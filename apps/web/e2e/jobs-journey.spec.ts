import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { resetRateLimits } from './rate-limits';
import {
  createIndividualProvider,
  createInternalTechnician,
  createProviderCompany,
  createReviewer,
  grantMembership,
  latestMailText,
  maintQuery,
  maintTransaction,
  PLATFORM_TENANT_ID,
  totp,
} from './support';

/**
 * T11 — jobs in real browsers (Phase 9 plan §4):
 * (a) the full journey: an individual orders a Wi-Fi setup → staff accept →
 *     finance records payment → the job is queued → an individual provider
 *     declines → a provider company accepts and names its technician → the
 *     technician, on a phone over a slow connection, goes on the way, starts,
 *     pauses, resumes, notes, photographs and reports → the customer watches
 *     the tracker and confirms → the order is Completed. On the way, every
 *     assignee page is checked for the customer's email and the order money (T5);
 * (b) an offer times out and the job returns to the queue; an internal OGS
 *     technician accepts; (c) staff reassign and the technician's open page
 *     turns into "no longer assigned"; (d) staff send a technician from a ticket.
 */
test.beforeAll(async () => {
  await resetRateLimits();
});

test.describe.configure({ timeout: 360_000 });

const unique = () => randomUUID().slice(0, 8);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(256, 0),
  Buffer.from([0xff, 0xd9]),
]);

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

async function chooseWorkspace(page: Page, value: string) {
  await page.getByLabel('Workspace', { exact: true }).selectOption(value);
}

/** Staff who accept requests (service_manager: also dispatch), record payments (finance), elevated. */
async function staffSession(page: Page, email: string, password: string): Promise<void> {
  await createReviewer(email, password);
  await grantMembership(email, PLATFORM_TENANT_ID, 'service_manager');
  await grantMembership(email, PLATFORM_TENANT_ID, 'finance');
  await grantMembership(email, PLATFORM_TENANT_ID, 'helpdesk');
  await signIn(page, email, password);
  const secret = await enrolMfa(page);
  await chooseWorkspace(page, PLATFORM_TENANT_ID);
  await page.getByRole('link', { name: 'Dispatch' }).click();
  await page.getByLabel('Reason').fill('Dispatch shift for the e2e journey');
  await page.getByLabel('Authenticator code').fill(totp(secret, Date.now() + 30_000));
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Queued').first()).toBeVisible();
}

/** An individual's paid order for the seeded Wi-Fi service; returns the request and order numbers. */
async function paidOrder(customer: Page, staff: Page, customerEmail: string) {
  await customer.goto('/services/home-wifi-setup');
  await customer.getByRole('link', { name: 'Request this service' }).click();
  await customer.getByLabel('Address').fill('Kilimani Road 7, Nairobi, house 3');
  await customer.getByLabel('Contact phone').fill('+254700000000');
  await customer.getByRole('button', { name: 'Send request' }).click();
  const heading = customer.getByRole('heading', { name: /REQ-\d{4}-\d{6}/ });
  await expect(heading).toBeVisible();
  const request = /REQ-\d{4}-\d{6}/.exec(await heading.innerText())?.[0] ?? '';

  await staff.goto('/platform/requests');
  await staff.getByLabel('Status').selectOption({ label: 'All' });
  await staff.getByRole('link', { name: request }).click();
  await staff.getByRole('button', { name: 'Start review' }).click();
  await staff.getByRole('button', { name: /Accept at KES/ }).click();
  await customer.reload();
  const order =
    /ORD-\d{4}-\d{6}/.exec(await customer.getByText(/quoting ORD-/).innerText())?.[0] ?? '';
  await staff.goto('/platform/orders');
  await staff.getByRole('link', { name: order }).click();
  await staff.getByLabel('Reference').fill(`QJK${unique().toUpperCase()}`);
  await staff.getByRole('button', { name: 'Record payment' }).click();
  await expect(staff.getByText('Confirmed').first()).toBeVisible();
  expect(await latestMailText(customerEmail, /is confirmed/)).toContain(order);
  return { request, order };
}

