import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetRateLimits } from './rate-limits';
import {
  createOrganisation,
  createReviewer,
  grantMembership,
  latestMailText,
  PLATFORM_TENANT_ID,
  totp,
} from './support';

/**
 * F10 — requests, quotations and orders in real browsers:
 * 1. an individual requests a fixed-price service → staff accept → finance
 *    records the payment → the customer sees "Confirmed";
 * 2. an organisation employee requests a quotation-only service → staff issue
 *    a quotation → the admin accepts → postpaid → "Confirmed".
 */
test.beforeAll(async () => {
  await resetRateLimits();
});

test.describe.configure({ timeout: 240_000 });

const unique = () => randomUUID().slice(0, 8);

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signUpAndVerify(page: Page, email: string, password: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const link = /http:\/\/localhost:5173\/verify-email#token=[\w-]{43}/.exec(
    await latestMailText(email, /Confirm your email/),
  )?.[0];
  await page.goto(link ?? '');
  await expect(page.getByText('Your email address is confirmed.')).toBeVisible();
}

/** Forced MFA enrolment; returns the base32 secret. */
async function enrolMfa(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  const secret = (await page.locator('code').innerText()).trim();
  await page.getByLabel('6-digit code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await page.getByRole('button', { name: 'I have saved them' }).click();
  return secret;
}

/** Staff with request (service_manager) and payment (finance) rights, elevated. */
async function staffSession(page: Page): Promise<void> {
  const staff = { email: `orders-${unique()}@e2e.test`, password: `orders ${unique()} pass` };
  await createReviewer(staff.email, staff.password);
  await grantMembership(staff.email, PLATFORM_TENANT_ID, 'service_manager');
  await grantMembership(staff.email, PLATFORM_TENANT_ID, 'finance');
  await signIn(page, staff.email, staff.password);
  const secret = await enrolMfa(page);
  await page.getByLabel('Workspace', { exact: true }).selectOption(PLATFORM_TENANT_ID);
  await page.getByRole('link', { name: 'Requests' }).click();
  await page.getByLabel('Reason').fill('Processing customer requests');
  await page.getByLabel('Authenticator code').fill(totp(secret, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Start' }).click();
  // The elevation is stored once the queue shows; only then is it safe to navigate.
  await expect(page.getByLabel('Status')).toBeVisible();
}

async function openStaffRequest(page: Page, number: string) {
  await page.goto('/platform/requests');
  await page.getByLabel('Status').selectOption({ label: 'All' });
  await page.getByRole('link', { name: number }).click();
  await expect(page.getByRole('heading', { name: new RegExp(number) })).toBeVisible();
}

test('individual: fixed price → staff accept → payment recorded → confirmed', async ({
  browser,
}) => {
  const customer = {
    email: `customer-${unique()}@e2e.test`,
    password: `customer ${unique()} pass`,
  };
  const c = await (await browser.newContext()).newPage();
  await signUpAndVerify(c, customer.email, customer.password);
  await signIn(c, customer.email, customer.password);
  await expect(c.getByRole('link', { name: 'Requests' })).toBeVisible();

  // 1. Request a fixed-price service from the catalogue.
  await c.goto('/services/home-wifi-setup');
  await c.getByRole('link', { name: 'Request this service' }).click();
  await c.getByLabel('Address').fill('Kilimani, Nairobi');
  await c.getByLabel('Contact phone').fill('+254712345678');
  await expect(c.getByText(/Estimated total:/)).toContainText('KES 4,060');
  await c.getByRole('button', { name: 'Send request' }).click();
  const heading = c.getByRole('heading', { name: /REQ-\d{4}-\d{6}/ });
  await expect(heading).toContainText('Submitted');
  const number = /REQ-\d{4}-\d{6}/.exec(await heading.innerText())?.[0] ?? '';
  expect(await latestMailText(customer.email, /We received your request/)).toContain(number);

  // 2. Staff review and accept at the catalogue price.
  const s = await (await browser.newContext()).newPage();
  await staffSession(s);
  await openStaffRequest(s, number);
  await s.getByRole('button', { name: 'Start review' }).click();
  await s.getByRole('button', { name: 'Accept at KES 3,500' }).click();
  await expect(s.getByRole('heading', { name: new RegExp(number) })).toContainText(
    'Awaiting payment',
  );

  // 3. The customer sees the payment instructions.
  await c.reload();
  await expect(c.getByText(/quoting ORD-\d{4}-\d{6} as the reference/)).toBeVisible();
  const order = /ORD-\d{4}-\d{6}/.exec(await c.getByText(/quoting ORD-/).innerText())?.[0] ?? '';

  // 4. Finance records the M-Pesa payment; the order is confirmed.
  await s.getByRole('link', { name: 'Orders' }).click();
  await s.getByRole('link', { name: order }).click();
  await expect(s.getByLabel('Amount (KES)')).toHaveValue('4060');
  await s.getByLabel('Reference').fill(`QJK${unique().toUpperCase()}`);
  await s.getByRole('button', { name: 'Record payment' }).click();
  await expect(s.getByText('Confirmed').first()).toBeVisible();
  expect(await latestMailText(customer.email, new RegExp(`Order ${order} is confirmed`))).toContain(
    order,
  );

  await c.reload();
  await expect(c.getByRole('heading', { name: new RegExp(number) })).toContainText('Confirmed');
});

test('organisation: quotation → admin accepts → postpaid → confirmed', async ({ browser }) => {
  const password = `org ${unique()} pass`;
  const orgName = `Savanna ${unique()} Ltd`;
  const admin = `admin-${unique()}@e2e.test`;
  const employee = `employee-${unique()}@e2e.test`;
  const tenantId = await createOrganisation({
    name: orgName,
    adminEmail: admin,
    employeeEmail: employee,
    password,
    postpaid: true,
  });

  // 1. The employee asks for a quotation-only service.
  const e = await (await browser.newContext()).newPage();
  await signIn(e, employee, password);
  await e.getByLabel('Workspace', { exact: true }).selectOption(tenantId);
  await e.goto('/services/server-setup');
  await e.getByRole('link', { name: 'Request this service' }).click();
  await e.getByLabel('Address').fill('Westlands, Nairobi');
  await e.getByLabel('Contact phone').fill('+254722000000');
  await e.getByLabel('What do you need?').fill('Two Linux servers with backups.');
  await expect(e.getByText(/OGS will send you a quotation/)).toBeVisible();
  await e.getByRole('button', { name: 'Send request' }).click();
  const heading = e.getByRole('heading', { name: /REQ-\d{4}-\d{6}/ });
  await expect(heading).toBeVisible();
  const number = /REQ-\d{4}-\d{6}/.exec(await heading.innerText())?.[0] ?? '';

  // 2. Staff route it to a quotation, price it and issue it.
  const s = await (await browser.newContext()).newPage();
  await staffSession(s);
  await openStaffRequest(s, number);
  await s.getByRole('button', { name: 'Start review' }).click();
  await s.getByRole('button', { name: 'Needs a quotation' }).click();
  await s.getByLabel('Line 1 unit price (KES)').fill('45,000');
  await s.getByLabel('Line 1 quantity').fill('2');
  await expect(s.getByText(/Subtotal KES 90,000 \+ VAT KES 14,400 = KES 104,400/)).toBeVisible();
  await s.getByRole('button', { name: 'Save draft' }).click();
  await s.getByRole('button', { name: 'Issue quotation' }).click();
  await expect(s.getByText('issued', { exact: true })).toBeVisible();
  expect(await latestMailText(admin, /Quotation QUO-/)).toContain('KES 104,400');

  // 3. The employee may not accept; the admin (MFA enrolled) accepts.
  await e.reload();
  await expect(
    e.getByText('An organisation administrator accepts or rejects quotations.'),
  ).toBeVisible();
  const a = await (await browser.newContext()).newPage();
  await signIn(a, admin, password);
  await enrolMfa(a);
  await a.getByLabel('Workspace', { exact: true }).selectOption(tenantId);
  await a.getByRole('link', { name: 'Requests' }).click();
  await a.getByRole('link', { name: number }).click();
  await a.getByRole('button', { name: 'Accept quotation' }).click();

  // 4. Postpaid: confirmed at once, no payment step.
  await expect(a.getByRole('heading', { name: new RegExp(number) })).toContainText('Confirmed');
  await expect(a.getByText('Invoice, 30 days')).toBeVisible();
});
