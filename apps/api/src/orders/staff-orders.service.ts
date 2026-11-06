import { Injectable } from '@nestjs/common';
import {
  documentTotals,
  lineTotals,
  type BillingResponse,
  type OrderStatus,
  type RecordPayment,
  type RequestStatus,
  type saveQuotationDraftSchema,
  type ServiceRequest,
  type ServiceRequestListResponse,
} from '@ogs/contracts';
import type { z } from 'zod';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/domain-error.js';
import { Prisma, TenantDb, type Db, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { loadRequestView } from './order-views.js';
import { idempotent, moveOrder, moveRequest, nextNumber } from './order-support.js';
import { requireOrderTransition, requireRequestTransition } from './transitions.js';

type QuotationDraft = z.output<typeof saveQuotationDraftSchema>;
const DAY_MS = 86_400_000;
/** "Your quotation expires soon" goes out this long before expiry. */
export const EXPIRY_WARNING_MS = 48 * 3_600_000;

function platformUser(ctx: DbContext): string {
  if (ctx.kind !== 'platform') {
    throw notFound();
  }
  return ctx.userId;
}

/**
 * Staff decisions on requests and quotations (Phase 7 plan §2.4). Every method
 * runs in an elevated `platform` context (platform.quotation.issue).
 */
@Injectable()
export class StaffRequestsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async queue(
    ctx: DbContext,
    status?: RequestStatus,
  ): Promise<ServiceRequestListResponse['requests']> {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx.serviceRequest.findMany({
        where: status === undefined ? {} : { status },
        select: {
          id: true,
          number: true,
          status: true,
          serviceId: true,
          serviceName: true,
          quantity: true,
          createdAt: true,
          customerTenantId: true,
          customerUserId: true,
          order: { select: { status: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const names = await customerNames(
        tx,
        rows.map((row) => ({ tenantId: row.customerTenantId, userId: row.customerUserId })),
      );
      return rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        service: { id: row.serviceId, name: row.serviceName, slug: '' },
        quantity: row.quantity,
        createdAt: row.createdAt.toISOString(),
        customerTenantId: row.customerTenantId,
        orderStatus: row.order?.status ?? null,
        customerName: names.get(row.customerTenantId ?? row.customerUserId ?? '') ?? null,
      }));
    });
  }

  async detail(ctx: DbContext, id: string): Promise<ServiceRequest> {
    return this.db.run(ctx, async (tx) => loadRequestView(tx, id));
  }

  async review(
    ctx: DbContext,
    id: string,
    version: number,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    return this.decide(ctx, id, version, meta, async (tx, request) => {
      await moveRequest(tx, request, 'review', requireRequestTransition('review', request.status));
      return 'request.reviewed';
    });
  }

  async needsQuotation(
    ctx: DbContext,
    id: string,
    version: number,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    return this.decide(ctx, id, version, meta, async (tx, request) => {
      await moveRequest(
        tx,
        request,
        'needsQuotation',
        requireRequestTransition('needsQuotation', request.status),
      );
      return 'request.quotation_needed';
    });
  }

  async cancel(
    ctx: DbContext,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    return this.decide(ctx, id, version, meta, async (tx, request) => {
      await moveRequest(
        tx,
        request,
        'staffCancel',
        requireRequestTransition('staffCancel', request.status),
        reason,
      );
      await this.outbox.publish(tx, {
        type: 'orders.request_cancelled',
        tenantId: request.customerTenantId,
        payload: { requestId: id },
      });
      return 'request.cancelled_by_staff';
    });
  }

  /** Accept at the catalogue price snapshot: only for FIXED and PER_UNIT prices. */
  async accept(
    ctx: DbContext,
    id: string,
    version: number,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    return this.decide(ctx, id, version, meta, async (tx, request) => {
      const to = requireRequestTransition('accept', request.status);
      if (
        (request.priceModel !== 'FIXED' && request.priceModel !== 'PER_UNIT') ||
        request.unitAmountMinor === null
      ) {
        throw conflict('quotation_required');
      }
      const line = lineTotals({
        quantity: request.quantity,
        unitAmountMinor: Number(request.unitAmountMinor),
      });
      const totals = documentTotals([line]);
      await moveRequest(tx, request, 'accept', to);
      await createOrder(tx, request, null, totals, this.outbox);
      return 'request.accepted';
    });
  }

  /** Creates or replaces the single draft quotation of a request. */
  async saveDraft(
    ctx: DbContext,
    id: string,
    input: QuotationDraft,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    const userId = platformUser(ctx);
    return this.db.run(ctx, async (tx) => {
      const request = await requestRow(tx, id);
      if (request.status !== 'AWAITING_QUOTATION' && request.status !== 'QUOTATION_ISSUED') {
        throw conflict('invalid_transition');
      }
      const lines = input.lines.map((line, index) => ({
        ...line,
        position: index + 1,
        ...lineTotals(line),
      }));
      const totals = documentTotals(lines);
      const existing = await tx.quotation.findFirst({
        where: { requestId: id, status: 'DRAFT' },
        select: { id: true },
      });
      let quotationId: string;
      if (existing === null) {
        const last = await tx.quotation.aggregate({
          where: { requestId: id },
          _max: { revision: true },
        });
        const created = await tx.quotation.create({
          data: {
            number: await nextNumber(tx, 'QUO'),
            requestId: id,
            revision: (last._max.revision ?? 0) + 1,
            validDays: input.validDays,
            notes: input.notes,
            subtotalMinor: totals.subtotalMinor,
            vatMinor: totals.vatMinor,
            totalMinor: totals.totalMinor,
            createdBy: userId,
          },
          select: { id: true },
        });
        quotationId = created.id;
      } else {
        quotationId = existing.id;
        await tx.quotationLine.deleteMany({ where: { quotationId } });
        await tx.quotation.update({
          where: { id: quotationId },
          data: {
            validDays: input.validDays,
            notes: input.notes,
            subtotalMinor: totals.subtotalMinor,
            vatMinor: totals.vatMinor,
            totalMinor: totals.totalMinor,
            version: { increment: 1 },
          },
          select: { id: true },
        });
      }
      await tx.quotationLine.createMany({
        data: lines.map((line) => ({
          quotationId,
          position: line.position,
          description: line.description,
          quantity: line.quantity,
          unitAmountMinor: line.unitAmountMinor,
          netMinor: line.netMinor,
          vatMinor: line.vatMinor,
          totalMinor: line.totalMinor,
        })),
      });
      await this.audit.record(tx, {
        action: 'quotation.draft_saved',
        tenantId: request.customerTenantId,
        entityType: 'quotation',
        entityId: quotationId,
        request: meta,
        metadata: { lines: lines.length, totalMinor: totals.totalMinor },
      });
      return loadRequestView(tx, id);
    });
  }

  /** Issues the draft: supersedes the open quotation and schedules expiry (P7-3). */
  async issue(
    ctx: DbContext,
    id: string,
    quotationId: string,
    version: number,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    return this.db.run(ctx, async (tx) => {
      const request = await requestRow(tx, id);
      const to = requireRequestTransition('issueQuotation', request.status);
      const draft = await tx.quotation.findFirst({
        where: { id: quotationId, requestId: id, status: 'DRAFT', version },
        select: { validDays: true, totalMinor: true, _count: { select: { lines: true } } },
      });
      if (draft === null) {
        throw conflict('stale_version');
      }
      if (draft._count.lines === 0 || draft.totalMinor <= 0n) {
        throw conflict('quotation_empty');
      }
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + draft.validDays * DAY_MS);
      await tx.quotation.updateMany({
        where: { requestId: id, status: 'ISSUED' },
        data: { status: 'SUPERSEDED', decidedAt: issuedAt, version: { increment: 1 } },
      });
      await tx.quotation.update({
        where: { id: quotationId },
        data: { status: 'ISSUED', issuedAt, expiresAt, version: { increment: 1 } },
        select: { id: true },
      });
      await moveRequest(tx, request, 'issueQuotation', to);
      const tenantId = request.customerTenantId;
      await this.outbox.publish(tx, {
        type: 'orders.quotation_issued',
        tenantId,
        payload: { requestId: id, quotationId },
      });
      await this.outbox.publish(tx, {
        type: 'orders.quotation_expiry',
        tenantId,
        payload: { requestId: id, quotationId },
        availableAt: expiresAt,
      });
      const warnAt = new Date(expiresAt.getTime() - EXPIRY_WARNING_MS);
      if (warnAt > issuedAt) {
        await this.outbox.publish(tx, {
          type: 'orders.quotation_expiring',
          tenantId,
          payload: { requestId: id, quotationId },
          availableAt: warnAt,
        });
      }
      await this.audit.record(tx, {
        action: 'quotation.issued',
        tenantId,
        entityType: 'quotation',
        entityId: quotationId,
        request: meta,
        metadata: { expiresAt: expiresAt.toISOString() },
      });
      return loadRequestView(tx, id);
    });
  }

  private async decide(
    ctx: DbContext,
    id: string,
    version: number,
    meta: AuditRequestMeta,
    work: (tx: Db, request: Awaited<ReturnType<typeof requestRow>>) => Promise<string>,
  ): Promise<ServiceRequest> {
    platformUser(ctx);
    return this.db.run(ctx, async (tx) => {
      const request = { ...(await requestRow(tx, id)), version };
      const action = await work(tx, request);
      await this.audit.record(tx, {
        action,
        tenantId: request.customerTenantId,
        entityType: 'service_request',
        entityId: id,
        request: meta,
      });
      return loadRequestView(tx, id);
    });
  }
}

