import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navItemsFor } from '@/app/nav-items';
import { fitWithin, timeLeft } from '@/features/jobs/jobs-data';
import { mockApi, renderApp, signedIn } from '@/test/render-app';

const PROVIDER_ID = '01930000-0000-7000-8000-0000000009a1';
const JOB_ID = '01930000-0000-7000-8000-0000000009b1';
const OFFER_ID = '01930000-0000-7000-8000-0000000009c1';
const ASSIGNMENT_ID = '01930000-0000-7000-8000-0000000009d1';
const REQUEST_ID = '01930000-0000-7000-8000-0000000009e1';
const PHOTO_ID = '01930000-0000-7000-8000-0000000009f1';
const COMPANY = '01930000-0000-7000-8000-0000000009a2';

const csrf = { status: 200, body: { csrfToken: 'x'.repeat(43) } };
const providerWorkspaces = {
  status: 200,
  body: {
    workspaces: [],
    provider: { providerId: PROVIDER_ID, status: 'ACTIVE', restricted: false },
  },
};
const providerWorkspace = {
  status: 200,
  body: { kind: 'provider', providerId: PROVIDER_ID, status: 'ACTIVE', restricted: false },
};

const offer = (overrides: Record<string, unknown> = {}) => ({
  offerId: OFFER_ID,
  jobId: JOB_ID,
  number: 'JOB-2026-000042',
  title: 'Network repair',
  brief: 'Office Wi-Fi drops every hour.',
  skills: [{ code: 'networking', name: 'Networking', minExperience: 'YEARS_1_3' }],
  onSite: true,
  regionCode: 'KE-30',
  area: 'Moi Avenue 12',
  windowFrom: null,
  windowTo: null,
  expiresAt: new Date(Date.now() + 90 * 60_000).toISOString(),
  kind: 'INDIVIDUAL',
  technicians: [],
  ...overrides,
});

const job = (overrides: Record<string, unknown> = {}) => ({
  id: JOB_ID,
  number: 'JOB-2026-000042',
  title: 'Network repair',
  status: 'ASSIGNED',
  version: 3,
  brief: 'Office Wi-Fi drops every hour.',
  skills: [],
  onSite: true,
  regionCode: 'KE-30',
  siteAddress: 'Moi Avenue 12, Nairobi CBD, 3rd floor',
  siteContactName: 'Wanjiru',
  siteContactPhone: '+254700000000',
  customerDisplay: 'Private customer',
  windowFrom: null,
  windowTo: null,
  assignment: {
    id: ASSIGNMENT_ID,
    kind: 'INDIVIDUAL',
    technician: 'grace@example.test',
    startedAt: '2026-11-09T08:00:00.000Z',
  },
  activity: [],
  workNotes: [],
  photos: [],
  report: null,
  internalNotes: [],
  technicians: [],
  can: {
    onTheWay: true,
    start: false,
    pause: false,
    resume: false,
    addWork: true,
    complete: false,
    changeTechnician: false,
  },
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Phase 9 navigation', () => {
  it('providers and OGS technicians get "Jobs"; dispatchers get "Dispatch"', () => {
    expect(
      navItemsFor({
        kind: 'provider',
        providerId: PROVIDER_ID,
        status: 'ACTIVE',
        restricted: false,
      } as never).map((item) => item.to),
    ).toContain('/jobs');
    expect(
      navItemsFor({
        kind: 'provider',
        providerId: PROVIDER_ID,
        status: 'PENDING_APPROVAL',
        restricted: true,
      } as never).map((item) => item.to),
    ).not.toContain('/jobs');
    const platform = (permissions: string[]) =>
      navItemsFor({
        kind: 'PLATFORM',
        tenantId: COMPANY,
        name: 'OGS',
        status: 'ACTIVE',
        restricted: false,
        membershipId: COMPANY,
        roles: [],
        permissions,
      } as never).map((item) => item.label);
    expect(platform(['assignment.respond', 'ticket.update_progress'])).toContain('Jobs');
    expect(platform(['ticket.assign', 'ticket.read'])).toContain('Dispatch');
    // A service manager works tickets but is not a technician: no "Jobs".
    expect(platform(['ticket.assign', 'ticket.update_progress'])).not.toContain('Jobs');
    expect(navItemsFor({ kind: 'personal' } as never).map((item) => item.to)).not.toContain(
      '/jobs',
    );
  });
});

