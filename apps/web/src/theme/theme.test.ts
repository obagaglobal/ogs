import { act, renderHook } from '@testing-library/react';
import {
  readThemeChoice,
  resolveTheme,
  setThemeChoice,
  THEME_STORAGE_KEY,
  useTheme,
} from './theme';

function mockSystem(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it('defaults to system, which follows the OS', () => {
    mockSystem(true);
    expect(readThemeChoice()).toBe('system');
    expect(resolveTheme('system')).toBe('dark');
    mockSystem(false);
    expect(resolveTheme('system')).toBe('light');
  });

  it('remembers an explicit choice and applies it to <html>', () => {
    mockSystem(false);
    setThemeChoice('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    setThemeChoice('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores junk in storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    expect(readThemeChoice()).toBe('system');
  });

  it('useTheme re-renders when the choice changes', () => {
    mockSystem(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
    act(() => {
      result.current.setChoice('dark');
    });
    expect(result.current).toMatchObject({ choice: 'dark', resolved: 'dark' });
  });
});
