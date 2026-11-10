import type { BrowserContext, Page, Route } from '@playwright/test';

/**
 * API fixtures for the Phase 9 design pages: the technician's job list and job,
 * the dispatch queue and job, and the customer's live tracker. Every API call
 * those pages make is answered here, so screenshots and accessibility checks
 * need no real providers, staff elevation or data. Demo data is obviously
 * fake (*.test emails, 0700 000 000 numbers).
 */
export type Phase9Fixture =
  'jobs-list' | 'technician-job' | 'dispatch-queue' | 'dispatch-job' | 'job-tracker';

const PLATFORM = '01930000-0000-7000-8000-000000000001';
const PROVIDER = '01930000-0000-7000-8000-0000000003a1';
const JOB = '01930000-0000-7000-8000-0000000003b1';
const OFFER = '01930000-0000-7000-8000-0000000003c1';
const REQUEST = '01930000-0000-7000-8000-0000000003d1';
const AT = '2026-11-09T07:45:00.000Z';
const id = (n: number) => `01930000-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`;

const session = (email: string) => ({
  user: { id: id(90), email, status: 'ACTIVE', mfaEnabled: true },
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
});

const card = (n: number, title: string, area: string, status: string, offer: boolean) => ({
  id: id(n),
  number: `JOB-2026-0001${String(10 + n)}`,
  title,
  status,
  regionCode: 'KE-30',
  area,
  windowFrom: '2026-11-10',
  windowTo: '2026-11-11',
  // Relative to the run, so "Expires in 1 h 30 min" is stable in screenshots.
  offer: offer
    ? { id: OFFER, expiresAt: new Date(Date.now() + 90.5 * 60_000).toISOString() }
    : null,
});

const jobsList = (view: string) => ({
  view,
  items:
    view === 'offers'
      ? [card(1, 'Office Wi-Fi installation', 'Westlands', 'OFFERED', true)]
      : [
          card(2, 'Home Wi-Fi setup', 'Kilimani Road 7', 'ON_THE_WAY', false),
          card(3, 'Printer network repair', 'Upper Hill', 'ASSIGNED', false),
        ],
  done: [],
  total: view === 'offers' ? 1 : 2,
  page: 1,
  pageSize: 20,
  counts: { offers: 1, active: 2 },
});

const technicianJob = {
  id: JOB,
  number: 'JOB-2026-000112',
  title: 'Home Wi-Fi setup',
  status: 'IN_PROGRESS',
  version: 4,
  brief:
    'Set up a mesh Wi-Fi network for a three-bedroom house. The router is in the living room; the customer works from the back bedroom.',
  skills: [{ code: 'wifi', name: 'Wi-Fi', minExperience: 'UNDER_1_YEAR' }],
  onSite: true,
  regionCode: 'KE-30',
  siteAddress: 'Kilimani Road 7, Nairobi, house 3',
  siteContactName: 'Wanjiru',
  siteContactPhone: '+254700000000',
  customerDisplay: 'Private customer',
  windowFrom: '2026-11-10',
  windowTo: '2026-11-11',
  assignment: {
    id: id(40),
    kind: 'INDIVIDUAL',
    technician: 'grace.achieng@example.test',
    startedAt: AT,
  },
  activity: [
    {
      id: id(41),
      kind: 'accept',
      fromValue: 'OFFERED',
      toValue: 'ASSIGNED',
      reason: null,
      actor: null,
      at: AT,
    },
    {
      id: id(42),
      kind: 'on_the_way',
      fromValue: 'ASSIGNED',
      toValue: 'ON_THE_WAY',
      reason: null,
      actor: null,
      at: '2026-11-09T08:10:00.000Z',
    },
    {
      id: id(43),
      kind: 'start',
      fromValue: 'ON_THE_WAY',
      toValue: 'IN_PROGRESS',
      reason: null,
      actor: null,
      at: '2026-11-09T08:52:00.000Z',
    },
  ],
  workNotes: [
    {
      id: id(44),
      body: 'Old router replaced; mesh points in the hallway and back bedroom.',
      author: 'grace.achieng@example.test',
      createdAt: '2026-11-09T09:20:00.000Z',
    },
  ],
  photos: [
    {
      id: id(45),
      caption: 'Hallway mesh point',
      status: 'CLEAN',
      createdAt: '2026-11-09T09:25:00.000Z',
    },
  ],
  report: null,
  internalNotes: [],
  technicians: [],
  can: {
    onTheWay: false,
    start: false,
    pause: true,
    resume: false,
    addWork: true,
    complete: true,
    changeTechnician: false,
  },
};

const staffRow = (
  n: number,
  title: string,
  status: string,
  source: string,
  hoursAgo: number,
  assignee: boolean,
) => ({
  id: id(n),
  number: `JOB-2026-0002${String(10 + n)}`,
  title,
  status,
  source: { kind: source.startsWith('ORD') ? 'ORDER' : 'TICKET', id: id(60 + n), number: source },
  regionCode: 'KE-30',
  customerDisplay: n === 2 ? 'Private customer' : 'Savanna Design Ltd',
  assignee: assignee
    ? { kind: 'COMPANY', label: 'Rift Valley Networks', technician: 'amina.otieno@riftvalley.test' }
    : null,
  pendingOffer:
    status === 'OFFERED'
      ? {
          kind: 'INDIVIDUAL',
          label: 'Grace Achieng',
          expiresAt: new Date(Date.now() + 75 * 60_000).toISOString(),
        }
      : null,
  createdAt: new Date(Date.now() - hoursAgo * 3_600_000 - 60_000).toISOString(),
  updatedAt: AT,
});