describe('Phase 9 helpers', () => {
  it('shrinks photos to at most 1600 px on the longest side, never enlarging', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('counts down offers', () => {
    const now = Date.parse('2026-11-09T08:00:00Z');
    expect(timeLeft('2026-11-09T09:42:00Z', now)).toBe('1 h 42 min');
    expect(timeLeft('2026-11-09T08:12:00Z', now)).toBe('12 min');
    expect(timeLeft('2026-11-09T07:59:00Z', now)).toBeNull();
  });
});

describe('Phase 9 technician screens (T11)', () => {
  function providerRoutes(routes: Record<string, unknown>) {
    localStorage.setItem('ogs.workspace', 'provider');
    return mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': providerWorkspaces,
      'GET /workspace': providerWorkspace,
      'GET /auth/csrf': csrf,
      ...routes,
    });
  }

  it('an offer shows the area only; accepting is the one highlight button', async () => {
    const user = userEvent.setup();
    const calls = providerRoutes({
      [`GET /jobs/offers/${OFFER_ID}`]: { status: 200, body: offer() },
      [`POST /jobs/offers/${OFFER_ID}/accept`]: { status: 201, body: job() },
      [`GET /jobs/${JOB_ID}`]: { status: 200, body: job() },
    });
    renderApp(`/jobs/offers/${OFFER_ID}`);
    expect(await screen.findByText(/Moi Avenue 12/)).toBeInTheDocument();
    expect(screen.queryByText(/3rd floor/)).not.toBeInTheDocument();
    expect(screen.getByText(/Expires in 1 h 30 min|Expires in 1 h 29 min/)).toBeInTheDocument();
    const accept = screen.getByRole('button', { name: 'Accept job' });
    expect(accept.className).toContain('bg-saffron');
    expect(
      screen.getAllByRole('button').filter((button) => button.className.includes('bg-saffron')),
    ).toHaveLength(1);
    await user.click(accept);
    await screen.findByText('Moi Avenue 12, Nairobi CBD, 3rd floor');
    const post = calls.find((call) => call.method === 'POST' && call.path.endsWith('/accept'));
    expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('declining asks for a reason', async () => {
    const user = userEvent.setup();
    const calls = providerRoutes({
      [`GET /jobs/offers/${OFFER_ID}`]: { status: 200, body: offer() },
      [`POST /jobs/offers/${OFFER_ID}/decline`]: { status: 200, body: { declined: true } },
      'GET /jobs': {
        status: 200,
        body: {
          view: 'active',
          items: [],
          done: [],
          total: 0,
          page: 1,
          pageSize: 20,
          counts: { offers: 0, active: 0 },
        },
      },
    });
    renderApp(`/jobs/offers/${OFFER_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Too far' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send decline' }));
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/decline'))?.body).toEqual({
        reason: 'TOO_FAR',
      });
    });
  });

  it('the job page has one next step, a call link and keeps typed notes', async () => {
    const user = userEvent.setup();
    providerRoutes({ [`GET /jobs/${JOB_ID}`]: { status: 200, body: job() } });
    renderApp(`/jobs/${JOB_ID}`);
    const next = await screen.findByRole('button', { name: 'I’m on my way' });
    expect(next.className).toContain('bg-saffron');
    expect(screen.getByRole('link', { name: 'Call site contact Wanjiru' })).toHaveAttribute(
      'href',
      'tel:+254700000000',
    );
    await user.type(screen.getByLabelText(/Add note/), 'Router replaced');
    expect(sessionStorage.getItem(`ogs.draft.job-note-${JOB_ID}`)).toBe('Router replaced');
  });

  it('a failed command is retried with the SAME Idempotency-Key', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const keys: string[] = [];
    providerRoutes({ [`GET /jobs/${JOB_ID}`]: { status: 200, body: job() } });
    const fetchMock = vi.mocked(globalThis.fetch);
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith(`/jobs/${JOB_ID}/on-the-way`)) {
        keys.push((init.headers as Record<string, string>)['Idempotency-Key'] ?? '');
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify(job({ status: 'ON_THE_WAY' })), { status: 201 });
      }
      return original === undefined ? new Response('{}') : original(input, init);
    });
    renderApp(`/jobs/${JOB_ID}`);
    await user.click(await screen.findByRole('button', { name: 'I’m on my way' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(attempts).toBe(2);
    });
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('a job that is no longer assigned says so', async () => {
    providerRoutes({ [`GET /jobs/${JOB_ID}`]: { status: 404, body: { error: 'not_found' } } });
    renderApp(`/jobs/${JOB_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'This job is no longer assigned to you' }),
    ).toBeInTheDocument();
  });
});

