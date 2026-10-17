import { useEffect, useRef, useState } from 'react';

import { createVoiceSessionHub } from '@/modules/chat/utils/voiceSessionHub';
import type { VoiceSessionHub } from '@/modules/chat/utils/voiceSessionHub';
import { PROVIDER_PERMISSION_PREFERENCE_KEYS } from '@/shared/constants';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { readUserPreference } from '@/shared/userSettings';
import type { LLMProvider, VoiceDirectory, VoiceSessionEntry, VoiceTarget } from '@/shared/types';

type VoiceBridgeOptions = {
  getTarget(): VoiceTarget | null;
  getDirectory(): VoiceDirectory | null;
};

const NO_TOOL_LIMITS = { allowedTools: [], disallowedTools: [], skipPermissions: false };

/** Options for a message sent into a session that is not on screen: the saved tool permissions of its provider, as the composer would send. */
function buildBackgroundSendOptions(session: VoiceSessionEntry): Record<string, unknown> {
  const provider: LLMProvider = session.provider ?? 'claude';
  const toolsSettings = readUserPreference<Record<string, unknown>>(PROVIDER_PERMISSION_PREFERENCE_KEYS[provider], NO_TOOL_LIMITS);
  return {
    toolsSettings,
    skipPermissions: Boolean(toolsSettings.skipPermissions),
    sessionSummary: session.name,
  };
}

/**
 * Creates the one session hub of the app and feeds it every websocket frame,
 * so it can read a reply from any session whether or not it is on screen.
 * Sending into a session that is not on screen goes over the same websocket
 * with `chat.send`. Used by the live voice provider.
 */
export function useVoiceBridge(options: VoiceBridgeOptions): VoiceSessionHub {
  const { sendMessage, subscribe } = useWebSocket();
  const optionsRef = useRef(options);
  const sendRef = useRef(sendMessage);
  // Updated after each render, so the hub always calls the newest functions.
  useEffect(() => {
    optionsRef.current = options;
    sendRef.current = sendMessage;
  });
  // The hub is created once and reads everything else through refs, so it never has to be rebuilt.
  const [hub] = useState(() => createVoiceSessionHub({
    send: (frame) => sendRef.current(frame),
    getDirectory: () => optionsRef.current.getDirectory(),
    getTarget: () => optionsRef.current.getTarget(),
    buildSendOptions: buildBackgroundSendOptions,
    now: () => Date.now(),
  }));

  useEffect(() => subscribe((event) => hub.handleEvent(event)), [subscribe, hub]);
  // Only leaving the app fails waiting requests; a new websocket subscription must not.
  useEffect(() => () => hub.dispose('The app closed.'), [hub]);

  return hub;
}
