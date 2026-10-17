import type {
  GeminiLiveService,
  GeminiLiveStatus,
  VoiceServiceResult,
} from '@/shared/types.js';

const AUTH_TOKENS_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';

// The browser may open the connection for a minute after the token is minted,
// and the token itself lives long enough for a long chat that reconnects.
const NEW_SESSION_WINDOW_MS = 60_000;
const TOKEN_LIFETIME_MS = 30 * 60_000;

/** Prebuilt Gemini voice presets from Google's speech generation docs. */
export const GEMINI_VOICE_PRESETS: readonly string[] = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

const DEFAULT_GEMINI_VOICE = 'Zephyr';

type GeminiLiveDependencies = {
  /** Server-held key. Empty means Gemini Live is unavailable. */
  apiKey: string;
  model: string;
  fetchGoogle(url: string, options: RequestInit): Promise<Response>;
  now(): number;
};

// Google documents asynchronous tool calls for the 2.5 Live models only. The
// 3.x Live models answer a tool call only after the response is sent back.
function supportsNonBlockingTools(model: string): boolean {
  return /gemini-2\.5/.test(model);
}

/**
 * Creates the Gemini Live service. It mints one-use ephemeral tokens so the
 * browser can connect to Google directly while the API key stays on the
 * server. Error messages never include the key or Google's response body.
 */
export function createGeminiLiveService(dependencies: GeminiLiveDependencies): GeminiLiveService {
  const configured = Boolean(dependencies.apiKey);

  return {
    getStatus(): GeminiLiveStatus {
      return {
        configured,
        reason: configured ? null : 'Add GEMINI_API_KEY to the server .env to enable Gemini Live.',
        model: dependencies.model,
        nonBlockingTools: supportsNonBlockingTools(dependencies.model),
        voices: [...GEMINI_VOICE_PRESETS],
        defaultVoice: DEFAULT_GEMINI_VOICE,
      };
    },

    async mintToken(): Promise<VoiceServiceResult<{ token: string; model: string; expiresAt: string }>> {
      if (!configured) {
        return { ok: false, status: 503, error: 'Gemini Live is not configured on the server.' };
      }

      const now = dependencies.now();
      const expiresAt = new Date(now + TOKEN_LIFETIME_MS).toISOString();
      try {
        const response = await dependencies.fetchGoogle(AUTH_TOKENS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': dependencies.apiKey,
          },
          // No lock to a model or config: Google's REST body has no liveConnectConstraints field (HTTP 400,
          // verified 2026-10-09), and a lock would reject the browser's own setup message. The token is still
          // one-use, valid for a minute to open and 30 minutes to run.
          body: JSON.stringify({
            uses: 1,
            expireTime: expiresAt,
            newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
          }),
        });

        if (!response.ok) {
          return {
            ok: false,
            status: 502,
            error: response.status === 401 || response.status === 403
              ? 'Google rejected the Gemini API key.'
              : `Google could not issue a Live token (${response.status}).`,
          };
        }

        const parsed = await response.json().catch(() => null) as { name?: unknown } | null;
        if (!parsed || typeof parsed.name !== 'string' || !parsed.name) {
          return { ok: false, status: 502, error: 'Google returned no Live token.' };
        }

        return {
          ok: true,
          value: { token: parsed.name, model: dependencies.model, expiresAt },
        };
      } catch {
        return { ok: false, status: 502, error: 'Google could not be reached for a Live token.' };
      }
    },
  };
}
