import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Response } from '@playwright/test';
import { resetRateLimits } from './rate-limits';
import {
  createOrganisation,
  createReviewer,
  grantMembership,
  latestMailText,
  MAILPIT_API,
  PLATFORM_TENANT_ID,
  totp,
} from './support';

/**
 * T9 — tickets in real browsers, and the owner's requirement for T2: internal
 * notes never reach customers. After staff write a canary into an internal
 * note, an internal file name and a hold reason, EVERY customer page in the
 * route table (src/App.tsx) is visited as the requester, an organisation admin
 * and an individual, and neither the rendered page nor any API response it
 * loads may contain the canary.
 */
test.beforeAll(async () => {
  await resetRateLimits();
});

test.describe.configure({ timeout: 300_000 });

const unique = () => randomUUID().slice(0, 8);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

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

async function enrolMfa(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  const secret = (await page.locator('code').innerText()).trim();
  await page.getByLabel('6-digit code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await page.getByRole('button', { name: 'I have saved them' }).click();
  return secret;
}

/** A helpdesk agent (ticket.create/read/comment/internal_note, on-behalf requests), elevated. */
async function helpdeskSession(page: Page): Promise<void> {
  const staff = { email: `helpdesk-${unique()}@e2e.test`, password: `helpdesk ${unique()} pass` };
  await createReviewer(staff.email, staff.password);
  await grantMembership(staff.email, PLATFORM_TENANT_ID, 'helpdesk');
  await signIn(page, staff.email, staff.password);
  const secret = await enrolMfa(page);
  await page.getByLabel('Workspace', { exact: true }).selectOption(PLATFORM_TENANT_ID);
  await page.getByRole('link', { name: 'Tickets' }).click();
  await page.getByLabel('Reason').fill('Helpdesk shift, first line support');
  await page.getByLabel('Authenticator code').fill(totp(secret, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByLabel('Search number or subject')).toBeVisible();
}

async function openStaffTicket(page: Page, number: string) {
  await page.goto('/platform/tickets');
  await page.getByLabel('Search number or subject').fill(number);
  await page.getByRole('link', { name: number }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(number) })).toBeVisible();
}

/** Customer pages, read from the route table so a new page cannot be missed. */
function customerRoutes(ticketId: string): string[] {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const paths = [...source.matchAll(/path="([^"]+)"/g)].map((match) => match[1] ?? '');
  return [
    '/',
    ...paths.filter((path) => path.startsWith('/') && !path.startsWith('/platform')),
  ].map((path) =>
    path
      .replace(':id', ticketId)
      .replace(':slug', 'home-wifi-setup')
      .replace(':category', 'networks'),
  );
}

/** Visits every customer page; no page text and no API response may contain `canary`. */
async function assertNoCanary(page: Page, ticketId: string, canary: string, who: string) {
  const leaks: string[] = [];
  const watch = (response: Response) => {
    if (!response.url().includes('/api/v1/')) return;
    void response
      .text()
      .then((text) => {
        if (text.includes(canary)) leaks.push(`${who}: API ${response.url()}`);
      })
      .catch(() => undefined);
  };
  page.on('response', watch);
  const routes = customerRoutes(ticketId);
  expect(routes).toContain(`/support/${ticketId}`);
  for (const path of routes) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    if ((await page.content()).includes(canary)) {
      leaks.push(`${who}: page ${path}`);
    }
  }
  page.off('response', watch);
  expect(leaks).toEqual([]);
}

