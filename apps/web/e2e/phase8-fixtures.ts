import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * API fixtures for the Phase 8 design pages: a customer ticket, the staff
 * queue and the staff ticket workspace (with an internal note). Every API call
 * those pages make is answered here, so screenshots and accessibility checks
 * need no real staff login, elevation or data.
 */
export type Phase8Fixture = 'customer-ticket' | 'ticket-queue' | 'staff-ticket';

const PLATFORM = '01930000-0000-7000-8000-000000000001';
const TICKET_ID = '01930000-0000-7000-8000-0000000002a1';
const AGENT = { id: '01930000-0000-7000-8000-0000000002b1', email: 'achieng.otieno@ogs.test' };
const REQUESTER = {
  id: '01930000-0000-7000-8000-000000000102',
  email: 'wanjiru.kamau@savanna.test',
};
const AT = '2026-11-07T07:45:00.000Z';

const session = {
  user: { id: REQUESTER.id, email: REQUESTER.email, status: 'ACTIVE', mfaEnabled: true },
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

const categories = {
  categories: [
    { code: 'hardware', name: 'Hardware' },
    { code: 'network', name: 'Network and internet' },
    { code: 'printers', name: 'Printers' },
  ],
};

const file = (id: string, name: string, sizeBytes: number) => ({
  id,
  name,
  mimeType: 'application/pdf',
  sizeBytes,
  status: 'CLEAN',
});

const base = {
  id: TICKET_ID,
  number: 'TCK-2026-000214',
  subject: 'Wi-Fi drops in the boardroom',
  urgency: 'HIGH',
  createdAt: AT,
  updatedAt: '2026-11-07T10:05:00.000Z',
  description:
    'Since Monday the Wi-Fi in the boardroom drops every few minutes during video calls. Other rooms are fine.',
  type: 'INCIDENT',
  category: { code: 'network', name: 'Network and internet' },
  priority: 'P2',
  channel: 'WEB',
  onBehalf: false,
  serviceOrder: { id: '01930000-0000-7000-8000-0000000000d1', number: 'ORD-2026-000067' },
  relatedTicket: null,
  departmentName: 'Operations',
  resolution: null,
  closure: null,
  closureReason: null,
  resolvedAt: null,
  closedAt: null,
  reopenUntil: null,
  attachments: [file('01930000-0000-7000-8000-0000000002c1', 'speed-test.pdf', 182_000)],
};

const customerTicket = {
  ...base,
  status: 'AWAITING_CUSTOMER',
  requesterLabel: 'You',
  version: 6,
  messages: [
    {
      id: '01930000-0000-7000-8000-0000000002d1',
      side: 'STAFF',
      authorLabel: 'OGS support',
      body: 'Thanks. Is the access point above the projector, and does it show a steady green light?',
      createdAt: '2026-11-07T08:40:00.000Z',
      attachments: [],
    },
    {
      id: '01930000-0000-7000-8000-0000000002d2',
      side: 'CUSTOMER',
      authorLabel: 'You',
      body: 'Yes, above the projector. The light blinks orange now and then.',
      createdAt: '2026-11-07T09:10:00.000Z',
      attachments: [file('01930000-0000-7000-8000-0000000002c2', 'access-point.pdf', 940_000)],
    },
    {
      id: '01930000-0000-7000-8000-0000000002d3',
      side: 'STAFF',
      authorLabel: 'OGS support',
      body: 'That points to the power injector. Can someone be in the boardroom tomorrow at 10:00?',
      createdAt: '2026-11-07T10:05:00.000Z',
      attachments: [],
    },
  ],
  activity: [
    { kind: 'created', fromValue: null, toValue: 'NEW', reason: null, occurredAt: AT },
    {
      kind: 'triage',
      fromValue: 'NEW',
      toValue: 'OPEN',
      reason: null,
      occurredAt: '2026-11-07T08:20:00.000Z',
    },
    {
      kind: 'comment',
      fromValue: null,
      toValue: null,
      reason: null,
      occurredAt: '2026-11-07T08:40:00.000Z',
    },
    {
      kind: 'await_customer',
      fromValue: 'IN_PROGRESS',
      toValue: 'AWAITING_CUSTOMER',
      reason: null,
      occurredAt: '2026-11-07T10:05:00.000Z',
    },
  ],
  can: { comment: true, reopen: false, acceptResolution: false, withdraw: true },
};

const staffTicket = {
  ...base,
  status: 'IN_PROGRESS',
  customerName: 'Savanna Design Ltd',
  assignee: AGENT,
  customer: {
    kind: 'ORGANISATION',
    tenantId: '01930000-0000-7000-8000-0000000000a1',
    userId: null,
    name: 'Savanna Design Ltd',
  },
  requester: REQUESTER,
  createdBy: REQUESTER,
  serviceOrder: { ...base.serviceOrder, status: 'READY_FOR_ASSIGNMENT', totalMinor: 8_352_000 },
  reopenCount: 0,
  firstResponseAt: '2026-11-07T08:40:00.000Z',
  version: 5,
  thread: [
    {
      id: '01930000-0000-7000-8000-0000000002d1',
      kind: 'comment',
      side: 'STAFF',
      author: AGENT,
      body: 'Thanks. Is the access point above the projector, and does it show a steady green light?',
      createdAt: '2026-11-07T08:40:00.000Z',
      attachments: [],
    },
    {
      id: '01930000-0000-7000-8000-0000000002e1',
      kind: 'note',
      side: 'STAFF',
      author: AGENT,
      body: 'Same model as the Westlands site; their injector failed in September. Bring a spare.',
      createdAt: '2026-11-07T08:55:00.000Z',
      attachments: [],
    },
    {
      id: '01930000-0000-7000-8000-0000000002d2',
      kind: 'comment',
      side: 'CUSTOMER',
      author: REQUESTER,
      body: 'Yes, above the projector. The light blinks orange now and then.',
      createdAt: '2026-11-07T09:10:00.000Z',
      attachments: [file('01930000-0000-7000-8000-0000000002c2', 'access-point.pdf', 940_000)],
    },
  ],
  activity: [
    {
      kind: 'created',
      visibility: 'PUBLIC',
      fromValue: null,
      toValue: 'NEW',
      reason: null,
      actor: REQUESTER,
      occurredAt: AT,
    },
    {
      kind: 'take',
      visibility: 'INTERNAL',
      fromValue: null,
      toValue: AGENT.id,
      reason: null,
      actor: AGENT,
      occurredAt: '2026-11-07T08:15:00.000Z',
    },
    {
      kind: 'triage',
      visibility: 'PUBLIC',
      fromValue: 'NEW',
      toValue: 'OPEN',
      reason: null,
      actor: AGENT,
      occurredAt: '2026-11-07T08:20:00.000Z',
    },
    {
      kind: 'internal_note',
      visibility: 'INTERNAL',
      fromValue: null,
      toValue: null,
      reason: null,
      actor: AGENT,
      occurredAt: '2026-11-07T08:55:00.000Z',
    },
  ],
};

const queueRow = (
  n: number,
  subject: string,
  customer: string,
  priority: string | null,
  status: string,
  hoursAgo: number,
  assigned: boolean,
) => ({
  id: `01930000-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`,
  number: `TCK-2026-0002${String(10 + n)}`,
  subject,
  status,
  priority,
  urgency: 'NORMAL',
  category: { code: 'network', name: 'Network and internet' },
  customerName: customer,
  assignee: assigned ? AGENT : null,
  onBehalf: n === 3,
  // Relative to the test run, so the "Age" column (1 h, 4 h, 26 h, 2 d) is stable in screenshots.
  createdAt: new Date(Date.now() - hoursAgo * 3_600_000 - 60_000).toISOString(),
  updatedAt: '2026-11-07T10:05:00.000Z',
});

const queue = {
  tickets: [
    queueRow(1, 'Server room alarm keeps sounding', 'Mombasa Port Clinic', null, 'NEW', 1, false),
    queueRow(2, 'Wi-Fi drops in the boardroom', 'Savanna Design Ltd', 'P2', 'IN_PROGRESS', 4, true),
    queueRow(
      3,
      'Cannot sign in to email',
      'grace.achieng@example.test',
      'P3',
      'AWAITING_CUSTOMER',
      26,
      true,
    ),
    queueRow(4, 'New starter needs a laptop set up', 'Kisumu Agro Co-op', 'P4', 'OPEN', 50, false),
  ],
  total: 4,
  page: 1,
  pageSize: 25,
  counts: { unassigned: 2, mine: 2, awaitingCustomer: 1 },
};

const platformWorkspace = {
  kind: 'PLATFORM',
  tenantId: PLATFORM,
  name: 'OGS Platform',
  status: 'ACTIVE',
  restricted: false,
  membershipId: '01930000-0000-7000-8000-0000000000bb',
  roles: ['ict_support_manager'],
  permissions: [
    'ticket.read',
    'ticket.comment',
    'ticket.internal_note',
    'ticket.assign',
    'ticket.create',
  ],
};

function bodyFor(fixture: Phase8Fixture, path: string): unknown {
  if (path === '/auth/session') return session;
  if (path === '/auth/csrf') return { csrfToken: 'x'.repeat(43) };
  if (path === '/tickets/categories') return categories;
  if (fixture === 'customer-ticket') {
    if (path === '/me/workspaces') return { workspaces: [], provider: null };
    if (path === '/workspace') return { kind: 'personal' };
    if (path === `/tickets/${TICKET_ID}`) return customerTicket;
    return undefined;
  }
  if (path === '/me/workspaces') {
    return {
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
  }
  if (path === '/workspace') return platformWorkspace;
  if (path === '/platform/tickets') return queue;
  if (path === `/platform/tickets/${TICKET_ID}`) return staffTicket;
  if (path === `/platform/tickets/${TICKET_ID}/linkable-orders`) {
    return {
      orders: [
        {
          id: base.serviceOrder.id,
          number: base.serviceOrder.number,
          serviceName: 'Office network installation',
        },
      ],
    };
  }
  if (path === '/platform/ticket-assignees') return { assignees: [AGENT] };
  return undefined;
}

/** Answers every Phase 8 page API call. */
export async function mockPhase8(page: Page, fixture: Phase8Fixture): Promise<void> {
  await page.route(/\/api\/v1\/(?!catalogue\/)/, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const body = bodyFor(fixture, path);
    await (body === undefined
      ? route.fulfill({ status: 404, json: { error: 'not_found' } })
      : route.fulfill({ json: body }));
  });
}

export async function phase8Storage(
  context: BrowserContext,
  fixture: Phase8Fixture,
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
    { staff: fixture !== 'customer-ticket', platform: PLATFORM },
  );
}

export const PHASE8_PATHS: Record<Phase8Fixture, string> = {
  'customer-ticket': `/support/${TICKET_ID}`,
  'ticket-queue': '/platform/tickets',
  'staff-ticket': `/platform/tickets/${TICKET_ID}`,
};
