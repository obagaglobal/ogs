import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatKes } from '@ogs/contracts';
import { z } from 'zod';
import type { TypedConfigService } from '../config/env.js';
import { MembershipStatus, TenantDb, type Db, type DbContext } from '../database/index.js';
import type { EventEnvelope, EventHandler } from '../events/event.types.js';
import { QuotationExpiryService } from '../orders/quotation-expiry.service.js';
import { deliverOnce } from './deliver-once.js';
import { EmailSender, type EmailMessage } from './email-sender.js';
import { templates } from './email-templates.js';

const payloadSchema = z.object({
  requestId: z.uuid(),
  quotationId: z.uuid().optional(),
  orderId: z.uuid().optional(),
});
type Payload = z.infer<typeof payloadSchema>;

const nairobiDate = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Everything an order email may need, read fresh when the event is handled. */
interface Facts {
  number: string;
  serviceName: string;
  status: string;
  cancelReason: string | null;
  quotation: {
    number: string;
    status: string;
    totalMinor: bigint;
    expiresAt: Date | null;
  } | null;
  order: {
    number: string;
    status: string;
    totalMinor: bigint;
    paidMinor: bigint;
    cancelReason: string | null;
    refundDue: boolean;
  } | null;
}

/**
 * Customer emails for Phase 7 (plan §2.6). Each event type has one handler;
 * they share loading, recipients and once-only delivery. Recipients: the person
 * who raised the request, plus the organisation's admins for quotation emails.
 */
abstract class OrderEmailHandler implements EventHandler {
  abstract readonly type: string;
  /** Quotation emails also go to the organisation's admins (who may accept them). */
  protected readonly toAdmins: boolean = false;
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
  }

  /** Subject and paragraphs, or null to send nothing (e.g. the situation changed). */
  protected abstract compose(facts: Facts): { subject: string; paragraphs: string[] } | null;

  async handle(envelope: EventEnvelope): Promise<void> {
    const payload = payloadSchema.parse(envelope.payload);
    const ctx: DbContext =
      envelope.tenantId === null
        ? { kind: 'system', job: 'orders.notify' }
        : { kind: 'system', job: 'orders.notify', tenantId: envelope.tenantId };
    await deliverOnce(this.db, ctx, envelope, this.sender, async (tx) => {
      const loaded = await this.load(tx, payload);
      if (loaded === null) {
        return [];
      }
      const message = this.compose(loaded.facts);
      if (message === null) {
        return [];
      }
      const recipients = new Set(loaded.requester === null ? [] : [loaded.requester]);
      if (this.toAdmins && envelope.tenantId !== null) {
        for (const email of await adminEmails(tx, envelope.tenantId)) {
          recipients.add(email);
        }
      }
      const url = `${this.base}/requests/${payload.requestId}`;
      return [...recipients].map((email): EmailMessage =>
        templates.orderNotice(email, message.subject, message.paragraphs, url),
      );
    });
  }

  private async load(
    tx: Db,
    payload: Payload,
  ): Promise<{ facts: Facts; requester: string | null } | null> {
    const request = await tx.serviceRequest.findUnique({
      where: { id: payload.requestId },
      select: {
        number: true,
        serviceName: true,
        status: true,
        cancelReason: true,
        createdBy: true,
      },
    });
    if (request === null) {
      return null;
    }
    const quotation =
      payload.quotationId === undefined
        ? null
        : await tx.quotation.findUnique({
            where: { id: payload.quotationId },
            select: { number: true, status: true, totalMinor: true, expiresAt: true },
          });
    const order = await tx.serviceOrder.findUnique({
      where: { requestId: payload.requestId },
      select: {
        number: true,
        status: true,
        totalMinor: true,
        paidMinor: true,
        cancelReason: true,
        refundDue: true,
      },
    });
    const requester = await tx.appUser.findUnique({
      where: { id: request.createdBy },
      select: { email: true },
    });
    return {
      facts: {
        number: request.number,
        serviceName: request.serviceName,
        status: request.status,
        cancelReason: request.cancelReason,
        quotation,
        order,
      },
      requester: requester?.email ?? null,
    };
  }
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
export class RequestSubmittedEmail extends OrderEmailHandler {
  readonly type = 'orders.request_submitted';
  protected compose(f: Facts) {
    return {
      subject: `We received your request ${f.number}`,
      paragraphs: [
        `Thank you. We received your request ${f.number} for ${f.serviceName}.`,
        'OGS staff will review it shortly. If the service needs a quotation, you will receive one by email.',
      ],
    };
  }
}

@Injectable()
export class RequestCancelledEmail extends OrderEmailHandler {
  readonly type = 'orders.request_cancelled';
  protected compose(f: Facts) {
    return {
      subject: `Request ${f.number} was cancelled`,
      paragraphs: [
        `Your request ${f.number} for ${f.serviceName} was cancelled.`,
        ...(f.cancelReason === null ? [] : [`Reason: ${f.cancelReason}`]),
      ],
    };
  }
}

