import {
  areaOf,
  assigneeJobSchema,
  CONFIRM_WINDOW_MS,
  CUSTOMER_JOB_LABEL,
  customerJobProgressSchema,
  staffJobSchema,
  type AssigneeJob,
  type AssigneeKind,
  type CustomerJobProgress,
  type JobReport,
  type StaffJob,
  type StaffJobSummary,
} from '@ogs/contracts';
import { notFound } from '../common/domain-error.js';
import type { Db } from '../database/index.js';
import { assigneeLabel, firstNameOf, initialsOf } from './job-support.js';
import { allows, isFinal } from './transitions.js';

const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => (date === null ? null : date.toISOString());
const day = (date: Date | null) => (date === null ? null : date.toISOString().slice(0, 10));

/** Emails by user id, for staff views (staff may see who did what). */
async function emails(tx: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) {
    return new Map();
  }
  const users = await tx.appUser.findMany({
    where: { id: { in: unique } },
    select: { id: true, email: true },
  });
  return new Map(users.map((user) => [user.id, user.email]));
}

function report(
  completion: {
    id: string;
    summary: string;
    minutesOnSite: number | null;
    materials: string;
    submittedAt: Date;
    outcome: JobReport['outcome'];
    evidenceIds: string[];
  } | null,
): JobReport | null {
  if (completion === null) {
    return null;
  }
  return {
    id: completion.id,
    summary: completion.summary,
    minutesOnSite: completion.minutesOnSite,
    materials: completion.materials,
    submittedAt: iso(completion.submittedAt),
    autoConfirmAt: iso(new Date(completion.submittedAt.getTime() + CONFIRM_WINDOW_MS)),
    outcome: completion.outcome,
    photoIds: completion.evidenceIds,
  };
}

const COMPLETION_SELECT = {
  id: true,
  summary: true,
  minutesOnSite: true,
  materials: true,
  submittedAt: true,
  outcome: true,
  evidenceIds: true,
} as const;

const PHOTO_SELECT = {
  id: true,
  caption: true,
  createdAt: true,
  file: { select: { status: true } },
} as const;

function photo(row: {
  id: string;
  caption: string;
  createdAt: Date;
  file: { status: 'QUARANTINED' | 'CLEAN' | 'REJECTED' };
}) {
  return {
    id: row.id,
    caption: row.caption,
    status: row.file.status,
    createdAt: iso(row.createdAt),
  };
}

// ---------------------------------------------------------------- staff

export const STAFF_SUMMARY_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  regionCode: true,
  customerDisplay: true,
  createdAt: true,
  updatedAt: true,
  serviceOrder: { select: { id: true, number: true } },
  ticket: { select: { id: true, number: true } },
  assignments: {
    where: { status: 'ACTIVE' as const },
    select: { kind: true, technicianUserId: true, provider: { select: { displayName: true } } },
  },
  offers: {
    where: { status: 'PENDING' as const },
    select: {
      kind: true,
      expiresAt: true,
      technicianUserId: true,
      provider: { select: { displayName: true } },
    },
  },
} as const;

interface SummaryRow {
  id: string;
  number: string;
  title: string;
  status: StaffJobSummary['status'];
  regionCode: string;
  customerDisplay: string;
  createdAt: Date;
  updatedAt: Date;
  serviceOrder: { id: string; number: string } | null;
  ticket: { id: string; number: string } | null;
  assignments: {
    kind: AssigneeKind;
    technicianUserId: string;
    provider: { displayName: string } | null;
  }[];
  offers: {
    kind: AssigneeKind;
    expiresAt: Date;
    technicianUserId: string | null;
    provider: { displayName: string } | null;
  }[];
}