/** Opens the job of `source` (ORD-… or TCK-…) on the dispatch desk; the worker opens it in seconds. */
async function openDispatchJob(staff: Page, source: string): Promise<string> {
  await expect(async () => {
    await staff.goto('/platform/dispatch');
    await expect(staff.getByRole('row').filter({ hasText: source })).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 60_000 });
  const link = staff.getByRole('row').filter({ hasText: source }).getByRole('link').first();
  const number = (await link.innerText()).trim();
  await link.click();
  await expect(staff.getByRole('heading', { name: new RegExp(number) })).toBeVisible();
  return number;
}

async function offerTo(staff: Page, name: string) {
  await staff.reload();
  await staff.getByRole('button', { name: `Offer to ${name}` }).click();
  const dialog = staff.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Send offer' }).click();
  await expect(staff.getByText(new RegExp(`Offer out to ${name}`))).toBeVisible();
}

async function openOffer(page: Page, number: string) {
  await expect(async () => {
    await page.goto('/jobs');
    await page.getByRole('tab', { name: /Offers/ }).click();
    await expect(page.getByRole('link', { name: `View offer ${number}` })).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await page.getByRole('link', { name: `View offer ${number}` }).click();
}

/** T5 on the web: the page and every API response it loaded carry no customer secret. */
function watchResponses(page: Page): string[] {
  const bodies: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/')) {
      void response
        .text()
        .then((text) => bodies.push(text))
        .catch(() => undefined);
    }
  });
  return bodies;
}