@Injectable()
export class QuotationIssuedEmail extends OrderEmailHandler {
  readonly type = 'orders.quotation_issued';
  protected override readonly toAdmins = true;
  protected compose(f: Facts) {
    if (f.quotation?.status !== 'ISSUED' || f.quotation.expiresAt === null) {
      return null;
    }
    return {
      subject: `Quotation ${f.quotation.number} for request ${f.number}`,
      paragraphs: [
        `Your quotation for ${f.serviceName} is ready: ${formatKes(Number(f.quotation.totalMinor))} including VAT.`,
        `It is valid until ${nairobiDate.format(f.quotation.expiresAt)} (Kenya time). Accept or reject it in OGS.`,
      ],
    };
  }
}

@Injectable()
export class QuotationExpiringEmail extends OrderEmailHandler {
  readonly type = 'orders.quotation_expiring';
  protected override readonly toAdmins = true;
  protected compose(f: Facts) {
    // Only if nobody has decided yet.
    if (
      f.quotation?.status !== 'ISSUED' ||
      f.quotation.expiresAt === null ||
      f.quotation.expiresAt <= new Date()
    ) {
      return null;
    }
    return {
      subject: `Quotation ${f.quotation.number} expires soon`,
      paragraphs: [
        `Your quotation for ${f.serviceName} (${formatKes(Number(f.quotation.totalMinor))} including VAT) expires on ${nairobiDate.format(f.quotation.expiresAt)} (Kenya time).`,
      ],
    };
  }
}

@Injectable()
export class QuotationExpiredEmail extends OrderEmailHandler {
  readonly type = 'orders.quotation_expired';
  protected override readonly toAdmins = true;
  protected compose(f: Facts) {
    return {
      subject: `Quotation ${f.quotation?.number ?? ''} has expired`,
      paragraphs: [
        `The quotation for request ${f.number} (${f.serviceName}) has expired.`,
        'OGS staff can send you a revised quotation, or you can cancel the request.',
      ],
    };
  }
}

@Injectable()
export class OrderCreatedEmail extends OrderEmailHandler {
  readonly type = 'orders.order_created';
  protected compose(f: Facts) {
    if (f.order === null) {
      return null;
    }
    return {
      subject: `Order ${f.order.number}: awaiting payment`,
      paragraphs: [
        `Your order ${f.order.number} for ${f.serviceName} is placed. Total: ${formatKes(Number(f.order.totalMinor))} including VAT.`,
        `Pay by bank transfer or M-Pesa paybill, quoting ${f.order.number} as the reference. We confirm the order as soon as the payment is recorded.`,
      ],
    };
  }
}

@Injectable()
export class PaymentRecordedEmail extends OrderEmailHandler {
  readonly type = 'orders.payment_recorded';
  protected compose(f: Facts) {
    if (f.order === null) {
      return null;
    }
    return {
      subject: `Payment received for order ${f.order.number}`,
      paragraphs: [
        `We recorded a payment towards order ${f.order.number}. Paid so far: ${formatKes(Number(f.order.paidMinor))}; balance: ${formatKes(Number(f.order.totalMinor - f.order.paidMinor))}.`,
      ],
    };
  }
}

@Injectable()
export class OrderConfirmedEmail extends OrderEmailHandler {
  readonly type = 'orders.order_confirmed';
  protected compose(f: Facts) {
    if (f.order === null) {
      return null;
    }
    return {
      subject: `Order ${f.order.number} is confirmed`,
      paragraphs: [
        `Your order ${f.order.number} for ${f.serviceName} is confirmed. We are arranging the work and will be in touch about the visit.`,
      ],
    };
  }
}

@Injectable()
export class OrderCancelledEmail extends OrderEmailHandler {
  readonly type = 'orders.order_cancelled';
  protected compose(f: Facts) {
    if (f.order === null) {
      return null;
    }
    return {
      subject: `Order ${f.order.number} was cancelled`,
      paragraphs: [
        `Order ${f.order.number} for ${f.serviceName} was cancelled.`,
        ...(f.order.cancelReason === null ? [] : [`Reason: ${f.order.cancelReason}`]),
        ...(f.order.refundDue
          ? ['Your payment will be refunded; OGS finance will contact you.']
          : []),
      ],
    };
  }
}

/** Not an email: the delayed expiry event (P7-3) runs the idempotent expiry. */
@Injectable()
export class QuotationExpiryHandler implements EventHandler {
  readonly type = 'orders.quotation_expiry';
  constructor(private readonly expiry: QuotationExpiryService) {}

  async handle(envelope: EventEnvelope): Promise<void> {
    const { quotationId } = payloadSchema.parse(envelope.payload);
    if (quotationId !== undefined) {
      await this.expiry.expire(quotationId);
    }
  }
}

export const PHASE_7_HANDLERS = [
  RequestSubmittedEmail,
  RequestCancelledEmail,
  QuotationIssuedEmail,
  QuotationExpiringEmail,
  QuotationExpiredEmail,
  OrderCreatedEmail,
  PaymentRecordedEmail,
  OrderConfirmedEmail,
  OrderCancelledEmail,
  QuotationExpiryHandler,
] as const;
