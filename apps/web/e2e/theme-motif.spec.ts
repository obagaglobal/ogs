import { expect, test, type Page } from '@playwright/test';
import {
  createCustomer,
  customerState,
  mockCatalogue,
  prepareFixture,
  ready,
  rememberTheme,
  settle,
} from './design-support';
import { PHASE9_PATHS, PHASE9_READY, type Phase9Fixture } from './phase9-fixtures';

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
  // [path, signed in, motifs, text that proves the page has fully rendered]
  const expected: [string, boolean, number, string | RegExp][] = [
    // Header strip, hero corner, hero band, section divider.
    ['/services', false, 4, 'Home Wi-Fi setup'],
    ['/services/c/networks', false, 1, 'Office network installation'],
    ['/services/home-wifi-setup', false, 1, 'Sign in to request'],
    ['/sign-in', false, 1, 'Forgot password?'],
    ['/sign-up', false, 1, 'Create account'],
    ['/forgot-password', false, 0, 'Reset your password'],
    ['/', true, 0, 'Get things done'],
    ['/requests', true, 1, 'No requests yet'], // the empty state
    ['/requests/new?service=home-wifi-setup', true, 0, /Estimated total/],
    ['/support', true, 1, 'No tickets here'], // the empty state
    ['/support/new', true, 0, 'How urgent is it?'], // a form: never a motif
    ['/security', true, 0, 'Two-step verification'],
  ];
  for (const [path, signedIn, count, ready] of expected) {
    const context = await browser.newContext(signedIn ? { storageState: state } : {});
    const page = await context.newPage();
    await mockCatalogue(page);
    await page.goto(path);
    // Wait for the page's own content, not just a quiet network: under load a
    // retried request can leave a short idle gap before the content arrives.
    await expect(page.getByText(ready).filter({ visible: true }).first()).toBeVisible({
      timeout: 20_000,
    });
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

test('motif: Phase 9 job, dispatch and tracker pages (fixtures)', async ({ browser }) => {
  // [fixture, motifs]: lists with rows and work screens carry none.
  const expected: [Phase9Fixture, number][] = [
    ['jobs-list', 0],
    ['technician-job', 0],
    ['dispatch-queue', 0],
    ['dispatch-job', 0],
    ['job-tracker', 0],
  ];
  for (const [fixture, count] of expected) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mockCatalogue(page);
    await prepareFixture(context, page, fixture);
    await page.goto(PHASE9_PATHS[fixture]);
    await ready(page, PHASE9_READY[fixture]);
    const found = await motifs(page);
    expect(found.count, `${fixture} motif count: ${found.where}`).toBe(count);
    expect(found.forbidden, `${fixture} motif inside a table or form`).toBe(0);
    await context.close();
  }
});
