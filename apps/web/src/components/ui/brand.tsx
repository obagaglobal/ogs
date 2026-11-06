import { cn } from '@/lib/utils';

/** The "O" brand mark: saffron with an ink edge, legible in both themes. */
export function BrandMark({ className }: { className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-sm border border-ink bg-saffron font-display text-sm font-bold text-on-saffron',
        className,
      )}
    >
      O
    </span>
  );
}