export function staffSummary(
  row: SummaryRow,
  people: ReadonlyMap<string, string>,
): StaffJobSummary {
  const active = row.assignments[0];
  const pending = row.offers[0];
  const source =
    row.serviceOrder !== null
      ? { kind: 'ORDER' as const, id: row.serviceOrder.id, number: row.serviceOrder.number }
      : { kind: 'TICKET' as const, id: row.ticket?.id ?? row.id, number: row.ticket?.number ?? '' };
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    source,
    regionCode: row.regionCode,
    customerDisplay: row.customerDisplay,
    assignee:
      active === undefined
        ? null
        : {
            kind: active.kind,
            label: assigneeLabel(active.kind, active.provider?.displayName ?? null),
            technician: people.get(active.technicianUserId) ?? 'Technician',
          },
    pendingOffer:
      pending === undefined
        ? null
        : {
            kind: pending.kind,
            label:
              pending.kind === 'INTERNAL'
                ? (people.get(pending.technicianUserId ?? '') ?? 'OGS technician')
                : assigneeLabel(pending.kind, pending.provider?.displayName ?? null),
            expiresAt: iso(pending.expiresAt),
          },
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function summaryPeople(rows: readonly SummaryRow[]): (string | null)[] {
  return rows.flatMap((row) => [
    ...row.assignments.map((a) => a.technicianUserId),
    ...row.offers.map((o) => o.technicianUserId),
  ]);
}

/** Everything about a job, for elevated staff (plan §2.6). */
export async function loadStaffJob(
  tx: Db,
  jobId: string,
  permissions: ReadonlySet<string>,
): Promise<StaffJob> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: {
      ...STAFF_SUMMARY_SELECT,
      version: true,
      brief: true,
      siteAddress: true,
      siteContactName: true,
      siteContactPhone: true,
      windowFrom: true,
      windowTo: true,
      onSite: true,
      remoteAllowed: true,
      allowInternal: true,
      allowIndividual: true,
      allowCompany: true,
      cancelReason: true,
      skills: {
        select: { skillCode: true, minExperience: true, skill: { select: { name: true } } },
      },
    },
  });
  if (job === null) {
    throw notFound();
  }
  const [offers, assignments, events, notes, photos, completion] = await Promise.all([
    tx.jobOffer.findMany({
      where: { jobId },
      orderBy: { offeredAt: 'desc' },
      select: {
        id: true,
        kind: true,
        status: true,
        offeredAt: true,
        expiresAt: true,
        offeredBy: true,
        technicianUserId: true,
        declineReason: true,
        declineNote: true,
        respondedAt: true,
        provider: { select: { displayName: true } },
      },
    }),
    tx.jobAssignment.findMany({
      where: { jobId },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        kind: true,
        status: true,
        technicianUserId: true,
        startedAt: true,
        endedAt: true,
        endReason: true,
        endNote: true,
        provider: { select: { displayName: true } },
      },
    }),
    tx.jobEvent.findMany({ where: { jobId }, orderBy: { occurredAt: 'asc' } }),
    tx.jobWorkNote.findMany({ where: { jobId }, orderBy: { createdAt: 'asc' } }),
    tx.jobEvidence.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
      select: PHOTO_SELECT,
    }),
    tx.jobCompletion.findFirst({
      where: { jobId },
      orderBy: { submittedAt: 'desc' },
      select: COMPLETION_SELECT,
    }),
  ]);
  const people = await emails(tx, [
    ...summaryPeople([job]),
    ...offers.flatMap((o) => [o.offeredBy, o.technicianUserId]),
    ...assignments.map((a) => a.technicianUserId),
    ...events.map((e) => e.actorUserId),
    ...notes.map((n) => n.authorUserId),
  ]);
  const assign = permissions.has('ticket.assign');
  const parsed = staffJobSchema.parse({
    ...staffSummary(job, people),
    version: job.version,
    brief: job.brief,
    siteAddress: job.siteAddress,
    siteContactName: job.siteContactName,
    siteContactPhone: job.siteContactPhone,
    windowFrom: day(job.windowFrom),
    windowTo: day(job.windowTo),
    onSite: job.onSite,
    remoteAllowed: job.remoteAllowed,
    channels: {
      internal: job.allowInternal,
      individual: job.allowIndividual,
      company: job.allowCompany,
    },
    skills: job.skills.map((s) => ({
      code: s.skillCode,
      name: s.skill.name,
      minExperience: s.minExperience,
    })),
    cancelReason: job.cancelReason,
    offers: offers.map((o) => ({
      id: o.id,
      kind: o.kind,
      label:
        o.kind === 'INTERNAL'
          ? (people.get(o.technicianUserId ?? '') ?? 'OGS technician')
          : assigneeLabel(o.kind, o.provider?.displayName ?? null),
      status: o.status,
      offeredAt: iso(o.offeredAt),
      expiresAt: iso(o.expiresAt),
      offeredBy: people.get(o.offeredBy) ?? 'OGS staff',
      declineReason: o.declineReason,
      declineNote: o.declineNote,
      respondedAt: isoOrNull(o.respondedAt),
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      kind: a.kind,
      label: assigneeLabel(a.kind, a.provider?.displayName ?? null),
      technician: people.get(a.technicianUserId) ?? 'Technician',
      status: a.status,
      startedAt: iso(a.startedAt),
      endedAt: isoOrNull(a.endedAt),
      endReason: a.endReason,
      endNote: a.endNote,
    })),
    activity: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      fromValue: e.fromValue,
      toValue: e.toValue,
      reason: e.reason,
      actor: e.actorUserId === null ? null : (people.get(e.actorUserId) ?? null),
      at: iso(e.occurredAt),
      customerVisible: e.customerVisible,
      providerVisible: e.providerVisible,
    })),
    workNotes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: people.get(n.authorUserId) ?? 'Technician',
      createdAt: iso(n.createdAt),
    })),
    photos: photos.map(photo),
    report: report(completion),
    can: {
      editBrief: assign && !isFinal(job.status),
      offer: assign && allows('offer', job.status),
      withdrawOffer: assign && allows('withdraw', job.status),
      reassign: assign && allows('reassign', job.status),
      cancel: assign && allows('cancel', job.status),
      confirm: permissions.has('ticket.confirm_completion') && allows('staffConfirm', job.status),
    },
  });
  return parsed;
}

