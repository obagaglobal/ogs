import { Injectable } from '@nestjs/common';
import {
  REOPEN_WINDOW_MS,
  TICKET_PAGE_SIZE,
  type staffOpenTicketSchema,
  type StaffTicket,
  type StaffTicketQueue,
  type staffTicketFiltersSchema,
  type LinkableOrders,
  type TicketPriority,
} from '@ogs/contracts';
import type { z } from 'zod';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { nextNumber } from '../common/document-numbers.js';
import { conflict, forbiddenRule, notFound } from '../common/domain-error.js';
import {
  MembershipStatus,
  TenantKind,
  TenantDb,
  type Db,
  type DbContext,
  type Prisma,
} from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import {
  FileService,
  type Download,
  type StoredFile,
  type UploadInput,
} from '../files/file.service.js';
import { idempotent } from '../orders/order-support.js';
import { categoryId } from './customer-tickets.service.js';
import { resolveOnBehalf } from './on-behalf.js';
import { attachFiles } from './ticket-files.js';
import { changeTicket, moveTicket, writeEvent, type TicketRef } from './ticket-support.js';
import { loadStaffTicket } from './ticket-views.js';
import {
  requireTicketCommand,
  TICKET_COMMANDS,
  type STAFF_STATUS_COMMANDS,
  type TicketCommand,
  type TicketTransition,
} from './transitions.js';

type Filters = z.output<typeof staffTicketFiltersSchema>;
type StaffOpen = z.output<typeof staffOpenTicketSchema>;
export type StaffStatusCommand = (typeof STAFF_STATUS_COMMANDS)[number];

/** An elevated staff member: the platform context and their platform permissions. */
export interface Staff {
  readonly ctx: DbContext;
  readonly userId: string;
  readonly permissions: ReadonlySet<string>;
}

interface Loaded extends TicketRef {
  readonly customerTenantId: string | null;
  readonly customerUserId: string | null;
  readonly assigneeUserId: string | null;
  readonly priority: TicketPriority | null;
  readonly firstResponseAt: Date | null;
}

/**
 * The helpdesk side of tickets (Phase 8 plan §2.4). Every method runs in an
 * elevated `platform` context; each command also checks the permission the
 * transition table names. Audit rows of INTERNAL commands carry no tenant, so
 * they never appear in the customer's own audit log.
 */
