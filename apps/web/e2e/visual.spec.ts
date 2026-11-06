import { expect, test } from '@playwright/test';
import {
  createCustomer,
  customerState,
  DESIGN_PAGES,
  mockCatalogue,
  settle,
  THEMES,
  rememberTheme,
} from './design-support';

/**
 * Phase 6b screenshots: 9 pages × light/dark × 1440/360 px (36 images).
 * Baselines are per platform (…-linux.png from CI is the reference; Windows
 * and macOS images are local only and git-ignored). Animations are frozen by
 * Playwright; dynamic bits (the request form's date) are stable by design.
 *
 * Update: `pnpm --filter @ogs/web test:e2e e2e/visual.spec.ts --update-snapshots`.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const WIDTHS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 360, height: 780 },
];

let state: Awaited<ReturnType<typeof customerState>>;

test.beforeAll(async ({ browser }) => {
  state = await customerState(browser, await createCustomer());
});

for (const page of DESIGN_PAGES) {
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      test(`${page.name} · ${theme} · ${size.label}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          ...(page.signedIn ? { storageState: state } : {}),
        });
        await rememberTheme(context, theme);
        const tab = await context.newPage();
        await mockCatalogue(tab);
        await tab.goto(page.path);
        await settle(tab);
        await expect(tab.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(tab).toHaveScreenshot(`${page.name}-${theme}-${size.label}.png`, {
          fullPage: true,
          // Sub-pixel font rendering differs slightly between runs.
          maxDiffPixelRatio: 0.01,
        });
        await context.close();
      });
    }
  }
}
