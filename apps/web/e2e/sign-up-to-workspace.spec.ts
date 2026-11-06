import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ACME_TENANT_ID, grantMembership, latestMailText, totp } from './support';

/**
 * B5 — the whole first-run journey in a real browser:
 * sign up → confirm via the emailed link (Mailpit) → sign in → personal
 * workspace → (membership granted) switch workspace → admin role → forced MFA
 * enrolment → back in, now with the organisation workspace.
 */
test('sign up, verify, sign in, switch workspace, enrol in MFA', async ({ page }) => {
  const email = `e2e-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = `e2e passphrase ${randomUUID().slice(0, 8)}`;

  // Sign up.
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Confirm through the link in the email.
  const link = /http:\/\/localhost:5173\/verify-email#token=[A-Za-z0-9_-]{43}/.exec(
    await latestMailText(email, /Confirm your email/),
  )?.[0];
  expect(link).toBeDefined();
  await page.goto(link ?? '');
  await expect(page.getByText('Your email address is confirmed.')).toBeVisible();

  // Sign in → personal workspace.
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Personal' })).toBeVisible();
  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue('personal');

  // Join Acme as an employee and switch to it.
  await grantMembership(email, ACME_TENANT_ID, 'org_employee');
  await page.reload();
  await page.getByLabel('Workspace', { exact: true }).selectOption(ACME_TENANT_ID);
  await expect(page.getByRole('heading', { name: 'Acme Kenya Ltd' })).toBeVisible();
  await expect(page.getByText('org_employee')).toBeVisible();

  // Becoming an admin makes MFA mandatory: the app sends the user to enrol.
  await grantMembership(email, ACME_TENANT_ID, 'org_admin');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  const secret = (await page.locator('code').innerText()).trim();
  await page.getByLabel('6-digit code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem'),
  ).toHaveCount(10);
  await page.getByRole('button', { name: 'I have saved them' }).click();

  await expect(page.getByLabel('Workspace', { exact: true })).toHaveValue(ACME_TENANT_ID);
  await expect(page.getByText(/org_admin/)).toBeVisible();
});
