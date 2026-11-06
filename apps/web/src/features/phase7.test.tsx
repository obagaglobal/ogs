import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, signedIn } from '@/test/render-app';

const REQUEST_ID = '01930000-0000-7000-8000-0000000000d1';
const QUOTATION_ID = '01930000-0000-7000-8000-0000000000d2';

const personalWorkspaces = { status: 200, body: { workspaces: [], provider: null } };
const personalWorkspace = { status: 200, body: { kind: 'personal' } };
const csrf = { status: 200, body: { csrfToken: 'x'.repeat(43) } };

const perUnitService = {
  status: 200,
  body: {
    slug: 'desktop-support',
    name: 'Desktop support',
    summary: 'Health checks for office computers.',
    category: { slug: 'computers', name: 'Computers' },
    parentCategory: null,
    audience: 'ALL',
    deliveryMode: 'BOTH',
    price: {
      model: 'PER_UNIT',
      amountMinor: 120_000,
      currency: 'KES',
      unit: 'DEVICE',
      minQuantity: 5,
      label: 'KES 1,200 per device (min. 5 devices)',
      vatInclusiveMinor: 139_200,
    },
    description: 'Text',
    inclusions: [],
    exclusions: [],
    customerRequirements: [],
    typicalDuration: null,
  },
};

const requestView = (overrides: Record<string, unknown> = {}) => ({
  id: REQUEST_ID,
  number: 'REQ-2026-000042',
  status: 'QUOTATION_ISSUED',
  service: { id: '01930000-0000-7000-8000-0000000000d9', name: 'Fibre splicing', slug: 'fibre' },
  price: { model: 'QUOTE', unitAmountMinor: null, unit: null, label: 'Price on quotation' },
  quantity: 1,
  county: 'KE-30',
  address: 'Ngong Road',
  preferredFrom: null,
  preferredTo: null,
  description: '',
  contactPhone: '+254712345678',
  cancelReason: null,
  customerTenantId: null,
  createdBy: '01930000-0000-7000-8000-000000000102',
  createdAt: '2026-11-06T08:00:00.000Z',
  version: 3,
  history: [
    {
      fromStatus: null,
      toStatus: 'SUBMITTED',
      command: 'submit',
      reason: null,
      occurredAt: '2026-11-06T08:00:00.000Z',
    },
  ],
  quotations: [
    {
      id: QUOTATION_ID,
      number: 'QUO-2026-000007',
      revision: 1,
      status: 'ISSUED',
      validDays: 14,
      notes: '',
      subtotalMinor: 2_000_100,
      vatMinor: 320_016,
      totalMinor: 2_320_116,
      issuedAt: '2026-11-06T09:00:00.000Z',
      expiresAt: '2026-11-20T09:00:00.000Z',
      decidedAt: null,
      decisionReason: null,
      version: 1,
      lines: [
        {
          position: 1,
          description: 'Fusion splicing',
          quantity: 2,
          unitAmountMinor: 1_000_050,
          netMinor: 2_000_100,
          vatMinor: 320_016,
          totalMinor: 2_320_116,
        },
      ],
    },
  ],
  order: null,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Phase 7 customer pages (F10)', () => {
  it('the request form estimates the total and reuses one idempotency key across retries', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': personalWorkspaces,
      'GET /workspace': personalWorkspace,
      'GET /catalogue/services/desktop-support': perUnitService,
      'GET /reference/regions': {
        status: 200,
        body: { regions: [{ code: 'KE-30', name: 'Nairobi City', country: 'KE' }] },
      },
      'GET /auth/csrf': csrf,
      'POST /requests': () => {
        attempts += 1;
        return attempts === 1
          ? { status: 503, body: { error: 'temporarily_unavailable' } }
          : { status: 201, body: requestView({ status: 'SUBMITTED', quotations: [] }) };
      },
      [`GET /requests/${REQUEST_ID}`]: {
        status: 200,
        body: requestView({ status: 'SUBMITTED', quotations: [] }),
      },
    });
    renderApp('/requests/new?service=desktop-support');
    const quantity = await screen.findByLabelText('Quantity (minimum 5)');
    // 5 devices × KES 1,200 = 6,000 + 960 VAT.
    expect(screen.getByText(/Estimated total:/)).toHaveTextContent('KES 6,960');
    await user.clear(quantity);
    await user.type(quantity, '10');
    expect(screen.getByText(/Estimated total:/)).toHaveTextContent('KES 13,920');
    await user.type(screen.getByLabelText('Address'), 'Moi Avenue, Nairobi');
    await user.type(screen.getByLabelText('Contact phone'), '+254712345678');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('heading', { name: /REQ-2026-000042/ });
    const posts = calls.filter((call) => call.method === 'POST' && call.path === '/requests');
    expect(posts).toHaveLength(2);
    const keys = posts.map((call) => call.headers['idempotency-key']);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(posts[1]?.body).toMatchObject({
      serviceSlug: 'desktop-support',
      quantity: 10,
      county: 'KE-30',
    });
    expect(posts[1]?.body).not.toHaveProperty('price');
  });

  it('shows the quotation with VAT and accepts it with an idempotency key', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': personalWorkspaces,
      'GET /workspace': personalWorkspace,
      [`GET /requests/${REQUEST_ID}`]: { status: 200, body: requestView() },
      'GET /auth/csrf': csrf,
      [`POST /requests/${REQUEST_ID}/quotations/${QUOTATION_ID}/accept`]: {
        status: 200,
        body: requestView({ status: 'ORDERED' }),
      },
    });
    renderApp(`/requests/${REQUEST_ID}`);
    const table = await screen.findByRole('table', { name: 'Quotation QUO-2026-000007 lines' });
    expect(table).toHaveTextContent('KES 10,000.50');
    expect(table).toHaveTextContent('KES 3,200.16');
    expect(table).toHaveTextContent('KES 23,201.16');
    expect(screen.getByText('Quotation ready')).toBeInTheDocument();
    // Rejecting needs a reason; accepting does not.
    expect(screen.getByRole('button', { name: 'Reject quotation' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Accept quotation' }));
    await waitFor(() => {
      const accept = calls.find((call) => call.path.endsWith('/accept'));
      expect(accept?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      expect(accept?.body).toEqual({ version: 1 });
    });
  });
});

