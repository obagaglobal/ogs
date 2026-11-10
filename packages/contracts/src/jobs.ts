import { z } from 'zod';
import { phoneSchema } from './organisations.js';
import {
  eligibilityCandidateSchema,
  experienceBandSchema,
  regionCodeSchema,
  skillCodeSchema,
} from './providers.js';
import { fileStatusSchema } from './tickets.js';

/**
 * Phase 9: jobs, offers, assignments and field work.
 *
 * Three audiences, three sets of response schemas (plan §2.5):
 *  - staff see everything;
 *  - assignees (internal technicians, individual providers, provider companies)
 *    see the brief OGS wrote and the site, never money, customer emails,
 *    the ticket conversation or internal notes (internal OGS technicians are
 *    staff and may see a ticket's internal notes, P9-2);
 *  - customers see the status, a first name and a label for the assignee,
 *    customer-visible activity and the completion report.
 * The API parses every response through its audience's schema (unknown keys
 * are stripped), so a field missing here cannot reach that audience.
 */

// ---------------------------------------------------------------- enums

export const jobStatusSchema = z.enum([
  'QUEUED',
  'OFFERED',
  'ASSIGNED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'PAUSED',
  'AWAITING_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
]);
export const assigneeKindSchema = z.enum(['INTERNAL', 'INDIVIDUAL', 'COMPANY']);
export const jobOfferStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'WITHDRAWN',
]);
export const declineReasonSchema = z.enum([
  'NOT_AVAILABLE',
  'TOO_FAR',
  'LACKS_SKILLS',
  'WORKLOAD',
  'OTHER',
]);
export const assignmentEndReasonSchema = z.enum([
  'REASSIGNED',
  'REMOVED',
  'TECHNICIAN_CHANGED',
  'JOB_COMPLETED',
  'JOB_CANCELLED',
  'PROVIDER_SUSPENDED',
]);
export const completionOutcomeSchema = z.enum([
  'CONFIRMED',
  'ISSUE_RAISED',
  'AUTO_CONFIRMED',
  'STAFF_CONFIRMED',
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type AssigneeKind = z.infer<typeof assigneeKindSchema>;
export type JobOfferStatus = z.infer<typeof jobOfferStatusSchema>;
export type DeclineReason = z.infer<typeof declineReasonSchema>;
export type AssignmentEndReason = z.infer<typeof assignmentEndReasonSchema>;
export type CompletionOutcome = z.infer<typeof completionOutcomeSchema>;

/** Offer windows staff can pick (P9-4), in minutes. The default is 2 hours. */
export const OFFER_WINDOW_MINUTES = [30, 60, 120, 240, 1440] as const;
export const DEFAULT_OFFER_WINDOW_MINUTES = 120;
/** A submitted report confirms itself after this long (P9-7, as ADR-057). */
export const CONFIRM_WINDOW_DAYS = 7;
export const CONFIRM_WINDOW_MS = CONFIRM_WINDOW_DAYS * 86_400_000;
/** Photos per assignment (enforced by the job_evidence trigger too). */
export const MAX_JOB_PHOTOS = 30;
export const JOB_PAGE_SIZE = 20;

/** States in which an assignee is working the job. */
export const WORKING_JOB_STATUSES: readonly JobStatus[] = [
  'ASSIGNED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'PAUSED',
];
export const FINAL_JOB_STATUSES: readonly JobStatus[] = ['COMPLETED', 'CANCELLED'];

/** What customers see (plan §2.5): simplified labels. */
export type CustomerJobLabel =
  | 'finding_technician'
  | 'technician_assigned'
  | 'on_the_way'
  | 'work_in_progress'
  | 'check_and_confirm'
  | 'completed'
  | 'cancelled';
export const CUSTOMER_JOB_LABEL: Record<JobStatus, CustomerJobLabel> = {
  QUEUED: 'finding_technician',
  OFFERED: 'finding_technician',
  ASSIGNED: 'technician_assigned',
  ON_THE_WAY: 'on_the_way',
  IN_PROGRESS: 'work_in_progress',
  PAUSED: 'work_in_progress',
  AWAITING_CONFIRMATION: 'check_and_confirm',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
/** The five customer steps of the tracker's Stepper, in order. */
export const CUSTOMER_JOB_STEPS = [
  'finding_technician',
  'technician_assigned',
  'on_the_way',
  'work_in_progress',
  'check_and_confirm',
] as const satisfies readonly CustomerJobLabel[];

/**
 * The county and area a provider sees before accepting (plan §2.5): the part
 * of the address before the first comma, never the full address.
 */
export function areaOf(address: string): string {
  const first = address.split(',')[0]?.trim() ?? '';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

// ---------------------------------------------------------------- inputs

const reasonSchema = z.string().trim().min(5).max(500);
const versionSchema = z.object({ version: z.number().int().min(0) });
const isoDate = z.iso.date();

export const jobBriefInputSchema = versionSchema
  .extend({
    title: z.string().trim().min(3).max(150),
    brief: z.string().trim().max(4000).default(''),
    siteAddress: z.string().trim().min(3).max(300),
    siteContactName: z.string().trim().min(1).max(100).nullable().default(null),
    siteContactPhone: phoneSchema.nullable().default(null),
    windowFrom: isoDate.nullable().default(null),
    windowTo: isoDate.nullable().default(null),
  })
  .refine((v) => v.windowFrom === null || v.windowTo === null || v.windowTo >= v.windowFrom, {
    message: 'window_order',
    path: ['windowTo'],
  });
export type JobBriefInput = z.input<typeof jobBriefInputSchema>;

/** Staff send a technician to a ticket (plan §2.4): the brief plus requirements. */
export const dispatchTicketSchema = z
  .object({
    title: z.string().trim().min(3).max(150),
    brief: z.string().trim().max(4000).default(''),
    regionCode: regionCodeSchema,
    siteAddress: z.string().trim().min(3).max(300),
    siteContactName: z.string().trim().min(1).max(100).nullable().default(null),
    siteContactPhone: phoneSchema.nullable().default(null),
    windowFrom: isoDate.nullable().default(null),
    windowTo: isoDate.nullable().default(null),
    onSite: z.boolean().default(true),
    remoteAllowed: z.boolean().default(false),
    serviceId: z.uuid().nullable().default(null),
    skills: z
      .array(z.object({ code: skillCodeSchema, minExperience: experienceBandSchema }))
      .max(10)
      .default([]),
    channels: z
      .object({ internal: z.boolean(), individual: z.boolean(), company: z.boolean() })
      .default({ internal: true, individual: true, company: true })
      .refine((c) => c.internal || c.individual || c.company, { message: 'channel_required' }),
  })
  .refine((v) => v.onSite || v.remoteAllowed, { message: 'where_required', path: ['onSite'] });
export type DispatchTicketInput = z.input<typeof dispatchTicketSchema>;

export const offerAssigneeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('INTERNAL'), technicianUserId: z.uuid() }),
  z.object({ kind: z.literal('INDIVIDUAL'), providerId: z.uuid() }),
  z.object({ kind: z.literal('COMPANY'), providerId: z.uuid() }),
]);
export type OfferAssignee = z.infer<typeof offerAssigneeSchema>;

