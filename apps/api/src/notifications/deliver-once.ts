import type { Db, DbContext, TenantDb } from '../database/index.js';
import type { EventEnvelope } from '../events/event.types.js';
import type { EmailMessage, EmailSender } from './email-sender.js';

/**
 * Sends the emails for one outbox event at most once (Phase 3 plan §2.6):
 *  1. one transaction: skip if this event was already SENT, otherwise build the
 *     messages (minting any tokens) and mark the delivery PENDING;
 *  2. send, outside any transaction;
 *  3. mark SENT.
 * A crash between 2 and 3 can resend once; an email is never silently lost.
 */
export async function deliverOnce(
  db: TenantDb,
  ctx: DbContext,
  envelope: EventEnvelope,
  sender: EmailSender,
  compose: (tx: Db) => Promise<readonly EmailMessage[]>,
  userId: string | null = null,
): Promise<number> {
  const messages = await db.run(ctx, async (tx) => {
    const delivery = await tx.notificationDelivery.findUnique({
      where: { eventId: envelope.eventId },
      select: { status: true },
    });
    if (delivery?.status === 'SENT') {
      return [];
    }
    const built = await compose(tx);
    await tx.notificationDelivery.upsert({
      where: { eventId: envelope.eventId },
      create: { eventId: envelope.eventId, kind: envelope.type, userId },
      update: {},
    });
    return built;
  });
  for (const message of messages) {
    await sender.send(message);
  }
  await db.run(ctx, async (tx) =>
    tx.notificationDelivery.updateMany({
      where: { eventId: envelope.eventId },
      data: { status: 'SENT', sentAt: new Date() },
    }),
  );
  return messages.length;
}
