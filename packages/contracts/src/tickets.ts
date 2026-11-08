import { z } from 'zod';
import { submitServiceRequestSchema } from './orders.js';

/**
 * Phase 8: tickets (ITSM). Customers and staff get DIFFERENT response schemas:
 * the customer schemas have no field that could carry an internal note, an
 * internal attachment, an internal activity row or the staff assignee, and the
 * API parses every customer response through them (unknown keys are stripped).
 */

// ---------------------------------------------------------------- enums

export const ticketStatusSchema = z.enum([
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'AWAITING_CUSTOMER',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
]);
export const ticketTypeSchema = z.enum(['INCIDENT', 'QUESTION']);
export const ticketUrgencySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
export const ticketPrioritySchema = z.enum(['P1', 'P2', 'P3', 'P4']);
export const ticketChannelSchema = z.enum(['WEB', 'PHONE', 'EMAIL', 'WALK_IN', 'WHATSAPP']);
export const ticketClosureSchema = z.enum(['ACCEPTED', 'AUTO_CLOSED', 'WITHDRAWN']);
export const fileStatusSchema = z.enum(['QUARANTINED', 'CLEAN', 'REJECTED']);

export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type TicketType = z.infer<typeof ticketTypeSchema>;
export type TicketUrgency = z.infer<typeof ticketUrgencySchema>;
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;
export type TicketChannel = z.infer<typeof ticketChannelSchema>;

/** Customers may reopen a resolved ticket for this long; then it closes (P8-2). */
export const REOPEN_WINDOW_DAYS = 7;
export const REOPEN_WINDOW_MS = REOPEN_WINDOW_DAYS * 86_400_000;
/** Files per comment (or per new ticket). */
export const MAX_TICKET_ATTACHMENTS = 5;

/** States in which a ticket is still being worked on. */
export const ACTIVE_TICKET_STATUSES: readonly TicketStatus[] = [
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'AWAITING_CUSTOMER',
  'ON_HOLD',
];

/** What customers see (plan §2.2): five simple labels. */
export type CustomerTicketLabel =
  'open' | 'in_progress' | 'waiting_for_you' | 'resolved' | 'closed';
export const CUSTOMER_TICKET_LABEL: Record<TicketStatus, CustomerTicketLabel> = {
  NEW: 'open',
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  ON_HOLD: 'in_progress',
  AWAITING_CUSTOMER: 'waiting_for_you',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
};

/** The priority a customer's urgency suggests at triage (staff decide). */
export const SUGGESTED_PRIORITY: Record<TicketUrgency, TicketPriority> = {
  CRITICAL: 'P1',
  HIGH: 'P2',
  NORMAL: 'P3',
  LOW: 'P4',
};

// ---------------------------------------------------------------- inputs

const reasonSchema = z.string().trim().min(5).max(500);
const bodySchema = z.string().trim().min(1).max(5000);
const attachmentIdsSchema = z.array(z.uuid()).max(MAX_TICKET_ATTACHMENTS).default([]);

export const openTicketSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  description: z.string().trim().min(10).max(5000),
  type: ticketTypeSchema.default('INCIDENT'),
  categoryCode: z.string().trim().min(2).max(40),
  urgency: ticketUrgencySchema.default('NORMAL'),
  serviceOrderId: z.uuid().optional(),
  relatedTicketId: z.uuid().optional(),
  attachmentIds: attachmentIdsSchema,
});
export type OpenTicket = z.input<typeof openTicketSchema>;

export const ticketCommentInputSchema = z.object({
  body: bodySchema,
  attachmentIds: attachmentIdsSchema,
});
export type TicketCommentInput = z.input<typeof ticketCommentInputSchema>;

export const ticketVersionSchema = z.object({ version: z.number().int().min(0) });
export const ticketVersionReasonSchema = ticketVersionSchema.extend({ reason: reasonSchema });

