import { useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FieldIds {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/**
 * Label + control + help + error, wired for screen readers (Phase 6b). The
 * child is a render function receiving the ids, so any control fits:
 *   <FormField label="Phone" help="…">{(ids) => <Input {...ids} />}</FormField>
 */
export function FormField({
  label,
  help,
  error,
  optional = false,
  className,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string | undefined;
  children: (ids: FieldIds) => ReactElement;
}) {
  const id = useId();
  const described = [error ? `${id}-error` : undefined, help ? `${id}-help` : undefined]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block font-display text-sm font-medium text-ink">
        {label}
        {optional ? (
          <span className="ml-1 font-sans font-normal text-muted-foreground">(optional)</span>
        ) : null}
      </label>
      {children({
        id,
        ...(described === '' ? {} : { 'aria-describedby': described }),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {help ? (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
