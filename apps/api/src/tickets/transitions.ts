import { ACTIVE_TICKET_STATUSES, type TicketStatus } from '@ogs/contracts';
import { conflict } from '../common/domain-error.js';

/**
 * The ONE definition of what may happen to a ticket (Phase 8 plan §2.2).
 * Services consult it before every change and the T1 tests iterate over it, so
 * code and tests cannot drift. The `protect_ticket` trigger is a second,
 * independent guard on who may make each change.
 */
export type TicketActor = 'customer' | 'staff' | 'system';

export interface TicketTransition {
  readonly from: readonly TicketStatus[];
  /** null: the command does not change the status (details, comments, notes). */
  readonly to: TicketStatus | null;
  readonly actor: TicketActor;
  /** Staff commands: the permission (beyond the route's elevation) they need. */
  readonly permission?: string;
  /** Whether the activity row is shown to the customer. */
  readonly visibility: 'PUBLIC' | 'INTERNAL';
}

const ACTIVE = ACTIVE_TICKET_STATUSES;
const NOT_CLOSED: readonly TicketStatus[] = [...ACTIVE, 'RESOLVED'];

export const TICKET_COMMANDS = {
  // Creation (no from-state: the ticket starts as NEW).
  open: { from: [], to: 'NEW', actor: 'customer', visibility: 'PUBLIC' },
  openOnBehalf: {
    from: [],
    to: 'NEW',
    actor: 'staff',
    permission: 'ticket.create',
    visibility: 'PUBLIC',
  },
  // Staff status commands.
  triage: {
    from: ['NEW'],
    to: 'OPEN',
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'PUBLIC',
  },
  start: {
    from: ['NEW', 'OPEN'],
    to: 'IN_PROGRESS',
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'PUBLIC',
  },
  awaitCustomer: {
    from: ['OPEN', 'IN_PROGRESS'],
    to: 'AWAITING_CUSTOMER',
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'PUBLIC',
  },
  hold: {
    from: ['IN_PROGRESS'],
    to: 'ON_HOLD',
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'INTERNAL',
  },
  resume: {
    from: ['ON_HOLD'],
    to: 'IN_PROGRESS',
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'INTERNAL',
  },
  resolve: {
    from: ACTIVE,
    to: 'RESOLVED',
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'PUBLIC',
  },
  staffReopen: {
    from: ['RESOLVED'],
    to: 'IN_PROGRESS',
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'PUBLIC',
  },
  // Staff detail commands.
  setPriority: {
    from: NOT_CLOSED,
    to: null,
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'INTERNAL',
  },
  setCategory: {
    from: NOT_CLOSED,
    to: null,
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'INTERNAL',
  },
  linkOrder: {
    from: NOT_CLOSED,
    to: null,
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'INTERNAL',
  },
  take: {
    from: NOT_CLOSED,
    to: null,
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'INTERNAL',
  },
  assign: {
    from: NOT_CLOSED,
    to: null,
    actor: 'staff',
    permission: 'ticket.assign',
    visibility: 'INTERNAL',
  },
  staffComment: {
    from: NOT_CLOSED,
    to: null,
    actor: 'staff',
    permission: 'ticket.comment',
    visibility: 'PUBLIC',
  },
  internalNote: {
    from: NOT_CLOSED,
    to: null,
    actor: 'staff',
    permission: 'ticket.internal_note',
    visibility: 'INTERNAL',
  },
  // Customer commands.
  comment: { from: ACTIVE, to: null, actor: 'customer', visibility: 'PUBLIC' },
  reopen: { from: ['RESOLVED'], to: 'IN_PROGRESS', actor: 'customer', visibility: 'PUBLIC' },
  acceptResolution: { from: ['RESOLVED'], to: 'CLOSED', actor: 'customer', visibility: 'PUBLIC' },
  withdraw: { from: ACTIVE, to: 'CLOSED', actor: 'customer', visibility: 'PUBLIC' },
  // System.
  autoClose: { from: ['RESOLVED'], to: 'CLOSED', actor: 'system', visibility: 'PUBLIC' },
} as const satisfies Record<string, TicketTransition>;

export type TicketCommand = keyof typeof TICKET_COMMANDS;

/** A customer reply moves "awaiting customer" back to "in progress" (automatic). */
export const CUSTOMER_REPLY_MOVES: Partial<Record<TicketStatus, TicketStatus>> = {
  AWAITING_CUSTOMER: 'IN_PROGRESS',
};

/** Throws 409 invalid_transition unless `command` may run from `current`. */
export function requireTicketCommand(
  command: TicketCommand,
  current: TicketStatus,
): TicketTransition {
  const transition: TicketTransition = TICKET_COMMANDS[command];
  if (!transition.from.includes(current)) {
    throw conflict('invalid_transition');
  }
  return transition;
}

/** Staff status commands the web app offers as buttons, in display order. */
export const STAFF_STATUS_COMMANDS = [
  'triage',
  'start',
  'awaitCustomer',
  'hold',
  'resume',
  'resolve',
  'staffReopen',
] as const satisfies readonly TicketCommand[];
