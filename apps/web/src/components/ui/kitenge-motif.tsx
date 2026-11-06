import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The Kitenge motif (Phase 6b signature element): an original geometric band of
 * alternating triangles, inspired by East African kitenge fabric but not
 * copied from any textile. Inline SVG, decorative only (aria-hidden).
 *
 * Allowed ONLY in: the public header strip, the public home/catalogue hero,
 * empty states, the full-page loader, sign-in/sign-up, and marketing section
 * dividers. NEVER behind text, in tables or forms, or more than once per
 * viewport in authenticated workspaces (e2e/motif.spec.ts counts it).
 */
export type MotifVariant = 'band' | 'corner' | 'divider';
export type MotifTone = 'saffron-ink' | 'saffron-only' | 'muted';

const TONE: Record<MotifTone, [string, string]> = {
  'saffron-ink': ['fill-saffron', 'fill-ink'],
  'saffron-only': ['fill-saffron', 'fill-saffron/40'],
  muted: ['fill-border', 'fill-control-border'],
};

export function KitengeMotif({
  height = 12,
  variant = 'band',
  tone = 'saffron-ink',
  className,
}: {
  height?: number;
  variant?: MotifVariant;
  tone?: MotifTone;
  className?: string | undefined;
}) {
  const patternId = useId();
  const [first, second] = TONE[tone];
  if (variant === 'corner') {
    // Three nested triangles anchored in a corner.
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        data-motif="corner"
        viewBox="0 0 48 48"
        width={height * 4}
        height={height * 4}
        className={cn('shrink-0', className)}
      >
        <path d="M0 0 H48 L0 48 Z" className={first} />
        <path d="M0 0 H30 L0 30 Z" className={second} />
        <path d="M0 0 H14 L0 14 Z" className={first} />
      </svg>
    );
  }
  // band / divider: a repeating strip of up- and down-pointing triangles with a
  // small diamond "seed" between them (the divider is thinner and lighter).
  const unit = 24;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-motif={variant}
      preserveAspectRatio="none"
      height={height}
      className={cn('block w-full', className)}
    >
      <defs>
        <pattern
          id={patternId}
          width={unit}
          height={12}
          patternUnits="userSpaceOnUse"
          patternTransform={`scale(${String(height / 12)})`}
        >
          <path d="M0 12 L6 0 L12 12 Z" className={first} />
          <path d="M12 0 L18 12 L24 0 Z" className={variant === 'divider' ? first : second} />
          <path d="M10.5 6 L12 4 L13.5 6 L12 8 Z" className={second} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
