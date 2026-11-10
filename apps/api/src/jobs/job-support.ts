import type { JobStatus } from '@ogs/contracts';
import { conflict, unprocessable } from '../common/domain-error.js';
import type { Db, Prisma } from '../database/index.js';
import { eventKind, JOB_COMMANDS, type JobCommand } from './transitions.js';

export interface JobRef {
  readonly id: string;
  readonly status: JobStatus;
  readonly version: number;
}

export interface JobEventFacts {
  readonly kind?: string;
  readonly assignmentId?: string | null;
  readonly fromValue?: string | null;
  readonly toValue?: string | null;
  readonly reason?: string | null;
}

/** Writes the ONE activity row of a command (review §13: audit trail complete). */
export async function writeJobEvent(
  tx: Db,
  jobId: string,
  command: JobCommand,
  facts: JobEventFacts = {},
): Promise<void> {
  const transition = JOB_COMMANDS[command];
  const assignmentId = facts.assignmentId ?? null;
  await tx.jobEvent.createMany({
    data: [
      {
        jobId,
        assignmentId,
        kind: facts.kind ?? eventKind(command),
        fromValue: facts.fromValue ?? null,
        toValue: facts.toValue ?? null,
        reason: facts.reason ?? null,
        customerVisible: transition.customerVisible,
        // A provider-visible row needs an assignment (CHECK): without one it is staff-only.
        providerVisible: transition.providerVisible && assignmentId !== null,
      },
    ],
  });
}

/**
 * Changes a job iff it is still at (status, version), bumping the version,
 * then writes the command's activity row. Throws 409 stale_version otherwise.
 */
export async function changeJob(
  tx: Db,
  job: JobRef,
  command: JobCommand,
  data: Prisma.JobUncheckedUpdateManyInput,
  facts: JobEventFacts = {},
): Promise<number> {
  const changed = await tx.job.updateMany({
    where: { id: job.id, status: job.status, version: job.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw conflict('stale_version');
  }
  await writeJobEvent(tx, job.id, command, facts);
  return job.version + 1;
}

/** A status command: the `to` state, plus any extra columns. */
export async function moveJob(
  tx: Db,
  job: JobRef,
  command: JobCommand,
  to: JobStatus,
  extra: Prisma.JobUncheckedUpdateManyInput = {},
  facts: Omit<JobEventFacts, 'fromValue' | 'toValue'> = {},
): Promise<number> {
  return changeJob(
    tx,
    job,
    command,
    { ...extra, status: to },
    { ...facts, fromValue: job.status, toValue: to },
  );
}

/**
 * There is no name field yet (Phase 6b): a person's first name is the first
 * alphabetic part of their email's local part, as for "Habari {name}".
 */
export function firstNameOf(email: string): string | null {
  const local = email.split('@')[0] ?? '';
  const part = local.split(/[^A-Za-z]+/).find((piece) => piece.length >= 2);
  if (part === undefined) {
    return null;
  }
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

export function initialsOf(name: string | null): string {
  if (name === null || name.trim() === '') {
    return 'T';
  }
  const words = name.trim().split(/\s+/);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2);
  return letters.toUpperCase();
}

/** The first word of an individual provider's display name. */
export function firstWord(name: string): string | null {
  const word = name.trim().split(/\s+/)[0];
  return word === undefined || word === '' ? null : word;
}

/**
 * The job_offer and job_assignment triggers refuse an ineligible assignee with
 * this message (plan §2.3). Services check first; this maps a lost race to 422.
 */
export function isEligibilityViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('not eligible for this job');
}

export function notEligible() {
  return unprocessable('not_eligible');
}

/** The label of who holds or is offered a job, for staff. */
export function assigneeLabel(
  kind: 'INTERNAL' | 'INDIVIDUAL' | 'COMPANY',
  providerName: string | null,
): string {
  if (kind === 'INTERNAL') {
    return 'OGS technician';
  }
  return providerName ?? (kind === 'COMPANY' ? 'Provider company' : 'Individual provider');
}