@Injectable()
export class StaffTicketsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly files: FileService,
  ) {}

  async queue(staff: Staff, filters: Filters): Promise<StaffTicketQueue> {
    return this.db.run(staff.ctx, async (tx) => {
      const where: Prisma.TicketWhereInput = {
        ...(filters.status === undefined
          ? { status: { not: 'CLOSED' } }
          : { status: filters.status }),
        ...(filters.priority === undefined ? {} : { priority: filters.priority }),
        ...(filters.category === undefined ? {} : { category: { code: filters.category } }),
        ...(filters.assignee === 'me'
          ? { assigneeUserId: staff.userId }
          : filters.assignee === 'unassigned'
            ? { assigneeUserId: null }
            : {}),
        ...(filters.q === undefined || filters.q === ''
          ? {}
          : {
              OR: [
                { number: { contains: filters.q, mode: 'insensitive' } },
                { subject: { contains: filters.q, mode: 'insensitive' } },
              ],
            }),
      };
      const open: Prisma.TicketWhereInput = { status: { notIn: ['RESOLVED', 'CLOSED'] } };
      const [rows, total, unassigned, mine, awaitingCustomer] = await Promise.all([
        tx.ticket.findMany({
          where,
          select: {
            id: true,
            number: true,
            subject: true,
            status: true,
            priority: true,
            urgency: true,
            onBehalf: true,
            customerTenantId: true,
            customerUserId: true,
            assigneeUserId: true,
            createdAt: true,
            updatedAt: true,
            category: { select: { code: true, name: true } },
          },
          // Priority first (P1 … P4, untriaged first), then oldest first.
          orderBy: [{ priority: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
          skip: (filters.page - 1) * TICKET_PAGE_SIZE,
          take: TICKET_PAGE_SIZE,
        }),
        tx.ticket.count({ where }),
        tx.ticket.count({ where: { ...open, assigneeUserId: null } }),
        tx.ticket.count({ where: { ...open, assigneeUserId: staff.userId } }),
        tx.ticket.count({ where: { status: 'AWAITING_CUSTOMER' } }),
      ]);
      const tenantIds = rows
        .map((r) => r.customerTenantId)
        .filter((id): id is string => id !== null);
      const userIds = rows
        .flatMap((r) => [r.customerUserId, r.assigneeUserId])
        .filter((id): id is string => id !== null);
      const [tenants, users] = await Promise.all([
        tx.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }),
        tx.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
      ]);
      const names = new Map([
        ...tenants.map((t): [string, string] => [t.id, t.name]),
        ...users.map((u): [string, string] => [u.id, u.email]),
      ]);
      return {
        tickets: rows.map((row) => ({
          id: row.id,
          number: row.number,
          subject: row.subject,
          status: row.status,
          priority: row.priority,
          urgency: row.urgency,
          category: row.category,
          customerName: names.get(row.customerTenantId ?? row.customerUserId ?? '') ?? '',
          assignee:
            row.assigneeUserId === null
              ? null
              : { id: row.assigneeUserId, email: names.get(row.assigneeUserId) ?? '' },
          onBehalf: row.onBehalf,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        total,
        page: filters.page,
        pageSize: TICKET_PAGE_SIZE,
        counts: { unassigned, mine, awaitingCustomer },
      };
    });
  }

  async detail(staff: Staff, id: string): Promise<StaffTicket> {
    return this.db.run(staff.ctx, async (tx) => loadStaffTicket(tx, id));
  }

  /** Open a ticket for a customer who phoned, emailed or walked in (P8-6). */
  async openOnBehalf(
    staff: Staff,
    input: StaffOpen,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'openOnBehalf');
    return this.db.run(staff.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: staff.userId,
          scope: 'platform',
          route: 'POST /platform/tickets',
          body: input,
        },
        async () => {
          const customer = await resolveOnBehalf(tx, input.customer);
          if (input.serviceOrderId !== undefined) {
            await this.requireOrderOf(tx, customer, input.serviceOrderId);
          }
          const created = await tx.ticket.create({
            data: {
              number: await nextNumber(tx, 'TCK'),
              customerTenantId: customer.customerTenantId,
              customerUserId: customer.customerUserId,
              requesterUserId: customer.requesterUserId,
              departmentId: customer.departmentId,
              createdBy: staff.userId,
              onBehalf: true,
              channel: input.channel,
              type: input.type,
              categoryId: await categoryId(tx, input.categoryCode),
              subject: input.subject,
              description: input.description,
              urgency: input.urgency,
              serviceOrderId: input.serviceOrderId ?? null,
            },
            select: { id: true, number: true },
          });
          await writeEvent(tx, created.id, 'openOnBehalf', {
            kind: 'created',
            toValue: 'NEW',
            reason: null,
          });
          await this.audit.record(tx, {
            action: 'ticket.opened_on_behalf',
            tenantId: customer.customerTenantId,
            entityType: 'ticket',
            entityId: created.id,
            request: meta,
            metadata: { number: created.number, channel: input.channel },
          });
          await this.outbox.publish(tx, {
            type: 'tickets.opened',
            tenantId: customer.customerTenantId,
            payload: { ticketId: created.id },
          });
          return loadStaffTicket(tx, created.id);
        },
      ),
    );
  }

  /** triage / start / awaitCustomer / hold / resume / resolve / staffReopen. */
  async status(
    staff: Staff,
    id: string,
    command: StaffStatusCommand,
    version: number,
    meta: AuditRequestMeta,
    options: {
      resolution?: string;
      reason?: string;
      priority?: TicketPriority;
      categoryCode?: string;
    } = {},
  ): Promise<StaffTicket> {
    this.allow(staff, command);
    return this.change(staff, id, version, command, meta, async (tx, ticket) => {
      const to = requireTicketCommand(command, ticket.status).to;
      if (to === null) {
        throw conflict('invalid_transition');
      }
      const extra: Prisma.TicketUncheckedUpdateManyInput = {};
      let reason: string | null = null;
      if (command === 'triage') {
        if (options.priority === undefined || options.categoryCode === undefined) {
          throw conflict('priority_required');
        }
        extra.priority = options.priority;
        extra.categoryId = await categoryId(tx, options.categoryCode);
      }
      if (command === 'resolve') {
        if (options.resolution === undefined) {
          throw conflict('resolution_required');
        }
        extra.resolution = options.resolution;
        extra.resolvedAt = new Date();
        reason = options.resolution;
      }
      if (command === 'hold') {
        reason = options.reason ?? null;
      }
      if (command === 'staffReopen') {
        extra.resolution = null;
        extra.resolvedAt = null;
        extra.reopenCount = { increment: 1 };
      }
      await moveTicket(tx, ticket, command, to, extra, reason);
      if (command === 'resolve') {
        // P8-2: the delayed auto-close; the hourly sweep is the safety net.
        await this.outbox.publish(tx, {
          type: 'tickets.auto_close',
          tenantId: ticket.customerTenantId,
          payload: { ticketId: id },
          availableAt: new Date(Date.now() + REOPEN_WINDOW_MS),
        });
        return 'tickets.resolved';
      }
      if (command === 'awaitCustomer') {
        return 'tickets.awaiting_customer';
      }
      return null;
    });
  }

  async setPriority(
    staff: Staff,
    id: string,
    version: number,
    priority: TicketPriority,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'setPriority');
    return this.change(staff, id, version, 'setPriority', meta, async (tx, ticket) => {
      requireTicketCommand('setPriority', ticket.status);
      if (ticket.priority === priority) {
        throw conflict('unchanged');
      }
      await changeTicket(
        tx,
        ticket,
        'setPriority',
        { priority },
        {
          fromValue: ticket.priority,
          toValue: priority,
          reason,
        },
      );
      return null;
    });
  }

  async setCategory(
    staff: Staff,
    id: string,
    version: number,
    code: string,
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'setCategory');
    return this.change(staff, id, version, 'setCategory', meta, async (tx, ticket) => {
      requireTicketCommand('setCategory', ticket.status);
      await changeTicket(
        tx,
        ticket,
        'setCategory',
        { categoryId: await categoryId(tx, code) },
        {
          toValue: code,
        },
      );
      return null;
    });
  }

  async linkOrder(
    staff: Staff,
    id: string,
    version: number,
    serviceOrderId: string | null,
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'linkOrder');
    return this.change(staff, id, version, 'linkOrder', meta, async (tx, ticket) => {
      requireTicketCommand('linkOrder', ticket.status);
      let number: string | null = null;
      if (serviceOrderId !== null) {
        number = await this.requireOrderOf(tx, ticket, serviceOrderId);
      }
      await changeTicket(
        tx,
        ticket,
        'linkOrder',
        { serviceOrderId },
        {
          toValue: number,
        },
      );
      return null;
    });
  }

  /** Any agent may take a ticket for themselves (P8-1). */
  async take(
    staff: Staff,
    id: string,
    version: number,
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'take');
    return this.change(staff, id, version, 'take', meta, async (tx, ticket) => {
      requireTicketCommand('take', ticket.status);
      if (ticket.assigneeUserId === staff.userId) {
        throw conflict('unchanged');
      }
      await changeTicket(
        tx,
        ticket,
        'take',
        { assigneeUserId: staff.userId },
        {
          fromValue: ticket.assigneeUserId,
          toValue: staff.userId,
        },
      );
      return null;
    });
  }

  /** Assigning someone else, or unassigning, needs ticket.assign (P8-1). */
  async assign(
    staff: Staff,
    id: string,
    version: number,
    assigneeUserId: string | null,
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'assign');
    return this.change(staff, id, version, 'assign', meta, async (tx, ticket) => {
      requireTicketCommand('assign', ticket.status);
      if (assigneeUserId !== null && !(await this.isAgent(tx, assigneeUserId))) {
        throw conflict('assignee_not_eligible');
      }
      await changeTicket(
        tx,
        ticket,
        'assign',
        { assigneeUserId },
        {
          fromValue: ticket.assigneeUserId,
          toValue: assigneeUserId,
        },
      );
      return assigneeUserId === null || assigneeUserId === staff.userId ? null : 'tickets.assigned';
    });
  }

  /** A public reply; the first one sets first_response_at (Phase 10 SLA input). */
  async comment(
    staff: Staff,
    id: string,
    body: string,
    attachmentIds: readonly string[],
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'staffComment');
    return this.db.run(staff.ctx, async (tx) => {
      const ticket = await this.load(tx, id);
      requireTicketCommand('staffComment', ticket.status);
      const comment = await tx.ticketComment.create({
        data: { ticketId: id, side: 'STAFF', body },
        select: { id: true },
      });
      await attachFiles(tx, id, attachmentIds, { commentId: comment.id }, staff.userId);
      await tx.ticket.updateMany({
        where: { id },
        data:
          ticket.firstResponseAt === null
            ? { firstResponseAt: new Date() }
            : { updatedAt: new Date() },
      });
      await writeEvent(tx, id, 'staffComment', { kind: 'comment' });
      await this.audit.record(tx, {
        action: 'ticket.replied',
        tenantId: ticket.customerTenantId,
        entityType: 'ticket',
        entityId: id,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'tickets.staff_replied',
        tenantId: ticket.customerTenantId,
        payload: { ticketId: id },
      });
      return loadStaffTicket(tx, id);
    });
  }

  /**
   * An internal note (P8-5). Its activity row is INTERNAL, its audit row has no
   * tenant, it publishes no customer event, and its files belong to OGS.
   */
  async note(
    staff: Staff,
    id: string,
    body: string,
    attachmentIds: readonly string[],
    meta: AuditRequestMeta,
  ): Promise<StaffTicket> {
    this.allow(staff, 'internalNote');
    return this.db.run(staff.ctx, async (tx) => {
      const ticket = await this.load(tx, id);
      requireTicketCommand('internalNote', ticket.status);
      const note = await tx.ticketInternalNote.create({
        data: { ticketId: id, body },
        select: { id: true },
      });
      await attachFiles(tx, id, attachmentIds, { noteId: note.id }, staff.userId);
      await writeEvent(tx, id, 'internalNote');
      await this.audit.record(tx, {
        action: 'ticket.internal_note_added',
        tenantId: null,
        entityType: 'ticket',
        entityId: id,
        request: meta,
      });
      return loadStaffTicket(tx, id);
    });
  }

  /** Upload for a reply (owned by the customer) or a note (owned by OGS). */
  async upload(
    staff: Staff,
    id: string,
    internal: boolean,
    input: UploadInput,
  ): Promise<StoredFile> {
    this.allow(staff, internal ? 'internalNote' : 'staffComment');
    const owner = await this.db.run(staff.ctx, async (tx) => {
      const ticket = await this.load(tx, id);
      if (internal) {
        const platform = await tx.tenant.findFirst({
          where: { kind: TenantKind.PLATFORM },
          select: { id: true },
        });
        if (platform === null) {
          throw notFound();
        }
        return { kind: 'tenant' as const, id: platform.id };
      }
      return ticket.customerTenantId === null
        ? { kind: 'user' as const, id: ticket.customerUserId ?? '' }
        : { kind: 'tenant' as const, id: ticket.customerTenantId };
    });
    return this.files.uploadAs(staff.ctx, owner, { ...input, purpose: 'ticket.attachment' });
  }

  async download(staff: Staff, id: string, attachmentId: string): Promise<Download> {
    const fileId = await this.db.run(staff.ctx, async (tx) => {
      const attachment = await tx.ticketAttachment.findFirst({
        where: { id: attachmentId, ticketId: id },
        select: { fileId: true },
      });
      if (attachment === null) {
        throw notFound();
      }
      return attachment.fileId;
    });
    return this.files.downloadUrl(staff.ctx, fileId);
  }

  /** Active platform members who can work tickets (hold ticket.comment). */
  async assignees(staff: Staff): Promise<{ assignees: { id: string; email: string }[] }> {
    return this.db.run(staff.ctx, async (tx) => {
      const members = await tx.membership.findMany({
        where: {
          status: MembershipStatus.ACTIVE,
          tenant: { kind: TenantKind.PLATFORM },
          roles: {
            some: { role: { permissions: { some: { permissionCode: 'ticket.comment' } } } },
          },
        },
        select: { user: { select: { id: true, email: true } } },
        orderBy: { user: { email: 'asc' } },
        take: 500,
      });
      return { assignees: members.map((m) => m.user) };
    });
  }

  async linkableOrders(staff: Staff, id: string): Promise<LinkableOrders> {
    return this.db.run(staff.ctx, async (tx) => {
      const ticket = await this.load(tx, id);
      const orders = await tx.serviceOrder.findMany({
        where: {
          customerTenantId: ticket.customerTenantId,
          customerUserId: ticket.customerUserId,
        },
        select: { id: true, number: true, request: { select: { serviceName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return {
        orders: orders.map((o) => ({
          id: o.id,
          number: o.number,
          serviceName: o.request.serviceName,
        })),
      };
    });
  }

  // ---------------------------------------------------------------- internals

  private allow(staff: Staff, command: TicketCommand): void {
    const transition: TicketTransition = TICKET_COMMANDS[command];
    if (transition.permission !== undefined && !staff.permissions.has(transition.permission)) {
      throw forbiddenRule('permission_denied');
    }
  }

  private async change(
    staff: Staff,
    id: string,
    version: number,
    command: TicketCommand,
    meta: AuditRequestMeta,
    work: (tx: Db, ticket: Loaded) => Promise<string | null>,
  ): Promise<StaffTicket> {
    return this.db.run(staff.ctx, async (tx) => {
      const ticket = await this.load(tx, id);
      if (ticket.version !== version) {
        throw conflict('stale_version');
      }
      const event = await work(tx, ticket);
      const internal = TICKET_COMMANDS[command].visibility === 'INTERNAL';
      await this.audit.record(tx, {
        action: `ticket.${command.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`)}`,
        // INTERNAL commands stay out of the customer's own audit log.
        tenantId: internal ? null : ticket.customerTenantId,
        entityType: 'ticket',
        entityId: id,
        request: meta,
      });
      if (event !== null) {
        await this.outbox.publish(tx, {
          type: event,
          tenantId: event === 'tickets.assigned' ? null : ticket.customerTenantId,
          payload: { ticketId: id },
        });
      }
      return loadStaffTicket(tx, id);
    });
  }

  private async load(tx: Db, id: string): Promise<Loaded> {
    const ticket = await tx.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        version: true,
        customerTenantId: true,
        customerUserId: true,
        assigneeUserId: true,
        priority: true,
        firstResponseAt: true,
      },
    });
    if (ticket === null) {
      throw notFound();
    }
    return ticket;
  }

  private async isAgent(tx: Db, userId: string): Promise<boolean> {
    const count = await tx.membership.count({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        tenant: { kind: TenantKind.PLATFORM },
        roles: { some: { role: { permissions: { some: { permissionCode: 'ticket.comment' } } } } },
      },
    });
    return count > 0;
  }

  /** The order must belong to the ticket's customer; returns its number. */
  private async requireOrderOf(
    tx: Db,
    owner: { customerTenantId: string | null; customerUserId: string | null },
    serviceOrderId: string,
  ): Promise<string> {
    const order = await tx.serviceOrder.findFirst({
      where: {
        id: serviceOrderId,
        customerTenantId: owner.customerTenantId,
        customerUserId: owner.customerUserId,
      },
      select: { number: true },
    });
    if (order === null) {
      throw conflict('order_unknown');
    }
    return order.number;
  }
}
