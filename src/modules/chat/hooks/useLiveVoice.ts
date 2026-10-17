import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGeminiLive } from '@/modules/chat/hooks/useGeminiLive';
import { useGeminiLiveStatus } from '@/shared/hooks/useGeminiLiveStatus';
import { useSessionVoiceSettings } from '@/modules/chat/hooks/useSessionVoiceSettings';
import { setLiveVoiceActive } from '@/modules/chat/utils/autoSpeak';
import { voicePlayer } from '@/modules/chat/utils/voicePlayer';
import type { VoiceSessionHub } from '@/modules/chat/utils/voiceSessionHub';
import { buildVoiceRecap, createVoiceSession, VOICE_SESSION_INTRO } from '@/modules/chat/utils/voiceSession';
import { voiceTranscriptStore } from '@/modules/chat/utils/voiceTranscriptStore';
import { api } from '@/shared/api';
import { readGeminiVoice } from '@/shared/voiceConfig';
import type {
  GeminiLiveStatus,
  LiveVoiceSnapshot,
  Project,
  VoiceDirectory,
  VoiceMode,
  VoiceSessionInfo,
  VoiceTarget,
  VoiceTranscriptRole,
} from '@/shared/types';

/** What the composer's Gemini Live button, the new voice session button and the status pill read and drive. */
export type LiveVoiceController = {
  /** The mode of the running session, or the saved mode of the session on screen while none runs. 'off' means dictation. */
  mode: VoiceMode;
  /** True while a hands-free session is started and connected. */
  running: boolean;
  snapshot: LiveVoiceSnapshot | null;
  /** Why the last session stopped by itself, if it did. */
  endedNote: string | null;
  geminiStatus: GeminiLiveStatus | null;
  geminiAvailable: boolean;
  geminiReason: string | null;
  /** The voice session a running Gemini Live is attached to, or null when none runs. */
  voiceSession: VoiceSessionInfo | null;
  /** Ids of every voice session, for the voice mark in the session list. */
  voiceSessionIds: ReadonlySet<string>;
  /** True when the chat on screen has no session yet, so Gemini Live has nothing to attach to. */
  geminiNeedsSession: boolean;
  /**
   * Saves the mode and starts it. 'off' stops any live session and returns to
   * dictation. 'gemini' attaches the live voice to the session on screen and
   * continues its saved conversation.
   */
  select(mode: VoiceMode): void;
  /** Creates a new voice session in the project and starts Gemini Live in it. Ends any voice that is running. */
  startVoiceSession(project: Project): void;
  /** Takes the screen back to the voice session. */
  openVoiceSession(): void;
  stop(): void;
  setMuted(muted: boolean): void;
};

type LiveVoiceOptions = {
  /** The session on screen, which the saved mode follows. */
  sessionId: string | null;
  hub: VoiceSessionHub;
  getDirectory(): VoiceDirectory | null;
  getTarget(): VoiceTarget | null;
  /** Filled with a function the provider calls whenever the sidebar's sessions change, so the voice session's name follows renames. */
  followDirectoryRef: { current: ((directory: VoiceDirectory | null) => void) | null };
};

/**
 * The app's live voice: whether a hands-free session is running, its controls,
 * and the saved mode of the session on screen (what the voice button shows on a fresh
 * page). A Gemini Live run is attached to one voice session for its whole life,
 * so switching sessions never stops it and requests always go to that session.
 * Nothing starts without a call to `select` or `startVoiceSession`, which
 * come from a click and so also grant microphone access. Called once by the
 * live voice provider.
 */
