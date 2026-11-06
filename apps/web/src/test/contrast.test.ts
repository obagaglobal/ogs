import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WCAG 2.2 AA contrast for every token pair the components use (Phase 6b).
 * Reads the real values from src/styles/tokens.css, so a token change that
 * breaks a pair fails here. Normal text needs 4.5:1; large text and UI
 * component boundaries (control outlines, focus ring, status dots) need 3:1.
 */
type Theme = Record<string, string>;

function parseTokens(): { light: Theme; dark: Theme } {
  const css = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');
  const block = (selector: RegExp): Theme => {
    const match = selector.exec(css);
    if (match?.[1] === undefined) throw new Error(`token block not found: ${selector.source}`);
    return Object.fromEntries(
      [...match[1].matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [
        m[1] ?? '',
        (m[2] ?? '').toLowerCase(),
      ]),
    );
  };
  return {
    light: block(/:root\[data-theme='light'\]\s*\{([^}]*)\}/),
    dark: block(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/),
  };
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const v = channel(hex, i) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** `top` at `alpha` over `bottom` (the tinted status fills such as bg-success/10). */
function mix(top: string, bottom: string, alpha: number): string {
  return `#${[0, 1, 2]
    .map((i) => Math.round(channel(top, i) * alpha + channel(bottom, i) * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

const tokens = parseTokens();
const TEXT = 4.5;
const UI = 3;

/** [foreground, background, minimum, where it is used] */
function pairs(t: Theme): [string, string, number, string][] {
  const backgrounds = ['paper', 'surface', 'surface-muted'] as const;
  const list: [string, string, number, string][] = [];
  for (const bg of backgrounds) {
    for (const fg of ['ink', 'muted', 'danger', 'success', 'warning'] as const) {
      list.push([t[fg] ?? '', t[bg] ?? '', TEXT, `${fg} text on ${bg}`]);
    }
    list.push([t['control-border'] ?? '', t[bg] ?? '', UI, `control outline on ${bg}`]);
    list.push([t['ink'] ?? '', t[bg] ?? '', UI, `focus ring (ink part) on ${bg}`]);
  }
  list.push([
    t['on-saffron'] ?? '',
    t['saffron'] ?? '',
    TEXT,
    'text on saffron (highlight button, motif labels)',
  ]);
  list.push([t['paper'] ?? '', t['ink'] ?? '', TEXT, 'primary button text']);
  list.push([t['surface'] ?? '', t['danger'] ?? '', TEXT, 'danger button text']);
  // Tinted status fills (alerts, pills) carry INK text; the colour is on the border and dot.
  for (const tone of ['success', 'danger', 'warning'] as const) {
    const tint = mix(t[tone] ?? '', t['surface'] ?? '', 0.1);
    list.push([
      t['ink'] ?? '',
      tint,
      TEXT,
      `ink text on the 10% ${tone} tint (status pills, alerts)`,
    ]);
    list.push([t[tone] ?? '', t['surface'] ?? '', UI, `${tone} border/dot next to surface`]);
  }
  return list;
}

describe('token contrast (WCAG 2.2 AA)', () => {
  for (const [name, theme] of Object.entries(tokens)) {
    it(`${name}: every pair in use passes`, () => {
      const failures = pairs(theme)
        .map(([fg, bg, min, what]) => ({ what, ratio: contrast(fg, bg), min }))
        .filter(({ ratio, min }) => ratio < min)
        .map(({ what, ratio, min }) => `${what}: ${ratio.toFixed(2)} < ${String(min)}`);
      expect(failures).toEqual([]);
    });
  }

  it('the focus indicator contrasts with every background (WCAG 2.2: 3:1 against its surroundings)', () => {
    for (const theme of [tokens.light, tokens.dark]) {
      for (const bg of ['paper', 'surface', 'surface-muted']) {
        // The two-tone ring passes if either of its parts does; the ink line always does.
        const best = Math.max(
          contrast(theme['ink'] ?? '', theme[bg] ?? ''),
          contrast(theme['saffron'] ?? '', theme[bg] ?? ''),
        );
        expect(best, bg).toBeGreaterThanOrEqual(UI);
      }
    }
  });

  it('saffron is never text on light backgrounds (it fails there)', () => {
    expect(contrast(tokens.light['saffron'] ?? '', tokens.light['paper'] ?? '')).toBeLessThan(TEXT);
  });

  it('every token is defined in both themes', () => {
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
    expect(Object.keys(tokens.light)).toHaveLength(12);
  });
});
