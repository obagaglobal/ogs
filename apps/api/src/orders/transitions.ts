import type { OrderStatus, RequestStatus } from '@ogs/contracts';
import { conflict } from '../common/domain-error.js';

/**
 * The ONE definition of what may happen to a request or an order (Phase 7
 * plan §2.2, review §9). Services consult it before every change, and the F1
 * tests iterate over it, so code and tests cannot drift apart. The database
 * triggers (protect_service_request / protect_service_order) are a second,
 * independent guard on who may make each change.
 */
export type Actor = 'customer' | 'staff' | 'finance' | 'system';

export interface Transition<S extends string> {
  readonly from: readonly S[];
  readonly to: S;
  readonly actor: Actor;
}

export const PRE_ORDER: readonly RequestStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'AWAITING_QUOTATION',
  'QUOTATION_ISSUED',
];

export const REQUEST_TRANSITIONS = {
  review: { from: ['SUBMITTED'], to: 'UNDER_REVIEW', actor: 'staff' },
  accept: { from: ['UNDER_REVIEW'], to: 'ORDERED', actor: 'staff' },
  needsQuotation: { from: ['UNDER_REVIEW'], to: 'AWAITING_QUOTATION', actor: 'staff' },
  issueQuotation: {
    from: ['AWAITING_QUOTATION', 'QUOTATION_ISSUED'],
    to: 'QUOTATION_ISSUED',
    actor: 'staff',
  },
  acceptQuotation: { from: ['QUOTATION_ISSUED'], to: 'ORDERED', actor: 'customer' },
  rejectQuotation: { from: ['QUOTATION_ISSUED'], to: 'AWAITING_QUOTATION', actor: 'customer' },
  expireQuotation: { from: ['QUOTATION_ISSUED'], to: 'AWAITING_QUOTATION', actor: 'system' },
  cancel: { from: PRE_ORDER, to: 'CANCELLED', actor: 'customer' },
  staffCancel: { from: PRE_ORDER, to: 'CANCELLED', actor: 'staff' },
} as const satisfies Record<string, Transition<RequestStatus>>;

export const ORDER_TRANSITIONS = {
  completePayment: { from: ['AWAITING_PAYMENT'], to: 'PAID', actor: 'finance' },
  release: { from: ['PAID'], to: 'READY_FOR_ASSIGNMENT', actor: 'system' },
  // Phase 9 (P9-10): the jobs worker moves the order with its job.
  startDelivery: { from: ['READY_FOR_ASSIGNMENT'], to: 'IN_DELIVERY', actor: 'system' },
  completeDelivery: { from: ['IN_DELIVERY'], to: 'COMPLETED', actor: 'system' },
  cancel: { from: ['AWAITING_PAYMENT'], to: 'CANCELLED', actor: 'customer' },
  staffCancel: {
    from: ['AWAITING_PAYMENT', 'PAID', 'READY_FOR_ASSIGNMENT', 'IN_DELIVERY'],
    to: 'CANCELLED',
    actor: 'finance',
  },
} as const satisfies Record<string, Transition<OrderStatus>>;

export type RequestCommand = keyof typeof REQUEST_TRANSITIONS;
export type OrderCommand = keyof typeof ORDER_TRANSITIONS;

/** Throws 409 invalid_transition unless `command` may run from `current`. */
export function requireRequestTransition(
  command: RequestCommand,
  current: RequestStatus,
): RequestStatus {
  const transition: Transition<RequestStatus> = REQUEST_TRANSITIONS[command];
  if (!transition.from.includes(current)) {
    throw conflict('invalid_transition');
  }
  return transition.to;
}

export function requireOrderTransition(command: OrderCommand, current: OrderStatus): OrderStatus {
  const transition: Transition<OrderStatus> = ORDER_TRANSITIONS[command];
  if (!transition.from.includes(current)) {
    throw conflict('invalid_transition');
  }
  return transition.to;
}
