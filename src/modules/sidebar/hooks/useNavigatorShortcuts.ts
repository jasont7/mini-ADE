import { useEffect, useLayoutEffect, useRef } from 'react';

type NavigatorShortcutHandlers = {
  /** Alt+0 picks every project; Alt+1..9 the rail's projects in order. */
  onSelectScopeIndex: (index: number) => void;
  /** Alt+Up and Alt+Down step through the pane's sessions in display order. */
  onStepSession: (direction: -1 | 1) => void;
};

/**
 * Keyboard switching for the navigator.
 *
 * Matches on `event.code`, not `event.key`: on macOS Option+digit types a
 * symbol (Option+1 is "¡"), so the key value says nothing useful. The default
 * is prevented so that symbol never lands in the composer. Handlers sit behind
 * a ref, so the listener is attached once and never sees stale state.
 */
export function useNavigatorShortcuts(handlers: NavigatorShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.isComposing) {
        return;
      }

      const digit = /^Digit(\d)$/.exec(event.code);
      if (digit) {
        event.preventDefault();
        handlersRef.current.onSelectScopeIndex(Number(digit[1]));
        return;
      }

      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        handlersRef.current.onStepSession(event.code === 'ArrowUp' ? -1 : 1);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
