import {
  Checkbox as CheckboxPrimitive,
  RadioGroup as RadioPrimitive,
  Switch as SwitchPrimitive,
} from 'radix-ui';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Checkbox, radio and switch (Phase 6b), on Radix for correct roles and
 * keyboard behaviour. Outlines use control-border (3:1); checked state is ink.
 * The visible box is 20px; the hit area is padded to 44px on small screens.
 */
const hit = 'relative after:absolute after:-inset-3 md:after:-inset-1';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-5 shrink-0 rounded-sm border border-control-border bg-surface motion-fast transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=checked]:text-paper aria-invalid:border-danger',
        hit,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
    />
  );
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      data-slot="radio"
      className={cn(
        'aspect-square size-5 shrink-0 rounded-full border border-control-border bg-surface motion-fast transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-ink',
        hit,
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator className="flex items-center justify-center">
        <span className="size-2.5 rounded-full bg-ink" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Item>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-control-border bg-surface-muted motion-fast transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-ink data-[state=checked]:bg-ink',
        hit,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-1 rounded-full bg-ink motion-fast transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-saffron" />
    </SwitchPrimitive.Root>
  );
}
