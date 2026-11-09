import { FINAL_JOB_STATUSES, WORKING_JOB_STATUSES, type JobStatus } from '@ogs/contracts';
import { conflict } from '../common/domain-error.js';

/**
 * The ONE definition of what may happen to a job (Phase 9 plan §2.4). Services
 * consult it before every change and the T1 tests iterate over it, so code and
 * tests cannot drift. The protect_job* triggers are a second, independent guard.
 *
 * Actors:
 *  - staff: elevated OGS staff (dispatchers, service managers);
 *  - offeree: the addressee of the PENDING offer;
 *  - assignee: the holder of the ACTIVE assignment (technician, individual provider);
 *  - dispatcher: a provider company member with ticket.assign;
 *  - customer: the job's customer;
 *  - system: the jobs.* worker.
 */
export type JobActor = 'staff' | 'offeree' | 'assignee' | 'dispatcher' | 'customer' | 'system';

export interface JobTransition {
  readonly from: readonly JobStatus[];
  /** null: the command does not change the status (notes, photos, brief). */
  readonly to: JobStatus | null;
  readonly actor: JobActor;
  /** The permission the actor needs (staff: in the platform workspace; others: in theirs). */
  readonly permission?: string;
  /** Who sees the activity row besides staff. */
  readonly customerVisible: boolean;
  readonly providerVisible: boolean;
}

const WORKING = WORKING_JOB_STATUSES;
const NOT_FINAL: readonly JobStatus[] = [
  'QUEUED',
  'OFFERED',
  'ASSIGNED',
  'ON_THE_WAY',
  'IN_PROGRESS',
  'PAUSED',
  'AWAITING_CONFIRMATION',
];

export const JOB_COMMANDS = {
  // Creation (no from-state: a job starts QUEUED).
  create: {
    from: [],
    to: 'QUEUED',
    actor: 'system',
    customerVisible: true,
    providerVisible: false,
  },
  dispatchTicket: {
    from: [],
    to: 'QUEUED',
    actor: 'staff',
    permission: 'ticket.assign',
    customerVisible: true,
    providerVisible: false,
  },
  // Staff.
  editBrief: {
    from: NOT_FINAL,
    to: null,
    actor: 'staff',
    permission: 'ticket.assign',
    customerVisible: false,
    providerVisible: false,
  },
  offer: {
    from: ['QUEUED'],
    to: 'OFFERED',
    actor: 'staff',
    permission: 'ticket.assign',
    customerVisible: false,
    providerVisible: false,
  },
  withdraw: {
    from: ['OFFERED'],
    to: 'QUEUED',
    actor: 'staff',
    permission: 'ticket.assign',
    customerVisible: false,
    providerVisible: false,
  },
  reassign: {
    from: WORKING,
    to: 'QUEUED',
    actor: 'staff',
    permission: 'ticket.assign',
    customerVisible: true,
    providerVisible: false,
  },
  cancel: {
    from: NOT_FINAL,
    to: 'CANCELLED',
    actor: 'staff',
    permission: 'ticket.assign',
    customerVisible: true,
    providerVisible: false,
  },
  staffConfirm: {
    from: ['AWAITING_CONFIRMATION'],
    to: 'COMPLETED',
    actor: 'staff',
    permission: 'ticket.confirm_completion',
    customerVisible: true,
    providerVisible: false,
  },
  // The offeree.
  accept: {
    from: ['OFFERED'],
    to: 'ASSIGNED',
    actor: 'offeree',
    permission: 'assignment.respond',
    customerVisible: true,
    providerVisible: true,
  },
  decline: {
    from: ['OFFERED'],
    to: 'QUEUED',
    actor: 'offeree',
    permission: 'assignment.respond',
    customerVisible: false,
    providerVisible: false,
  },
  // The assignee.
  onTheWay: {
    from: ['ASSIGNED'],
    to: 'ON_THE_WAY',
    actor: 'assignee',
    permission: 'ticket.update_progress',
    customerVisible: true,
    providerVisible: true,
  },
  start: {
    from: ['ASSIGNED', 'ON_THE_WAY'],
    to: 'IN_PROGRESS',
    actor: 'assignee',
    permission: 'ticket.update_progress',
    customerVisible: true,
    providerVisible: true,
  },
  pause: {
    from: ['IN_PROGRESS'],
    to: 'PAUSED',
    actor: 'assignee',
    permission: 'ticket.update_progress',
    customerVisible: true,
    providerVisible: true,
  },
  resume: {
    from: ['PAUSED'],
    to: 'IN_PROGRESS',
    actor: 'assignee',
    permission: 'ticket.update_progress',
    customerVisible: true,
    providerVisible: true,
  },
  workNote: {
    from: [...WORKING, 'AWAITING_CONFIRMATION'],
    to: null,
    actor: 'assignee',
    permission: 'ticket.update_progress',
    customerVisible: false,
    providerVisible: true,
  },
  photo: {
    from: WORKING,
    to: null,
    actor: 'assignee',
    permission: 'ticket.update_progress',
    customerVisible: false,
    providerVisible: true,
  },
  submitReport: {
    from: ['IN_PROGRESS'],
    to: 'AWAITING_CONFIRMATION',
    actor: 'assignee',
    permission: 'ticket.update_progress',
    customerVisible: true,
    providerVisible: true,
  },
  // A provider company's dispatcher.
  changeTechnician: {
    from: WORKING,
    to: null,
    actor: 'dispatcher',
    permission: 'ticket.assign',
    customerVisible: false,
    providerVisible: true,
  },
  // The customer.
  confirm: {
    from: ['AWAITING_CONFIRMATION'],
    to: 'COMPLETED',
    actor: 'customer',
    customerVisible: true,
    providerVisible: true,
  },
  reportProblem: {
    from: ['AWAITING_CONFIRMATION'],
    to: 'IN_PROGRESS',
    actor: 'customer',
    customerVisible: true,
    providerVisible: true,
  },
  // The jobs worker.
  expire: {
    from: ['OFFERED'],
    to: 'QUEUED',
    actor: 'system',
    customerVisible: false,
    providerVisible: false,
  },
  autoConfirm: {
    from: ['AWAITING_CONFIRMATION'],
    to: 'COMPLETED',
    actor: 'system',
    customerVisible: true,
    providerVisible: false,
  },
} as const satisfies Record<string, JobTransition>;

export type JobCommand = keyof typeof JOB_COMMANDS;

/** Throws 409 invalid_transition unless `command` may run from `current`. */
export function requireJobCommand(command: JobCommand, current: JobStatus): JobTransition {
  const transition: JobTransition = JOB_COMMANDS[command];
  if (!transition.from.includes(current)) {
    throw conflict('invalid_transition');
  }
  return transition;
}

/** Whether `command` may run from `current` (for the `can` flags of responses). */
export function allows(command: JobCommand, current: JobStatus): boolean {
  const transition: JobTransition = JOB_COMMANDS[command];
  return transition.from.includes(current);
}

export function isFinal(status: JobStatus): boolean {
  return FINAL_JOB_STATUSES.includes(status);
}

/** Event kinds are the command names in snake case: `onTheWay` → `on_the_way`. */
export function eventKind(command: JobCommand): string {
  return command.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
