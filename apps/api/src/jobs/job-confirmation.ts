import { conflict, notFound } from '../common/domain-error.js';
import type { Db } from '../database/index.js';
import { moveJob } from './job-support.js';
import { requireJobCommand } from './transitions.js';

/**
 * Confirms a job's open report in the CUSTOMER's context (P9-7): the report is
 * CONFIRMED, the job COMPLETED and the assignment ended. Used by the confirm
 * route and by "Accept resolution" on a ticket. `version` null: any version,
 * and a job that is not awaiting confirmation is left alone.
 */
export async function confirmJob(
  tx: Db,
  jobId: string,
  version: number | null,
  userId: string,
): Promise<boolean> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, version: true },
  });
  if (job === null) {
    throw notFound();
  }
  if (version !== null && job.version !== version) {
    throw conflict('stale_version');
  }
  if (version === null && job.status !== 'AWAITING_CONFIRMATION') {
    return false;
  }
  requireJobCommand('confirm', job.status);
  const now = new Date();
  const decided = await tx.jobCompletion.updateMany({
    where: { jobId, outcome: null },
    data: { outcome: 'CONFIRMED', decidedAt: now, decidedBy: userId },
  });
  if (decided.count !== 1) {
    throw conflict('no_open_report');
  }
  const assignment = await tx.jobAssignment.findFirst({
    where: { jobId, status: 'ACTIVE' },
    select: { id: true },
  });
  await moveJob(
    tx,
    job,
    'confirm',
    'COMPLETED',
    { confirmedAt: now },
    {
      assignmentId: assignment?.id ?? null,
    },
  );
  if (assignment !== null) {
    await tx.jobAssignment.updateMany({
      where: { id: assignment.id, status: 'ACTIVE' },
      data: { status: 'ENDED', endReason: 'JOB_COMPLETED', endedAt: now, endedBy: userId },
    });
  }
  return true;
}

/** "Accept resolution" on a ticket confirms its job awaiting confirmation (P9-7). */
export async function confirmTicketJob(
  tx: Db,
  ticketId: string,
  userId: string,
): Promise<string | null> {
  const job = await tx.job.findFirst({
    where: { ticketId, status: 'AWAITING_CONFIRMATION' },
    select: { id: true },
  });
  if (job === null) {
    return null;
  }
  return (await confirmJob(tx, job.id, null, userId)) ? job.id : null;
}