// ---------------------------------------------------------------- assignees

export interface AssigneeViewer {
  readonly userId: string;
  readonly kind: 'INTERNAL' | 'INDIVIDUAL' | 'COMPANY';
  readonly tenantId?: string;
  readonly permissions: ReadonlySet<string>;
}

/** Active company members who can work jobs (a dispatcher's technician list). */
export async function companyTechnicians(
  tx: Db,
  tenantId: string,
): Promise<{ id: string; label: string }[]> {
  const members = await tx.membership.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      roles: {
        some: { role: { permissions: { some: { permissionCode: 'ticket.update_progress' } } } },
      },
    },
    select: { userId: true, user: { select: { email: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map((m) => ({ id: m.userId, label: m.user.email }));
}

/**
 * The job while the caller holds its ACTIVE assignment (plan §2.5). Everything
 * is read under the caller's RLS: no row of another assignment, no customer
 * table, no internal note (except for INTERNAL OGS technicians, P9-2).
 * 404 the moment the assignment ends.
 */
export async function loadAssigneeJob(
  tx: Db,
  viewer: AssigneeViewer,
  jobId: string,
): Promise<AssigneeJob> {
  const assignment = await tx.jobAssignment.findFirst({
    where: { jobId, status: 'ACTIVE' },
    select: {
      id: true,
      kind: true,
      technicianUserId: true,
      technicianName: true,
      startedAt: true,
    },
  });
  if (assignment === null) {
    throw notFound();
  }
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      version: true,
      brief: true,
      onSite: true,
      regionCode: true,
      siteAddress: true,
      siteContactName: true,
      siteContactPhone: true,
      customerDisplay: true,
      windowFrom: true,
      windowTo: true,
      ticketId: true,
      skills: {
        select: { skillCode: true, minExperience: true, skill: { select: { name: true } } },
      },
    },
  });
  if (job === null) {
    throw notFound();
  }
  const [events, notes, photos, completion] = await Promise.all([
    tx.jobEvent.findMany({
      where: { jobId, assignmentId: assignment.id, providerVisible: true },
      orderBy: { occurredAt: 'asc' },
      select: {
        id: true,
        kind: true,
        fromValue: true,
        toValue: true,
        reason: true,
        occurredAt: true,
      },
    }),
    tx.jobWorkNote.findMany({
      where: { assignmentId: assignment.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, body: true, authorUserId: true, createdAt: true },
    }),
    tx.jobEvidence.findMany({
      where: { assignmentId: assignment.id },
      orderBy: { createdAt: 'asc' },
      select: PHOTO_SELECT,
    }),
    tx.jobCompletion.findFirst({
      where: { assignmentId: assignment.id },
      orderBy: { submittedAt: 'desc' },
      select: COMPLETION_SELECT,
    }),
  ]);
  // Internal notes: OGS technicians on a ticket job only (RLS repeats this).
  const internalNotes =
    assignment.kind === 'INTERNAL' && job.ticketId !== null
      ? await tx.ticketInternalNote.findMany({
          where: { ticketId: job.ticketId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, createdAt: true },
        })
      : [];
  const companyTenant =
    viewer.kind === 'COMPANY' && viewer.permissions.has('ticket.assign')
      ? viewer.tenantId
      : undefined;
  const dispatcher = companyTenant !== undefined;
  const technicians =
    companyTenant === undefined ? [] : await companyTechnicians(tx, companyTenant);
  const people = await emails(tx, [
    assignment.technicianUserId,
    ...notes.map((n) => n.authorUserId),
  ]);
  const working = viewer.permissions.has('ticket.update_progress');
  const mine = assignment.technicianUserId === viewer.userId || viewer.kind === 'INDIVIDUAL';
  const act = working && mine;
  return assigneeJobSchema.parse({
    id: job.id,
    number: job.number,
    title: job.title,
    status: job.status,
    version: job.version,
    brief: job.brief,
    skills: job.skills.map((s) => ({
      code: s.skillCode,
      name: s.skill.name,
      minExperience: s.minExperience,
    })),
    onSite: job.onSite,
    regionCode: job.regionCode,
    siteAddress: job.siteAddress,
    siteContactName: job.siteContactName,
    siteContactPhone: job.siteContactPhone,
    customerDisplay: job.customerDisplay,
    windowFrom: day(job.windowFrom),
    windowTo: day(job.windowTo),
    assignment: {
      id: assignment.id,
      kind: assignment.kind,
      technician:
        people.get(assignment.technicianUserId) ?? assignment.technicianName ?? 'Technician',
      startedAt: iso(assignment.startedAt),
    },
    activity: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      fromValue: e.fromValue,
      toValue: e.toValue,
      reason: e.reason,
      actor: null,
      at: iso(e.occurredAt),
    })),
    workNotes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: people.get(n.authorUserId) ?? 'Technician',
      createdAt: iso(n.createdAt),
    })),
    photos: photos.map(photo),
    report: report(completion),
    internalNotes: internalNotes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: iso(n.createdAt),
    })),
    technicians,
    can: {
      onTheWay: act && job.onSite && allows('onTheWay', job.status),
      start: act && allows('start', job.status) && (job.status !== 'ASSIGNED' || !job.onSite),
      pause: act && allows('pause', job.status),
      resume: act && allows('resume', job.status),
      addWork: act && allows('photo', job.status),
      complete: act && allows('submitReport', job.status),
      changeTechnician: dispatcher && allows('changeTechnician', job.status),
    },
  });
}