describe('Phase 9 customer tracker (T11)', () => {
  it('shows who is coming, the steps, the report and a highlight to confirm', async () => {
    const user = userEvent.setup();
    const progress = {
      job: {
        id: JOB_ID,
        number: 'JOB-2026-000042',
        status: 'AWAITING_CONFIRMATION',
        label: 'check_and_confirm',
        version: 7,
        assignee: { firstName: 'Amina', initials: 'AM', partner: true },
        activity: [{ id: PHOTO_ID, kind: 'accept', at: '2026-11-09T08:00:00.000Z' }],
        report: {
          id: ASSIGNMENT_ID,
          summary: 'Replaced the access point.',
          minutesOnSite: 75,
          materials: '',
          submittedAt: '2026-11-09T10:00:00.000Z',
          autoConfirmAt: '2026-11-16T10:00:00.000Z',
          outcome: null,
          photos: [
            {
              id: PHOTO_ID,
              caption: 'After',
              status: 'CLEAN',
              createdAt: '2026-11-09T09:00:00.000Z',
            },
          ],
        },
        can: { confirm: true, reportProblem: true },
      },
    };
    const request = {
      id: REQUEST_ID,
      number: 'REQ-2026-000101',
      status: 'ORDERED',
      service: { id: REQUEST_ID, name: 'Network repair', slug: 'network-repair' },
      price: { model: 'FIXED', unitAmountMinor: 350_000, unit: null, label: 'KES 3,500' },
      quantity: 1,
      county: 'KE-30',
      address: 'Moi Avenue 12',
      preferredFrom: null,
      preferredTo: null,
      description: '',
      contactPhone: '+254700000000',
      cancelReason: null,
      customerTenantId: null,
      createdBy: '01930000-0000-7000-8000-000000000102',
      createdAt: '2026-11-09T07:00:00.000Z',
      version: 2,
      history: [],
      quotations: [],
      order: {
        id: REQUEST_ID,
        number: 'ORD-2026-000055',
        status: 'IN_DELIVERY',
        paymentTerms: 'PREPAY',
        netDays: null,
        subtotalMinor: 350_000,
        vatMinor: 56_000,
        totalMinor: 406_000,
        paidMinor: 406_000,
        refundDue: false,
        cancelReason: null,
        version: 3,
        createdAt: '2026-11-09T07:00:00.000Z',
        history: [],
        payments: [],
      },
    };
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': { status: 200, body: { workspaces: [], provider: null } },
      'GET /workspace': { status: 200, body: { kind: 'personal' } },
      'GET /auth/csrf': csrf,
      [`GET /requests/${REQUEST_ID}`]: { status: 200, body: request },
      [`GET /requests/${REQUEST_ID}/progress`]: { status: 200, body: progress },
      [`POST /requests/${REQUEST_ID}/job/confirm`]: { status: 200, body: progress },
    });
    renderApp(`/requests/${REQUEST_ID}`);
    expect(await screen.findByText('Amina')).toBeInTheDocument();
    expect(screen.getByText('OGS partner technician')).toBeInTheDocument();
    expect(screen.getByText('Replaced the access point.')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm work is complete' });
    expect(confirm.className).toContain('bg-saffron');
    await user.click(confirm);
    await waitFor(() => {
      const post = calls.find((call) => call.path.endsWith('/job/confirm'));
      expect(post?.body).toEqual({ version: 7 });
      expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
