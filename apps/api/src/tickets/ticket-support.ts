import type { TicketStatus } from '@ogs/contracts';
import { conflict } from '../common/domain-error.js';
import type { Db, Prisma } from '../database/index.js';
import { TICKET_COMMANDS, type TicketCommand } from './transitions.js';

export interface TicketRef {
  readonly id: string;
  readonly status: TicketStatus;
  readonly version: number;
}

export interface EventFacts {
  readonly kind?: string;
  readonly fromValue?: string | null;
  readonly toValue?: string | null;
  readonly reason?: string | null;
}

/** Event kinds are the command names in snake case: `awaitCustomer` → `await_customer`. */
export function eventKind(command: TicketCommand): string {
  return command.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** Writes the ONE activity row of a command (review §13: activity log complete). */
export async function writeEvent(
  tx: Db,
  ticketId: string,
  command: TicketCommand,
  facts: EventFacts = {},
): Promise<void> {
  await tx.ticketEvent.createMany({
    data: [
      {
        ticketId,
        kind: facts.kind ?? eventKind(command),
        visibility: TICKET_COMMANDS[command].visibility,
        fromValue: facts.fromValue ?? null,
        toValue: facts.toValue ?? null,
        reason: facts.reason ?? null,
      },
    ],
  });
}

/**
 * Changes a ticket iff it is still at (status, version), bumping the version,
 * then writes the command's activity row. Throws 409 stale_version otherwise.
 */
export async function changeTicket(
  tx: Db,
  ticket: TicketRef,
  command: TicketCommand,
  data: Prisma.TicketUncheckedUpdateManyInput,
  facts: EventFacts = {},
): Promise<number> {
  const changed = await tx.ticket.updateMany({
    where: { id: ticket.id, status: ticket.status, version: ticket.version },
    data: { ...data, version: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw conflict('stale_version');
  }
  await writeEvent(tx, ticket.id, command, facts);
  return ticket.version + 1;
}

/** A status command: the `to` state from the table, plus any extra columns. */
export async function moveTicket(
  tx: Db,
  ticket: TicketRef,
  command: TicketCommand,
  to: TicketStatus,
  extra: Prisma.TicketUncheckedUpdateManyInput = {},
  reason: string | null = null,
): Promise<number> {
  return changeTicket(
    tx,
    ticket,
    command,
    { ...extra, status: to },
    { fromValue: ticket.status, toValue: to, reason },
  );
}
