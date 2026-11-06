import { Injectable } from '@nestjs/common';
import type {
  RequestStatus,
  ServiceRequest,
  ServiceRequestListResponse,
  submitServiceRequestSchema,
} from '@ogs/contracts';
import type { z } from 'zod';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, forbiddenRule, notFound } from '../common/domain-error.js';
import { TenantDb, type Db } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { loadRequestView, requestScope, type Customer } from './order-views.js';
import { idempotent, moveOrder, moveRequest, nextNumber } from './order-support.js';
import { requireOrderTransition, requireRequestTransition } from './transitions.js';

type Submitted = z.output<typeof submitServiceRequestSchema>;

/** The customer side of requests, quotations and orders (Phase 7 plan §2.3). */
@Injectable()
export class CustomerRequestsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Idempotent (P7-7). The price is snapshotted here; the client never sends one. */
  async submit(
    customer: Customer,
    input: Submitted,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    if (customer.tenantId !== undefined && !customer.permissions.has('request.create')) {
      throw forbiddenRule('permission_denied');
    }
    return this.db.run(customer.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: customer.userId,
          scope: customer.scope,
          route: 'POST /requests',
          body: input,
        },
        async () => {
          const service = await tx.service.findFirst({
            where: { slug: input.serviceSlug, status: 'PUBLISHED', category: { status: 'ACTIVE' } },
            select: {
              id: true,
              name: true,
              audience: true,
              prices: {
                select: { id: true, model: true, amountMinor: true, unit: true, minQuantity: true },
                orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
                take: 1,
              },
            },
          });
          const price = service?.prices[0];
          if (service === null || price === undefined) {
            throw conflict('service_unavailable');
          }
          if (
            (service.audience === 'ORGANISATIONS' && customer.tenantId === undefined) ||
            (service.audience === 'INDIVIDUALS' && customer.tenantId !== undefined)
          ) {
            throw conflict('audience_mismatch');
          }
          const perUnit = price.model === 'PER_UNIT';
          if (perUnit && input.quantity < price.minQuantity) {
            throw conflict('below_minimum_quantity');
          }
          if ((await tx.region.count({ where: { code: input.county, active: true } })) !== 1) {
            throw conflict('region_unknown');
          }
          const created = await tx.serviceRequest.create({
            data: {
              number: await nextNumber(tx, 'REQ'),
              customerTenantId: customer.tenantId ?? null,
              customerUserId: customer.tenantId === undefined ? customer.userId : null,
              createdBy: customer.userId,
              serviceId: service.id,
              servicePriceId: price.id,
              serviceName: service.name,
              priceModel: price.model,
              unitAmountMinor: price.amountMinor,
              priceUnit: price.unit,
              quantity: perUnit ? input.quantity : 1,
              county: input.county,
              address: input.address,
              preferredFrom:
                input.preferredFrom === undefined ? null : new Date(input.preferredFrom),
              preferredTo: input.preferredTo === undefined ? null : new Date(input.preferredTo),
              description: input.description,
              contactPhone: input.contactPhone,
            },
            select: { id: true, number: true },
          });
          await tx.serviceRequestEvent.createMany({
            data: [
              { requestId: created.id, fromStatus: null, toStatus: 'SUBMITTED', command: 'submit' },
            ],
          });
          await this.audit.record(tx, {
            action: 'request.submitted',
            tenantId: customer.tenantId ?? null,
            entityType: 'service_request',
            entityId: created.id,
            request: meta,
            metadata: { number: created.number, serviceId: service.id },
          });
          await this.outbox.publish(tx, {
            type: 'orders.request_submitted',
            tenantId: customer.tenantId ?? null,
            payload: { requestId: created.id },
          });
          return loadRequestView(tx, created.id);
        },
      ),
    );
  }

  async list(
    customer: Customer,
    status?: RequestStatus,
  ): Promise<ServiceRequestListResponse['requests']> {
    const rows = await this.db.run(customer.ctx, async (tx) =>
      tx.serviceRequest.findMany({
        where: {
          ...requestScope(customer),
          ...(customer.tenantId === undefined
            ? { customerUserId: customer.userId }
            : { customerTenantId: customer.tenantId }),
          ...(status === undefined ? {} : { status }),
        },
        select: {
          id: true,
          number: true,
          status: true,
          serviceId: true,
          serviceName: true,
          quantity: true,
          createdAt: true,
          customerTenantId: true,
          order: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
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
      customerName: null,
    }));
  }

  async get(customer: Customer, id: string): Promise<ServiceRequest> {
    return this.db.run(customer.ctx, async (tx) => this.view(tx, customer, id));
  }

  async cancel(
    customer: Customer,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    return this.db.run(customer.ctx, async (tx) => {
      const request = await this.row(tx, customer, id);
      const to = requireRequestTransition('cancel', request.status);
      await moveRequest(tx, { ...request, version }, 'cancel', to, reason);
      await this.record(tx, customer, 'request.cancelled', id, meta, { reason });
      await this.outbox.publish(tx, {
        type: 'orders.request_cancelled',
        tenantId: customer.tenantId ?? null,
        payload: { requestId: id },
      });
      return this.view(tx, customer, id);
    });
  }

  /** Idempotent (P7-7). Creates the order from the accepted quotation. */
  async acceptQuotation(
    customer: Customer,
    id: string,
    quotationId: string,
    version: number,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    this.requireQuotationRight(customer);
    return this.db.run(customer.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: customer.userId,
          scope: customer.scope,
          route: `POST /requests/${id}/quotations/${quotationId}/accept`,
          body: { version },
        },
        async () => {
          const request = await this.row(tx, customer, id);
          const to = requireRequestTransition('acceptQuotation', request.status);
          const quotation = await this.issuedQuotation(tx, id, quotationId);
          const accepted = await tx.quotation.updateMany({
            where: { id: quotationId, status: 'ISSUED', version, expiresAt: { gt: new Date() } },
            data: { status: 'ACCEPTED', decidedAt: new Date(), version: { increment: 1 } },
          });
          if (accepted.count !== 1) {
            throw conflict(
              quotation.expiresAt <= new Date() ? 'quotation_expired' : 'stale_version',
            );
          }
          await moveRequest(tx, request, 'acceptQuotation', to);
          const billing =
            customer.tenantId === undefined
              ? null
              : await tx.organisationBilling.findUnique({
                  where: { tenantId: customer.tenantId },
                  select: { paymentTerms: true, netDays: true },
                });
          const postpaid = billing?.paymentTerms === 'POSTPAID';
          const order = await tx.serviceOrder.create({
            data: {
              number: await nextNumber(tx, 'ORD'),
              requestId: id,
              quotationId,
              customerTenantId: customer.tenantId ?? null,
              customerUserId: customer.tenantId === undefined ? customer.userId : null,
              paymentTerms: postpaid ? 'POSTPAID' : 'PREPAY',
              netDays: postpaid ? billing.netDays : null,
              subtotalMinor: quotation.subtotalMinor,
              vatMinor: quotation.vatMinor,
              totalMinor: quotation.totalMinor,
              status: postpaid ? 'READY_FOR_ASSIGNMENT' : 'AWAITING_PAYMENT',
            },
            select: { id: true, number: true, status: true },
          });
          await tx.serviceOrderEvent.createMany({
            data: [
              { orderId: order.id, fromStatus: null, toStatus: order.status, command: 'create' },
            ],
          });
          await this.record(tx, customer, 'quotation.accepted', id, meta, {
            quotationId,
            orderNumber: order.number,
          });
          await this.outbox.publish(tx, {
            type: postpaid ? 'orders.order_confirmed' : 'orders.order_created',
            tenantId: customer.tenantId ?? null,
            payload: { requestId: id, orderId: order.id },
          });
          return this.view(tx, customer, id);
        },
      ),
    );
  }

  async rejectQuotation(
    customer: Customer,
    id: string,
    quotationId: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    this.requireQuotationRight(customer);
    return this.db.run(customer.ctx, async (tx) => {
      const request = await this.row(tx, customer, id);
      const to = requireRequestTransition('rejectQuotation', request.status);
      await this.issuedQuotation(tx, id, quotationId);
      const rejected = await tx.quotation.updateMany({
        where: { id: quotationId, status: 'ISSUED', version, expiresAt: { gt: new Date() } },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decisionReason: reason,
          version: { increment: 1 },
        },
      });
      if (rejected.count !== 1) {
        throw conflict('stale_version');
      }
      await moveRequest(tx, request, 'rejectQuotation', to, reason);
      await this.record(tx, customer, 'quotation.rejected', id, meta, { quotationId });
      return this.view(tx, customer, id);
    });
  }

  /** Customers may cancel an unpaid, prepaid order (refunds are Phase 11). */
  async cancelOrder(
    customer: Customer,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<ServiceRequest> {
    return this.db.run(customer.ctx, async (tx) => {
      await this.row(tx, customer, id);
      const order = await tx.serviceOrder.findUnique({
        where: { requestId: id },
        select: { id: true, status: true, paidMinor: true },
      });
      if (order === null) {
        throw notFound();
      }
      const to = requireOrderTransition('cancel', order.status);
      if (order.paidMinor > 0n) {
        throw conflict('order_partly_paid');
      }
      await moveOrder(tx, { ...order, version }, 'cancel', to, reason);
      await this.record(tx, customer, 'order.cancelled', id, meta, { orderId: order.id });
      await this.outbox.publish(tx, {
        type: 'orders.order_cancelled',
        tenantId: customer.tenantId ?? null,
        payload: { requestId: id, orderId: order.id },
      });
      return this.view(tx, customer, id);
    });
  }

  // --------------------------------------------------------------------------

  private requireQuotationRight(customer: Customer): void {
    if (customer.tenantId !== undefined && !customer.permissions.has('quotation.accept')) {
      throw forbiddenRule('permission_denied');
    }
  }

  private async row(tx: Db, customer: Customer, id: string) {
    const row = await tx.serviceRequest.findFirst({
      where: {
        id,
        ...requestScope(customer),
        ...(customer.tenantId === undefined
          ? { customerUserId: customer.userId }
          : { customerTenantId: customer.tenantId }),
      },
      select: { id: true, status: true, version: true },
    });
    if (row === null) {
      throw notFound();
    }
    return row;
  }

  private async issuedQuotation(tx: Db, requestId: string, quotationId: string) {
    const quotation = await tx.quotation.findFirst({
      where: { id: quotationId, requestId },
      select: {
        status: true,
        expiresAt: true,
        subtotalMinor: true,
        vatMinor: true,
        totalMinor: true,
      },
    });
    if (quotation === null) {
      throw notFound();
    }
    if (
      quotation.status === 'EXPIRED' ||
      (quotation.expiresAt !== null && quotation.expiresAt <= new Date())
    ) {
      throw conflict('quotation_expired');
    }
    if (quotation.status !== 'ISSUED') {
      throw conflict('invalid_transition');
    }
    return { ...quotation, expiresAt: quotation.expiresAt ?? new Date(0) };
  }

  private async view(tx: Db, customer: Customer, id: string): Promise<ServiceRequest> {
    await this.row(tx, customer, id);
    return loadRequestView(tx, id, requestScope(customer));
  }

  private async record(
    tx: Db,
    customer: Customer,
    action: string,
    requestId: string,
    meta: AuditRequestMeta,
    metadata: Record<string, string>,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      tenantId: customer.tenantId ?? null,
      entityType: 'service_request',
      entityId: requestId,
      request: meta,
      metadata,
    });
  }
}