describe('Phase 7 staff pages (F10)', () => {
  const PLATFORM = '01930000-0000-7000-8000-000000000001';

  it('the quotation editor shows live totals and saves exact minor units', async () => {
    localStorage.setItem('ogs.workspace', PLATFORM);
    sessionStorage.setItem(
      'ogs.elevation',
      JSON.stringify({
        id: '01930000-0000-7000-8000-0000000000e9',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    const user = userEvent.setup();
    const awaiting = requestView({
      status: 'AWAITING_QUOTATION',
      quotations: [],
      price: { model: 'QUOTE', unitAmountMinor: null, unit: null, label: 'Price on quotation' },
    });
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': {
        status: 200,
        body: {
          workspaces: [
            {
              tenantId: PLATFORM,
              kind: 'PLATFORM',
              name: 'OGS Platform',
              status: 'ACTIVE',
              restricted: false,
            },
          ],
          provider: null,
        },
      },
      'GET /workspace': {
        status: 200,
        body: {
          kind: 'PLATFORM',
          tenantId: PLATFORM,
          name: 'OGS Platform',
          status: 'ACTIVE',
          restricted: false,
          membershipId: '01930000-0000-7000-8000-0000000000bb',
          roles: ['service_manager'],
          permissions: ['platform.quotation.issue'],
        },
      },
      [`GET /platform/requests/${REQUEST_ID}`]: { status: 200, body: awaiting },
      'GET /auth/csrf': csrf,
      [`PUT /platform/requests/${REQUEST_ID}/quotation`]: { status: 200, body: awaiting },
    });
    renderApp(`/platform/requests/${REQUEST_ID}`);
    const amount = await screen.findByLabelText('Line 1 unit price (KES)');
    await user.type(amount, '10,000.50');
    const quantity = screen.getByLabelText('Line 1 quantity');
    await user.clear(quantity);
    await user.type(quantity, '2');
    expect(screen.getByText(/Subtotal/)).toHaveTextContent(
      'Subtotal KES 20,001 + VAT KES 3,200.16 = KES 23,201.16',
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        lines: [{ description: 'Fibre splicing', quantity: 2, unitAmountMinor: 1_000_050 }],
        validDays: 14,
        notes: '',
      });
    });
  });
});
