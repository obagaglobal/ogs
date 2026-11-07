import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * API fixtures for the Phase 7 design pages (Phase 6b §9.4): request detail,
 * staff request with the quotation editor, orders list and finance order.
 * Every API call those pages make is answered here, so their screenshots and
 * accessibility checks need no real staff login, elevation or data.
 */
export type Phase7Fixture = 'customer-request' | 'staff-request' | 'orders' | 'finance-order';

const PLATFORM = '01930000-0000-7000-8000-000000000001';
const ORG = '01930000-0000-7000-8000-0000000000a1';
const REQUEST_ID = '01930000-0000-7000-8000-0000000000c1';
const ORDER_ID = '01930000-0000-7000-8000-0000000000d1';
const AT = '2026-11-06T08:00:00.000Z';

const session = {
  user: {
    id: '01930000-0000-7000-8000-000000000102',
    email: 'wanjiru.kamau@savanna.test',
    status: 'ACTIVE',
    mfaEnabled: true,
  },
  session: {
    id: '01930000-0000-7000-8000-000000000999',
    createdAt: AT,
    lastSeenAt: AT,
    expiresAt: '2099-01-01T00:00:00.000Z',
    ip: '127.0.0.1',
    userAgent: 'design-tests',
    current: true,
    mfaPending: false,
  },
};

const platformWorkspaces = {
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
};
const platformWorkspace = {
  kind: 'PLATFORM',
  tenantId: PLATFORM,
  name: 'OGS Platform',
  status: 'ACTIVE',
  restricted: false,
  membershipId: '01930000-0000-7000-8000-0000000000bb',
  roles: ['service_manager', 'finance'],
  permissions: ['platform.quotation.issue', 'platform.finance.manage'],
};

const history = (steps: [string | null, string, string, string | null][]) =>
  steps.map(([fromStatus, toStatus, occurredAt, reason]) => ({
    fromStatus,
    toStatus,
    command: 'design',
    reason,
    occurredAt,
  }));

const line = (position: number, description: string, quantity: number, unit: number) => {
  const net = quantity * unit;
  const vat = Math.round(net * 0.16);
  return {
    position,
    description,
    quantity,
    unitAmountMinor: unit,
    netMinor: net,
    vatMinor: vat,
    totalMinor: net + vat,
  };
};

function quotation(status: 'ISSUED' | 'DRAFT', lines: ReturnType<typeof line>[]) {
  const subtotal = lines.reduce((sum, l) => sum + l.netMinor, 0);
  const vat = lines.reduce((sum, l) => sum + l.vatMinor, 0);
  return {
    id: '01930000-0000-7000-8000-0000000000e1',
    number: 'QUO-2026-000045',
    revision: 1,
    status,
    validDays: 14,
    notes: status === 'ISSUED' ? 'Cabling runs in existing trunking; no wall chasing.' : '',
    subtotalMinor: subtotal,
    vatMinor: vat,
    totalMinor: subtotal + vat,
    issuedAt: status === 'ISSUED' ? '2026-11-06T09:00:00.000Z' : null,
    // Far ahead so the "expires soon" badge never depends on the day the tests run.
    expiresAt: status === 'ISSUED' ? '2099-01-14T09:00:00.000Z' : null,
    decidedAt: null,
    decisionReason: null,
    version: 1,
    lines,
  };
}

const officeLines = [
  line(1, 'Cat6 cabling points', 12, 450_000),
  line(2, '24-port managed switch', 1, 3_850_000),
  line(3, 'Wi-Fi access points, installed', 3, 1_200_000),
];

function request(overrides: Record<string, unknown>) {
  return {
    id: REQUEST_ID,
    number: 'REQ-2026-000123',
    status: 'QUOTATION_ISSUED',
    service: {
      id: '01930000-0000-7000-8000-0000000000f1',
      name: 'Office network installation',
      slug: 'office-network',
    },
    price: { model: 'FROM', unitAmountMinor: 4_500_000, unit: null, label: 'From KES 45,000' },
    quantity: 1,
    county: 'KE-30',
    address: 'Westlands, Nairobi',
    preferredFrom: '2026-11-16',
    preferredTo: '2026-11-20',
    description: 'Twelve desks on the second floor need wired points and good Wi-Fi.',
    contactPhone: '+254712345678',
    cancelReason: null,
    customerTenantId: ORG,
    createdBy: session.user.id,
    createdAt: AT,
    version: 4,
    history: history([
      [null, 'SUBMITTED', AT, null],
      ['SUBMITTED', 'UNDER_REVIEW', '2026-11-06T08:20:00.000Z', null],
      ['UNDER_REVIEW', 'AWAITING_QUOTATION', '2026-11-06T08:25:00.000Z', null],
      ['AWAITING_QUOTATION', 'QUOTATION_ISSUED', '2026-11-06T09:00:00.000Z', null],
    ]),
    quotations: [quotation('ISSUED', officeLines)],
    order: null,
    ...overrides,
  };
}

