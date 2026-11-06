import { z } from 'zod';
import {
  moneyMinorSchema,
  priceModelSchema,
  priceUnitSchema,
  VAT_RATE_PERCENT,
} from './catalogue.js';
import { phoneSchema } from './organisations.js';
import { regionCodeSchema } from './providers.js';

/**
 * Phase 7: service requests, quotations, orders and manual payments.
 * Money is integer minor units (KES cents); VAT is computed per line and stored
 * (P7-6). The same helpers run in the API, the web app and the tests.
 */

// ---------------------------------------------------------------- money

/** VAT on one VAT-exclusive amount, rounded half up to the cent (P7-6). */
export function vatOn(netMinor: number): number {
  if (!Number.isSafeInteger(netMinor) || netMinor < 0) {
    throw new RangeError('netMinor must be a non-negative safe integer');
  }
  // Integer arithmetic: (net × rate + 50) ÷ 100, floored = round half up.
  return Math.floor((netMinor * VAT_RATE_PERCENT + 50) / 100);
}

export interface LineInput {
  readonly quantity: number;
  readonly unitAmountMinor: number;
}
export interface LineTotals {
  readonly netMinor: number;
  readonly vatMinor: number;
  readonly totalMinor: number;
}

export function lineTotals(line: LineInput): LineTotals {
  const netMinor = line.unitAmountMinor * line.quantity;
  if (!Number.isSafeInteger(netMinor)) {
    throw new RangeError('line amount is too large');
  }
  const vatMinor = vatOn(netMinor);
  return { netMinor, vatMinor, totalMinor: netMinor + vatMinor };
}

export interface DocumentTotals {
  readonly subtotalMinor: number;
  readonly vatMinor: number;
  readonly totalMinor: number;
}

/** Totals are sums of the stored line values, never recomputed differently. */
export function documentTotals(lines: readonly LineTotals[]): DocumentTotals {
  const subtotalMinor = lines.reduce((sum, line) => sum + line.netMinor, 0);
  const vatMinor = lines.reduce((sum, line) => sum + line.vatMinor, 0);
  return { subtotalMinor, vatMinor, totalMinor: subtotalMinor + vatMinor };
}

// ---------------------------------------------------------------- enums

export const requestStatusSchema = z.enum([
  'SUBMITTED',
  'UNDER_REVIEW',
  'AWAITING_QUOTATION',
  'QUOTATION_ISSUED',
  'ORDERED',
  'CANCELLED',
]);
export const quotationStatusSchema = z.enum([
  'DRAFT',
  'ISSUED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
]);
export const orderStatusSchema = z.enum([
  'AWAITING_PAYMENT',
  'PAID',
  'READY_FOR_ASSIGNMENT',
  'CANCELLED',
]);
export const paymentTermsSchema = z.enum(['PREPAY', 'POSTPAID']);
export const paymentMethodSchema = z.enum(['BANK_TRANSFER', 'MPESA_PAYBILL']);

export type RequestStatus = z.infer<typeof requestStatusSchema>;
export type QuotationStatus = z.infer<typeof quotationStatusSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** What customers see (review §9: a simplified label set). */
export const CUSTOMER_STATUS_LABELS: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Being reviewed',
  AWAITING_QUOTATION: 'Being reviewed',
  QUOTATION_ISSUED: 'Quotation ready',
  ORDERED: 'Ordered',
  CANCELLED: 'Cancelled',
};
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  READY_FOR_ASSIGNMENT: 'Confirmed',
  CANCELLED: 'Cancelled',
};