export const sendOfferSchema = versionSchema.extend({
  assignee: offerAssigneeSchema,
  windowMinutes: z
    .number()
    .int()
    .refine((m) => (OFFER_WINDOW_MINUTES as readonly number[]).includes(m), {
      message: 'window_not_allowed',
    })
    .default(DEFAULT_OFFER_WINDOW_MINUTES),
});
export type SendOfferInput = z.input<typeof sendOfferSchema>;

export const jobVersionSchema = versionSchema;
export const jobVersionReasonSchema = versionSchema.extend({ reason: reasonSchema });

export const acceptOfferSchema = z.object({
  /** Company offers: the company's technician who will do the work (P9-5). */
  technicianUserId: z.uuid().optional(),
});
export type AcceptOfferInput = z.input<typeof acceptOfferSchema>;

export const declineOfferSchema = z
  .object({
    reason: declineReasonSchema,
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.reason !== 'OTHER' || (v.note !== undefined && v.note.length >= 3), {
    message: 'note_required',
    path: ['note'],
  });
export type DeclineOfferInput = z.input<typeof declineOfferSchema>;

export const changeTechnicianSchema = versionSchema.extend({
  technicianUserId: z.uuid(),
  reason: reasonSchema,
});
export type ChangeTechnicianInput = z.input<typeof changeTechnicianSchema>;

export const workNoteInputSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export type WorkNoteInput = z.input<typeof workNoteInputSchema>;

export const evidenceFieldsSchema = z.object({
  caption: z.string().trim().max(200).default(''),
});

export const completionInputSchema = versionSchema.extend({
  summary: z.string().trim().min(10).max(2000),
  minutesOnSite: z.number().int().min(0).max(10_080).nullable().default(null),
  materials: z.string().trim().max(1000).default(''),
  evidenceIds: z.array(z.uuid()).max(MAX_JOB_PHOTOS).default([]),
});
export type CompletionInput = z.input<typeof completionInputSchema>;

export const staffJobFiltersSchema = z.object({
  status: jobStatusSchema.optional(),
  source: z.enum(['ORDER', 'TICKET']).optional(),
  county: regionCodeSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type StaffJobFilters = z.input<typeof staffJobFiltersSchema>;

export const assigneeJobFiltersSchema = z.object({
  view: z.enum(['offers', 'active', 'done']).default('active'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type AssigneeJobFilters = z.input<typeof assigneeJobFiltersSchema>;

// ---------------------------------------------------------------- shared parts

const skillRequirementSchema = z.object({
  code: z.string(),
  name: z.string(),
  minExperience: experienceBandSchema,
});
const sourceSchema = z.object({
  kind: z.enum(['ORDER', 'TICKET']),
  id: z.uuid(),
  number: z.string(),
});
const photoSchema = z.object({
  id: z.uuid(),
  caption: z.string(),
  status: fileStatusSchema,
  createdAt: z.string(),
});
export type JobPhoto = z.infer<typeof photoSchema>;

const reportSchema = z.object({
  id: z.uuid(),
  summary: z.string(),
  minutesOnSite: z.number().nullable(),
  materials: z.string(),
  submittedAt: z.string(),
  autoConfirmAt: z.string(),
  outcome: completionOutcomeSchema.nullable(),
  photoIds: z.array(z.uuid()),
});
export type JobReport = z.infer<typeof reportSchema>;

const personSchema = z.object({ id: z.uuid(), label: z.string() });

// ---------------------------------------------------------------- staff

export const staffJobSummarySchema = z.object({
  id: z.uuid(),
  number: z.string(),
  title: z.string(),
  status: jobStatusSchema,
  source: sourceSchema,
  regionCode: z.string(),
  customerDisplay: z.string(),
  assignee: z
    .object({ kind: assigneeKindSchema, label: z.string(), technician: z.string() })
    .nullable(),
  pendingOffer: z
    .object({ kind: assigneeKindSchema, label: z.string(), expiresAt: z.string() })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StaffJobSummary = z.infer<typeof staffJobSummarySchema>;

export const staffJobQueueSchema = z.object({
  jobs: z.array(staffJobSummarySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  counts: z.object({
    queued: z.number(),
    offered: z.number(),
    inProgress: z.number(),
    awaitingConfirmation: z.number(),
  }),
});
export type StaffJobQueue = z.infer<typeof staffJobQueueSchema>;

export const staffJobOfferSchema = z.object({
  id: z.uuid(),
  kind: assigneeKindSchema,
  label: z.string(),
  status: jobOfferStatusSchema,
  offeredAt: z.string(),
  expiresAt: z.string(),
  offeredBy: z.string(),
  declineReason: declineReasonSchema.nullable(),
  declineNote: z.string().nullable(),
  respondedAt: z.string().nullable(),
});
export type StaffJobOffer = z.infer<typeof staffJobOfferSchema>;

export const staffJobAssignmentSchema = z.object({
  id: z.uuid(),
  kind: assigneeKindSchema,
  label: z.string(),
  technician: z.string(),
  status: z.enum(['ACTIVE', 'ENDED']),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  endReason: assignmentEndReasonSchema.nullable(),
  endNote: z.string().nullable(),
});
export type StaffJobAssignment = z.infer<typeof staffJobAssignmentSchema>;

export const jobActivitySchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  reason: z.string().nullable(),
  actor: z.string().nullable(),
  at: z.string(),
});
export type JobActivity = z.infer<typeof jobActivitySchema>;

export const staffJobActivitySchema = jobActivitySchema.extend({
  customerVisible: z.boolean(),
  providerVisible: z.boolean(),
});

export const workNoteSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
});
export type WorkNote = z.infer<typeof workNoteSchema>;

export const staffJobSchema = staffJobSummarySchema.extend({
  version: z.number(),
  brief: z.string(),
  siteAddress: z.string(),
  siteContactName: z.string().nullable(),
  siteContactPhone: z.string().nullable(),
  windowFrom: z.string().nullable(),
  windowTo: z.string().nullable(),
  onSite: z.boolean(),
  remoteAllowed: z.boolean(),
  channels: z.object({ internal: z.boolean(), individual: z.boolean(), company: z.boolean() }),
  skills: z.array(skillRequirementSchema),
  cancelReason: z.string().nullable(),
  offers: z.array(staffJobOfferSchema),
  assignments: z.array(staffJobAssignmentSchema),
  activity: z.array(staffJobActivitySchema),
  workNotes: z.array(workNoteSchema),
  photos: z.array(photoSchema),
  report: reportSchema.nullable(),
  can: z.object({
    editBrief: z.boolean(),
    offer: z.boolean(),
    withdrawOffer: z.boolean(),
    reassign: z.boolean(),
    cancel: z.boolean(),
    confirm: z.boolean(),
  }),
});
export type StaffJob = z.infer<typeof staffJobSchema>;

export const jobCandidatesSchema = z.object({
  internal: z.array(personSchema),
  providers: z.array(eligibilityCandidateSchema),
});
export type JobCandidates = z.infer<typeof jobCandidatesSchema>;

// ---------------------------------------------------------------- assignees

/** A card in the assignee's job list: no address beyond the area, no customer. */
export const assigneeJobCardSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  title: z.string(),
  status: jobStatusSchema,
  regionCode: z.string(),
  area: z.string(),
  windowFrom: z.string().nullable(),
  windowTo: z.string().nullable(),
  offer: z.object({ id: z.uuid(), expiresAt: z.string() }).nullable(),
});
export type AssigneeJobCard = z.infer<typeof assigneeJobCardSchema>;

export const assigneeDoneItemSchema = z.object({
  assignmentId: z.uuid(),
  number: z.string(),
  title: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  endReason: assignmentEndReasonSchema.nullable(),
});
export type AssigneeDoneItem = z.infer<typeof assigneeDoneItemSchema>;

export const assigneeJobListSchema = z.object({
  view: z.enum(['offers', 'active', 'done']),
  items: z.array(assigneeJobCardSchema),
  done: z.array(assigneeDoneItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  counts: z.object({ offers: z.number(), active: z.number() }),
});
export type AssigneeJobList = z.infer<typeof assigneeJobListSchema>;

/** The offer, before accepting (plan §2.5): the brief and the area only. */
export const assigneeOfferSchema = z.object({
  offerId: z.uuid(),
  jobId: z.uuid(),
  number: z.string(),
  title: z.string(),
  brief: z.string(),
  skills: z.array(skillRequirementSchema),
  onSite: z.boolean(),
  regionCode: z.string(),
  area: z.string(),
  windowFrom: z.string().nullable(),
  windowTo: z.string().nullable(),
  expiresAt: z.string(),
  kind: assigneeKindSchema,
  /** Company dispatchers pick one of these when accepting. */
  technicians: z.array(personSchema),
});
export type AssigneeOffer = z.infer<typeof assigneeOfferSchema>;

/** The job while it is assigned to the caller (plan §2.5, after accepting). */
export const assigneeJobSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  title: z.string(),
  status: jobStatusSchema,
  version: z.number(),
  brief: z.string(),
  skills: z.array(skillRequirementSchema),
  onSite: z.boolean(),
  regionCode: z.string(),
  siteAddress: z.string(),
  siteContactName: z.string().nullable(),
  siteContactPhone: z.string().nullable(),
  customerDisplay: z.string(),
  windowFrom: z.string().nullable(),
  windowTo: z.string().nullable(),
  assignment: z.object({
    id: z.uuid(),
    kind: assigneeKindSchema,
    technician: z.string(),
    startedAt: z.string(),
  }),
  activity: z.array(jobActivitySchema),
  workNotes: z.array(workNoteSchema),
  photos: z.array(photoSchema),
  report: reportSchema.nullable(),
  /** INTERNAL OGS technicians only (P9-2); always empty for providers. */
  internalNotes: z.array(z.object({ id: z.uuid(), body: z.string(), createdAt: z.string() })),
  technicians: z.array(personSchema),
  can: z.object({
    onTheWay: z.boolean(),
    start: z.boolean(),
    pause: z.boolean(),
    resume: z.boolean(),
    addWork: z.boolean(),
    complete: z.boolean(),
    changeTechnician: z.boolean(),
  }),
});
export type AssigneeJob = z.infer<typeof assigneeJobSchema>;

// ---------------------------------------------------------------- customers

/** The first live job tracker (plan §2.9): no brief, notes, offers or reasons. */
export const customerJobProgressSchema = z.object({
  job: z
    .object({
      id: z.uuid(),
      number: z.string(),
      status: jobStatusSchema,
      label: z.enum([
        'finding_technician',
        'technician_assigned',
        'on_the_way',
        'work_in_progress',
        'check_and_confirm',
        'completed',
        'cancelled',
      ]),
      version: z.number(),
      assignee: z
        .object({
          firstName: z.string().nullable(),
          initials: z.string(),
          partner: z.boolean(),
        })
        .nullable(),
      activity: z.array(z.object({ id: z.uuid(), kind: z.string(), at: z.string() })),
      report: reportSchema
        .omit({ photoIds: true })
        .extend({
          photos: z.array(photoSchema),
        })
        .nullable(),
      can: z.object({ confirm: z.boolean(), reportProblem: z.boolean() }),
    })
    .nullable(),
});
export type CustomerJobProgress = z.infer<typeof customerJobProgressSchema>;
