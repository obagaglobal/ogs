import type { ComponentProps, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

/** A labelled input with an optional error, wired for screen readers. */
export function Field({
  label,
  error,
  hint,
  className,
  ...input
}: ComponentProps<'input'> & {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : undefined, hint ? `${id}-hint` : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn('rounded-lg border bg-card p-6 text-card-foreground shadow-xs', className)}
    >
      {children}
    </section>
  );
}

/** Announced to screen readers (role=alert for errors, status otherwise). */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        tone === 'error' && 'border-destructive/40 bg-destructive/5 text-destructive',
        tone === 'success' && 'border-emerald-700/30 bg-emerald-50 text-emerald-900',
        tone === 'info' && 'bg-muted text-foreground',
      )}
    >
      {children}
    </div>
  );
}
