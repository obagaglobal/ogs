import type { ComponentProps, ReactNode } from 'react';
import { Alert } from './feedback';
import { FormField } from './form-field';
import { Input } from './input';

/**
 * Compact helpers used across the existing screens. Since Phase 6b they are
 * thin wrappers over the design-system primitives (FormField + Input, Card,
 * Alert), so every screen picks up the Kitenge signal styling.
 */
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
  return (
    <FormField label={label} help={hint} error={error} className={className}>
      {(ids) => <Input {...ids} {...input} />}
    </FormField>
  );
}

export { Card } from './card';

/** Announced to screen readers (role=alert for errors, status otherwise). */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  children: ReactNode;
}) {
  return <Alert tone={tone}>{children}</Alert>;
}
