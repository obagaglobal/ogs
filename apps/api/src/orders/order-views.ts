import { priceLabel, type Order, type Quotation, type ServiceRequest } from '@ogs/contracts';
import { forbiddenRule, notFound } from '../common/domain-error.js';
import type { AccessState } from '../access/access.types.js';
import { Prisma, TenantKind, type Db, type DbContext } from '../database/index.js';

const n = (value: bigint | null): number | null => (value === null ? null : Number(value));
const iso = (value: Date | null): string | null => value?.toISOString() ?? null;
const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

/** Who a customer request acts for (Phase 7 plan §2.3, P7-2, P7-9). */
export interface Customer {
  readonly ctx: DbContext;
  readonly userId: string;
  /** The organisation, or undefined for a person's own requests. */
  readonly tenantId?: string;
  readonly permissions: ReadonlySet<string>;
  /** The workspace header value, used to scope idempotency keys. */
  readonly scope: string;
}

/**
 * Personal workspace → the person (ADR-009); an ACTIVE organisation workspace →
 * the organisation. Provider, provider-company and platform workspaces are not
 * customers.
 */
export function customerOf(auth: AccessState): Customer {
  const workspace = auth.workspace;
  if (workspace === undefined) {
    throw forbiddenRule('workspace_forbidden');
  }
  const resolved = workspace.resolved;
  if (resolved.kind === 'personal') {
    return {
      ctx: workspace.context,
      userId: auth.user.id,
      permissions: new Set(),
      scope: 'personal',
    };
  }
  if (resolved.kind === TenantKind.ORGANISATION) {
    return {
      ctx: workspace.context,
      userId: auth.user.id,
      tenantId: resolved.tenantId,
      permissions: workspace.permissions,
      scope: resolved.tenantId,
    };
  }
  throw forbiddenRule('not_a_customer_workspace');
}

/** Admins (request.read_all) see the organisation's requests; members their own. */
export function requestScope(customer: Customer): { createdBy?: string } {
  if (customer.tenantId === undefined || customer.permissions.has('request.read_all')) {
    return {};
  }
  return { createdBy: customer.userId };
}

export const REQUEST_SELECT = {
  id: true,
  number: true,
  status: true,
  serviceId: true,
  serviceName: true,
  priceModel: true,
  unitAmountMinor: true,
  priceUnit: true,
  quantity: true,
  county: true,
  address: true,
  preferredFrom: true,
  preferredTo: true,
  description: true,
  contactPhone: true,
  cancelReason: true,
  customerTenantId: true,
  customerUserId: true,
  createdBy: true,
  createdAt: true,
  version: true,
  events: {
    select: { fromStatus: true, toStatus: true, command: true, reason: true, occurredAt: true },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ServiceRequestSelect;

/**
 * The full view of one request. RLS decides visibility (a customer never sees
 * draft quotations); `scope` adds the member/admin rule inside an organisation.
 */
export async function loadRequestView(
  tx: Db,
  id: string,
  scope: { createdBy?: string } = {},
): Promise<ServiceRequest> {
  const row = await tx.serviceRequest.findFirst({
    where: { id, ...scope },
    select: REQUEST_SELECT,
  });
  if (row === null) {
    throw notFound();
  }
  // The catalogue service may have been retired since: its slug is looked up, not required.
  const service = await tx.service.findUnique({
    where: { id: row.serviceId },
    select: { slug: true },
  });
  const quotations = await tx.quotation.findMany({
    where: { requestId: id },
    orderBy: { revision: 'desc' },
    select: {
      id: true,
      number: true,
      revision: true,
      status: true,
      validDays: true,
      notes: true,
      subtotalMinor: true,
      vatMinor: true,
      totalMinor: true,
      issuedAt: true,
      expiresAt: true,
      decidedAt: true,
      decisionReason: true,
      version: true,
      lines: {
        select: {
          position: true,
          description: true,
          quantity: true,
          unitAmountMinor: true,
          netMinor: true,
          vatMinor: true,
          totalMinor: true,
        },
        orderBy: { position: 'asc' },
      },
    },
  });
  const order = await tx.serviceOrder.findUnique({
    where: { requestId: id },
    select: {
      id: true,
      number: true,
      status: true,
      paymentTerms: true,
      netDays: true,
      subtotalMinor: true,
      vatMinor: true,
      totalMinor: true,
      paidMinor: true,
      refundDue: true,
      cancelReason: true,
      version: true,
      createdAt: true,
      events: {
        select: { fromStatus: true, toStatus: true, command: true, reason: true, occurredAt: true },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      },
      payments: {
        select: {
          id: true,
          amountMinor: true,
          method: true,
          reference: true,
          note: true,
          recordedAt: true,
        },
        orderBy: { recordedAt: 'asc' },
      },
    },
  });
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    service: { id: row.serviceId, name: row.serviceName, slug: service?.slug ?? '' },
    price: {
      model: row.priceModel,
      unitAmountMinor: n(row.unitAmountMinor),
      unit: row.priceUnit,
      label: priceLabel({
        model: row.priceModel,
        amountMinor: n(row.unitAmountMinor),
        unit: row.priceUnit,
        minQuantity: 1,
      }),
    },
    quantity: row.quantity,
    county: row.county,
    address: row.address,
    preferredFrom: day(row.preferredFrom),
    preferredTo: day(row.preferredTo),
    description: row.description,
    contactPhone: row.contactPhone,
    cancelReason: row.cancelReason,
    customerTenantId: row.customerTenantId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    history: row.events.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    quotations: quotations.map((q): Quotation => ({
      id: q.id,
      number: q.number,
      revision: q.revision,
      status: q.status,
      validDays: q.validDays,
      notes: q.notes,
      subtotalMinor: Number(q.subtotalMinor),
      vatMinor: Number(q.vatMinor),
      totalMinor: Number(q.totalMinor),
      issuedAt: iso(q.issuedAt),
      expiresAt: iso(q.expiresAt),
      decidedAt: iso(q.decidedAt),
      decisionReason: q.decisionReason,
      version: q.version,
      lines: q.lines.map((line) => ({
        position: line.position,
        description: line.description,
        quantity: line.quantity,
        unitAmountMinor: Number(line.unitAmountMinor),
        netMinor: Number(line.netMinor),
        vatMinor: Number(line.vatMinor),
        totalMinor: Number(line.totalMinor),
      })),
    })),
    order:
      order === null
        ? null
        : ({
            id: order.id,
            number: order.number,
            status: order.status,
            paymentTerms: order.paymentTerms,
            netDays: order.netDays,
            subtotalMinor: Number(order.subtotalMinor),
            vatMinor: Number(order.vatMinor),
            totalMinor: Number(order.totalMinor),
            paidMinor: Number(order.paidMinor),
            refundDue: order.refundDue,
            cancelReason: order.cancelReason,
            version: order.version,
            createdAt: order.createdAt.toISOString(),
            history: order.events.map((event) => ({
              ...event,
              occurredAt: event.occurredAt.toISOString(),
            })),
            payments: order.payments.map((payment) => ({
              id: payment.id,
              amountMinor: Number(payment.amountMinor),
              method: payment.method,
              reference: payment.reference,
              note: payment.note,
              recordedAt: payment.recordedAt.toISOString(),
            })),
          } satisfies Order),
  };
}
