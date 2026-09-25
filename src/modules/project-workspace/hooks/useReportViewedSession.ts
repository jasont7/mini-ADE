import { useEffect, useState } from 'react';

import { useWebSocket } from '@/shared/context/WebSocketContext';

const isPageVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Tells the server which session this client has on screen, or null when none
 * is open or the page is hidden. The server turns that into the last-viewed and
 * unread state every device shows, so a reply read here is read everywhere.
 *
 * Re-sent whenever the socket reconnects, because the server forgets what a
 * closed socket was showing.
 */
export function useReportViewedSession(viewedSessionId: string | null): void {
  const { sendMessage, isConnected } = useWebSocket();
  const [isVisible, setIsVisible] = useState(isPageVisible);

  useEffect(() => {
    const handleVisibilityChange = () => setIsVisible(isPageVisible());
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const reportedSessionId = isVisible ? viewedSessionId : null;

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    sendMessage({ type: 'session.viewing', sessionId: reportedSessionId });
  }, [isConnected, reportedSessionId, sendMessage]);
}