test('(a) order → decline → company → technician on a slow phone → customer confirms', async ({
  browser,
}) => {
  const password = `jobs ${unique()} pass`;
  const customerEmail = `job-customer-${unique()}@e2e.test`;
  const individual = { email: `fundi-${unique()}@e2e.test`, name: `Grace Fundi ${unique()}` };
  const companyName = `Rift Valley Networks ${unique()}`;
  const admin = `pc-admin-${unique()}@e2e.test`;
  const technician = `amina.otieno-${unique()}@e2e.test`;
  await createIndividualProvider({ email: individual.email, password, name: individual.name });
  const companyTenant = await createProviderCompany({
    name: companyName,
    adminEmail: admin,
    technicianEmail: technician,
    password,
  });

  const c = await (await browser.newContext()).newPage();
  await signUpAndVerify(c, customerEmail, password);
  await signIn(c, customerEmail, password);
  const s = await (await browser.newContext()).newPage();
  await staffSession(s, `dispatch-${unique()}@e2e.test`, password);
  const { request, order } = await paidOrder(c, s, customerEmail);

  // The job is queued; the customer's tracker says "Finding a technician".
  const number = await openDispatchJob(s, order);
  await c.reload();
  await expect(c.getByText('Finding a technician').first()).toBeVisible();

  // 1. Offered to the individual, who sees the area only and declines.
  await offerTo(s, individual.name);
  const p = await (await browser.newContext()).newPage();
  await signIn(p, individual.email, password);
  await chooseWorkspace(p, 'provider');
  await openOffer(p, number);
  await expect(p.getByText('Kilimani Road 7', { exact: false })).toBeVisible();
  await expect(p.getByText('house 3')).toHaveCount(0);
  await p.getByRole('button', { name: 'Decline' }).click();
  await p.getByRole('radio', { name: 'Not available then' }).click();
  await p.getByRole('button', { name: 'Send decline' }).click();
  await expect(p.getByRole('heading', { name: 'Jobs' })).toBeVisible();

  // 2. Re-offered to the company: its admin accepts and names the technician.
  await offerTo(s, companyName);
  const a = await (await browser.newContext()).newPage();
  await signIn(a, admin, password);
  await enrolMfa(a);
  await chooseWorkspace(a, companyTenant);
  await openOffer(a, number);
  await a.getByLabel('Technician who will do the work').selectOption({ label: technician });
  await a.getByRole('button', { name: 'Accept job' }).click();
  await expect(a.getByRole('heading', { name: new RegExp(number) })).toBeVisible();

  // 3. The technician works on a phone over a slow connection (400 kbps, 400 ms).
  const phone = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const t = await phone.newPage();
  const bodies = watchResponses(t);
  await signIn(t, technician, password);
  await chooseWorkspace(t, companyTenant);
  const cdp = await phone.newCDPSession(t);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  await t.goto('/jobs');
  await t.getByRole('link', { name: `Open job ${number}` }).click();
  await expect(t.getByText('Kilimani Road 7, Nairobi, house 3')).toBeVisible();
  await expect(t.getByRole('link', { name: /Call site contact/ })).toHaveAttribute(
    'href',
    'tel:+254700000000',
  );
  await t.getByRole('button', { name: /on my way/ }).click();
  await t.getByRole('button', { name: 'Start work' }).click();
  await t.getByRole('button', { name: 'Pause' }).click();
  await t.getByLabel('Why are you pausing?').fill('Waiting for the spare router');
  await t.getByRole('button', { name: 'Pause job' }).click();
  await t.getByRole('button', { name: 'Resume work' }).click();
  await t.getByLabel('Add note').fill('Replaced the router in the living room.');
  await t.getByRole('button', { name: 'Add note' }).click();
  await expect(t.getByText('Replaced the router in the living room.')).toBeVisible();
  await t.locator('input[type="file"]').setInputFiles({
    name: 'after.jpg',
    mimeType: 'image/jpeg',
    buffer: JPEG,
  });
  await expect(t.getByRole('button', { name: /View photo 1/ })).toBeVisible({ timeout: 60_000 });
  await t.getByRole('button', { name: 'Submit completion report' }).click();
  await t.getByLabel('What did you do?').fill('Installed a new router and tested every room.');
  await t.getByLabel('Time on site (minutes)').fill('75');
  await t.getByRole('button', { name: 'Submit report' }).click();
  await expect(t.getByText('Waiting for customer').first()).toBeVisible();

  // T5: nothing the technician's browser received names the customer or the money.
  for (const path of ['/jobs', `/jobs?view=done`]) {
    await t.goto(path);
  }
  const all = `${bodies.join('\n')}\n${await t.content()}`;
  expect(all).not.toContain(customerEmail);
  expect(all).not.toMatch(/4,060|406000|totalMinor|subtotalMinor|paidMinor/);
  expect(all).not.toContain(order);

  // 4. The customer sees the report and confirms; the order is Completed.
  await c.goto('/requests');
  await c.getByRole('link', { name: request }).click();
  await expect(c.getByText('Check and confirm').first()).toBeVisible();
  await expect(c.getByText('OGS partner technician')).toBeVisible();
  await expect(c.getByText('Amina')).toBeVisible();
  await expect(c.getByText('Installed a new router and tested every room.')).toBeVisible();
  await c.getByRole('button', { name: 'Confirm work is complete' }).click();
  await expect(c.getByRole('heading', { name: new RegExp(request) })).toContainText('Completed');

  // The technician has lost the job; only the "Done" record remains.
  await t.goto('/jobs');
  await t.getByRole('tab', { name: 'Done' }).click();
  await expect(t.getByText(number)).toBeVisible();
});

