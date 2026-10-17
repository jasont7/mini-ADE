import type { IncomingMessage } from 'node:http';

import { WebSocket } from 'ws';

type LiveDictationDependencies = {
  baseUrl: string;
  apiKey: string;
};

const STREAM_PATH = '/audio/transcriptions/stream';

/** Maps the speech backend's http(s) base URL onto its streaming endpoint, or null when it is unusable. */
function buildUpstreamUrl(baseUrl: string): string | null {
  try {
    const parsed = new URL(`${baseUrl.replace(/\/$/, '')}${STREAM_PATH}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // Same defense in depth as the HTTP voice proxy: never reach link-local metadata addresses.
    if (parsed.hostname.startsWith('169.254.')) {
      return null;
    }
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Creates the live dictation relay. The browser never reaches the speech server
 * directly, so this pipes frames both ways to its streaming endpoint with no
 * buffering and closes each side when the other closes.
 */
export function createLiveDictationService(dependencies: LiveDictationDependencies) {
  const upstreamUrl = buildUpstreamUrl(dependencies.baseUrl);

  return {
    /** Used by the websocket module's gateway for `/api/voice/dictate`, after it has authenticated the upgrade. */
    handleConnection(clientWs: WebSocket, request: IncomingMessage): void {
      if (!upstreamUrl) {
        clientWs.close(4503, 'Speech backend not configured');
        return;
      }

      // Browsers cannot set headers on a websocket, so a per-user key (the
      // x-voice-api-key equivalent) arrives as a query parameter.
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');
      const apiKey = requestUrl.searchParams.get('voice_key')?.trim() || dependencies.apiKey;

      const upstream = new WebSocket(upstreamUrl, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        handshakeTimeout: 10_000,
      });

      upstream.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      // The client waits for the upstream `ready` frame before sending, so
      // anything arriving before the upstream is open is dropped, not queued.
      clientWs.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        }
      });

      upstream.on('close', () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close();
        }
      });

      clientWs.on('close', () => {
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.terminate();
        }
      });

      upstream.on('error', (error) => {
        console.error('[Voice] dictation upstream error:', error.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(4502, 'Upstream error');
        }
      });

      clientWs.on('error', () => {
        upstream.terminate();
      });
    },
  };
}
