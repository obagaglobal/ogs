import { useSyncExternalStore } from 'react';

/**
 * Light / dark / system theme (Phase 6b). The choice is remembered per browser
 * under the same key public/theme-init.js reads before first paint, so the
 * page never flashes the wrong theme. "system" follows the OS live.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ogs.theme';
const listeners = new Set<() => void>();

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') {
    return systemPrefersDark() ? 'dark' : 'light';
  }
  return choice;
}

function apply(): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(readThemeChoice()));
  for (const listener of listeners) {
    listener();
  }
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Storage blocked: the choice still applies to this page.
  }
  apply();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) apply();
  };
  media?.addEventListener('change', apply);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', apply);
    window.removeEventListener('storage', onStorage);
  };
}

const snapshot = (): string =>
  `${readThemeChoice()}|${document.documentElement.getAttribute('data-theme') ?? 'light'}`;

/** The current choice and the theme actually shown; re-renders when either changes. */
export function useTheme(): {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
} {
  const value = useSyncExternalStore(subscribe, snapshot, () => 'system|light');
  const [choice, resolved] = value.split('|') as [ThemeChoice, ResolvedTheme];
  return { choice, resolved, setChoice: setThemeChoice };
}