test('(b, c) an offer times out → back in the queue → an OGS technician accepts → reassigned', async ({
  browser,
}) => {
  const password = `jobs ${unique()} pass`;
  const staffEmail = `dispatch-${unique()}@e2e.test`;
  const customerEmail = `job-customer-${unique()}@e2e.test`;
  const fundi = { email: `fundi-${unique()}@e2e.test`, name: `Peter Fundi ${unique()}` };
  const techEmail = `ogs-tech-${unique()}@e2e.test`;
  const providerId = await createIndividualProvider({
    email: fundi.email,
    password,
    name: fundi.name,
  });
  await createInternalTechnician(techEmail, password);

  const c = await (await browser.newContext()).newPage();
  await signUpAndVerify(c, customerEmail, password);
  await signIn(c, customerEmail, password);
  const s = await (await browser.newContext()).newPage();
  await staffSession(s, staffEmail, password);
  const { order } = await paidOrder(c, s, customerEmail);
  const number = await openDispatchJob(s, order);

  // An offer with a 5-second window (the API's shortest is 30 minutes) and its delayed expiry.
  await maintTransaction({ platformUserEmail: staffEmail }, [
    [
      `INSERT INTO job_offer (job_id, kind, provider_id, offered_by, expires_at)
       SELECT j.id, 'INDIVIDUAL', $2, app.current_user_id(), now() + interval '5 seconds'
         FROM job j WHERE j.number = $1`,
      [number, providerId],
    ],
    [`UPDATE job SET status = 'OFFERED', version = version + 1 WHERE number = $1`, [number]],
    [
      `INSERT INTO outbox_event (type, payload, available_at)
       SELECT 'jobs.offer_expire', jsonb_build_object('offerId', o.id), o.expires_at
         FROM job_offer o JOIN job j ON j.id = o.job_id WHERE j.number = $1 AND o.status = 'PENDING'`,
      [number],
    ],
  ]);
  await expect(async () => {
    await s.reload();
    await expect(s.getByRole('heading', { name: new RegExp(number) })).toContainText('Queued', {
      timeout: 2_000,
    });
  }).toPass({ timeout: 60_000 });

  // The OGS technician gets it instead.
  const t = await (await browser.newContext()).newPage();
  await signIn(t, techEmail, password);
  await enrolMfa(t);
  await chooseWorkspace(t, PLATFORM_TENANT_ID);
  await offerTo(s, techEmail);
  await openOffer(t, number);
  await t.getByRole('button', { name: 'Accept job' }).click();
  await expect(t.getByRole('button', { name: /on my way/ })).toBeVisible();

  // (c) Staff take it back; the technician's page says it is no longer theirs.
  await s.reload();
  await s.getByRole('button', { name: 'Reassign' }).click();
  await s.getByRole('dialog').getByLabel('Reason').fill('Customer asked for another visit day');
  await s.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await t.reload();
  await expect(
    t.getByRole('heading', { name: 'This job is no longer assigned to you' }),
  ).toBeVisible();
});

test('(d) staff send a technician from a ticket', async ({ browser }) => {
  const password = `jobs ${unique()} pass`;
  const staffEmail = `dispatch-${unique()}@e2e.test`;
  const ticket = `TCK-2026-${String(Math.floor(Math.random() * 900_000) + 100_000)}`;
  await maintQuery(
    `INSERT INTO ticket (number, customer_tenant_id, requester_user_id, created_by, category_id, subject,
                         description)
     SELECT $1, m.tenant_id, m.user_id, m.user_id, c.id, 'Core switch down',
            'The core switch in the server room is down.'
       FROM membership m JOIN tenant t ON t.id = m.tenant_id AND t.kind = 'ORGANISATION' AND t.status = 'ACTIVE'
       JOIN ticket_category c ON c.code = 'network'
      WHERE m.status = 'ACTIVE'
      LIMIT 1`,
    [ticket],
  );
  const s = await (await browser.newContext()).newPage();
  await staffSession(s, staffEmail, password);
  await s.goto('/platform/tickets');
  await s.getByLabel('Search').fill(ticket);
  await s.getByRole('link', { name: ticket }).first().click();
  await s.getByRole('button', { name: 'Send a technician' }).click();
  const dialog = s.getByRole('dialog');
  await dialog.getByLabel('Site address').fill('Kenyatta Avenue 5, Nairobi, 2nd floor');
  await dialog.getByRole('button', { name: 'Create job' }).click();
  await expect(s.getByRole('heading', { name: /JOB-\d{4}-\d{6}/ })).toBeVisible();
  await expect(s.getByText('Suggestions')).toBeVisible();
});