export function useLiveVoice(options: LiveVoiceOptions): LiveVoiceController {
  const { sessionId, hub, getDirectory, getTarget, followDirectoryRef } = options;
  const geminiStatus = useGeminiLiveStatus();
  const { settings, update } = useSessionVoiceSettings(sessionId);
  // The mode of the running live session, null when none runs. Kept apart from the saved mode so the session survives a switch.
  const [runningMode, setRunningMode] = useState<VoiceMode | null>(null);
  // The Gemini voice saved in Settings when the session started, so it does not change under a running session.
  const [runningVoice, setRunningVoice] = useState<string | null>(null);
  const [endedNote, setEndedNote] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<VoiceSessionInfo | null>(null);
  const [voiceSessionIds, setVoiceSessionIds] = useState<ReadonlySet<string>>(() => new Set());
  // Counts voice sessions started, so a new one reconnects Gemini even though it is already running.
  const [runId, setRunId] = useState(0);
  const runIdRef = useRef(0);
  const voiceSessionRef = useRef<VoiceSessionInfo | null>(null);
  // Resolves when the running voice session exists and Claude has taken its first message. Requests wait on it.
  const voiceReadyRef = useRef<Promise<void>>(Promise.resolve());
  // Entries that arrive before the session has an id wait here.
  const earlyEntriesRef = useRef<{ role: VoiceTranscriptRole; text: string; at: number }[]>([]);

  const setSession = useCallback((next: VoiceSessionInfo | null) => {
    voiceSessionRef.current = next;
    setVoiceSession(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.voice.voiceSessions()
      .then(async (response) => (response.ok ? ((await response.json()) as { sessionIds?: string[] }).sessionIds ?? [] : []))
      .then((ids) => {
        if (!cancelled) setVoiceSessionIds((current) => new Set([...current, ...ids]));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const markVoiceSession = useCallback((id: string) => {
    setVoiceSessionIds((current) => (current.has(id) ? current : new Set([...current, id])));
  }, []);

  // Any end of a live session, by itself or on request, goes through here so state never says running with nothing connected.
  const handleEnded = useCallback((reason: string) => {
    setRunningMode(null);
    setSession(null);
    setEndedNote(reason);
  }, [setSession]);

  // Gemini's requests go to the voice session, never to the one on screen.
  const askClaude = useCallback(async (request: string) => {
    const run = runIdRef.current;
    await voiceReadyRef.current;
    // Another voice session took over while this request waited: it belongs to the one that ended.
    if (runIdRef.current !== run) throw new Error('The voice session ended.');
    const id = voiceSessionRef.current?.sessionId;
    if (!id) throw new Error('The voice session is not ready.');
    return hub.askSession(id, request);
  }, [hub]);
  const getRecap = useCallback(async () => {
    const id = voiceSessionRef.current?.sessionId;
    if (!id) return null;
    await voiceTranscriptStore.load(id).catch(() => undefined);
    return buildVoiceRecap(voiceTranscriptStore.get(id));
  }, []);
  const onTranscript = useCallback((role: VoiceTranscriptRole, text: string, at: number) => {
    const id = voiceSessionRef.current?.sessionId;
    if (!id) {
      earlyEntriesRef.current.push({ role, text, at });
      return;
    }
    voiceTranscriptStore.append(id, { id: crypto.randomUUID(), role, text, at });
  }, []);
  const geminiLive = useGeminiLive({
    active: runningMode === 'gemini',
    runId,
    status: geminiStatus,
    voice: runningVoice,
    askClaude,
    getRecap,
    onTranscript,
    onEnded: handleEnded,
  });
  const live = runningMode === 'gemini' ? geminiLive : null;
  // Gemini picked while the server cannot offer it has nothing to connect to, so it is not running.
  const geminiUnavailable = runningMode === 'gemini' && geminiStatus !== null && !geminiStatus.configured;
  useEffect(() => {
    if (!geminiUnavailable) return;
    setRunningMode(null);
    setSession(null);
    setEndedNote(geminiStatus?.reason ?? 'Gemini Live is not available.');
  }, [geminiUnavailable, geminiStatus?.reason, setSession]);
  const running = runningMode !== null && !geminiUnavailable;

  // Requests still waiting on a reply belong to the voice session that ended with it.
  useEffect(() => {
    if (!running) hub.dispose('The voice session ended.');
  }, [running, hub]);

  // A live session speaks for itself. Keep the read-aloud player quiet while it runs.
  useEffect(() => {
    setLiveVoiceActive(running);
    if (running) voicePlayer.stop();
    return () => setLiveVoiceActive(false);
  }, [running]);

  // Entries that were said before the id arrived are saved the moment it does.
  const flushEarlyEntries = useCallback((id: string) => {
    for (const entry of earlyEntriesRef.current.splice(0)) {
      voiceTranscriptStore.append(id, { id: crypto.randomUUID(), ...entry });
    }
  }, []);

  // Starts one voice run: ends the previous one, which is what keeps it to one live voice at a time.
  const beginRun = useCallback((info: VoiceSessionInfo, voice: string | null) => {
    hub.dispose('The voice session ended.');
    earlyEntriesRef.current = [];
    runIdRef.current += 1;
    setRunId(runIdRef.current);
    setEndedNote(null);
    setRunningVoice(voice);
    setSession(info);
    setRunningMode('gemini');
    return runIdRef.current;
  }, [hub, setSession]);

  const startVoiceSession = useCallback((project: Project) => {
    const projectPath = project.fullPath || project.path || '';
    const runForThis = beginRun({ sessionId: null, name: '', projectName: project.displayName }, readGeminiVoice());
    voiceReadyRef.current = (async () => {
      try {
        const created = await createVoiceSession(
          { createSession: api.providers.createSession, registerVoiceSession: api.voice.registerVoiceSession },
          { projectPath, now: new Date() },
        );
        // Another voice session was started while this one was being created: this one is not wanted any more.
        if (runIdRef.current !== runForThis) return;
        setSession({ sessionId: created.sessionId, name: created.name, projectName: project.displayName });
        markVoiceSession(created.sessionId);
        flushEarlyEntries(created.sessionId);
        const directory = getDirectory();
        directory?.establishSession(created.sessionId, { provider: 'claude', project, summary: created.name });
        // Claude learns what this session is before anything else reaches it. A refusal here does not stop the call.
        const introDone = hub.askSession(created.sessionId, VOICE_SESSION_INTRO).catch(() => undefined);
        directory?.openSession(created.sessionId);
        await introDone;
      } catch (error) {
        if (runIdRef.current !== runForThis) return;
        setRunningMode(null);
        setSession(null);
        setEndedNote(error instanceof Error ? error.message : 'Could not start the voice session.');
      }
    })();
  }, [beginRun, flushEarlyEntries, getDirectory, hub, markVoiceSession, setSession]);

  // Gemini Live from its composer button: the same voice session flow, attached to the session already on screen.
  const attachToScreenSession = useCallback(() => {
    const target = getTarget();
    if (!target?.sessionId) return;
    const id = target.sessionId;
    const name = target.sessionName ?? 'Voice session';
    beginRun({ sessionId: id, name, projectName: target.projectName }, readGeminiVoice());
    voiceReadyRef.current = api.voice.registerVoiceSession(id, name).then(() => markVoiceSession(id)).catch(() => undefined);
  }, [beginRun, getTarget, markVoiceSession]);

  const select = useCallback((next: VoiceMode) => {
    update({ mode: next, geminiVoice: settings.geminiVoice });
    if (next === 'gemini') {
      attachToScreenSession();
      return;
    }
    setEndedNote(null);
    setSession(null);
    setRunningMode(null);
  }, [attachToScreenSession, setSession, settings.geminiVoice, update]);
  const stop = useCallback(() => {
    setRunningMode(null);
    setSession(null);
  }, [setSession]);
  const openVoiceSession = useCallback(() => {
    const id = voiceSessionRef.current?.sessionId;
    if (id) getDirectory()?.openSession(id);
  }, [getDirectory]);

  // The session's name can change after it was created (Claude names it), so the pill follows the sidebar's list.
  useEffect(() => {
    followDirectoryRef.current = (directory) => {
      const current = voiceSessionRef.current;
      const entry = current?.sessionId ? directory?.sessions.find((item) => item.id === current.sessionId) : null;
      if (current && entry && entry.name !== current.name) setSession({ ...current, name: entry.name });
    };
    return () => {
      followDirectoryRef.current = null;
    };
  }, [setSession, followDirectoryRef]);

  const geminiNeedsSession = sessionId === null;

  // Stable between renders that change nothing, so readers of the provider's context stay quiet.
  return useMemo(() => ({
    mode: runningMode ?? settings.mode,
    running,
    snapshot: running ? live?.snapshot ?? null : null,
    endedNote,
    geminiStatus,
    geminiAvailable: Boolean(geminiStatus?.configured),
    geminiReason: geminiStatus?.reason ?? null,
    voiceSession: running ? voiceSession : null,
    voiceSessionIds,
    geminiNeedsSession,
    select,
    startVoiceSession,
    openVoiceSession,
    stop,
    setMuted: live?.setMuted ?? (() => undefined),
  }), [
    runningMode, settings.mode, running, live?.snapshot, live?.setMuted, voiceSession,
    voiceSessionIds, geminiNeedsSession, endedNote, geminiStatus, select, startVoiceSession,
    openVoiceSession, stop,
  ]);
}
