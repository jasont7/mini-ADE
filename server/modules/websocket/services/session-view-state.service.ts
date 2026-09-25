import { sessionsDb } from '@/modules/database/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { RealtimeClientConnection, SessionViewStateEvent } from '@/shared/types.js';

/**
 * Which session each connected client has on screen, and the two timestamps
 * derived from it: `last_viewed_at` and `last_completed_at`.
 *
 * A client reports the session it is showing with `session.viewing` (null when
 * nothing is selected or the page is hidden). The server stamps a session as
 * viewed when a client starts or stops showing it, and a run that finishes
 * while any client is showing it is read on arrival. Keeping this on the
 * server is what makes the sidebar's unread dot and grey-out the same on every
 * device.
 */
const viewedSessionByConnection = new Map<RealtimeClientConnection, string>();

function isOnScreen(sessionId: string): boolean {
  for (const viewedSessionId of viewedSessionByConnection.values()) {
    if (viewedSessionId === sessionId) {
      return true;
    }
  }
  return false;
}

/**
 * Its own event rather than `session_upserted`: clients treat an upsert of the
 * session on screen as a transcript change and reload its messages.
 */
function broadcastViewState(sessionId: string): void {
  const row = sessionsDb.getSessionById(sessionId);
  if (!row) {
    return;
  }

  const event: SessionViewStateEvent = {
    kind: 'session_view_state',
    sessionId: row.session_id,
    lastViewedAt: row.last_viewed_at,
    lastCompletedAt: row.last_completed_at,
  };
  const payload = JSON.stringify(event);
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
}

function markViewed(sessionId: string, viewedAt: string): void {
  sessionsDb.markSessionViewed(sessionId, viewedAt);
  broadcastViewState(sessionId);
}

export const sessionViewStateService = {
  /** Records what `connection` now shows; null when it shows no session. */
  setViewedSession(connection: RealtimeClientConnection, sessionId: string | null): void {
    const previousSessionId = viewedSessionByConnection.get(connection) ?? null;
    if (previousSessionId === sessionId) {
      return;
    }

    if (sessionId) {
      viewedSessionByConnection.set(connection, sessionId);
    } else {
      viewedSessionByConnection.delete(connection);
    }

    // Stamped on the way in and on the way out, so time spent reading counts.
    const now = new Date().toISOString();
    for (const touchedSessionId of [previousSessionId, sessionId]) {
      if (touchedSessionId) {
        markViewed(touchedSessionId, now);
      }
    }
  },

  /** A closed socket stops showing whatever it had open. */
  dropConnection(connection: RealtimeClientConnection): void {
    this.setViewedSession(connection, null);
  },

  /** Called once per run when its terminal `complete` passes through the registry. */
  recordRunCompleted(sessionId: string): void {
    const now = new Date().toISOString();
    sessionsDb.markSessionCompleted(sessionId, now);
    if (isOnScreen(sessionId)) {
      sessionsDb.markSessionViewed(sessionId, now);
    }
    broadcastViewState(sessionId);
  },

  /** Test-only: forgets every connection. */
  clearAll(): void {
    viewedSessionByConnection.clear();
  },
};
