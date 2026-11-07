import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Cards (Phase 6b): surface, 1px hairline, 4px radius, no shadow. `emphasis`
 * uses the strong 1px ink border for the card that matters most on a screen.
 */
export function Card({
  className,
  emphasis = false,
  ...props
}: ComponentProps<'section'> & { emphasis?: boolean }) {
  return (
    <section
      data-slot="card"
      className={cn(
        'rounded-md border bg-surface p-5 text-ink sm:p-6',
        emphasis ? 'border-ink' : 'border-border',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-medium leading-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Page title block: display heading, optional eyebrow and description. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        {eyebrow ? (
          <p className="font-display text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="max-w-2xl text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
