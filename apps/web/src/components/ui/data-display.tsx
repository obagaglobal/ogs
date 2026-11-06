import { formatKes } from '@ogs/contracts';
import { Avatar as AvatarPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { initialsOf } from '@/lib/initials';
import { cn } from '@/lib/utils';

/** Money is always "KES 84,500", mono with tabular figures. */
export function Money({ minor, className }: { minor: number; className?: string }) {
  return <span className={cn('tabular whitespace-nowrap', className)}>{formatKes(minor)}</span>;
}

/** Reference numbers, codes and IDs (REQ-2026-000123 …) in mono. */
export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('tabular text-[0.95em]', className)}>{children}</span>;
}

/** A labelled number for dashboards: the value is mono. */
export function StatTile({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn('rounded-md border bg-surface p-4', emphasis ? 'border-ink' : 'border-border')}
    >
      <p className="font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="tabular mt-1 text-2xl text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Avatar with initials (full-round is allowed for avatars only). */
export function Avatar({
  name,
  size = 32,
  className,
}: {
  name: string;
  size?: number;
  className?: string | undefined;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-ink bg-saffron',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AvatarPrimitive.Fallback
        className="font-display text-xs font-bold text-on-saffron"
        delayMs={0}
      >
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