const dispatchQueue = {
  jobs: [
    staffRow(1, 'Office Wi-Fi installation', 'QUEUED', 'ORD-2026-000071', 1, false),
    staffRow(2, 'Home Wi-Fi setup', 'OFFERED', 'ORD-2026-000068', 4, false),
    staffRow(3, 'Replace the core switch', 'IN_PROGRESS', 'TCK-2026-000212', 26, true),
  ],
  total: 3,
  page: 1,
  pageSize: 20,
  counts: { queued: 1, offered: 1, inProgress: 1, awaitingConfirmation: 0 },
};

const staffJob = {
  ...staffRow(1, 'Office Wi-Fi installation', 'QUEUED', 'ORD-2026-000071', 1, false),
  id: JOB,
  version: 2,
  brief: 'Install Wi-Fi across two office floors; ceiling access is through the store room.',
  siteAddress: 'Westlands Avenue 14, Nairobi, floors 2–3',
  siteContactName: 'Otieno',
  siteContactPhone: '+254700000000',
  windowFrom: '2026-11-12',
  windowTo: '2026-11-14',
  onSite: true,
  remoteAllowed: false,
  channels: { internal: true, individual: true, company: true },
  skills: [{ code: 'wifi', name: 'Wi-Fi', minExperience: 'YEARS_1_3' }],
  cancelReason: null,
  offers: [
    {
      id: OFFER,
      kind: 'INDIVIDUAL',
      label: 'Grace Achieng',
      status: 'DECLINED',
      offeredAt: AT,
      expiresAt: '2026-11-09T09:45:00.000Z',
      offeredBy: 'dispatch@ogs.test',
      declineReason: 'NOT_AVAILABLE',
      declineNote: null,
      respondedAt: '2026-11-09T08:05:00.000Z',
    },
  ],
  assignments: [],
  activity: [
    {
      id: id(70),
      kind: 'create',
      fromValue: null,
      toValue: 'QUEUED',
      reason: null,
      actor: null,
      at: AT,
      customerVisible: true,
      providerVisible: false,
    },
    {
      id: id(71),
      kind: 'offer',
      fromValue: 'QUEUED',
      toValue: 'OFFERED',
      reason: null,
      actor: 'dispatch@ogs.test',
      at: '2026-11-09T07:50:00.000Z',
      customerVisible: false,
      providerVisible: false,
    },
    {
      id: id(72),
      kind: 'decline',
      fromValue: 'OFFERED',
      toValue: 'QUEUED',
      reason: 'NOT_AVAILABLE',
      actor: 'grace.achieng@example.test',
      at: '2026-11-09T08:05:00.000Z',
      customerVisible: false,
      providerVisible: false,
    },
  ],
  workNotes: [],
  photos: [],
  report: null,
  can: {
    editBrief: true,
    offer: true,
    withdrawOffer: false,
    reassign: false,
    cancel: true,
    confirm: false,
  },
};

const candidates = {
  internal: [{ id: id(80), label: 'brian.kiprop@ogs.test' }],
  providers: [
    {
      providerId: id(81),
      kind: 'COMPANY',
      displayName: 'Rift Valley Networks',
      score: 45,
      reasons: [
        { factor: 'skill', points: 10, detail: 'Wi-Fi' },
        { factor: 'region', points: 20, detail: 'Covers Nairobi' },
        { factor: 'available', points: 15, detail: 'Available now' },
      ],
    },
    {
      providerId: id(82),
      kind: 'INDIVIDUAL',
      displayName: 'Peter Mwangi',
      score: 30,
      reasons: [
        { factor: 'skill', points: 10, detail: 'Wi-Fi' },
        { factor: 'region', points: 20, detail: 'Covers Nairobi' },
      ],
    },
  ],
};

const request = {
  id: REQUEST,
  number: 'REQ-2026-000144',
  status: 'ORDERED',
  service: { id: id(20), name: 'Home Wi-Fi setup', slug: 'home-wifi-setup' },
  price: { model: 'FIXED', unitAmountMinor: 350_000, unit: null, label: 'KES 3,500' },
  quantity: 1,
  county: 'KE-30',
  address: 'Kilimani Road 7, Nairobi, house 3',
  preferredFrom: '2026-11-10',
  preferredTo: '2026-11-11',
  description: 'The Wi-Fi does not reach the back bedroom.',
  contactPhone: '+254700000000',
  cancelReason: null,
  customerTenantId: null,
  createdBy: id(90),
  createdAt: '2026-11-08T07:00:00.000Z',
  version: 3,
  history: [
    {
      fromStatus: null,
      toStatus: 'SUBMITTED',
      command: 'submit',
      reason: null,
      occurredAt: '2026-11-08T07:00:00.000Z',
    },
    {
      fromStatus: 'UNDER_REVIEW',
      toStatus: 'ORDERED',
      command: 'accept',
      reason: null,
      occurredAt: '2026-11-08T08:00:00.000Z',
    },
  ],
  quotations: [],
  order: {
    id: id(21),
    number: 'ORD-2026-000068',
    status: 'IN_DELIVERY',
    paymentTerms: 'PREPAY',
    netDays: null,
    subtotalMinor: 350_000,
    vatMinor: 56_000,
    totalMinor: 406_000,
    paidMinor: 406_000,
    refundDue: false,
    cancelReason: null,
    version: 4,
    createdAt: '2026-11-08T08:00:00.000Z',
    history: [],
    payments: [],
  },
};

