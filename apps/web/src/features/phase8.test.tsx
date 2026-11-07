import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navItemsFor } from '@/app/nav-items';
import { mockApi, renderApp, signedIn } from '@/test/render-app';

const TICKET_ID = '01930000-0000-7000-8000-0000000000f1';
const PLATFORM = '01930000-0000-7000-8000-000000000001';
const STAFF_ID = '01930000-0000-7000-8000-0000000000f7';

const personalWorkspaces = { status: 200, body: { workspaces: [], provider: null } };
const personalWorkspace = { status: 200, body: { kind: 'personal' } };
const csrf = { status: 200, body: { csrfToken: 'x'.repeat(43) } };
const categories = {
  status: 200,
  body: {
    categories: [
      { code: 'hardware', name: 'Hardware' },
      { code: 'printers', name: 'Printers' },
    ],
  },
};

const customerTicket = (overrides: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  number: 'TCK-2026-000017',
  subject: 'Printer offline',
  status: 'IN_PROGRESS',
  urgency: 'HIGH',
  createdAt: '2026-11-07T08:00:00.000Z',
  updatedAt: '2026-11-07T09:00:00.000Z',
  requesterLabel: 'You',
  description: 'The office printer shows offline.',
  type: 'INCIDENT',
  category: { code: 'printers', name: 'Printers' },
  priority: 'P2',
  channel: 'WEB',
  onBehalf: false,
  serviceOrder: null,
  relatedTicket: null,
  departmentName: null,
  resolution: null,
  closure: null,
  closureReason: null,
  resolvedAt: null,
  closedAt: null,
  reopenUntil: null,
  version: 4,
  attachments: [],
  messages: [
    {
      id: '01930000-0000-7000-8000-0000000000f2',
      side: 'STAFF',
      authorLabel: 'OGS support',
      body: 'Please restart it and tell us the light colour.',
      createdAt: '2026-11-07T08:30:00.000Z',
      attachments: [],
    },
  ],
  activity: [
    {
      kind: 'created',
      fromValue: null,
      toValue: 'NEW',
      reason: null,
      occurredAt: '2026-11-07T08:00:00.000Z',
    },
  ],
  can: { comment: true, reopen: false, acceptResolution: false, withdraw: true },
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('Phase 8 navigation', () => {
  it('customers get "Support", staff with ticket.read get "Tickets"', () => {
    expect(navItemsFor({ kind: 'personal' } as never).map((item) => item.to)).toContain('/support');
    const platform = navItemsFor({
      kind: 'PLATFORM',
      tenantId: PLATFORM,
      name: 'OGS Platform',
      status: 'ACTIVE',
      restricted: false,
      membershipId: PLATFORM,
      roles: ['helpdesk'],
      permissions: ['ticket.read'],
    } as never);
    expect(platform.map((item) => item.label)).toContain('Tickets');
    expect(platform.map((item) => item.to)).not.toContain('/support');
  });
});

describe('Phase 8 customer pages (T9)', () => {
  it('opens a ticket with urgency and category, one idempotency key, and no priority', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': personalWorkspaces,
      'GET /workspace': personalWorkspace,
      'GET /tickets/categories': categories,
      'GET /tickets/linkable-orders': { status: 200, body: { orders: [] } },
      'GET /auth/csrf': csrf,
      'POST /tickets': { status: 201, body: customerTicket({ status: 'NEW' }) },
      [`GET /tickets/${TICKET_ID}`]: { status: 200, body: customerTicket({ status: 'NEW' }) },
    });
    renderApp('/support/new');
    await user.type(await screen.findByLabelText('Subject'), 'Printer offline');
    await user.selectOptions(screen.getByLabelText('Category'), 'printers');
    await user.click(screen.getByRole('radio', { name: /Critical/ }));
    await user.type(
      screen.getByLabelText('Describe the problem'),
      'The office printer shows offline since 8am.',
    );
    await user.click(screen.getByRole('button', { name: 'Open ticket' }));
    await screen.findByRole('heading', { name: /TCK-2026-000017/ });
    const post = calls.find((call) => call.method === 'POST' && call.path === '/tickets');
    expect(post?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(post?.body).toEqual({
      subject: 'Printer offline',
      categoryCode: 'printers',
      urgency: 'CRITICAL',
      description: 'The office printer shows offline since 8am.',
      attachmentIds: [],
    });
    expect(post?.body).not.toHaveProperty('priority');
  });

  it('shows staff replies as OGS and replies on the ticket', async () => {
    const user = userEvent.setup();
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': personalWorkspaces,
      'GET /workspace': personalWorkspace,
      [`GET /tickets/${TICKET_ID}`]: { status: 200, body: customerTicket() },
      'GET /auth/csrf': csrf,
      [`POST /tickets/${TICKET_ID}/comments`]: { status: 200, body: customerTicket() },
    });
    renderApp(`/support/${TICKET_ID}`);
    const reply = await screen.findByText('Please restart it and tell us the light colour.');
    expect(reply.closest('article')).toHaveTextContent('OGS');
    expect(screen.queryByText('Internal')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Your reply'), 'The light is orange.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/comments'))?.body).toEqual({
        body: 'The light is orange.',
        attachmentIds: [],
      });
    });
  });

  it('a resolved ticket offers accept (highlight) and reopen with a reason', async () => {
    const user = userEvent.setup();
    const resolved = customerTicket({
      status: 'RESOLVED',
      resolution: 'Replaced the toner.',
      resolvedAt: '2026-11-07T10:00:00.000Z',
      reopenUntil: '2099-11-14T10:00:00.000Z',
      can: { comment: false, reopen: true, acceptResolution: true, withdraw: false },
    });
    const calls = mockApi({
      'GET /auth/session': signedIn(),
      'GET /me/workspaces': personalWorkspaces,
      'GET /workspace': personalWorkspace,
      [`GET /tickets/${TICKET_ID}`]: { status: 200, body: resolved },
      'GET /auth/csrf': csrf,
      [`POST /tickets/${TICKET_ID}/reopen`]: { status: 200, body: customerTicket() },
    });
    renderApp(`/support/${TICKET_ID}`);
    expect(await screen.findByText('Replaced the toner.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept resolution' }).className).toContain(
      'bg-saffron',
    );
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('What is still wrong?'), 'Still streaky');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/reopen'))?.body).toEqual({
        version: 4,
        reason: 'Still streaky',
      });
    });
  });
});