const issued = quotation('ISSUED', officeLines);
const order = {
  id: ORDER_ID,
  number: 'ORD-2026-000067',
  status: 'AWAITING_PAYMENT',
  paymentTerms: 'PREPAY',
  netDays: null,
  subtotalMinor: issued.subtotalMinor,
  vatMinor: issued.vatMinor,
  totalMinor: issued.totalMinor,
  paidMinor: 5_000_000,
  refundDue: false,
  cancelReason: null,
  version: 2,
  createdAt: '2026-11-06T10:00:00.000Z',
  history: history([[null, 'AWAITING_PAYMENT', '2026-11-06T10:00:00.000Z', null]]),
  payments: [
    {
      id: '01930000-0000-7000-8000-0000000000a9',
      amountMinor: 5_000_000,
      method: 'MPESA_PAYBILL',
      reference: 'SKL4Q7XY2P',
      note: null,
      recordedAt: '2026-11-06T11:30:00.000Z',
    },
  ],
};

const orderRow = (
  n: number,
  customer: string,
  service: string,
  total: number,
  paid: number,
  status: string,
) => ({
  id: `01930000-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
  number: `ORD-2026-0000${String(60 + n)}`,
  status,
  totalMinor: total,
  paidMinor: paid,
  refundDue: false,
  createdAt: `2026-11-0${String(1 + (n % 6))}T10:00:00.000Z`,
  requestNumber: `REQ-2026-0001${String(10 + n)}`,
  serviceName: service,
  customerName: customer,
});

const ORDERS = [
  orderRow(
    1,
    'Savanna Design Ltd',
    'Office network installation',
    order.totalMinor,
    5_000_000,
    'AWAITING_PAYMENT',
  ),
  orderRow(2, 'Grace Achieng', 'Home Wi-Fi setup', 406_000, 0, 'AWAITING_PAYMENT'),
  orderRow(3, 'Mombasa Port Clinic', 'CCTV, 4 cameras', 9_802_000, 9_802_000, 'AWAITING_PAYMENT'),
  orderRow(4, 'Kisumu Agro Co-op', 'Microsoft 365 set-up', 1_392_000, 600_000, 'AWAITING_PAYMENT'),
];

function bodyFor(fixture: Phase7Fixture, method: string, path: string): unknown {
  if (path === '/auth/session') return session;
  if (path === '/auth/csrf') return { csrfToken: 'x'.repeat(43) };
  if (path === '/reference/regions')
    return { regions: [{ code: 'KE-30', name: 'Nairobi City', country: 'KE' }] };
  if (fixture === 'customer-request') {
    if (path === '/me/workspaces') return { workspaces: [], provider: null };
    if (path === '/workspace') return { kind: 'personal' };
    if (path === `/requests/${REQUEST_ID}`) return request({ customerTenantId: null });
  }
  if (path === '/me/workspaces') return platformWorkspaces;
  if (path === '/workspace') return platformWorkspace;
  if (fixture === 'staff-request' && path === `/platform/requests/${REQUEST_ID}`) {
    return request({
      status: 'AWAITING_QUOTATION',
      history: history([
        [null, 'SUBMITTED', AT, null],
        ['SUBMITTED', 'UNDER_REVIEW', '2026-11-06T08:20:00.000Z', null],
        ['UNDER_REVIEW', 'AWAITING_QUOTATION', '2026-11-06T08:25:00.000Z', null],
      ]),
      quotations: [quotation('DRAFT', officeLines)],
    });
  }
  if (path === '/platform/orders' && method === 'GET') return { orders: ORDERS };
  if (path === `/platform/orders/${ORDER_ID}`) {
    return request({
      status: 'ORDERED',
      quotations: [{ ...issued, status: 'ACCEPTED', decidedAt: '2026-11-06T10:00:00.000Z' }],
      order,
    });
  }
  if (path === `/platform/organisations/${ORG}/billing`) {
    return { tenantId: ORG, paymentTerms: 'PREPAY', netDays: null, version: 1 };
  }
  return undefined;
}

/** Answers every Phase 7 page API call (the catalogue keeps its own mock). */
export async function mockPhase7(page: Page, fixture: Phase7Fixture): Promise<void> {
  await page.route(/\/api\/v1\/(?!catalogue\/)/, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const body = bodyFor(fixture, request.method(), path);
    await (body === undefined
      ? route.fulfill({ status: 404, json: { error: 'not_found' } })
      : route.fulfill({ json: body }));
  });
}

/** The workspace and, for staff pages, an active elevation. */
export async function phase7Storage(
  context: BrowserContext,
  fixture: Phase7Fixture,
): Promise<void> {
  await context.addInitScript(
    ({ staff, platform }) => {
      localStorage.setItem('ogs.workspace', staff ? platform : 'personal');
      if (staff) {
        sessionStorage.setItem(
          'ogs.elevation',
          JSON.stringify({
            id: '01930000-0000-7000-8000-0000000000e9',
            expiresAt: '2099-01-01T00:00:00.000Z',
          }),
        );
      }
    },
    { staff: fixture !== 'customer-request', platform: PLATFORM },
  );
}

/** Paths of the four fixture pages. */
export const PHASE7_PATHS: Record<Phase7Fixture, string> = {
  'customer-request': `/requests/${REQUEST_ID}`,
  'staff-request': `/platform/requests/${REQUEST_ID}`,
  orders: '/platform/orders',
  'finance-order': `/platform/orders/${ORDER_ID}`,
};