/**
 * Finance (Phase 7 plan §2.4, P7-4, P7-5): manual payments, order cancellation
 * and billing terms. Elevated `platform` context with platform.finance.manage.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async orders(ctx: DbContext, status?: OrderStatus) {
    return this.db.run(ctx, async (tx) => {
      const rows = await tx.serviceOrder.findMany({
        where: status === undefined ? {} : { status },
        select: {
          id: true,
          number: true,
          status: true,
          paymentTerms: true,
          totalMinor: true,
          paidMinor: true,
          refundDue: true,
          createdAt: true,
          customerTenantId: true,
          customerUserId: true,
          request: { select: { id: true, number: true, serviceName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const names = await customerNames(
        tx,
        rows.map((row) => ({ tenantId: row.customerTenantId, userId: row.customerUserId })),
      );
      return rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        paymentTerms: row.paymentTerms,
        totalMinor: Number(row.totalMinor),
        paidMinor: Number(row.paidMinor),
        refundDue: row.refundDue,
        createdAt: row.createdAt.toISOString(),
        requestId: row.request.id,
        requestNumber: row.request.number,
        serviceName: row.request.serviceName,
        customerName: names.get(row.customerTenantId ?? row.customerUserId ?? '') ?? null,
      }));
    });
  }

  /** Idempotent (P7-7); the order row is locked so concurrent payments never overpay. */
  async recordPayment(
    ctx: DbContext,
    orderId: string,
    input: RecordPayment,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    const userId = platformUser(ctx);
    return this.db.run(ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId,
          scope: 'platform',
          route: `POST /platform/orders/${orderId}/payments`,
          body: input,
        },
        async () => {
          await tx.$queryRaw`SELECT id FROM service_order WHERE id = ${orderId}::uuid FOR UPDATE`;
          const order = await tx.serviceOrder.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              status: true,
              version: true,
              totalMinor: true,
              paidMinor: true,
              requestId: true,
              customerTenantId: true,
            },
          });
          if (order === null) {
            throw notFound();
          }
          if (order.status !== 'AWAITING_PAYMENT') {
            throw conflict('invalid_transition');
          }
          const amount = BigInt(input.amountMinor);
          const paid = order.paidMinor + amount;
          if (paid > order.totalMinor) {
            throw conflict('overpayment');
          }
          try {
            await tx.payment.createMany({
              data: [
                {
                  orderId,
                  amountMinor: amount,
                  method: input.method,
                  reference: input.reference,
                  note: input.note ?? null,
                },
              ],
            });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              throw conflict('duplicate_reference');
            }
            throw error;
          }
          const complete = paid === order.totalMinor;
          if (complete) {
            const version = await moveOrder(
              tx,
              order,
              'completePayment',
              requireOrderTransition('completePayment', order.status),
              null,
              { paidMinor: paid },
            );
            await moveOrder(
              tx,
              { id: orderId, status: 'PAID', version },
              'release',
              requireOrderTransition('release', 'PAID'),
            );
          } else {
            const changed = await tx.serviceOrder.updateMany({
              where: { id: orderId, version: order.version },
              data: { paidMinor: paid, version: { increment: 1 } },
            });
            if (changed.count !== 1) {
              throw conflict('stale_version');
            }
          }
          await this.audit.record(tx, {
            action: 'payment.recorded',
            tenantId: order.customerTenantId,
            entityType: 'service_order',
            entityId: orderId,
            request: meta,
            metadata: {
              amountMinor: input.amountMinor,
              method: input.method,
              reference: input.reference,
            },
          });
          await this.outbox.publish(tx, {
            type: complete ? 'orders.order_confirmed' : 'orders.payment_recorded',
            tenantId: order.customerTenantId,
            payload: { requestId: order.requestId, orderId },
          });
          return loadRequestView(tx, order.requestId);
        },
      ),
    );
  }

  /** Staff cancellation; a paid order is marked "refund due" (refunds are Phase 11). */
  async cancelOrder(
    ctx: DbContext,
    orderId: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    platformUser(ctx);
    return this.db.run(ctx, async (tx) => {
      const order = await tx.serviceOrder.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          paidMinor: true,
          requestId: true,
          customerTenantId: true,
        },
      });
      if (order === null) {
        throw notFound();
      }
      const to = requireOrderTransition('staffCancel', order.status);
      await moveOrder(tx, { ...order, version }, 'staffCancel', to, reason, {
        refundDue: order.paidMinor > 0n,
      });
      await this.audit.record(tx, {
        action: 'order.cancelled_by_staff',
        tenantId: order.customerTenantId,
        entityType: 'service_order',
        entityId: orderId,
        reason,
        request: meta,
        metadata: { refundDue: order.paidMinor > 0n },
      });
      await this.outbox.publish(tx, {
        type: 'orders.order_cancelled',
        tenantId: order.customerTenantId,
        payload: { requestId: order.requestId, orderId },
      });
      return loadRequestView(tx, order.requestId);
    });
  }

  async billing(ctx: DbContext, tenantId: string): Promise<BillingResponse> {
    return this.db.run(ctx, async (tx) => {
      await organisationTenant(tx, tenantId);
      const row = await tx.organisationBilling.findUnique({
        where: { tenantId },
        select: { paymentTerms: true, netDays: true, version: true },
      });
      return {
        tenantId,
        paymentTerms: row?.paymentTerms ?? 'PREPAY',
        netDays: row?.netDays ?? null,
        version: row?.version ?? 0,
      };
    });
  }

  async setBilling(
    ctx: DbContext,
    tenantId: string,
    terms: { paymentTerms: 'PREPAY' | 'POSTPAID'; netDays: number | null },
    meta: AuditRequestMeta,
  ): Promise<BillingResponse> {
    return this.db.run(ctx, async (tx) => {
      await organisationTenant(tx, tenantId);
      const row = await tx.organisationBilling.upsert({
        where: { tenantId },
        create: { tenantId, paymentTerms: terms.paymentTerms, netDays: terms.netDays },
        update: {
          paymentTerms: terms.paymentTerms,
          netDays: terms.netDays,
          version: { increment: 1 },
        },
        select: { paymentTerms: true, netDays: true, version: true },
      });
      await this.audit.record(tx, {
        action: 'billing.terms_set',
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        request: meta,
        metadata: { paymentTerms: terms.paymentTerms, netDays: terms.netDays },
      });
      return { tenantId, ...row };
    });
  }
}

