import type { ReactNode } from 'react';
import { t, type MessageKey } from '@/i18n';
import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'live';

const TONES: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: 'border-border bg-surface-muted', dot: 'bg-muted-foreground' },
  // Tinted fills carry ink text; the colour is on the border and dot (contrast.test.ts).
  success: { box: 'border-success bg-success/10', dot: 'bg-success' },
  warning: { box: 'border-warning bg-warning/10', dot: 'bg-warning' },
  danger: { box: 'border-danger bg-danger/10', dot: 'bg-danger' },
  live: { box: 'border-saffron bg-saffron text-on-saffron', dot: 'bg-on-saffron' },
};

/** A small label. Colour is never the only signal: the text says it too. */
export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-display text-xs font-medium text-ink',
        TONES[tone].box,
        className,
      )}
    >
      {dot ? (
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', TONES[tone].dot)} />
      ) : null}
      {children}
    </span>
  );
}

export type Status =
  | 'draft'
  | 'pending'
  | 'active'
  | 'live'
  | 'completed'
  | 'paid'
  | 'overdue'
  | 'breached'
  | 'suspended';

const STATUS_TONE: Record<Status, Tone> = {
  draft: 'neutral',
  pending: 'warning',
  active: 'success',
  live: 'live',
  completed: 'success',
  paid: 'success',
  overdue: 'danger',
  breached: 'danger',
  suspended: 'danger',
};

/** The shared status vocabulary (draft … suspended), with a dot and a label. */
export function StatusPill({
  status,
  label,
  className,
}: {
  status: Status;
  label?: string;
  className?: string;
}) {
  return (
    <Badge tone={STATUS_TONE[status]} dot className={className}>
      {label ?? t(`status.${status}` as MessageKey)}
    </Badge>
  );
}
