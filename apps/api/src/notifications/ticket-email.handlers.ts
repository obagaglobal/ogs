import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REOPEN_WINDOW_MS } from '@ogs/contracts';
import { z } from 'zod';
import type { TypedConfigService } from '../config/env.js';
import { MembershipStatus, TenantDb, type Db, type DbContext } from '../database/index.js';
import type { EventEnvelope, EventHandler } from '../events/event.types.js';
import { TicketAutoCloseService } from '../tickets/ticket-auto-close.service.js';
import { deliverOnce } from './deliver-once.js';
import { EmailSender, type EmailMessage } from './email-sender.js';
import { templates } from './email-templates.js';

const payloadSchema = z.object({ ticketId: z.uuid() });

const nairobiDate = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * What a ticket email may use. Deliberately small: number, subject, status and
 * dates. No comment, note or resolution text is ever read here, so no email
 * can carry internal content (T2, T8).
 */
interface Facts {
  number: string;
  subject: string;
  status: string;
  priority: string | null;
  onBehalf: boolean;
  closure: string | null;
  resolvedAt: Date | null;
}

type Audience = 'customer' | 'assignee';

/**
 * Ticket emails (Phase 8 plan §2.6). Customer emails go to the requester (and,
 * for P1 tickets, the organisation's admins); staff emails go to the assignee.
 */
abstract class TicketEmailHandler implements EventHandler {
  abstract readonly type: string;
  protected readonly audience: Audience = 'customer';
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
  }

  protected abstract compose(facts: Facts): { subject: string; paragraphs: string[] } | null;

  async handle(envelope: EventEnvelope): Promise<void> {
    const { ticketId } = payloadSchema.parse(envelope.payload);
    const ctx: DbContext =
      envelope.tenantId === null
        ? { kind: 'system', job: 'tickets.notify' }
        : { kind: 'system', job: 'tickets.notify', tenantId: envelope.tenantId };
    await deliverOnce(this.db, ctx, envelope, this.sender, async (tx) => {
      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        select: {
          number: true,
          subject: true,
          status: true,
          priority: true,
          onBehalf: true,
          closure: true,
          resolvedAt: true,
          requesterUserId: true,
          assigneeUserId: true,
          customerTenantId: true,
        },
      });
      if (ticket === null) {
        return [];
      }
      const message = this.compose(ticket);
      if (message === null) {
        return [];
      }
      const recipients = new Set<string>();
      if (this.audience === 'assignee') {
        const email = await emailOf(tx, ticket.assigneeUserId);
        if (email !== null) {
          recipients.add(email);
        }
      } else {
        const email = await emailOf(tx, ticket.requesterUserId);
        if (email !== null) {
          recipients.add(email);
        }
        if (ticket.priority === 'P1' && ticket.customerTenantId !== null) {
          for (const admin of await adminEmails(tx, ticket.customerTenantId)) {
            recipients.add(admin);
          }
        }
      }
      const url =
        this.audience === 'assignee'
          ? `${this.base}/platform/tickets/${ticketId}`
          : `${this.base}/support/${ticketId}`;
      return [...recipients].map((email): EmailMessage =>
        templates.ticketNotice(email, message.subject, message.paragraphs, url),
      );
    });
  }
}

