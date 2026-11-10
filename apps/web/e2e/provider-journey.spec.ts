import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetRateLimits } from './rate-limits';
import {
  createReviewer,
  grantMembership,
  latestMailText,
  maintQuery,
  PLATFORM_TENANT_ID,
  totp,
} from './support';

/**
 * D10 — the individual provider journey in real browsers:
 * a person applies as a provider → OGS staff verify and approve them →
 * the provider sets their availability → staff find them through eligibility.
 */
test.beforeAll(async () => {
  await resetRateLimits();
});

test.describe.configure({ timeout: 180_000 });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const unique = () => randomUUID().slice(0, 8);

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

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function uploadDocument(page: Page, type: string, name: string) {
  await page.getByLabel('Document type').selectOption({ label: type });
  await page
    .getByLabel('Add a document')
    .setInputFiles({ name, mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(name)).toBeVisible();
}

/** Next Monday 10:00 in Nairobi, as a datetime-local value ("YYYY-MM-DDTHH:MM"). */
function nextMondayTen(): string {
  const nairobiNow = new Date(Date.now() + 3 * 3600_000);
  const day = nairobiNow.getUTCDay(); // 0 = Sunday
  const ahead = ((8 - day) % 7) + (day === 1 ? 7 : 0);
  const monday = new Date(nairobiNow.getTime() + ahead * 86_400_000);
  return `${monday.toISOString().slice(0, 10)}T10:00`;
}

test('apply → verify and approve → set availability → found by eligibility', async ({
  browser,
}) => {
  const name = `Wanjiku ${unique()}`;
  const skillCode = `e2e_${unique()}`;
  const skillName = `E2E fibre splicing ${unique()}`;
  const provider = {
    email: `provider-${unique()}@e2e.test`,
    password: `provider ${unique()} pass`,
  };
  const staff = { email: `staff-${unique()}@e2e.test`, password: `staff ${unique()} pass` };
  // A skill only this run uses, so the eligibility result is exactly our provider.
  await maintQuery(`INSERT INTO skill (code, name, category) VALUES ($1, $2, 'E2E')`, [
    skillCode,
    skillName,
  ]);

  // 1. The person applies as an individual provider and submits a complete application.
  const p = await (await browser.newContext()).newPage();
  await signUpAndVerify(p, provider.email, provider.password);
  await signIn(p, provider.email, provider.password);
  await p.getByRole('link', { name: 'Become a provider' }).click();
  await p.getByLabel('Your name as customers will see it').fill(name);
  await p.getByRole('button', { name: 'Start application' }).click();
  await expect(p.getByRole('heading', { name })).toBeVisible();
  await p.getByLabel('Phone').fill('+254712345678');
  await p.getByLabel('Home county').selectOption({ label: 'Nairobi City' });
  await p.getByRole('button', { name: 'Save profile' }).click();
  await expect(p.getByText('Profile saved.')).toBeVisible();
  await p.getByLabel(skillName).check();
  await p.getByLabel(`Experience in ${skillName}`).selectOption('OVER_5_YEARS');
  await p.getByRole('button', { name: 'Save skills' }).click();
  await expect(p.getByText('Skills saved.')).toBeVisible();
  await uploadDocument(p, 'Government ID (national ID or passport)', 'national-id.pdf');
  await uploadDocument(p, 'Certificate or other skills evidence', 'certificate.pdf');
  await p.getByRole('link', { name: 'Coverage' }).click();
  await p.getByLabel('Nairobi City').check();
  await p.getByRole('button', { name: 'Save coverage' }).click();
  await expect(p.getByText('Coverage saved.')).toBeVisible();
  await p.getByRole('link', { name: 'Application' }).click();
  await p.getByRole('button', { name: 'Submit for review' }).click();
  await expect(p.getByText('Submitted — OGS is verifying your application.')).toBeVisible();

  // 2. OGS staff verify and approve (provider vetting + dispatch roles).
  await createReviewer(staff.email, staff.password);
  await grantMembership(staff.email, PLATFORM_TENANT_ID, 'operations_manager');
  const s = await (await browser.newContext()).newPage();
  await signIn(s, staff.email, staff.password);
  await expect(s.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  const secret = (await s.locator('code').innerText()).trim();
  await s.getByLabel('6-digit code from the app').fill(totp(secret));
  await s.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await s.getByRole('button', { name: 'I have saved them' }).click();
  await s.getByLabel('Workspace', { exact: true }).selectOption(PLATFORM_TENANT_ID);
  await s.getByRole('link', { name: 'Applications' }).click();
  await s.getByLabel('Reason').fill('Weekly vetting of individual providers');
  await s.getByLabel('Authenticator code').fill(totp(secret, Date.now() + 30_000));
  await s.getByRole('button', { name: 'Start' }).click();
  await s.getByLabel('Type').selectOption({ label: 'Individual provider' });
  await s.getByRole('link', { name }).click();
  await expect(s.getByText('national-id.pdf')).toBeVisible();
  await s.getByLabel('Identity checked against the ID document').check();
  await s.getByLabel('Skills evidence checked').check();
  await s.getByRole('button', { name: 'Approve' }).click();
  await expect(s.getByText('Decision recorded and emailed.')).toBeVisible();
  expect(await latestMailText(provider.email, /approved as an OGS provider/)).toContain(
    'approved as a provider',
  );

  // 3. The approved provider sets their weekly hours (Monday 08:00–17:00 Nairobi).
  await p.goto('/provider/availability');
  await expect(p.getByText('Approved — OGS can offer you work.')).toBeVisible();
  await p.getByLabel('Monday').check();
  await p.getByRole('button', { name: 'Save working hours' }).click();
  await expect(p.getByText('Working hours saved.')).toBeVisible();

  // 4. Staff find them for a Monday-morning job in Nairobi, with the reasons.
  await s.getByRole('link', { name: 'Eligibility' }).click();
  await s.getByLabel(skillName).check();
  await s.getByLabel('County').selectOption({ label: 'Nairobi City' });
  await s.getByLabel('Available at (Kenya time, optional)').fill(nextMondayTen());
  await s.getByRole('button', { name: 'Search' }).click();
  await expect(s.getByText('1 eligible provider')).toBeVisible();
  await expect(s.getByText(name)).toBeVisible();
  await expect(s.getByText(/^\+15 Available at .*10:00.*\(Kenya time\)$/)).toBeVisible();
});
