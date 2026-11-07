import { Paperclip } from 'lucide-react';
import { Progress } from 'radix-ui';
import { useId, useState } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

/**
 * File upload with a progress bar (Phase 6b). The component owns the picking,
 * the progress display and the error message; the caller provides `upload`,
 * which reports progress from 0 to 1 (see uploadWithProgress in
 * lib/upload.ts). No screen uploads files yet: Phase 5 KYC uses its own flow.
 */
export function FileUpload({
  label,
  accept,
  help,
  upload,
  onUploaded,
}: {
  label: string;
  accept?: string;
  help?: string;
  upload: (file: File, onProgress: (fraction: number) => void) => Promise<void>;
  onUploaded?: (file: File) => void;
}) {
  const id = useId();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading'; name: string; fraction: number }
    | { kind: 'done'; name: string }
    | { kind: 'error'; name: string }
  >({ kind: 'idle' });

  async function pick(file: File | undefined) {
    if (!file) return;
    setState({ kind: 'uploading', name: file.name, fraction: 0 });
    try {
      await upload(file, (fraction) => {
        setState({ kind: 'uploading', name: file.name, fraction });
      });
      setState({ kind: 'done', name: file.name });
      onUploaded?.(file);
    } catch {
      setState({ kind: 'error', name: file.name });
    }
  }

  const percent = state.kind === 'uploading' ? Math.round(state.fraction * 100) : 100;
  return (
    <div className="space-y-1.5">
      <span id={`${id}-label`} className="block font-display text-sm font-medium text-ink">
        {label}
      </span>
      <label
        htmlFor={id}
        className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-control-border bg-surface px-4 py-4 text-center text-sm hover:border-ink has-[:focus-visible]:border-ink"
      >
        <Paperclip aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="font-medium underline underline-offset-4">{t('common.chooseFile')}</span>
        {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
        <input
          id={id}
          type="file"
          className="sr-only"
          aria-labelledby={`${id}-label`}
          {...(accept ? { accept } : {})}
          disabled={state.kind === 'uploading'}
          onChange={(event) => void pick(event.target.files?.[0])}
        />
      </label>
      {state.kind === 'idle' ? null : (
        <div className="space-y-1" aria-live="polite">
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate">{state.name}</span>
            <span className={cn('tabular', state.kind === 'error' && 'text-danger')}>
              {state.kind === 'error' ? t('common.errorTitle') : `${String(percent)}%`}
            </span>
          </div>
          <Progress.Root
            value={percent}
            aria-label={t('common.uploading')}
            className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
          >
            <Progress.Indicator
              className={cn(
                'h-full motion-base transition-transform',
                state.kind === 'error'
                  ? 'bg-danger'
                  : state.kind === 'done'
                    ? 'bg-success'
                    : 'bg-saffron',
              )}
              style={{ transform: `translateX(-${String(100 - percent)}%)` }}
            />
          </Progress.Root>
        </div>
      )}
    </div>
  );
}
