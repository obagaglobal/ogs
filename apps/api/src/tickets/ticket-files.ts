import { MAX_TICKET_ATTACHMENTS } from '@ogs/contracts';
import { conflict } from '../common/domain-error.js';
import type { Db } from '../database/index.js';

export interface AttachTarget {
  readonly commentId?: string;
  readonly noteId?: string;
}

/**
 * Links uploaded files to a ticket (plan §2.3, T7): only `ticket.attachment`
 * files the caller uploaded, not yet attached anywhere. The
 * protect_ticket_attachment trigger repeats these checks and adds ownership
 * (public files belong to the customer, note files to OGS).
 */
export async function attachFiles(
  tx: Db,
  ticketId: string,
  fileIds: readonly string[],
  target: AttachTarget,
  uploaderId: string,
): Promise<void> {
  const unique = [...new Set(fileIds)];
  if (unique.length === 0) {
    return;
  }
  if (unique.length > MAX_TICKET_ATTACHMENTS) {
    throw conflict('too_many_attachments');
  }
  // Public files belong to the ticket's customer; note files to the PLATFORM tenant.
  const owner =
    target.noteId === undefined
      ? await tx.ticket.findUnique({
          where: { id: ticketId },
          select: { customerTenantId: true, customerUserId: true },
        })
      : await tx.tenant
          .findFirst({ where: { kind: 'PLATFORM' }, select: { id: true } })
          .then((platform) =>
            platform === null ? null : { customerTenantId: platform.id, customerUserId: null },
          );
  if (owner === null) {
    throw conflict('attachment_invalid');
  }
  const files = await tx.fileMetadata.findMany({
    where: {
      id: { in: unique },
      purpose: 'ticket.attachment',
      uploadedBy: uploaderId,
      status: { not: 'REJECTED' },
      ticketAttachment: null,
      tenantId: owner.customerTenantId,
      ownerUserId: owner.customerUserId,
    },
    select: { id: true },
  });
  if (files.length !== unique.length) {
    throw conflict('attachment_invalid');
  }
  await tx.ticketAttachment.createMany({
    data: unique.map((fileId) => ({
      ticketId,
      fileId,
      commentId: target.commentId ?? null,
      noteId: target.noteId ?? null,
    })),
  });
}