describe('Phase 8 staff pages (T9)', () => {
  const staffTicket = {
    id: TICKET_ID,
    number: 'TCK-2026-000017',
    subject: 'Printer offline',
    status: 'IN_PROGRESS',
    priority: 'P2',
    urgency: 'HIGH',
    category: { code: 'printers', name: 'Printers' },
    customerName: 'Acme Ltd',
    assignee: { id: STAFF_ID, email: 'agent@ogs.test' },
    onBehalf: false,
    createdAt: '2026-11-07T08:00:00.000Z',
    updatedAt: '2026-11-07T09:00:00.000Z',
    description: 'The office printer shows offline.',
    type: 'INCIDENT',
    channel: 'WEB',
    customer: { kind: 'ORGANISATION', tenantId: PLATFORM, userId: null, name: 'Acme Ltd' },
    requester: { id: STAFF_ID, email: 'grace@acme.test' },
    createdBy: { id: STAFF_ID, email: 'grace@acme.test' },
    departmentName: null,
    serviceOrder: null,
    relatedTicket: null,
    resolution: null,
    closure: null,
    closureReason: null,
    reopenCount: 0,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenUntil: null,
    version: 2,
    attachments: [],
    thread: [
      {
        id: '01930000-0000-7000-8000-0000000000f3',
        kind: 'note',
        side: 'STAFF',
        author: { id: STAFF_ID, email: 'agent@ogs.test' },
        body: 'Customer is on the old firmware.',
        createdAt: '2026-11-07T08:10:00.000Z',
        attachments: [],
      },
    ],
    activity: [],
  };

  function staffSetup() {
    localStorage.setItem('ogs.workspace', PLATFORM);
    sessionStorage.setItem(
      'ogs.elevation',
      JSON.stringify({
        id: '01930000-0000-7000-8000-0000000000e9',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    );
    return mockApi({
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
          roles: ['helpdesk'],
          permissions: ['ticket.read', 'ticket.comment', 'ticket.internal_note'],
        },
      },
      'GET /tickets/categories': categories,
      [`GET /platform/tickets/${TICKET_ID}`]: { status: 200, body: staffTicket },
      [`GET /platform/tickets/${TICKET_ID}/linkable-orders`]: { status: 200, body: { orders: [] } },
      'GET /platform/ticket-assignees': {
        status: 200,
        body: { assignees: [{ id: STAFF_ID, email: 'agent@ogs.test' }] },
      },
      'GET /auth/csrf': csrf,
      [`POST /platform/tickets/${TICKET_ID}/notes`]: { status: 200, body: staffTicket },
      [`POST /platform/tickets/${TICKET_ID}/comments`]: { status: 200, body: staffTicket },
    });
  }

  it('internal notes are marked; the composer label follows the tab and posts to /notes', async () => {
    const user = userEvent.setup();
    const calls = staffSetup();
    renderApp(`/platform/tickets/${TICKET_ID}`);
    const note = await screen.findByText('Customer is on the old firmware.');
    const article = note.closest('article');
    expect(article).toHaveAttribute('data-internal', 'true');
    expect(article).toHaveTextContent('Internal');
    // Default: a public reply.
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Internal note' }));
    expect(screen.queryByRole('button', { name: 'Send reply' })).not.toBeInTheDocument();
    const field = screen.getByLabelText('Internal note', { selector: 'textarea' });
    await user.type(field, 'Escalate to the vendor.');
    await user.click(screen.getByRole('button', { name: 'Add internal note' }));
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/notes'))?.body).toEqual({
        body: 'Escalate to the vendor.',
        attachmentIds: [],
      });
    });
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/comments'))).toBe(
      false,
    );
    // After sending, the composer is back on "Reply to customer".
    expect(await screen.findByRole('button', { name: 'Send reply' })).toBeInTheDocument();
  });

  it('"Resolve" is the screen’s only highlight button', async () => {
    staffSetup();
    renderApp(`/platform/tickets/${TICKET_ID}`);
    const resolve = await screen.findByRole('button', { name: 'Resolve' });
    expect(resolve.className).toContain('bg-saffron');
    const highlights = screen
      .getAllByRole('button')
      .filter((button) => button.className.includes('bg-saffron'));
    expect(highlights).toHaveLength(1);
  });
});