const progress = {
  job: {
    id: JOB,
    number: 'JOB-2026-000112',
    status: 'IN_PROGRESS',
    label: 'work_in_progress',
    version: 4,
    assignee: { firstName: 'Grace', initials: 'GR', partner: false },
    activity: [
      { id: id(50), kind: 'create', at: '2026-11-08T08:01:00.000Z' },
      { id: id(51), kind: 'accept', at: AT },
      { id: id(52), kind: 'on_the_way', at: '2026-11-09T08:10:00.000Z' },
      { id: id(53), kind: 'start', at: '2026-11-09T08:52:00.000Z' },
    ],
    report: null,
    can: { confirm: false, reportProblem: false },
  },
};

const platformWorkspace = {
  kind: 'PLATFORM',
  tenantId: PLATFORM,
  name: 'OGS Platform',
  status: 'ACTIVE',
  restricted: false,
  membershipId: '01930000-0000-7000-8000-0000000000bb',
  roles: ['operations_manager'],
  permissions: ['ticket.read', 'ticket.assign'],
};

function bodyFor(fixture: Phase9Fixture, path: string, query: string): unknown {
  if (path === '/auth/csrf') return { csrfToken: 'x'.repeat(43) };
  const provider = fixture === 'jobs-list' || fixture === 'technician-job';
  const staff = fixture === 'dispatch-queue' || fixture === 'dispatch-job';
  if (path === '/auth/session') {
    return session(
      provider
        ? 'grace.achieng@example.test'
        : staff
          ? 'dispatch@ogs.test'
          : 'wanjiru.kamau@savanna.test',
    );
  }
  if (path === '/me/workspaces') {
    if (provider)
      return {
        workspaces: [],
        provider: { providerId: PROVIDER, status: 'ACTIVE', restricted: false },
      };
    if (staff) {
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
    return { workspaces: [], provider: null };
  }
  if (path === '/workspace') {
    if (provider)
      return { kind: 'provider', providerId: PROVIDER, status: 'ACTIVE', restricted: false };
    if (staff) return platformWorkspace;
    return { kind: 'personal' };
  }
  if (path === '/jobs') return jobsList(new URLSearchParams(query).get('view') ?? 'active');
  if (path === `/jobs/${JOB}`) return technicianJob;
  if (path === '/platform/jobs') return dispatchQueue;
  if (path === `/platform/jobs/${JOB}`) return staffJob;
  if (path === `/platform/jobs/${JOB}/candidates`) return candidates;
  if (path === `/requests/${REQUEST}`) return request;
  if (path === `/requests/${REQUEST}/progress`) return progress;
  return undefined;
}

/** Answers every Phase 9 page API call. */
export async function mockPhase9(page: Page, fixture: Phase9Fixture): Promise<void> {
  await page.route(/\/api\/v1\/(?!catalogue\/)/, async (route: Route) => {
    const url = new URL(route.request().url());
    const body = bodyFor(fixture, url.pathname.replace('/api/v1', ''), url.search);
    await (body === undefined
      ? route.fulfill({ status: 404, json: { error: 'not_found' } })
      : route.fulfill({ json: body }));
  });
}

export async function phase9Storage(
  context: BrowserContext,
  fixture: Phase9Fixture,
): Promise<void> {
  await context.addInitScript(
    ({ workspace, staff }) => {
      localStorage.setItem('ogs.workspace', workspace);
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
    {
      workspace:
        fixture === 'jobs-list' || fixture === 'technician-job'
          ? 'provider'
          : fixture === 'job-tracker'
            ? 'personal'
            : PLATFORM,
      staff: fixture === 'dispatch-queue' || fixture === 'dispatch-job',
    },
  );
}

export const PHASE9_PATHS: Record<Phase9Fixture, string> = {
  'jobs-list': '/jobs',
  'technician-job': `/jobs/${JOB}`,
  'dispatch-queue': '/platform/dispatch',
  'dispatch-job': `/platform/dispatch/${JOB}`,
  'job-tracker': `/requests/${REQUEST}`,
};

export const PHASE9_READY: Record<Phase9Fixture, string> = {
  'jobs-list': 'Kilimani Road 7',
  'technician-job': 'Hallway mesh point',
  'dispatch-queue': 'Replace the core switch',
  'dispatch-job': 'Rift Valley Networks',
  'job-tracker': 'Work in progress',
};
