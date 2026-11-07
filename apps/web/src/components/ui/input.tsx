import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Text inputs (Phase 6b). Outlines use control-border (3:1, WCAG 1.4.11);
 * errors use danger; the focus ring comes from the global :focus-visible.
 * 44px tall on small screens. Select is the native element on purpose: it is
 * accessible everywhere and gives phones their own picker.
 */
const control =
  'w-full rounded-md border border-control-border bg-surface px-3 text-base text-ink placeholder:text-muted-foreground motion-fast transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger md:text-sm';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(control, 'min-h-11 py-2 md:min-h-10', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea data-slot="textarea" className={cn(control, 'min-h-24 py-2', className)} {...props} />
  );
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(control, 'min-h-11 cursor-pointer appearance-auto py-2 md:min-h-10', className)}
      {...props}
    />
  );
}