export function cardOf(
  job: {
    id: string;
    number: string;
    title: string;
    status: AssigneeJob['status'];
    regionCode: string;
    siteAddress: string;
    windowFrom: Date | null;
    windowTo: Date | null;
  },
  offer: { id: string; expiresAt: Date } | null,
) {
  return {
    id: job.id,
    number: job.number,
    title: job.title,
    status: job.status,
    regionCode: job.regionCode,
    area: areaOf(job.siteAddress),
    windowFrom: day(job.windowFrom),
    windowTo: day(job.windowTo),
    offer: offer === null ? null : { id: offer.id, expiresAt: iso(offer.expiresAt) },
  };
}

// ---------------------------------------------------------------- customers

/**
 * The live tracker (plan §2.9): read under the customer's RLS. No brief, notes,
 * offers, declines or reasons: activity rows carry a kind and a time only.
 */
export async function loadCustomerProgress(
  tx: Db,
  jobId: string | null,
  canConfirm: boolean,
): Promise<CustomerJobProgress> {
  if (jobId === null) {
    return customerJobProgressSchema.parse({ job: null });
  }
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: { id: true, number: true, status: true, version: true, serviceOrderId: true },
  });
  if (job === null) {
    return customerJobProgressSchema.parse({ job: null });
  }
  const [assignment, events, completion] = await Promise.all([
    tx.jobAssignment.findFirst({
      where: { jobId },
      orderBy: { startedAt: 'desc' },
      select: { status: true, kind: true, technicianName: true },
    }),
    tx.jobEvent.findMany({
      where: { jobId, customerVisible: true },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, kind: true, occurredAt: true },
    }),
    tx.jobCompletion.findFirst({
      where: { jobId },
      orderBy: { submittedAt: 'desc' },
      select: COMPLETION_SELECT,
    }),
  ]);
  const showAssignee =
    assignment !== null &&
    (assignment.status === 'ACTIVE' ||
      job.status === 'COMPLETED' ||
      job.status === 'AWAITING_CONFIRMATION');
  const photos =
    completion === null
      ? []
      : await tx.jobEvidence.findMany({
          where: { id: { in: completion.evidenceIds } },
          orderBy: { createdAt: 'asc' },
          select: PHOTO_SELECT,
        });
  const reportView = report(completion);
  const isOrderJob = job.serviceOrderId !== null;
  const awaiting = job.status === 'AWAITING_CONFIRMATION';
  return customerJobProgressSchema.parse({
    job: {
      id: job.id,
      number: job.number,
      status: job.status,
      label: CUSTOMER_JOB_LABEL[job.status],
      version: job.version,
      assignee: showAssignee
        ? {
            firstName: assignment.technicianName,
            initials: initialsOf(assignment.technicianName),
            partner: assignment.kind === 'COMPANY',
          }
        : null,
      activity: events.map((e) => ({ id: e.id, kind: e.kind, at: iso(e.occurredAt) })),
      report:
        reportView === null
          ? null
          : {
              id: reportView.id,
              summary: reportView.summary,
              minutesOnSite: reportView.minutesOnSite,
              materials: reportView.materials,
              submittedAt: reportView.submittedAt,
              autoConfirmAt: reportView.autoConfirmAt,
              outcome: reportView.outcome,
              photos: photos.map(photo),
            },
      // Ticket jobs are confirmed by accepting the ticket's resolution (P9-7).
      can: {
        confirm: canConfirm && isOrderJob && awaiting,
        reportProblem: canConfirm && isOrderJob && awaiting,
      },
    },
  });
}

/** The customer-facing first name of a technician (P9-8). */
export function technicianFirstName(
  kind: 'INTERNAL' | 'INDIVIDUAL' | 'COMPANY',
  email: string | null,
  providerName: string | null,
): string | null {
  if (kind === 'INDIVIDUAL' && providerName !== null) {
    const word = providerName.trim().split(/\s+/)[0];
    if (word !== undefined && word !== '') {
      return word.slice(0, 60);
    }
  }
  return email === null ? null : (firstNameOf(email)?.slice(0, 60) ?? null);
}
