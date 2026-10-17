import os from 'node:os';
import path from 'node:path';

import multer from 'multer';

import { sessionVoiceSettingsDb, voiceTranscriptDb } from '@/modules/database/index.js';

import { createGeminiLiveService, GEMINI_VOICE_PRESETS } from './gemini-live.service.js';
import { createLiveDictationService } from './live-dictation.service.js';
import { createSessionVoiceSettingsService } from './session-voice-settings.service.js';
import { createVoiceTranscriptService } from './voice-transcript.service.js';
import { createVoiceRouter } from './voice.routes.js';
import { createVoiceService } from './voice.service.js';

const DEFAULT_VOICE_TIMEOUT_MS = 300_000;
const parsedTimeoutMs = Number(process.env.VOICE_TIMEOUT_MS);
const voiceTimeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
  ? parsedTimeoutMs
  : DEFAULT_VOICE_TIMEOUT_MS;

const voiceService = createVoiceService({
  defaults: {
    // The server-controlled URL is intentional: frontend-configured custom
    // backends are called directly by the browser and never become SSRF input.
    baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.VOICE_API_KEY || '',
    sttModel: process.env.VOICE_STT_MODEL || 'whisper-1',
    ttsModel: process.env.VOICE_TTS_MODEL || 'tts-1',
    ttsVoice: process.env.VOICE_TTS_VOICE || 'alloy',
  },
  timeoutMs: voiceTimeoutMs,
  fetchBackend: async (url, options) => {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), voiceTimeoutMs);
    try {
      return await fetch(url, {
        redirect: 'manual',
        ...options,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const geminiLiveService = createGeminiLiveService({
  // Read once here so the key only ever lives in the service closure.
  apiKey: (process.env.GEMINI_API_KEY || '').trim(),
  model: (process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live').trim(),
  fetchGoogle: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15_000) }),
  now: () => Date.now(),
});

const sessionVoiceSettingsService = createSessionVoiceSettingsService({
  store: sessionVoiceSettingsDb,
  voices: GEMINI_VOICE_PRESETS,
});

// Markdown copies live next to the database in mini-ADE's own data folder, never inside a project.
const voiceTranscriptService = createVoiceTranscriptService({
  store: voiceTranscriptDb,
  directory: path.join(
    process.env.DATABASE_PATH ? path.dirname(process.env.DATABASE_PATH) : path.join(os.homedir(), '.cloudcli'),
    'voice-transcripts',
  ),
});

/** Voice router assembled for the server entrypoint. */
export const voiceRoutes = createVoiceRouter({
  voiceService,
  geminiLiveService,
  sessionVoiceSettingsService,
  voiceTranscriptService,
  parseAudioUpload: audioUpload.single('audio'),
});

const liveDictationService = createLiveDictationService({
  baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
  apiKey: process.env.VOICE_API_KEY || '',
});

/** Live dictation relay assembled for the websocket gateway. */
export const handleLiveDictationConnection = liveDictationService.handleConnection;