/** Staff open a ticket for a customer who phoned, emailed or walked in (P8-6). */
export const onBehalfCustomerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ORGANISATION'), tenantId: z.uuid(), requesterUserId: z.uuid() }),
  z.object({ kind: z.literal('PERSON'), userId: z.uuid() }),
]);
export type OnBehalfCustomer = z.infer<typeof onBehalfCustomerSchema>;

export const staffOpenTicketSchema = openTicketSchema
  .omit({ relatedTicketId: true, attachmentIds: true })
  .extend({
    customer: onBehalfCustomerSchema,
    channel: ticketChannelSchema.exclude(['WEB']),
  });
export type StaffOpenTicket = z.input<typeof staffOpenTicketSchema>;

/** Staff place a service request for a customer (P8-7, ADR-047). */
export const staffSubmitRequestSchema = z.object({
  customer: onBehalfCustomerSchema,
  request: submitServiceRequestSchema,
});
export type StaffSubmitRequest = z.input<typeof staffSubmitRequestSchema>;

export const triageTicketSchema = ticketVersionSchema.extend({
  priority: ticketPrioritySchema,
  categoryCode: z.string().trim().min(2).max(40),
});
export const ticketPriorityInputSchema = ticketVersionReasonSchema.extend({
  priority: ticketPrioritySchema,
});
export const ticketCategoryInputSchema = ticketVersionSchema.extend({
  categoryCode: z.string().trim().min(2).max(40),
});
export const resolveTicketSchema = ticketVersionSchema.extend({
  resolution: z.string().trim().min(5).max(2000),
});
export const assignTicketSchema = ticketVersionSchema.extend({
  assigneeUserId: z.uuid().nullable(),
});
export const linkOrderSchema = ticketVersionSchema.extend({
  serviceOrderId: z.uuid().nullable(),
});