test('organisation: ticket with a file → helpdesk notes, asks, resolves → reopened → closed; no internal content anywhere', async ({
  browser,
}) => {
  const CANARY = `CANARY${unique()}${unique()}`;
  const password = `support ${unique()} pass`;
  const admin = `admin-${unique()}@e2e.test`;
  const employee = `employee-${unique()}@e2e.test`;
  const tenantId = await createOrganisation({
    name: `Savanna ${unique()} Ltd`,
    adminEmail: admin,
    employeeEmail: employee,
    password,
    postpaid: false,
  });

  // 1. The employee opens a ticket with a screenshot.
  const e = await (await browser.newContext()).newPage();
  await signIn(e, employee, password);
  await e.getByLabel('Workspace', { exact: true }).selectOption(tenantId);
  await e.getByRole('link', { name: 'Support' }).click();
  await e.getByRole('link', { name: 'New ticket' }).click();
  await e.getByLabel('Subject').fill('Printer on floor 2 is offline');
  await e.getByLabel('Category').selectOption({ label: 'Printers' });
  await e.getByRole('radio', { name: /^High/ }).click();
  await e.getByLabel('Describe the problem').fill('It shows offline since 8am. We restarted it.');
  await e.locator('input[type=file]').setInputFiles({
    name: 'printer-error.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(e.getByRole('button', { name: 'Remove printer-error.pdf' })).toBeVisible();
  await e.getByRole('button', { name: 'Open ticket' }).click();
  const heading = e.getByRole('heading', { name: /TCK-\d{4}-\d{6}/ });
  await expect(heading).toBeVisible();
  const number = /TCK-\d{4}-\d{6}/.exec(await heading.innerText())?.[0] ?? '';
  const ticketId = new URL(e.url()).pathname.split('/').pop() ?? '';
  expect(await latestMailText(employee, /We received your ticket/)).toContain(number);
  await expect(e.getByText('printer-error.pdf')).toBeVisible();

  // 2. Helpdesk takes it, keeps internal notes (with the canary), replies and asks.
  const s = await (await browser.newContext()).newPage();
  await helpdeskSession(s);
  await openStaffTicket(s, number);
  await s.getByRole('button', { name: 'Take' }).click();
  await expect(s.getByText('Taken')).toBeVisible();
  await s.getByRole('button', { name: 'Start work' }).click();
  await expect(s.getByText('Work started')).toBeVisible();
  await s.getByRole('tab', { name: 'Internal note' }).click();
  await s
    .getByLabel('Internal note', { exact: true })
    .and(s.locator('textarea'))
    .fill(`Old firmware, see vendor case ${CANARY}`);
  await s.locator('input[type=file]').setInputFiles({
    name: `${CANARY}.pdf`,
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await expect(s.getByRole('button', { name: `Remove ${CANARY}.pdf` })).toBeVisible();
  await s.getByRole('button', { name: 'Add internal note' }).click();
  await expect(s.locator('article[data-internal="true"]')).toContainText(CANARY);
  await s.getByRole('button', { name: 'Put on hold' }).click();
  await s.getByLabel('Why is it on hold?').fill(`Waiting for ${CANARY}`);
  await s.getByRole('button', { name: 'Confirm' }).click();
  await s.getByRole('button', { name: 'Resume' }).click();
  await expect(s.getByText('Resumed')).toBeVisible();
  // Back on the reply tab after the note.
  await s.getByLabel('Your reply').fill('Please send a photo of the printer display.');
  await s.getByRole('button', { name: 'Send reply' }).click();
  await expect(s.getByText('Please send a photo of the printer display.')).toBeVisible();
  await s.getByRole('button', { name: 'Ask the customer' }).click();
  await expect(s.getByText('Waiting for customer').first()).toBeVisible();

  // 3. The employee sees only the public reply, from "OGS"; nothing internal anywhere.
  await e.goto(`/support/${ticketId}`);
  await expect(e.getByText('Waiting for you').first()).toBeVisible();
  await expect(e.getByText('Please send a photo of the printer display.')).toBeVisible();
  expect(await latestMailText(employee, /New reply on ticket/)).not.toContain(CANARY);
  await assertNoCanary(e, ticketId, CANARY, 'requester');
  await e.goto(`/support/${ticketId}`);
  await e.getByLabel('Your reply').fill('The display says "Paper jam in tray 2".');
  await e.getByRole('button', { name: 'Send reply' }).click();
  await expect(e.getByText('In progress').first()).toBeVisible();

  // 4. Staff resolve; the employee reopens with a reason; staff resolve again.
  const resolve = async (text: string) => {
    await s.reload();
    await s.getByRole('button', { name: 'Resolve' }).click();
    await s.getByLabel('Resolution').fill(text);
    await s.getByRole('button', { name: 'Confirm' }).click();
    await expect(s.getByText(text)).toBeVisible();
  };
  await resolve('Cleared the paper jam and cleaned the rollers.');
  await e.reload();
  await expect(e.getByText(/you can reopen it until/)).toBeVisible();
  await e.getByRole('button', { name: 'Reopen' }).click();
  await e.getByLabel('What is still wrong?').fill('It jams again after ten pages.');
  await e.getByRole('button', { name: 'Confirm' }).click();
  await expect(e.getByText('In progress').first()).toBeVisible();
  await resolve('Replaced the worn tray 2 roller.');

  // 5. The employee accepts: closed.
  await e.reload();
  await e.getByRole('button', { name: 'Accept resolution' }).click();
  await expect(e.getByText('This ticket is closed.')).toBeVisible();

  // 6. The admin sees every organisation ticket, and nothing internal either.
  const a = await (await browser.newContext()).newPage();
  await signIn(a, admin, password);
  await enrolMfa(a);
  await a.getByLabel('Workspace', { exact: true }).selectOption(tenantId);
  await a.getByRole('link', { name: 'Support' }).click();
  await a.getByLabel('Show').selectOption('all');
  await expect(a.getByRole('link', { name: number }).first()).toBeVisible();
  await assertNoCanary(a, ticketId, CANARY, 'admin');

  // 7. No email to anyone contains the canary.
  const search = (await (
    await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(CANARY)}`)
  ).json()) as { messages?: unknown[] };
  expect(search.messages ?? []).toHaveLength(0);
});

test('helpdesk: a ticket by phone for a person, and a request for an organisation member', async ({
  browser,
}) => {
  const CANARY = `CANARY${unique()}${unique()}`;
  const person = { email: `caller-${unique()}@e2e.test`, password: `caller ${unique()} pass` };
  const p = await (await browser.newContext()).newPage();
  await signUpAndVerify(p, person.email, person.password);

  // 1. Helpdesk opens a ticket for the caller and writes an internal note.
  const s = await (await browser.newContext()).newPage();
  await helpdeskSession(s);
  await s.getByRole('link', { name: 'New ticket' }).click();
  await s.getByLabel('Customer', { exact: true }).fill(person.email);
  await s.getByLabel('Choose a customer').selectOption({ label: person.email });
  await s.getByLabel('How did they contact us?').selectOption({ label: 'phone' });
  await s.getByLabel('Subject').fill('Cannot sign in to email');
  await s.getByLabel('Describe the problem').fill('Caller says the mailbox rejects her password.');
  await s.getByRole('button', { name: 'Open ticket' }).click();
  const heading = s.getByRole('heading', { name: /TCK-\d{4}-\d{6}/ });
  await expect(heading).toBeVisible();
  const ticketId = new URL(s.url()).pathname.split('/').pop() ?? '';
  await s.getByRole('tab', { name: 'Internal note' }).click();
  await s
    .getByLabel('Internal note', { exact: true })
    .and(s.locator('textarea'))
    .fill(`Caller sounded unsure; verify identity ${CANARY}`);
  await s.getByRole('button', { name: 'Add internal note' }).click();
  await expect(s.locator('article[data-internal="true"]')).toContainText(CANARY);
  expect(await latestMailText(person.email, /opened ticket .* for you/)).toContain(
    'on your behalf',
  );

  // 2. The person sees it under Support, marked as opened by OGS by phone.
  await signIn(p, person.email, person.password);
  await p.getByRole('link', { name: 'Support' }).click();
  await p.getByRole('link', { name: /TCK-/ }).first().click();
  await expect(p.getByText('OGS opened this ticket for you (phone).')).toBeVisible();
  await assertNoCanary(p, ticketId, CANARY, 'individual');

  // 3. A service request entered for an organisation member.
  const password = `org ${unique()} pass`;
  const orgName = `Mombasa ${unique()} Clinic`;
  const employee = `employee-${unique()}@e2e.test`;
  const tenantId = await createOrganisation({
    name: orgName,
    adminEmail: `admin-${unique()}@e2e.test`,
    employeeEmail: employee,
    password,
    postpaid: false,
  });
  await s.goto('/platform/requests/new');
  await s.getByLabel('Customer', { exact: true }).fill(orgName);
  await s.getByLabel('Choose a customer').selectOption({ label: orgName });
  await s.getByLabel('Requester').selectOption({ label: employee });
  // An organisations-only service (the Phase 7 audience rule applies on behalf too).
  await s.getByRole('combobox', { name: 'Service' }).click();
  await s.getByRole('option', { name: 'Server setup' }).click();
  await s.getByLabel('Address').fill('Nyali, Mombasa');
  await s.getByLabel('Contact phone').fill('+254733000000');
  await s.getByRole('button', { name: 'Send request' }).click();
  const sent = s.getByText(/Request REQ-\d{4}-\d{6} is in the queue/);
  await expect(sent).toBeVisible();
  const requestNumber = /REQ-\d{4}-\d{6}/.exec(await sent.innerText())?.[0] ?? '';

  // 4. The member finds it among their own requests.
  const m = await (await browser.newContext()).newPage();
  await signIn(m, employee, password);
  await m.getByLabel('Workspace', { exact: true }).selectOption(tenantId);
  await m.getByRole('link', { name: 'Requests' }).click();
  await expect(m.getByRole('link', { name: requestNumber }).first()).toBeVisible();
});
