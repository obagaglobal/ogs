import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  createCustomer,
  customerState,
  DESIGN_PAGES,
  mockCatalogue,
  prepareFixture,
  type DesignPage,
  ready,
  settle,
  rememberTheme,
  THEMES,
} from './design-support';

/**
 * Phase 6b accessibility (WCAG 2.2 AA):
 * - axe on the eighteen design pages in both themes; serious or critical fails;
 * - keyboard: skip link first, focus-trapping dialog that restores focus;
 * - no horizontal scrolling at 360/768/1024/1440 px;
 * - 44 px touch targets for controls on a 360 px phone.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

let state: Awaited<ReturnType<typeof customerState>>;

test.beforeAll(async ({ browser }) => {
  state = await customerState(browser, await createCustomer());
});

async function open(
  browser: Browser,
  path: string,
  signedIn: boolean,
  options: {
    theme?: 'light' | 'dark';
    width?: number;
    readyText?: string | RegExp;
    fixture?: DesignPage['fixture'];
  } = {},
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1280, height: 800 },
    ...(signedIn ? { storageState: state } : {}),
  });
  if (options.theme) await rememberTheme(context, options.theme);
  const page = await context.newPage();
  await mockCatalogue(page);
  await prepareFixture(context, page, options.fixture);
  await page.goto(path);
  await (options.readyText === undefined ? settle(page) : ready(page, options.readyText));
  return page;
}

for (const { name, path, signedIn, ready: readyText, fixture } of DESIGN_PAGES) {
  for (const theme of THEMES) {
    test(`axe: ${name} · ${theme}`, async ({ browser }) => {
      const page = await open(browser, path, signedIn, { theme, readyText, fixture });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
      ).toEqual([]);
      await page.context().close();
    });
  }
}

test('keyboard: the skip link is first and moves focus to the content', async ({ browser }) => {
  for (const [path, signedIn, readyText] of [
    ['/services', false, 'Home Wi-Fi setup'],
    ['/', true, 'Get things done'],
  ] as const) {
    const page = await open(browser, path, signedIn, { readyText });
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await page.context().close();
  }
});

test('keyboard: dialogs trap focus, close on Escape and restore focus', async ({ browser }) => {
  const page = await open(browser, '/design-system', true, { readyText: 'Kitenge motif' });
  const trigger = page.getByRole('button', { name: 'Open dialog' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Cancel this request?' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.context().close();
});

test('the focus ring is visible: ink outline plus saffron ring', async ({ browser }) => {
  const page = await open(browser, '/sign-in', false, { readyText: 'Forgot password?' });
  await page.getByLabel('Email').focus();
  await page.keyboard.press('Tab');
  const style = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const computed = getComputedStyle(element);
    return { outline: computed.outlineStyle, shadow: computed.boxShadow };
  });
  expect(style.outline).toBe('solid');
  expect(style.shadow).not.toBe('none');
  await page.context().close();
});

for (const width of [360, 768, 1024, 1440]) {
  test(`responsive: no horizontal scrolling at ${String(width)} px`, async ({ browser }) => {
    for (const { name, path, signedIn, ready: readyText, fixture } of DESIGN_PAGES) {
      const page = await open(browser, path, signedIn, { width, readyText, fixture });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${name} overflows by ${String(overflow)} px`).toBeLessThanOrEqual(0);
      await page.context().close();
    }
  });
}

test('touch targets: controls are at least 44 px tall on a 360 px phone', async ({ browser }) => {
  for (const { name, path, signedIn, ready: readyText, fixture } of DESIGN_PAGES) {
    const page = await open(browser, path, signedIn, { width: 360, readyText, fixture });
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'button:not([role=checkbox]):not([role=radio]):not([role=switch]), select, input:not([type=checkbox]):not([type=radio]):not([type=file]), [role=combobox], [data-slot=button]',
        ),
      ]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 2 && box.height > 2 && getComputedStyle(element).visibility !== 'hidden'
          );
        })
        .filter((element) => element.getBoundingClientRect().height < 44)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 30)}" ${String(Math.round(element.getBoundingClientRect().height))}px`,
        ),
    );
    expect(small, `${name}: controls under 44 px`).toEqual([]);
    // Checkbox, radio and switch draw a 20–24 px box; an ::after overlay
    // extends the hit area to at least 44 px.
    const smallChoices = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[role=checkbox], [role=radio], [role=switch]')]
        .map((element) => {
          const box = element.getBoundingClientRect();
          const after = getComputedStyle(element, '::after');
          const inset = -Number.parseFloat(after.top);
          return Math.min(box.height, box.width) + 2 * inset;
        })
        .filter((size) => size < 44),
    );
    expect(smallChoices, `${name}: choice controls under 44 px`).toEqual([]);
    await page.context().close();
  }
});
