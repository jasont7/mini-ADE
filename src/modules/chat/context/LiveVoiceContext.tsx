import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useLiveVoice } from '@/modules/chat/hooks/useLiveVoice';
import type { LiveVoiceController } from '@/modules/chat/hooks/useLiveVoice';
import { useVoiceBridge } from '@/modules/chat/hooks/useVoiceBridge';
import type { VoiceDirectory, VoiceTarget } from '@/shared/types';

/** Who is on screen as the chat interface last reported it. The submit function is kept apart so a new function each render does not re-register the target. */
type TargetIdentity = Omit<VoiceTarget, 'submitText'>;

type VoiceRegistry = {
  setTarget(identity: TargetIdentity | null): void;
  submitRef: { current: ((text: string) => void) | null };
  setDirectory(directory: VoiceDirectory | null): void;
};

// Two contexts so a chat update that only moves the target does not re-render the controller's readers.
const LiveVoiceControllerContext = createContext<LiveVoiceController | null>(null);
const VoiceRegistryContext = createContext<VoiceRegistry | null>(null);

/**
 * Owns the one live voice of the app. It sits above the router so switching
 * sessions, projects or tabs never unmounts it, and the mic menu in every
 * session shows the same state. A Gemini Live run is attached to its voice
 * session, so requests go there whatever is on screen. Mounted by App; read
 * through `useLiveVoiceController`, fed by `useRegisterVoiceTarget` (the
 * session on screen) and `useRegisterVoiceDirectory` (the sidebar's sessions).
 */
export function LiveVoiceProvider({ children }: { children: ReactNode }) {
  // The session on screen; state because the saved voice mode follows it.
  const [target, setTargetState] = useState<TargetIdentity | null>(null);
  const targetRef = useRef<TargetIdentity | null>(null);
  const submitRef = useRef<((text: string) => void) | null>(null);
  // The sidebar's sessions; a ref because the hub reads it when a request is sent and nothing renders from it.
  const directoryRef = useRef<VoiceDirectory | null>(null);
  const followDirectoryRef = useRef<((directory: VoiceDirectory | null) => void) | null>(null);

  const registry = useMemo<VoiceRegistry>(() => ({
    setTarget: (identity) => {
      targetRef.current = identity;
      setTargetState((current) => (
        current?.sessionId === identity?.sessionId
        && current?.sessionName === identity?.sessionName
        && current?.projectName === identity?.projectName
          ? current
          : identity
      ));
    },
    submitRef,
    setDirectory: (directory) => {
      directoryRef.current = directory;
      followDirectoryRef.current?.(directory);
    },
  }), []);

  const getDirectory = useCallback(() => directoryRef.current, []);
  const getTarget = useCallback((): VoiceTarget | null => (targetRef.current && submitRef.current
    ? { ...targetRef.current, submitText: (text) => submitRef.current?.(text) }
    : null), []);
  const hub = useVoiceBridge({ getTarget, getDirectory });

  const controller = useLiveVoice({
    sessionId: target?.sessionId ?? null,
    hub,
    getDirectory,
    getTarget,
    followDirectoryRef,
  });

  // A new chat that gets its session id is the same chat: a request waiting on it follows the id.
  const sessionId = target?.sessionId ?? null;
  useEffect(() => {
    if (sessionId) hub.bindNewSession(sessionId);
  }, [sessionId, hub]);

  return (
    <VoiceRegistryContext.Provider value={registry}>
      <LiveVoiceControllerContext.Provider value={controller}>{children}</LiveVoiceControllerContext.Provider>
    </VoiceRegistryContext.Provider>
  );
}

/** Used by the chat interface, the sidebar and the voice status control to read and drive the app's live voice. */
export function useLiveVoiceController(): LiveVoiceController {
  const controller = useContext(LiveVoiceControllerContext);
  if (!controller) throw new Error('useLiveVoiceController is used outside LiveVoiceProvider');
  return controller;
}

/**
 * Used by the chat interface to say which session is on screen and how to
 * submit text into it. Re-registers only when the session or its names change,
 * and clears the target when the chat unmounts.
 */
export function useRegisterVoiceTarget(target: VoiceTarget): void {
  const registry = useContext(VoiceRegistryContext);
  if (!registry) throw new Error('useRegisterVoiceTarget is used outside LiveVoiceProvider');
  const { sessionId, sessionName, projectName, submitText } = target;
  // After every render, and after a replaced chat's cleanup, so the newest chat's function is the one kept.
  useEffect(() => {
    registry.submitRef.current = submitText;
  });
  useEffect(() => {
    registry.setTarget({ sessionId, sessionName, projectName });
  }, [registry, sessionId, sessionName, projectName]);
  useEffect(() => () => {
    registry.setTarget(null);
    registry.submitRef.current = null;
  }, [registry]);
}

/**
 * Used by the project workspace to hand the live voice the sessions the
 * sidebar lists and the controls to open or add one. Cleared when the workspace
 * unmounts.
 */
export function useRegisterVoiceDirectory(directory: VoiceDirectory): void {
  const registry = useContext(VoiceRegistryContext);
  if (!registry) throw new Error('useRegisterVoiceDirectory is used outside LiveVoiceProvider');
  useEffect(() => {
    registry.setDirectory(directory);
  }, [registry, directory]);
  useEffect(() => () => registry.setDirectory(null), [registry]);
}
