import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createReviewer, latestMailText, PLATFORM_TENANT_ID, totp } from './support';

/**
 * C11 — the organisation journey across three people in real browsers:
 * applicant registers and submits → OGS staff approve under an elevation →
 * the (now MFA-enrolled) admin invites a colleague → the colleague signs up
 * from the invitation and lands in the organisation.
 */
test.describe.configure({ timeout: 180_000 });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const unique = () => randomUUID().slice(0, 8);

async function signUpAndVerify(page: Page, email: string, password: string, locked = false) {
  if (!locked) {
    await page.goto('/sign-up');
    await page.getByLabel('Email').fill(email);
  }
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const link = /http:\/\/localhost:5173\/verify-email#token=[\w-]{43}/.exec(
    await latestMailText(email, /Confirm your email/),
  )?.[0];
  await page.goto(link ?? '');
  await expect(page.getByText('Your email address is confirmed.')).toBeVisible();
}

async function signIn(page: Page, email: string, password: string, next?: string) {
  await page.goto(next === undefined ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Completes forced MFA enrolment; returns the base32 secret. */
async function enrolMfa(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  const secret = (await page.locator('code').innerText()).trim();
  await page.getByLabel('6-digit code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await page.getByRole('button', { name: 'I have saved them' }).click();
  return secret;
}

test('apply → approve → invite → accept', async ({ browser }) => {
  const orgName = `Kilimo ${unique()} Ltd`;
  const applicant = {
    email: `applicant-${unique()}@e2e.test`,
    password: `applicant ${unique()} pass`,
  };
  const reviewer = {
    email: `reviewer-${unique()}@e2e.test`,
    password: `reviewer ${unique()} pass`,
  };
  const colleague = {
    email: `colleague-${unique()}@e2e.test`,
    password: `colleague ${unique()} pass`,
  };

  // 1. The applicant registers the organisation and submits it.
  const a = await (await browser.newContext()).newPage();
  await signUpAndVerify(a, applicant.email, applicant.password);
  await signIn(a, applicant.email, applicant.password);
  await a.getByRole('link', { name: 'Register an organisation' }).click();
  await a.getByLabel('Legal name').fill(orgName);
  await a.getByRole('button', { name: 'Start application' }).click();
  await expect(a.getByRole('heading', { name: orgName })).toBeVisible();
  await a.getByLabel('Business registration number', { exact: true }).fill('PVT-2026-7788');
  await a.getByLabel('KRA PIN', { exact: true }).fill('P051234567X');
  await a.getByLabel('County or region').fill('Nakuru');
  await a.getByLabel('Physical address').fill('Kenyatta Avenue, Nakuru');
  await a.getByLabel('Phone').fill('+254712345678');
  await a.getByLabel('Contact email').fill(applicant.email);
  await a.getByRole('button', { name: 'Save details' }).click();
  await expect(a.getByText('Saved.')).toBeVisible();
  await a
    .getByLabel('Add a document')
    .setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: PDF });
  await a.getByRole('button', { name: 'Upload' }).click();
  await expect(a.getByText('certificate.pdf')).toBeVisible();
  await a.getByRole('button', { name: 'Submit for review' }).click();
  await expect(a.getByText('Submitted — OGS is reviewing your application.')).toBeVisible();

  // 2. OGS staff approve it (forced MFA enrolment, then an elevation with a reason).
  await createReviewer(reviewer.email, reviewer.password);
  const r = await (await browser.newContext()).newPage();
  await signIn(r, reviewer.email, reviewer.password);
  const secret = await enrolMfa(r);
  await r.getByLabel('Workspace', { exact: true }).selectOption(PLATFORM_TENANT_ID);
  await r.getByRole('link', { name: 'Applications' }).click();
  await r.getByLabel('Reason').fill('Daily review of new organisation applications');
  // The enrolment code's time step is used up; the next step's code is accepted (±1).
  await r.getByLabel('Authenticator code').fill(totp(secret, Date.now() + 30_000));
  await r.getByRole('button', { name: 'Start' }).click();
  await r.getByRole('link', { name: orgName }).click();
  await r.getByRole('button', { name: 'Approve' }).click();
  await expect(r.getByText('Decision recorded and emailed.')).toBeVisible();
  expect(await latestMailText(applicant.email, /is approved/)).toContain('is approved');

  // 3. The applicant is now an admin of an active organisation: MFA first, then invite.
  await a.goto('/');
  await enrolMfa(a);
  await a.getByRole('link', { name: 'Team' }).click();
  await a.getByLabel('Email').fill(colleague.email);
  await a.getByRole('button', { name: 'Send invitation' }).click();
  await expect(a.getByText('Invitation sent. It is valid for 7 days.')).toBeVisible();

  // 4. The colleague follows the link, signs up with the invited address, and accepts.
  const invitation = /http:\/\/localhost:5173\/invitations\/accept#\S+/.exec(
    await latestMailText(colleague.email, /invited to join/),
  )?.[0];
  const c = await (await browser.newContext()).newPage();
  await c.goto(invitation ?? '');
  await c.getByRole('link', { name: 'create an account' }).click();
  await expect(c.getByLabel('Email')).toHaveValue(colleague.email);
  await signUpAndVerify(c, colleague.email, colleague.password, true);
  await signIn(c, colleague.email, colleague.password, '/invitations/accept');
  await c.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(c.getByRole('heading', { name: orgName })).toBeVisible();
  await expect(c.getByText('org_employee')).toBeVisible();
});
