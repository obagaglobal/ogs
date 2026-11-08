import {
  ACTIVE_TICKET_STATUSES,
  customerTicketSchema,
  REOPEN_WINDOW_MS,
  staffTicketSchema,
  type CustomerTicket,
  type StaffTicket,
  type TicketAttachment,
} from '@ogs/contracts';
import { notFound } from '../common/domain-error.js';
import { MembershipStatus, type Db, type Prisma } from '../database/index.js';
import type { Customer } from '../orders/order-views.js';

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/** The label staff replies carry for customers: OGS owns the relationship. */
export const STAFF_AUTHOR_LABEL = 'OGS support';

export function reopenUntil(status: string, resolvedAt: Date | null): Date | null {
  return status === 'RESOLVED' && resolvedAt !== null
    ? new Date(resolvedAt.getTime() + REOPEN_WINDOW_MS)
    : null;
}

// ---------------------------------------------------------------- customer scope (P8-4)

export interface CustomerScope {
  readonly where: Prisma.TicketWhereInput;
  /** Requester or ticket.read_all: may reopen, accept or withdraw. */
  readonly decides: (requesterUserId: string) => boolean;
}

/**
 * Who sees which tickets: a person sees their own (personal workspace only);
 * an organisation member sees their own, plus their department's with
 * ticket.read_department, or all with ticket.read_all. RLS keeps the tenant
 * boundary; this keeps the member split (as ADR-054).
 */
export async function customerScope(tx: Db, customer: Customer): Promise<CustomerScope> {
  if (customer.tenantId === undefined) {
    return {
      where: { customerUserId: customer.userId, customerTenantId: null },
      decides: () => true,
    };
  }
  const tenant = { customerTenantId: customer.tenantId };
  const readAll = customer.permissions.has('ticket.read_all');
  const decides = (requester: string) => readAll || requester === customer.userId;
  if (readAll) {
    return { where: tenant, decides };
  }
  if (customer.permissions.has('ticket.read_department')) {
    const membership = await tx.membership.findFirst({
      where: {
        tenantId: customer.tenantId,
        userId: customer.userId,
        status: MembershipStatus.ACTIVE,
      },
      select: { departmentId: true },
    });
    const departmentId = membership?.departmentId ?? null;
    if (departmentId !== null) {
      return {
        where: {
          ...tenant,
          OR: [{ requesterUserId: customer.userId }, { departmentId }],
        },
        decides,
      };
    }
  }
  return { where: { ...tenant, requesterUserId: customer.userId }, decides };
}

// ---------------------------------------------------------------- attachments

const ATTACHMENT_SELECT = {
  id: true,
  commentId: true,
  noteId: true,
  file: { select: { originalName: true, mimeType: true, sizeBytes: true, status: true } },
} as const;

type AttachmentRow = Prisma.TicketAttachmentGetPayload<{ select: typeof ATTACHMENT_SELECT }>;

function attachmentView(row: AttachmentRow): TicketAttachment {
  return {
    id: row.id,
    name: row.file.originalName,
    mimeType: row.file.mimeType,
    sizeBytes: row.file.sizeBytes,
    status: row.file.status,
  };
}

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

const TICKET_SELECT = {
  id: true,
  number: true,
  subject: true,
  description: true,
  status: true,
  type: true,
  urgency: true,
  priority: true,
  channel: true,
  onBehalf: true,
  customerTenantId: true,
  customerUserId: true,
  requesterUserId: true,
  createdBy: true,
  departmentId: true,
  assigneeUserId: true,
  resolution: true,
  closure: true,
  closureReason: true,
  reopenCount: true,
  firstResponseAt: true,
  resolvedAt: true,
  closedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { code: true, name: true } },
  serviceOrder: { select: { id: true, number: true, status: true, totalMinor: true } },
  relatedTicket: { select: { id: true, number: true } },
} as const;

// ---------------------------------------------------------------- customer view

