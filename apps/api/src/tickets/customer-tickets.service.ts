import { Injectable } from '@nestjs/common';
import {
  ACTIVE_TICKET_STATUSES,
  customerTicketListSchema,
  REOPEN_WINDOW_MS,
  TICKET_PAGE_SIZE,
  type CustomerTicket,
  type CustomerTicketList,
  type customerTicketFiltersSchema,
  type LinkableOrders,
  type openTicketSchema,
  type TicketCategory,
  type ticketCommentInputSchema,
} from '@ogs/contracts';
import type { z } from 'zod';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { nextNumber } from '../common/document-numbers.js';
import { conflict, forbiddenRule, notFound } from '../common/domain-error.js';
import {
  MembershipStatus,
  TenantDb,
  type Db,
  type DbContext,
  type Prisma,
} from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { FileService, type Download } from '../files/file.service.js';
import { RateLimiter } from '../identity/rate-limiter.js';
import { confirmTicketJob } from '../jobs/job-confirmation.js';
import { idempotent } from '../orders/order-support.js';
import type { Customer } from '../orders/order-views.js';
import { attachFiles } from './ticket-files.js';
import { changeTicket, moveTicket, writeEvent } from './ticket-support.js';
import { customerScope, loadCustomerTicket } from './ticket-views.js';
import { CUSTOMER_REPLY_MOVES, requireTicketCommand } from './transitions.js';

type OpenInput = z.output<typeof openTicketSchema>;
type CommentInput = z.output<typeof ticketCommentInputSchema>;
type Filters = z.output<typeof customerTicketFiltersSchema>;

/** Ticket categories for any signed-in context. */
export async function activeCategories(tx: Db): Promise<TicketCategory[]> {
  return tx.ticketCategory.findMany({
    where: { active: true },
    select: { code: true, name: true },
    orderBy: { position: 'asc' },
  });
}

export async function categoryId(tx: Db, code: string): Promise<string> {
  const category = await tx.ticketCategory.findFirst({
    where: { code, active: true },
    select: { id: true },
  });
  if (category === null) {
    throw conflict('category_unknown');
  }
  return category.id;
}

/**
 * The customer side of tickets (Phase 8 plan §2.3). Individuals act from the
 * personal workspace; organisation members need ticket.create / ticket.read /
 * ticket.comment. Every response goes through loadCustomerTicket, i.e. through
 * the customer schema: no internal data can be serialised here.
 */
