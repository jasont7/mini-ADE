import { Check, Edit2, GitBranch, Loader2, Trash2, X } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';
import type { LLMProvider } from '@/shared/types';
import { useSessionForkingProviders } from '@/shared/hooks/useProviderCapabilities';
import { useProviderSessionIdCopy } from '@/modules/sidebar/hooks/useProviderSessionIdCopy';
import { PROVIDER_LABELS } from '@/modules/sidebar/utils/sidebarProjectFormatting';

type SessionOptionsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionName: string;
  provider: LLMProvider;
  isProcessing: boolean;
  isEditing: boolean;
  renameDraft: string;
  onRenameDraftChange: (draft: string) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onFork?: () => void;
};

/**
 * Rendered by SessionPaneRow on touch layouts: the same actions as the desktop
 * SessionOptions menu, as a bottom sheet with thumb-sized targets.
 */
export default function SessionOptionsSheet({
  open,
  onOpenChange,
  sessionId,
  sessionName,
  provider,
  isProcessing,
  isEditing,
  renameDraft,
  onRenameDraftChange,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onDelete,
  onFork,
}: SessionOptionsSheetProps) {
  const providerLabel = PROVIDER_LABELS[provider];
  const { copyState, copyLabel, setOptionsOpen, handleCopyAction, isCopyPending, CopyStateIcon } =
    useProviderSessionIdCopy(sessionId, providerLabel);
  const forkableProviders = useSessionForkingProviders();
  const canFork = Boolean(onFork) && forkableProviders.has(provider) && !isProcessing;

  const setOpen = (next: boolean) => {
    setOptionsOpen(next);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        aria-describedby="mobile-session-options-description"
        animationClassName="animate-bottom-sheet-content-show motion-reduce:animate-none"
        className="bottom-0 left-0 top-auto max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl border-x-0 border-b-0 px-4 pb-safe-area-inset-bottom pt-3"
      >
        <DialogTitle>Session options</DialogTitle>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />

        <div className="mb-4 flex items-center gap-3 px-1">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-muted">
            <LLMProviderLogo provider={provider} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground" title={sessionName}>
              {sessionName}
            </p>
            <p id="mobile-session-options-description" className="text-xs text-muted-foreground">
              {providerLabel} session
            </p>
          </div>
        </div>

        {isEditing ? (
          <div className="mb-3 space-y-2">
            <label htmlFor={`mobile-session-rename-${sessionId}`} className="block px-1 text-xs font-medium text-muted-foreground">
              Session name
            </label>
            <input
              id={`mobile-session-rename-${sessionId}`}
              type="text"
              value={renameDraft}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  onSaveRename();
                }
              }}
              className="w-full rounded-xl border-2 border-primary/40 bg-background px-3 py-3 text-foreground shadow-sm focus:border-primary focus:outline-none"
              autoFocus
              autoComplete="off"
              // 16px keeps iOS Safari from zooming the viewport on focus.
              style={{ fontSize: '16px' }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSaveRename}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
              >
                <Check className="h-5 w-5 flex-shrink-0" />
                Save
              </button>
              <button
                type="button"
                onClick={onCancelRename}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-muted/35 px-4 py-3 text-sm font-medium text-foreground transition-colors active:bg-muted"
              >
                <X className="h-5 w-5 flex-shrink-0" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={onStartRename}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
            >
              <Edit2 className="h-5 w-5 flex-shrink-0" />
              <span className="text-sm font-medium">Rename session</span>
            </button>

            <button
              type="button"
              onClick={handleCopyAction}
              disabled={isCopyPending}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                copyState === 'copied'
                  ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
                  : copyState === 'error'
                    ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                    : 'border-border bg-muted/35 text-foreground active:bg-muted',
              )}
            >
              {isCopyPending ? (
                <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin" />
              ) : (
                <CopyStateIcon className="h-5 w-5 flex-shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{copyLabel}</span>
                {copyState === 'error' && (
                  <span className="mt-0.5 block text-xs">Tap to try again.</span>
                )}
              </span>
            </button>

            {canFork && onFork && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onFork();
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-muted/35 px-4 py-3 text-left text-foreground transition-colors active:bg-muted"
              >
                <GitBranch className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">Fork session</span>
              </button>
            )}

            {!isProcessing && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-red-600 transition-colors active:bg-red-500/10 dark:text-red-400"
              >
                <Trash2 className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm font-medium">Archive or delete session</span>
              </button>
            )}
          </div>
        )}

        {!isEditing && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mb-3 mt-2 min-h-11 w-full rounded-xl text-sm font-medium text-muted-foreground transition-colors active:bg-muted"
          >
            Cancel
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