/**
 * The customer's view of one ticket. Reads ONLY public tables and public rows
 * (each query also filters explicitly, on top of RLS), and the result is parsed
 * through customerTicketSchema, which has no field for internal data.
 */
export async function loadCustomerTicket(
  tx: Db,
  customer: Customer,
  id: string,
): Promise<CustomerTicket> {
  const scope = await customerScope(tx, customer);
  const ticket = await tx.ticket.findFirst({
    where: { AND: [{ id }, scope.where] },
    select: TICKET_SELECT,
  });
  if (ticket === null) {
    throw notFound();
  }
  const [comments, attachments, events, department] = await Promise.all([
    tx.ticketComment.findMany({
      where: { ticketId: id },
      select: { id: true, side: true, authorUserId: true, body: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    tx.ticketAttachment.findMany({
      where: { ticketId: id, noteId: null },
      select: ATTACHMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
    tx.ticketEvent.findMany({
      where: { ticketId: id, visibility: 'PUBLIC' },
      select: { kind: true, fromValue: true, toValue: true, reason: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
    ticket.departmentId === null
      ? null
      : tx.department.findFirst({ where: { id: ticket.departmentId }, select: { name: true } }),
  ]);
  const customerAuthors = await emails(tx, [
    ticket.requesterUserId,
    ...comments.filter((c) => c.side === 'CUSTOMER').map((c) => c.authorUserId),
  ]);
  const label = (userId: string) =>
    userId === customer.userId ? 'You' : (customerAuthors.get(userId) ?? 'Customer');
  const decides = scope.decides(ticket.requesterUserId);
  const active = ACTIVE_TICKET_STATUSES.includes(ticket.status);
  const until = reopenUntil(ticket.status, ticket.resolvedAt);
  const commentable =
    active && (customer.tenantId === undefined || customer.permissions.has('ticket.comment'));

  return customerTicketSchema.parse({
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    urgency: ticket.urgency,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    requesterLabel: label(ticket.requesterUserId),
    description: ticket.description,
    type: ticket.type,
    category: ticket.category,
    priority: ticket.priority,
    channel: ticket.channel,
    onBehalf: ticket.onBehalf,
    serviceOrder:
      ticket.serviceOrder === null
        ? null
        : { id: ticket.serviceOrder.id, number: ticket.serviceOrder.number },
    relatedTicket: ticket.relatedTicket,
    departmentName: department?.name ?? null,
    resolution: ticket.resolution,
    closure: ticket.closure,
    closureReason: ticket.closureReason,
    resolvedAt: iso(ticket.resolvedAt),
    closedAt: iso(ticket.closedAt),
    reopenUntil: iso(until),
    version: ticket.version,
    attachments: attachments
      .filter((a) => a.commentId === null && a.noteId === null)
      .map(attachmentView),
    messages: comments.map((comment) => ({
      id: comment.id,
      side: comment.side,
      authorLabel: comment.side === 'STAFF' ? STAFF_AUTHOR_LABEL : label(comment.authorUserId),
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      attachments: attachments
        .filter((a) => a.commentId === comment.id && a.noteId === null)
        .map(attachmentView),
    })),
    activity: events.map((event) => ({
      kind: event.kind,
      fromValue: event.fromValue,
      toValue: event.toValue,
      reason: event.reason,
      occurredAt: event.occurredAt.toISOString(),
    })),
    can: {
      comment: commentable,
      reopen: decides && until !== null && until.getTime() > Date.now(),
      acceptResolution: decides && ticket.status === 'RESOLVED',
      withdraw: decides && active,
    },
  });
}

// ---------------------------------------------------------------- staff view

/** Everything, for elevated staff: public conversation and internal notes in one thread. */
export async function loadStaffTicket(tx: Db, id: string): Promise<StaffTicket> {
  const ticket = await tx.ticket.findUnique({ where: { id }, select: TICKET_SELECT });
  if (ticket === null) {
    throw notFound();
  }
  const [comments, notes, attachments, events, department, tenant] = await Promise.all([
    tx.ticketComment.findMany({
      where: { ticketId: id },
      select: { id: true, side: true, authorUserId: true, body: true, createdAt: true },
    }),
    tx.ticketInternalNote.findMany({
      where: { ticketId: id },
      select: { id: true, authorUserId: true, body: true, createdAt: true },
    }),
    tx.ticketAttachment.findMany({
      where: { ticketId: id },
      select: ATTACHMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    }),
    tx.ticketEvent.findMany({
      where: { ticketId: id },
      select: {
        kind: true,
        visibility: true,
        fromValue: true,
        toValue: true,
        reason: true,
        actorUserId: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'asc' },
    }),
    ticket.departmentId === null
      ? null
      : tx.department.findFirst({ where: { id: ticket.departmentId }, select: { name: true } }),
    ticket.customerTenantId === null
      ? null
      : tx.tenant.findUnique({ where: { id: ticket.customerTenantId }, select: { name: true } }),
  ]);
  const people = await emails(tx, [
    ticket.requesterUserId,
    ticket.createdBy,
    ticket.assigneeUserId,
    ticket.customerUserId,
    ...comments.map((c) => c.authorUserId),
    ...notes.map((n) => n.authorUserId),
    ...events.map((e) => e.actorUserId),
  ]);
  const person = (userId: string | null) =>
    userId === null ? null : { id: userId, email: people.get(userId) ?? 'unknown' };
  const thread = [
    ...comments.map((c) => ({
      id: c.id,
      kind: 'comment' as const,
      side: c.side,
      author: person(c.authorUserId),
      body: c.body,
      createdAt: c.createdAt,
      attachments: attachments.filter((a) => a.commentId === c.id).map(attachmentView),
    })),
    ...notes.map((n) => ({
      id: n.id,
      kind: 'note' as const,
      side: 'STAFF' as const,
      author: person(n.authorUserId),
      body: n.body,
      createdAt: n.createdAt,
      attachments: attachments.filter((a) => a.noteId === n.id).map(attachmentView),
    })),
  ]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }));

  const customerName =
    tenant?.name ??
    (ticket.customerUserId === null ? '' : (people.get(ticket.customerUserId) ?? ''));

  return staffTicketSchema.parse({
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    urgency: ticket.urgency,
    category: ticket.category,
    customerName,
    assignee: person(ticket.assigneeUserId),
    onBehalf: ticket.onBehalf,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    description: ticket.description,
    type: ticket.type,
    channel: ticket.channel,
    customer: {
      kind: ticket.customerTenantId === null ? 'PERSON' : 'ORGANISATION',
      tenantId: ticket.customerTenantId,
      userId: ticket.customerUserId,
      name: customerName,
    },
    requester: person(ticket.requesterUserId),
    createdBy: person(ticket.createdBy),
    departmentName: department?.name ?? null,
    serviceOrder:
      ticket.serviceOrder === null
        ? null
        : { ...ticket.serviceOrder, totalMinor: Number(ticket.serviceOrder.totalMinor) },
    relatedTicket: ticket.relatedTicket,
    resolution: ticket.resolution,
    closure: ticket.closure,
    closureReason: ticket.closureReason,
    reopenCount: ticket.reopenCount,
    firstResponseAt: iso(ticket.firstResponseAt),
    resolvedAt: iso(ticket.resolvedAt),
    closedAt: iso(ticket.closedAt),
    reopenUntil: iso(reopenUntil(ticket.status, ticket.resolvedAt)),
    version: ticket.version,
    attachments: attachments
      .filter((a) => a.commentId === null && a.noteId === null)
      .map(attachmentView),
    thread,
    activity: events.map((e) => ({
      kind: e.kind,
      visibility: e.visibility,
      fromValue: e.fromValue,
      toValue: e.toValue,
      reason: e.reason,
      actor: person(e.actorUserId),
      occurredAt: e.occurredAt.toISOString(),
    })),
  });
}
