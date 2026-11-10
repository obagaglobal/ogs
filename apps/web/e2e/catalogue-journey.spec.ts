import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetRateLimits } from './rate-limits';
import { createReviewer, grantMembership, PLATFORM_TENANT_ID, totp } from './support';

/**
 * E9 — the catalogue journey in real browsers: OGS staff create, price and
 * publish a service → a signed-out visitor finds it by search and opens it →
 * staff retire it → it is gone for the visitor.
 */
test.beforeAll(async () => {
  await resetRateLimits();
});

test.describe.configure({ timeout: 180_000 });

const unique = () => randomUUID().slice(0, 8);

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('publish → found by a visitor → retire → gone', async ({ browser }) => {
  const word = `zq${unique()}`;
  const name = `Fibre splicing ${word}`;
  const slug = `fibre-splicing-${word}`;
  const staff = { email: `catalogue-${unique()}@e2e.test`, password: `catalogue ${unique()} pass` };
  await createReviewer(staff.email, staff.password);
  await grantMembership(staff.email, PLATFORM_TENANT_ID, 'service_manager');

  // 1. Staff: forced MFA, platform workspace, elevation.
  const s = await (await browser.newContext()).newPage();
  await signIn(s, staff.email, staff.password);
  await expect(s.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  const secret = (await s.locator('code').innerText()).trim();
  await s.getByLabel('6-digit code from the app').fill(totp(secret));
  await s.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await s.getByRole('button', { name: 'I have saved them' }).click();
  await s.getByLabel('Workspace', { exact: true }).selectOption(PLATFORM_TENANT_ID);
  await s.getByRole('link', { name: 'Catalogue' }).click();
  await s.getByLabel('Reason').fill('Adding the fibre splicing service');
  await s.getByLabel('Authenticator code').fill(totp(secret, Date.now() + 30_000));
  await s.getByRole('button', { name: 'Start' }).click();

  // 2. Create the draft, fill it in, price it, set skills, publish.
  await s.getByLabel('Service name').fill(name);
  await s.getByLabel('Service slug').fill(slug);
  await s.getByLabel('Category', { exact: true }).selectOption({ label: 'Networks & Wi-Fi' });
  await s.getByRole('button', { name: 'Create draft' }).click();
  await expect(s.getByRole('heading', { name })).toBeVisible();
  await expect(s.getByRole('button', { name: 'Publish' })).toBeDisabled();
  await s
    .getByLabel('Summary', { exact: true })
    .fill('Fusion splicing and testing of fibre links.');
  await s
    .getByLabel('Description', { exact: true })
    .fill('We splice, test and document fibre links.');
  await s.getByRole('button', { name: 'Save content' }).click();
  await expect(s.getByRole('list', { name: 'Missing before publishing' })).not.toContainText(
    'A summary',
  );
  await s.getByLabel('Amount (KES)').fill('4,250');
  await s.getByRole('button', { name: 'Save price' }).click();
  await expect(s.getByRole('list', { name: 'Price history' })).toContainText('KES 4,250');
  await s.getByLabel('Network installation and troubleshooting').check();
  await s.getByRole('button', { name: 'Save skills' }).click();
  await expect(s.getByRole('button', { name: 'Publish' })).toBeEnabled();
  await s.getByRole('button', { name: 'Publish' }).click();
  await expect(s.getByText('Published — visible to everyone')).toBeVisible();

  // 3. A signed-out visitor finds it by search and opens it.
  const v = await (await browser.newContext()).newPage();
  await v.goto('/services');
  await expect(v.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await v.getByLabel('Search services').fill(word);
  await v.getByRole('button', { name: 'Search' }).click();
  await v.getByRole('link', { name }).click();
  await expect(v.getByRole('heading', { name })).toBeVisible();
  await expect(v.getByText('KES 4,250', { exact: true })).toBeVisible();
  await expect(v).toHaveTitle(new RegExp(name));

  // 4. Staff retire it; the visitor no longer finds it.
  await s.getByRole('button', { name: 'Retire' }).click();
  await expect(s.getByText('Retired — hidden from the public')).toBeVisible();
  await v.reload();
  await expect(v.getByRole('heading', { name: 'Service not found' })).toBeVisible();
  await v.goto(`/services?q=${word}`);
  await expect(v.getByText('No services match. Try other words.')).toBeVisible();
});