export const staffTicketFiltersSchema = z.object({
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  category: z.string().max(40).optional(),
  assignee: z.enum(['me', 'unassigned', 'anyone']).default('anyone'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type StaffTicketFilters = z.input<typeof staffTicketFiltersSchema>;

export const customerTicketFiltersSchema = z.object({
  show: z.enum(['open', 'resolved', 'all']).default('open'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const TICKET_PAGE_SIZE = 25;

// ---------------------------------------------------------------- responses (shared parts)

export const ticketCategorySchema = z.object({ code: z.string(), name: z.string() });
export const ticketCategoryListSchema = z.object({ categories: z.array(ticketCategorySchema) });
export type TicketCategory = z.infer<typeof ticketCategorySchema>;

export const ticketAttachmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: fileStatusSchema,
});
export type TicketAttachment = z.infer<typeof ticketAttachmentSchema>;

const linkSchema = z.object({ id: z.uuid(), number: z.string() });

// ---------------------------------------------------------------- customer responses

export const customerTicketMessageSchema = z.object({
  id: z.uuid(),
  side: z.enum(['CUSTOMER', 'STAFF']),
  /** Staff replies show as "OGS support"; customer messages show the member's email. */
  authorLabel: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  attachments: z.array(ticketAttachmentSchema),
});

export const customerTicketActivitySchema = z.object({
  kind: z.string(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  reason: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});

export const customerTicketSummarySchema = z.object({
  id: z.uuid(),
  number: z.string(),
  subject: z.string(),
  status: ticketStatusSchema,
  urgency: ticketUrgencySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  requesterLabel: z.string(),
});
export type CustomerTicketSummary = z.infer<typeof customerTicketSummarySchema>;

export const customerTicketListSchema = z.object({
  tickets: z.array(customerTicketSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CustomerTicketList = z.infer<typeof customerTicketListSchema>;

export const customerTicketSchema = customerTicketSummarySchema.extend({
  description: z.string(),
  type: ticketTypeSchema,
  category: ticketCategorySchema,
  priority: ticketPrioritySchema.nullable(),
  channel: ticketChannelSchema,
  onBehalf: z.boolean(),
  serviceOrder: linkSchema.nullable(),
  relatedTicket: linkSchema.nullable(),
  departmentName: z.string().nullable(),
  resolution: z.string().nullable(),
  closure: ticketClosureSchema.nullable(),
  closureReason: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  /** Until when the customer may reopen (resolved tickets only). */
  reopenUntil: z.iso.datetime().nullable(),
  version: z.number().int(),
  attachments: z.array(ticketAttachmentSchema),
  messages: z.array(customerTicketMessageSchema),
  activity: z.array(customerTicketActivitySchema),
  /** What this person may do now (the server still checks each call). */
  can: z.object({
    comment: z.boolean(),
    reopen: z.boolean(),
    acceptResolution: z.boolean(),
    withdraw: z.boolean(),
  }),
});
export type CustomerTicket = z.infer<typeof customerTicketSchema>;

export const linkableOrdersSchema = z.object({
  orders: z.array(z.object({ id: z.uuid(), number: z.string(), serviceName: z.string() })),
});
export type LinkableOrders = z.infer<typeof linkableOrdersSchema>;

// ---------------------------------------------------------------- staff responses

const personSchema = z.object({ id: z.uuid(), email: z.string() });

export const staffTicketSummarySchema = z.object({
  id: z.uuid(),
  number: z.string(),
  subject: z.string(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema.nullable(),
  urgency: ticketUrgencySchema,
  category: ticketCategorySchema,
  customerName: z.string(),
  assignee: personSchema.nullable(),
  onBehalf: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StaffTicketSummary = z.infer<typeof staffTicketSummarySchema>;

export const staffTicketQueueSchema = z.object({
  tickets: z.array(staffTicketSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: z.object({
    unassigned: z.number().int(),
    mine: z.number().int(),
    awaitingCustomer: z.number().int(),
  }),
});
export type StaffTicketQueue = z.infer<typeof staffTicketQueueSchema>;

export const staffThreadItemSchema = z.object({
  id: z.uuid(),
  /** `note` items are internal: never shown to customers. */
  kind: z.enum(['comment', 'note']),
  side: z.enum(['CUSTOMER', 'STAFF']),
  author: personSchema.nullable(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  attachments: z.array(ticketAttachmentSchema),
});
export type StaffThreadItem = z.infer<typeof staffThreadItemSchema>;

export const staffTicketActivitySchema = customerTicketActivitySchema.extend({
  visibility: z.enum(['PUBLIC', 'INTERNAL']),
  actor: personSchema.nullable(),
});

export const staffTicketSchema = staffTicketSummarySchema.extend({
  description: z.string(),
  type: ticketTypeSchema,
  channel: ticketChannelSchema,
  customer: z.object({
    kind: z.enum(['ORGANISATION', 'PERSON']),
    tenantId: z.uuid().nullable(),
    userId: z.uuid().nullable(),
    name: z.string(),
  }),
  requester: personSchema,
  createdBy: personSchema,
  departmentName: z.string().nullable(),
  serviceOrder: linkSchema.extend({ status: z.string(), totalMinor: z.number().int() }).nullable(),
  relatedTicket: linkSchema.nullable(),
  resolution: z.string().nullable(),
  closure: ticketClosureSchema.nullable(),
  closureReason: z.string().nullable(),
  reopenCount: z.number().int(),
  firstResponseAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  reopenUntil: z.iso.datetime().nullable(),
  version: z.number().int(),
  attachments: z.array(ticketAttachmentSchema),
  thread: z.array(staffThreadItemSchema),
  activity: z.array(staffTicketActivitySchema),
});
export type StaffTicket = z.infer<typeof staffTicketSchema>;

export const ticketAssigneesSchema = z.object({ assignees: z.array(personSchema) });

export const customerLookupSchema = z.object({
  organisations: z.array(z.object({ tenantId: z.uuid(), name: z.string() })),
  people: z.array(personSchema),
});
export type CustomerLookup = z.infer<typeof customerLookupSchema>;

export const organisationMembersSchema = z.object({
  members: z.array(personSchema.extend({ departmentName: z.string().nullable() })),
});
export type OrganisationMembers = z.infer<typeof organisationMembersSchema>;
