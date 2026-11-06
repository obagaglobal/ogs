import { expect, test, type Page } from '@playwright/test';
import {
  createCustomer,
  customerState,
  mockCatalogue,
  rememberTheme,
  settle,
} from './design-support';

/**
 * Phase 6b theme and motif rules:
 * - the theme choice persists and is applied before the app's JavaScript
 *   runs (no flash of the wrong theme);
 * - the Kitenge motif appears only where allowed, never in tables or forms,
 *   and at most once per signed-in page.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

let state: Awaited<ReturnType<typeof customerState>>;

test.beforeAll(async ({ browser }) => {
  state = await customerState(browser, await createCustomer());
});

test('theme: chosen in the account menu, remembered across reloads', async ({ browser }) => {
  const context = await browser.newContext({ storageState: state, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('/');
  await settle(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('ogs.theme'))).toBe('dark');

  // "System" follows the operating system.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitemradio', { name: 'System' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await context.close();
});

test('theme: no flash, the remembered theme is set before the app runs', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' });
  await rememberTheme(context, 'dark');
  const page = await context.newPage();
  // Block the application bundle: only index.html and theme-init.js run.
  await page.route(/\/src\/main\.tsx|\/assets\/index-.*\.js/, (route) => route.abort());
  await page.goto('/services');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // theme-init.js is a classic, synchronous script placed before every
  // stylesheet and app module (Vite's dev client aside), so the attribute is in
  // place before anything is styled or painted.
  const init = await page.evaluate(() => {
    const script = document.querySelector('script[src="/theme-init.js"]');
    // Dev tooling (Vite's client and React refresh preamble) is excluded: it is
    // not part of production builds.
    const later = [
      ...document.querySelectorAll('link[rel=stylesheet], style, script[type=module][src]'),
    ].filter((node) => !(node.getAttribute('src') ?? '').startsWith('/@'));
    return {
      inHead: script?.parentElement === document.head,
      blocking:
        script !== null &&
        !script.hasAttribute('async') &&
        !script.hasAttribute('defer') &&
        script.getAttribute('type') !== 'module',
      first: later.every(
        (node) =>
          script !== null &&
          (script.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
    };
  });
  expect(init).toEqual({ inHead: true, blocking: true, first: true });
  await context.close();
});

/** Motifs on a page, and any in forbidden places. */
async function motifs(page: Page) {
  return page.evaluate(() => ({
    count: document.querySelectorAll('[data-motif]').length,
    where: [...document.querySelectorAll('[data-motif]')]
      .map((node) => node.parentElement?.outerHTML.slice(0, 160) ?? '')
      .join(' | '),
    forbidden: document.querySelectorAll('table [data-motif], form [data-motif]').length,
    focusable: [...document.querySelectorAll('[data-motif]')].filter(
      (node) => node.getAttribute('aria-hidden') !== 'true',
    ).length,
  }));
}

test('motif: only where allowed, in the expected numbers', async ({ browser }) => {
  const expected: [string, boolean, number][] = [
    // Header strip, hero corner, hero band, section divider.
    ['/services', false, 4],
    ['/services/c/networks', false, 1],
    ['/services/home-wifi-setup', false, 1],
    ['/sign-in', false, 1],
    ['/sign-up', false, 1],
    ['/forgot-password', false, 0],
    ['/', true, 0],
    ['/requests', true, 1], // the empty state
    ['/requests/new?service=home-wifi-setup', true, 0],
    ['/security', true, 0],
  ];
  for (const [path, signedIn, count] of expected) {
    const context = await browser.newContext(signedIn ? { storageState: state } : {});
    const page = await context.newPage();
    await mockCatalogue(page);
    await page.goto(path);
    await settle(page);
    const found = await motifs(page);
    expect(found.count, `${path} motif count: ${found.where}`).toBe(count);
    expect(found.forbidden, `${path} motif inside a table or form`).toBe(0);
    expect(found.focusable, `${path} motif exposed to assistive tech`).toBe(0);
    if (signedIn)
      expect(found.count, `${path}: at most once when signed in`).toBeLessThanOrEqual(1);
    await context.close();
  }
});