// ---------------------------------------------------------------- shared

async function requestRow(tx: Db, id: string) {
  const row = await tx.serviceRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      version: true,
      priceModel: true,
      unitAmountMinor: true,
      quantity: true,
      customerTenantId: true,
      customerUserId: true,
    },
  });
  if (row === null) {
    throw notFound();
  }
  return row;
}

async function organisationTenant(tx: Db, tenantId: string): Promise<void> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
  if (tenant?.kind !== 'ORGANISATION') {
    throw notFound();
  }
}

/** The order for an agreed price: terms come from the organisation's billing (P7-5). */
async function createOrder(
  tx: Db,
  request: { id: string; customerTenantId: string | null; customerUserId: string | null },
  quotationId: string | null,
  totals: { subtotalMinor: number; vatMinor: number; totalMinor: number },
  outbox: OutboxService,
): Promise<void> {
  const billing =
    request.customerTenantId === null
      ? null
      : await tx.organisationBilling.findUnique({
          where: { tenantId: request.customerTenantId },
          select: { paymentTerms: true, netDays: true },
        });
  const postpaid = billing?.paymentTerms === 'POSTPAID';
  const order = await tx.serviceOrder.create({
    data: {
      number: await nextNumber(tx, 'ORD'),
      requestId: request.id,
      quotationId,
      customerTenantId: request.customerTenantId,
      customerUserId: request.customerUserId,
      paymentTerms: postpaid ? 'POSTPAID' : 'PREPAY',
      netDays: postpaid ? billing.netDays : null,
      subtotalMinor: totals.subtotalMinor,
      vatMinor: totals.vatMinor,
      totalMinor: totals.totalMinor,
      status: postpaid ? 'READY_FOR_ASSIGNMENT' : 'AWAITING_PAYMENT',
    },
    select: { id: true, status: true },
  });
  await tx.serviceOrderEvent.createMany({
    data: [{ orderId: order.id, fromStatus: null, toStatus: order.status, command: 'create' }],
  });
  await outbox.publish(tx, {
    type: postpaid ? 'orders.order_confirmed' : 'orders.order_created',
    tenantId: request.customerTenantId,
    payload: { requestId: request.id, orderId: order.id },
  });
}

/** Organisation names and personal emails, for staff lists. */
async function customerNames(
  tx: Db,
  owners: readonly { tenantId: string | null; userId: string | null }[],
): Promise<Map<string, string>> {
  const tenantIds = [
    ...new Set(owners.map((o) => o.tenantId).filter((id): id is string => id !== null)),
  ];
  const userIds = [
    ...new Set(owners.map((o) => o.userId).filter((id): id is string => id !== null)),
  ];
  const tenants = await tx.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, name: true },
  });
  const users = await tx.appUser.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  return new Map([
    ...tenants.map((tenant): [string, string] => [tenant.id, tenant.name]),
    ...users.map((user): [string, string] => [user.id, user.email]),
  ]);
}
