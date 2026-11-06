import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { KitengeMotif } from './kitenge-motif';

/**
 * Alerts, skeletons, empty and error states (Phase 6b). Alerts announce
 * themselves (role=alert for errors, status otherwise); tinted fills carry ink
 * text with the colour on the border and icon.
 */
export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const ALERT: Record<AlertTone, { box: string; icon: typeof Info; colour: string }> = {
  info: { box: 'border-border bg-surface-muted', icon: Info, colour: 'text-ink' },
  success: { box: 'border-success bg-success/10', icon: CheckCircle2, colour: 'text-success' },
  warning: { box: 'border-warning bg-warning/10', icon: AlertTriangle, colour: 'text-warning' },
  error: { box: 'border-danger bg-danger/10', icon: XCircle, colour: 'text-danger' },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
}) {
  const { box, icon: Icon, colour } = ALERT[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-md border border-l-4 px-4 py-3 text-sm text-ink',
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', colour)} />
      <div className="space-y-1">
        {title ? <p className="font-display font-medium">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

/** A full-width banner (e.g. "this workspace is pending approval"). */
export function Banner({ tone = 'info', children }: { tone?: AlertTone; children: ReactNode }) {
  return (
    <Alert tone={tone} className="rounded-none border-x-0 border-t-0">
      {children}
    </Alert>
  );
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-muted', className)}
      {...props}
    />
  );
}

/** Nothing to show yet; one of the places the motif may appear. */
export function EmptyState({
  title,
  body,
  action,
  as: Title = 'p',
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  /** Use a heading when the empty state is the whole page (e.g. "not found"). */
  as?: 'p' | 'h1' | 'h2';
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-6 py-10 text-center">
      <KitengeMotif variant="divider" tone="muted" height={12} className="w-32" />
      <Title className="font-display text-lg font-medium">{title}</Title>
      {body ? <p className="max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title?: ReactNode;
  body?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-md border border-danger px-6 py-10 text-center"
    >
      <XCircle aria-hidden="true" className="size-6 text-danger" />
      <p className="font-display text-lg font-medium">{title ?? t('common.errorTitle')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body ?? t('common.errorBody')}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Full-page loading screen (the motif's other allowed place). */
export function PageLoader() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-svh flex-col items-center justify-center gap-4 bg-paper"
    >
      <KitengeMotif variant="band" height={16} className="w-48 animate-pulse" />
      <p className="font-display text-sm text-muted-foreground">{t('shell.loading')}</p>
    </div>
  );
}

/** Shown inside a layout while a route's code chunk loads (no motif: calm). */
export function RouteFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
