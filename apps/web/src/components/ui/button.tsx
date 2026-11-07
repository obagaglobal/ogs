import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Buttons (Phase 6b). primary = ink; secondary = ink outline; ghost; danger
 * (destructive actions ONLY); highlight = saffron with on-saffron text, for the
 * one key action of a screen. `default`, `outline` and `destructive` remain as
 * aliases so existing screens keep their meaning. Touch targets are 44px tall
 * on small screens (WCAG 2.5.8 / Android guidance), 36px from md up.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shadcn convention: variants are reused by link-styled buttons.
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border font-display text-sm font-medium motion-fast transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        primary: 'border-ink bg-ink text-paper hover:bg-ink/85',
        secondary: 'border-ink bg-transparent text-ink hover:bg-surface-muted',
        ghost: 'border-transparent bg-transparent text-ink hover:bg-surface-muted',
        danger: 'border-danger bg-danger text-surface hover:bg-danger/90',
        highlight: 'border-saffron bg-saffron text-on-saffron hover:bg-saffron/85',
        link: 'h-auto min-h-0 border-transparent px-0 text-ink underline underline-offset-4 hover:decoration-saffron md:min-h-0',
        // Aliases kept for existing screens.
        default: 'border-ink bg-ink text-paper hover:bg-ink/85',
        outline: 'border-ink bg-transparent text-ink hover:bg-surface-muted',
        destructive: 'border-danger bg-danger text-surface hover:bg-danger/90',
      },
      size: {
        default: 'min-h-11 px-4 py-2 md:min-h-9',
        sm: 'min-h-11 px-3 text-sm md:min-h-8',
        lg: 'min-h-12 px-6 text-base',
        icon: 'size-11 md:size-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