async function emailOf(tx: Db, userId: string | null): Promise<string | null> {
  if (userId === null) {
    return null;
  }
  const user = await tx.appUser.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

async function adminEmails(tx: Db, tenantId: string): Promise<string[]> {
  const members = await tx.membership.findMany({
    where: {
      tenantId,
      status: MembershipStatus.ACTIVE,
      roles: { some: { role: { code: 'org_admin', tenantId: null } } },
    },
    select: { user: { select: { email: true } } },
  });
  return members.map((member) => member.user.email);
}

@Injectable()
export class TicketOpenedEmail extends TicketEmailHandler {
  readonly type = 'tickets.opened';
  protected compose(f: Facts) {
    return f.onBehalf
      ? {
          subject: `OGS opened ticket ${f.number} for you`,
          paragraphs: [
            `OGS support opened ticket ${f.number} ("${f.subject}") on your behalf.`,
            'You can follow it and reply in OGS.',
          ],
        }
      : {
          subject: `We received your ticket ${f.number}`,
          paragraphs: [
            `Thank you. We received your ticket ${f.number} ("${f.subject}").`,
            'OGS support will look at it shortly. We will email you when we reply.',
          ],
        };
  }
}

@Injectable()
export class TicketRepliedEmail extends TicketEmailHandler {
  readonly type = 'tickets.staff_replied';
  protected compose(f: Facts) {
    return {
      subject: `New reply on ticket ${f.number}`,
      paragraphs: [
        `OGS support replied to your ticket ${f.number} ("${f.subject}").`,
        'Open OGS to read it.',
      ],
    };
  }
}

@Injectable()
export class TicketAwaitingCustomerEmail extends TicketEmailHandler {
  readonly type = 'tickets.awaiting_customer';
  protected compose(f: Facts) {
    if (f.status !== 'AWAITING_CUSTOMER') {
      return null;
    }
    return {
      subject: `We need your reply on ticket ${f.number}`,
      paragraphs: [
        `OGS support is waiting for your reply on ticket ${f.number} ("${f.subject}").`,
        'Open OGS to see what we need.',
      ],
    };
  }
}

@Injectable()
export class TicketResolvedEmail extends TicketEmailHandler {
  readonly type = 'tickets.resolved';
  protected compose(f: Facts) {
    if (f.status !== 'RESOLVED' || f.resolvedAt === null) {
      return null;
    }
    const until = new Date(f.resolvedAt.getTime() + REOPEN_WINDOW_MS);
    return {
      subject: `Ticket ${f.number} is resolved`,
      paragraphs: [
        `We resolved your ticket ${f.number} ("${f.subject}").`,
        `If the problem is not fixed, reopen it in OGS before ${nairobiDate.format(until)} (Kenya time). After that it closes.`,
      ],
    };
  }
}

@Injectable()
export class TicketClosedEmail extends TicketEmailHandler {
  readonly type = 'tickets.closed';
  protected compose(f: Facts) {
    if (f.status !== 'CLOSED') {
      return null;
    }
    return {
      subject: `Ticket ${f.number} is closed`,
      paragraphs: [
        f.closure === 'WITHDRAWN'
          ? `Ticket ${f.number} ("${f.subject}") was withdrawn and is now closed.`
          : `Ticket ${f.number} ("${f.subject}") is closed.`,
        'If you need more help, open a new ticket in OGS.',
      ],
    };
  }
}

@Injectable()
export class TicketAssignedEmail extends TicketEmailHandler {
  readonly type = 'tickets.assigned';
  protected override readonly audience: Audience = 'assignee';
  protected compose(f: Facts) {
    return {
      subject: `Ticket ${f.number} was assigned to you`,
      paragraphs: [`Ticket ${f.number} ("${f.subject}") is now yours.`],
    };
  }
}

@Injectable()
export class TicketCustomerRepliedEmail extends TicketEmailHandler {
  readonly type = 'tickets.customer_replied';
  protected override readonly audience: Audience = 'assignee';
  protected compose(f: Facts) {
    return {
      subject: `Customer replied on ticket ${f.number}`,
      paragraphs: [`The customer replied on ticket ${f.number} ("${f.subject}").`],
    };
  }
}

@Injectable()
export class TicketReopenedEmail extends TicketEmailHandler {
  readonly type = 'tickets.reopened';
  protected override readonly audience: Audience = 'assignee';
  protected compose(f: Facts) {
    return {
      subject: `Ticket ${f.number} was reopened`,
      paragraphs: [`The customer reopened ticket ${f.number} ("${f.subject}").`],
    };
  }
}

/** Not an email: the delayed auto-close event (P8-2) runs the idempotent close. */
@Injectable()
export class TicketAutoCloseHandler implements EventHandler {
  readonly type = 'tickets.auto_close';
  constructor(private readonly autoClose: TicketAutoCloseService) {}

  async handle(envelope: EventEnvelope): Promise<void> {
    const { ticketId } = payloadSchema.parse(envelope.payload);
    await this.autoClose.close(ticketId);
  }
}

export const PHASE_8_HANDLERS = [
  TicketOpenedEmail,
  TicketRepliedEmail,
  TicketAwaitingCustomerEmail,
  TicketResolvedEmail,
  TicketClosedEmail,
  TicketAssignedEmail,
  TicketCustomerRepliedEmail,
  TicketReopenedEmail,
  TicketAutoCloseHandler,
] as const;