@Injectable()
export class CustomerTicketsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly files: FileService,
    private readonly limiter: RateLimiter,
  ) {}

  async categories(ctx: DbContext): Promise<TicketCategory[]> {
    return this.db.run(ctx, activeCategories);
  }

  async list(customer: Customer, filters: Filters): Promise<CustomerTicketList> {
    requireCustomer(customer, 'ticket.read');
    return this.db.run(customer.ctx, async (tx) => {
      const scope = await customerScope(tx, customer);
      const status: Prisma.TicketWhereInput =
        filters.show === 'open'
          ? { status: { in: [...ACTIVE_TICKET_STATUSES] } }
          : filters.show === 'resolved'
            ? { status: { in: ['RESOLVED', 'CLOSED'] } }
            : {};
      const where: Prisma.TicketWhereInput = { AND: [scope.where, status] };
      const [rows, total] = await Promise.all([
        tx.ticket.findMany({
          where,
          select: {
            id: true,
            number: true,
            subject: true,
            status: true,
            urgency: true,
            requesterUserId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (filters.page - 1) * TICKET_PAGE_SIZE,
          take: TICKET_PAGE_SIZE,
        }),
        tx.ticket.count({ where }),
      ]);
      const requesters = await tx.appUser.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.requesterUserId))] } },
        select: { id: true, email: true },
      });
      const email = new Map(requesters.map((user) => [user.id, user.email]));
      return customerTicketListSchema.parse({
        tickets: rows.map((row) => ({
          id: row.id,
          number: row.number,
          subject: row.subject,
          status: row.status,
          urgency: row.urgency,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          requesterLabel:
            row.requesterUserId === customer.userId
              ? 'You'
              : (email.get(row.requesterUserId) ?? 'Customer'),
        })),
        total,
        page: filters.page,
        pageSize: TICKET_PAGE_SIZE,
      });
    });
  }

  async get(customer: Customer, id: string): Promise<CustomerTicket> {
    requireCustomer(customer, 'ticket.read');
    return this.db.run(customer.ctx, async (tx) => loadCustomerTicket(tx, customer, id));
  }

  /** Orders the customer may link a ticket to (their own, not cancelled). */
  async linkableOrders(customer: Customer): Promise<LinkableOrders> {
    requireCustomer(customer, 'ticket.create');
    return this.db.run(customer.ctx, async (tx) => {
      const orders = await tx.serviceOrder.findMany({
        where: {
          ...(customer.tenantId === undefined
            ? { customerUserId: customer.userId }
            : {
                customerTenantId: customer.tenantId,
                ...(customer.permissions.has('request.read_all')
                  ? {}
                  : { request: { createdBy: customer.userId } }),
              }),
          status: { not: 'CANCELLED' },
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

  /** Idempotent (P7-7). The ticket starts NEW, with no priority or assignee. */
  async open(
    customer: Customer,
    input: OpenInput,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<CustomerTicket> {
    requireCustomer(customer, 'ticket.create');
    await this.limiter.consume('ticketsPerUser', customer.userId);
    return this.db.run(customer.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: customer.userId,
          scope: customer.scope,
          route: 'POST /tickets',
          body: input,
        },
        async () => {
          let departmentId: string | null = null;
          if (customer.tenantId !== undefined) {
            const membership = await tx.membership.findFirst({
              where: {
                tenantId: customer.tenantId,
                userId: customer.userId,
                status: MembershipStatus.ACTIVE,
              },
              select: { departmentId: true },
            });
            departmentId = membership?.departmentId ?? null;
          }
          await this.checkLinks(tx, customer, input);
          const created = await tx.ticket.create({
            data: {
              number: await nextNumber(tx, 'TCK'),
              customerTenantId: customer.tenantId ?? null,
              customerUserId: customer.tenantId === undefined ? customer.userId : null,
              requesterUserId: customer.userId,
              departmentId,
              createdBy: customer.userId,
              type: input.type,
              categoryId: await categoryId(tx, input.categoryCode),
              subject: input.subject,
              description: input.description,
              urgency: input.urgency,
              serviceOrderId: input.serviceOrderId ?? null,
              relatedTicketId: input.relatedTicketId ?? null,
            },
            select: { id: true, number: true },
          });
          await attachFiles(tx, created.id, input.attachmentIds, {}, customer.userId);
          await writeEvent(tx, created.id, 'open', { kind: 'created', toValue: 'NEW' });
          await this.audit.record(tx, {
            action: 'ticket.opened',
            tenantId: customer.tenantId ?? null,
            entityType: 'ticket',
            entityId: created.id,
            request: meta,
            metadata: { number: created.number },
          });
          await this.outbox.publish(tx, {
            type: 'tickets.opened',
            tenantId: customer.tenantId ?? null,
            payload: { ticketId: created.id },
          });
          return loadCustomerTicket(tx, customer, created.id);
        },
      ),
    );
  }

  /** A public reply; it moves "awaiting customer" back to "in progress". */
  async comment(
    customer: Customer,
    id: string,
    input: CommentInput,
    meta: AuditRequestMeta,
  ): Promise<CustomerTicket> {
    requireCustomer(customer, 'ticket.comment');
    await this.limiter.consume('ticketCommentsPerUser', customer.userId);
    return this.db.run(customer.ctx, async (tx) => {
      const ticket = await this.visible(tx, customer, id);
      requireTicketCommand('comment', ticket.status);
      const comment = await tx.ticketComment.create({
        data: { ticketId: id, side: 'CUSTOMER', body: input.body },
        select: { id: true },
      });
      await attachFiles(tx, id, input.attachmentIds, { commentId: comment.id }, customer.userId);
      const to = CUSTOMER_REPLY_MOVES[ticket.status];
      if (to === undefined) {
        await tx.ticket.updateMany({ where: { id }, data: { updatedAt: new Date() } });
        await writeEvent(tx, id, 'comment');
      } else {
        await changeTicket(
          tx,
          ticket,
          'comment',
          { status: to },
          { fromValue: ticket.status, toValue: to },
        );
      }
      await this.audit.record(tx, {
        action: 'ticket.commented',
        tenantId: customer.tenantId ?? null,
        entityType: 'ticket',
        entityId: id,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'tickets.customer_replied',
        tenantId: customer.tenantId ?? null,
        payload: { ticketId: id },
      });
      return loadCustomerTicket(tx, customer, id);
    });
  }

  /** Within REOPEN_WINDOW_DAYS of the resolution (P8-2); the trigger checks it too. */
  async reopen(
    customer: Customer,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<CustomerTicket> {
    return this.decide(customer, id, version, meta, 'ticket.reopened', async (tx, ticket) => {
      const transition = requireTicketCommand('reopen', ticket.status);
      if (
        ticket.resolvedAt === null ||
        ticket.resolvedAt.getTime() + REOPEN_WINDOW_MS <= Date.now()
      ) {
        throw conflict('reopen_window_passed');
      }
      await moveTicket(
        tx,
        ticket,
        'reopen',
        transition.to ?? 'IN_PROGRESS',
        { resolvedAt: null, resolution: null, reopenCount: { increment: 1 } },
        reason,
      );
      return 'tickets.reopened';
    });
  }

  async acceptResolution(
    customer: Customer,
    id: string,
    version: number,
    meta: AuditRequestMeta,
  ): Promise<CustomerTicket> {
    return this.decide(
      customer,
      id,
      version,
      meta,
      'ticket.resolution_accepted',
      async (tx, ticket) => {
        requireTicketCommand('acceptResolution', ticket.status);
        await moveTicket(tx, ticket, 'acceptResolution', 'CLOSED', {
          closure: 'ACCEPTED',
          closedAt: new Date(),
        });
        // Phase 9 (P9-7): accepting the resolution also confirms the ticket's
        // job, if its report is waiting. The customer is never asked twice.
        const jobId = await confirmTicketJob(tx, id, customer.userId);
        if (jobId !== null) {
          await this.audit.record(tx, {
            action: 'job.confirmed',
            tenantId: customer.tenantId ?? null,
            entityType: 'job',
            entityId: jobId,
            request: meta,
          });
          await this.outbox.publish(tx, {
            type: 'jobs.completed',
            tenantId: customer.tenantId ?? null,
            payload: { jobId },
          });
        }
        return 'tickets.closed';
      },
    );
  }

  async withdraw(
    customer: Customer,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<CustomerTicket> {
    return this.decide(customer, id, version, meta, 'ticket.withdrawn', async (tx, ticket) => {
      requireTicketCommand('withdraw', ticket.status);
      await moveTicket(
        tx,
        ticket,
        'withdraw',
        'CLOSED',
        { closure: 'WITHDRAWN', closureReason: reason, closedAt: new Date() },
        reason,
      );
      return 'tickets.closed';
    });
  }

  /** A public attachment of a ticket the customer can see (never a note's file). */
  async download(customer: Customer, id: string, attachmentId: string): Promise<Download> {
    requireCustomer(customer, 'ticket.read');
    const fileId = await this.db.run(customer.ctx, async (tx) => {
      await this.visible(tx, customer, id);
      const attachment = await tx.ticketAttachment.findFirst({
        where: { id: attachmentId, ticketId: id, noteId: null },
        select: { fileId: true },
      });
      if (attachment === null) {
        throw notFound();
      }
      return attachment.fileId;
    });
    return this.files.downloadUrl(customer.ctx, fileId);
  }

  // ---------------------------------------------------------------- internals

  private async decide(
    customer: Customer,
    id: string,
    version: number,
    meta: AuditRequestMeta,
    action: string,
    work: (tx: Db, ticket: VisibleTicket) => Promise<string>,
  ): Promise<CustomerTicket> {
    requireCustomer(customer, 'ticket.read');
    return this.db.run(customer.ctx, async (tx) => {
      const ticket = await this.visible(tx, customer, id);
      const scope = await customerScope(tx, customer);
      if (!scope.decides(ticket.requesterUserId)) {
        throw forbiddenRule('permission_denied');
      }
      if (ticket.version !== version) {
        throw conflict('stale_version');
      }
      const event = await work(tx, ticket);
      await this.audit.record(tx, {
        action,
        tenantId: customer.tenantId ?? null,
        entityType: 'ticket',
        entityId: id,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: event,
        tenantId: customer.tenantId ?? null,
        payload: { ticketId: id },
      });
      return loadCustomerTicket(tx, customer, id);
    });
  }

  private async visible(tx: Db, customer: Customer, id: string): Promise<VisibleTicket> {
    const scope = await customerScope(tx, customer);
    const ticket = await tx.ticket.findFirst({
      where: { AND: [{ id }, scope.where] },
      select: { id: true, status: true, version: true, requesterUserId: true, resolvedAt: true },
    });
    if (ticket === null) {
      throw notFound();
    }
    return ticket;
  }

  private async checkLinks(tx: Db, customer: Customer, input: OpenInput): Promise<void> {
    const own =
      customer.tenantId === undefined
        ? { customerUserId: customer.userId }
        : { customerTenantId: customer.tenantId };
    if (
      input.serviceOrderId !== undefined &&
      (await tx.serviceOrder.count({ where: { id: input.serviceOrderId, ...own } })) !== 1
    ) {
      throw conflict('order_unknown');
    }
    if (input.relatedTicketId !== undefined) {
      const scope = await customerScope(tx, customer);
      const related = await tx.ticket.count({
        where: { AND: [{ id: input.relatedTicketId }, scope.where] },
      });
      if (related !== 1) {
        throw conflict('related_ticket_unknown');
      }
    }
  }
}

interface VisibleTicket {
  id: string;
  status: CustomerTicket['status'];
  version: number;
  requesterUserId: string;
  resolvedAt: Date | null;
}

/** Organisation members need the permission; a person in their own workspace always may. */
function requireCustomer(customer: Customer, permission: string): void {
  if (customer.tenantId !== undefined && !customer.permissions.has(permission)) {
    throw forbiddenRule('permission_denied');
  }
}