/** Header carrying the client's idempotency key (P7-7). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

// ---------------------------------------------------------------- requests

const isoDate = z.iso.date();
const reasonSchema = z.string().trim().min(5).max(500);

export const submitServiceRequestSchema = z
  .object({
    serviceSlug: z.string().trim().min(2).max(100),
    quantity: z.number().int().min(1).max(10_000).default(1),
    county: regionCodeSchema,
    address: z.string().trim().min(5).max(300),
    preferredFrom: isoDate.optional(),
    preferredTo: isoDate.optional(),
    description: z.string().trim().max(2000).default(''),
    contactPhone: phoneSchema,
  })
  .refine(
    (value) =>
      value.preferredFrom === undefined ||
      value.preferredTo === undefined ||
      value.preferredTo >= value.preferredFrom,
    { error: 'The end date must be on or after the start date', path: ['preferredTo'] },
  );
export type SubmitServiceRequest = z.input<typeof submitServiceRequestSchema>;

export const reasonBodySchema = z.object({ reason: reasonSchema });
export const versionBodySchema = z.object({ version: z.number().int().min(0) });
export const versionReasonBodySchema = versionBodySchema.extend({ reason: reasonSchema });

const historySchema = z.object({
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  command: z.string(),
  reason: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});

export const quotationLineSchema = z.object({
  position: z.number().int(),
  description: z.string(),
  quantity: z.number().int(),
  unitAmountMinor: moneyMinorSchema,
  netMinor: moneyMinorSchema,
  vatMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
});
export const quotationSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  revision: z.number().int(),
  status: quotationStatusSchema,
  validDays: z.number().int(),
  notes: z.string(),
  subtotalMinor: moneyMinorSchema,
  vatMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  issuedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionReason: z.string().nullable(),
  version: z.number().int(),
  lines: z.array(quotationLineSchema),
});
export type Quotation = z.infer<typeof quotationSchema>;

export const paymentSchema = z.object({
  id: z.uuid(),
  amountMinor: moneyMinorSchema,
  method: paymentMethodSchema,
  reference: z.string(),
  note: z.string().nullable(),
  recordedAt: z.iso.datetime(),
});

export const orderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: orderStatusSchema,
  paymentTerms: paymentTermsSchema,
  netDays: z.number().int().nullable(),
  subtotalMinor: moneyMinorSchema,
  vatMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  paidMinor: moneyMinorSchema,
  refundDue: z.boolean(),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  history: z.array(historySchema),
  payments: z.array(paymentSchema),
});
export type Order = z.infer<typeof orderSchema>;

export const serviceRequestSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: requestStatusSchema,
  service: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  price: z.object({
    model: priceModelSchema,
    unitAmountMinor: moneyMinorSchema.nullable(),
    unit: priceUnitSchema.nullable(),
    label: z.string(),
  }),
  quantity: z.number().int(),
  county: z.string(),
  address: z.string(),
  preferredFrom: isoDate.nullable(),
  preferredTo: isoDate.nullable(),
  description: z.string(),
  contactPhone: z.string(),
  cancelReason: z.string().nullable(),
  /** Organisation requests carry the tenant; personal requests are null. */
  customerTenantId: z.uuid().nullable(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  version: z.number().int(),
  history: z.array(historySchema),
  /** Issued (and later) quotations only; customers never see drafts. */
  quotations: z.array(quotationSchema),
  order: orderSchema.nullable(),
});
export type ServiceRequest = z.infer<typeof serviceRequestSchema>;

export const serviceRequestSummarySchema = serviceRequestSchema.pick({
  id: true,
  number: true,
  status: true,
  service: true,
  quantity: true,
  createdAt: true,
  customerTenantId: true,
});
export const serviceRequestListResponseSchema = z.object({
  requests: z.array(
    serviceRequestSummarySchema.extend({
      orderStatus: orderStatusSchema.nullable(),
      customerName: z.string().nullable(),
    }),
  ),
});
export type ServiceRequestListResponse = z.infer<typeof serviceRequestListResponseSchema>;

// ---------------------------------------------------------------- staff

export const quotationLineInputSchema = z.object({
  description: z.string().trim().min(2).max(300),
  quantity: z.number().int().min(1).max(100_000),
  unitAmountMinor: moneyMinorSchema,
});
export const saveQuotationDraftSchema = z.object({
  lines: z.array(quotationLineInputSchema).min(1).max(100),
  validDays: z.number().int().min(1).max(60).default(14),
  notes: z.string().trim().max(2000).default(''),
});
export type SaveQuotationDraft = z.input<typeof saveQuotationDraftSchema>;

export const recordPaymentSchema = z.object({
  amountMinor: moneyMinorSchema.refine((value) => value > 0, { error: 'Enter an amount' }),
  method: paymentMethodSchema,
  reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9/._-]{2,59}$/, {
      error: 'Letters, digits and / . _ - only (3–60 characters)',
    }),
  note: z.string().trim().max(300).optional(),
});
export type RecordPayment = z.infer<typeof recordPaymentSchema>;

export const billingTermsSchema = z
  .object({
    paymentTerms: paymentTermsSchema,
    netDays: z.number().int().min(1).max(120).nullable(),
  })
  .refine((value) => (value.paymentTerms === 'POSTPAID') === (value.netDays !== null), {
    error: 'Postpaid terms need net days; prepaid terms have none',
    path: ['netDays'],
  });
export const billingResponseSchema = z.object({
  tenantId: z.uuid(),
  paymentTerms: paymentTermsSchema,
  netDays: z.number().int().nullable(),
  version: z.number().int(),
});
export type BillingResponse = z.infer<typeof billingResponseSchema>;
