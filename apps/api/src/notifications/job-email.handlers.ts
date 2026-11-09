import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONFIRM_WINDOW_MS } from '@ogs/contracts';
import { z } from 'zod';
import type { TypedConfigService } from '../config/env.js';
import { MembershipStatus, TenantDb, type Db, type DbContext } from '../database/index.js';
import type { EventEnvelope, EventHandler } from '../events/event.types.js';
import { JobLifecycleService } from '../jobs/job-lifecycle.service.js';
import { deliverOnce } from './deliver-once.js';
import { EmailSender, type EmailMessage } from './email-sender.js';
import { templates } from './email-templates.js';

const jobPayload = z.object({
  jobId: z.uuid(),
  offerId: z.uuid().optional(),
  assignmentId: z.uuid().optional(),
});

const nairobi = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * What a job email may use (Phase 9 plan §2.8): number, title, county,
 * statuses and dates. No brief, address, phone, note, reason or money is read
 * here, so no email can carry them (T5, T10).
 */
interface Facts {
  readonly jobId: string;
  readonly number: string;
  readonly title: string;
  readonly regionCode: string;
  readonly status: string;
  readonly isOrderJob: boolean;
}

interface Mail {
  readonly to: readonly string[];
  readonly subject: string;
  readonly paragraphs: string[];
  readonly path: string;
  readonly label: string;
}

/**
 * Job emails. Each handler reads the job and decides recipients in a
 * `jobs.notify` system context (RLS policies name exactly the rows it needs).
 */
abstract class JobEmailHandler implements EventHandler {
  abstract readonly type: string;
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
  }

  protected abstract compose(
    tx: Db,
    facts: Facts,
    payload: z.infer<typeof jobPayload>,
  ): Promise<Mail[]>;

  async handle(envelope: EventEnvelope): Promise<void> {
    const payload = jobPayload.parse(envelope.payload);
    const ctx: DbContext =
      envelope.tenantId === null
        ? { kind: 'system', job: 'jobs.notify' }
        : { kind: 'system', job: 'jobs.notify', tenantId: envelope.tenantId };
    await deliverOnce(this.db, ctx, envelope, this.sender, async (tx) => {
      const job = await tx.job.findUnique({
        where: { id: payload.jobId },
        select: {
          id: true,
          number: true,
          title: true,
          regionCode: true,
          status: true,
          serviceOrderId: true,
        },
      });
      if (job === null) {
        return [];
      }
      const mails = await this.compose(
        tx,
        {
          jobId: job.id,
          number: job.number,
          title: job.title,
          regionCode: job.regionCode,
          status: job.status,
          isOrderJob: job.serviceOrderId !== null,
        },
        payload,
      );
      return mails.flatMap((mail) =>
        [...new Set(mail.to)].map((email): EmailMessage =>
          templates.jobNotice(
            email,
            mail.subject,
            mail.paragraphs,
            `${this.base}${mail.path}`,
            mail.label,
          ),
        ),
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

/** Who answers an offer: the internal technician, the individual, or the company's responders. */
async function offerees(tx: Db, offerId: string): Promise<string[]> {
  const offer = await tx.jobOffer.findUnique({
    where: { id: offerId },
    select: {
      kind: true,
      technicianUserId: true,
      assigneeTenantId: true,
      provider: { select: { ownerUserId: true } },
    },
  });
  if (offer === null) {
    return [];
  }
  if (offer.kind === 'INTERNAL') {
    const email = await emailOf(tx, offer.technicianUserId);
    return email === null ? [] : [email];
  }
  if (offer.kind === 'INDIVIDUAL') {
    const email = await emailOf(tx, offer.provider?.ownerUserId ?? null);
    return email === null ? [] : [email];
  }
  if (offer.assigneeTenantId === null) {
    return [];
  }
  const members = await tx.membership.findMany({
    where: {
      tenantId: offer.assigneeTenantId,
      status: MembershipStatus.ACTIVE,
      roles: {
        some: { role: { permissions: { some: { permissionCode: 'assignment.respond' } } } },
      },
    },
    select: { userId: true },
  });
  const emails = await Promise.all(members.map((m) => emailOf(tx, m.userId)));
  return emails.filter((email): email is string => email !== null);
}

/** The customer to tell: the order's requester, or the ticket's requester. */
async function customerEmail(
  tx: Db,
  jobId: string,
): Promise<{ email: string | null; path: string }> {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: {
      ticket: { select: { id: true, requesterUserId: true } },
      serviceOrder: { select: { request: { select: { id: true, createdBy: true } } } },
    },
  });
  if (job?.serviceOrder !== null && job?.serviceOrder !== undefined) {
    const request = job.serviceOrder.request;
    return { email: await emailOf(tx, request.createdBy), path: `/requests/${request.id}` };
  }
  if (job?.ticket !== null && job?.ticket !== undefined) {
    return {
      email: await emailOf(tx, job.ticket.requesterUserId),
      path: `/support/${job.ticket.id}`,
    };
  }
  return { email: null, path: '/' };
}

async function technicianOf(tx: Db, assignmentId: string | undefined): Promise<string | null> {
  if (assignmentId === undefined) {
    return null;
  }
  const assignment = await tx.jobAssignment.findUnique({
    where: { id: assignmentId },
    select: { technicianUserId: true },
  });
  return emailOf(tx, assignment?.technicianUserId ?? null);
}

async function activeTechnician(tx: Db, jobId: string): Promise<string | null> {
  const assignment = await tx.jobAssignment.findFirst({
    where: { jobId, status: 'ACTIVE' },
    select: { technicianUserId: true },
  });
  return emailOf(tx, assignment?.technicianUserId ?? null);
}

@Injectable()
export class JobOfferedEmail extends JobEmailHandler {
  readonly type = 'jobs.offered';
  protected async compose(tx: Db, f: Facts, p: z.infer<typeof jobPayload>): Promise<Mail[]> {
    if (p.offerId === undefined) {
      return [];
    }
    const offer = await tx.jobOffer.findUnique({
      where: { id: p.offerId },
      select: { status: true, expiresAt: true },
    });
    if (offer?.status !== 'PENDING') {
      return [];
    }
    return [
      {
        to: await offerees(tx, p.offerId),
        subject: `New job offer ${f.number}`,
        paragraphs: [
          `OGS is offering you job ${f.number} ("${f.title}") in ${f.regionCode}.`,
          `Please accept or decline before ${nairobi.format(offer.expiresAt)} (Kenya time). After that the offer expires.`,
        ],
        path: `/jobs/offers/${p.offerId}`,
        label: 'View the offer',
      },
    ];
  }
}

@Injectable()
export class JobOfferWithdrawnEmail extends JobEmailHandler {
  readonly type = 'jobs.offer_withdrawn';
  protected async compose(tx: Db, f: Facts, p: z.infer<typeof jobPayload>): Promise<Mail[]> {
    if (p.offerId === undefined) {
      return [];
    }
    return [
      {
        to: await offerees(tx, p.offerId),
        subject: `Offer ${f.number} withdrawn`,
        paragraphs: [
          `OGS withdrew its offer of job ${f.number} ("${f.title}"). No action is needed.`,
        ],
        path: '/jobs',
        label: 'Open your jobs',
      },
    ];
  }
}

/** The dispatcher who sent the offer hears that it came back. */
abstract class OfferOutcomeEmail extends JobEmailHandler {
  protected abstract readonly outcome: string;
  protected async compose(tx: Db, f: Facts, p: z.infer<typeof jobPayload>): Promise<Mail[]> {
    if (p.offerId === undefined) {
      return [];
    }
    const offer = await tx.jobOffer.findUnique({
      where: { id: p.offerId },
      select: { offeredBy: true },
    });
    const email = await emailOf(tx, offer?.offeredBy ?? null);
    return email === null
      ? []
      : [
          {
            to: [email],
            subject: `Offer for ${f.number} ${this.outcome}`,
            paragraphs: [
              `Your offer of job ${f.number} ("${f.title}") was ${this.outcome}.`,
              'The job is back in the dispatch queue.',
            ],
            path: `/platform/dispatch/${f.jobId}`,
            label: 'Open the job',
          },
        ];
  }
}

@Injectable()
export class JobOfferDeclinedEmail extends OfferOutcomeEmail {
  readonly type = 'jobs.offer_declined';
  protected readonly outcome = 'declined';
}

@Injectable()
export class JobOfferExpiredEmail extends OfferOutcomeEmail {
  readonly type = 'jobs.offer_expired';
  protected readonly outcome = 'not answered in time';
}

@Injectable()
export class JobAssignedEmail extends JobEmailHandler {
  readonly type = 'jobs.assigned';
  protected async compose(tx: Db, f: Facts, p: z.infer<typeof jobPayload>): Promise<Mail[]> {
    const mails: Mail[] = [];
    const technician = await technicianOf(tx, p.assignmentId);
    if (technician !== null) {
      mails.push({
        to: [technician],
        subject: `Job ${f.number} is assigned to you`,
        paragraphs: [`Job ${f.number} ("${f.title}") in ${f.regionCode} is now yours.`],
        path: `/jobs/${f.jobId}`,
        label: 'Open the job',
      });
    }
    const customer = await customerEmail(tx, f.jobId);
    if (customer.email !== null && f.status !== 'QUEUED') {
      mails.push({
        to: [customer.email],
        subject: `A technician is assigned to ${f.title}`,
        paragraphs: [
          `Good news: an OGS technician is assigned to your job ${f.number} ("${f.title}").`,
          'You can follow the progress in OGS.',
        ],
        path: customer.path,
        label: 'Follow the progress',
      });
    }
    return mails;
  }
}

@Injectable()
export class JobOnTheWayEmail extends JobEmailHandler {
  readonly type = 'jobs.on_the_way';
  protected async compose(tx: Db, f: Facts): Promise<Mail[]> {
    const customer = await customerEmail(tx, f.jobId);
    return customer.email === null
      ? []
      : [
          {
            to: [customer.email],
            subject: `Your technician is on the way (${f.number})`,
            paragraphs: [`Your OGS technician is on the way for job ${f.number} ("${f.title}").`],
            path: customer.path,
            label: 'Follow the progress',
          },
        ];
  }
}

@Injectable()
export class JobReportSubmittedEmail extends JobEmailHandler {
  readonly type = 'jobs.report_submitted';
  protected async compose(tx: Db, f: Facts): Promise<Mail[]> {
    if (f.status !== 'AWAITING_CONFIRMATION') {
      return [];
    }
    const customer = await customerEmail(tx, f.jobId);
    if (customer.email === null) {
      return [];
    }
    const report = await tx.jobCompletion.findFirst({
      where: { jobId: f.jobId, outcome: null },
      select: { submittedAt: true },
    });
    const until =
      report === null ? null : new Date(report.submittedAt.getTime() + CONFIRM_WINDOW_MS);
    return [
      {
        to: [customer.email],
        subject: `Please check and confirm job ${f.number}`,
        paragraphs: f.isOrderJob
          ? [
              `The technician has finished job ${f.number} ("${f.title}") and sent a report.`,
              until === null
                ? 'Please check the work and confirm it in OGS, or report a problem.'
                : `Please check the work and confirm it in OGS, or report a problem, before ${nairobi.format(until)} (Kenya time). After that it is confirmed automatically.`,
            ]
          : [
              `The technician has finished job ${f.number} ("${f.title}") and sent a report.`,
              'OGS support will update your ticket.',
            ],
        path: customer.path,
        label: 'Check the work',
      },
    ];
  }
}

@Injectable()
export class JobCompletedEmail extends JobEmailHandler {
  readonly type = 'jobs.completed';
  protected async compose(tx: Db, f: Facts): Promise<Mail[]> {
    if (f.status !== 'COMPLETED') {
      return [];
    }
    const customer = await customerEmail(tx, f.jobId);
    return customer.email === null
      ? []
      : [
          {
            to: [customer.email],
            subject: `Job ${f.number} is completed`,
            paragraphs: [
              `Job ${f.number} ("${f.title}") is completed. Thank you for choosing OGS.`,
            ],
            path: customer.path,
            label: 'View the job',
          },
        ];
  }
}

@Injectable()
export class JobProblemReportedEmail extends JobEmailHandler {
  readonly type = 'jobs.problem_reported';
  protected async compose(tx: Db, f: Facts): Promise<Mail[]> {
    const technician = await activeTechnician(tx, f.jobId);
    return technician === null
      ? []
      : [
          {
            to: [technician],
            subject: `The customer reported a problem on ${f.number}`,
            paragraphs: [
              `The customer reported a problem with job ${f.number} ("${f.title}"). It is back in progress.`,
            ],
            path: `/jobs/${f.jobId}`,
            label: 'Open the job',
          },
        ];
  }
}

@Injectable()
export class JobRemovedEmail extends JobEmailHandler {
  readonly type = 'jobs.removed';
  protected async compose(tx: Db, f: Facts, p: z.infer<typeof jobPayload>): Promise<Mail[]> {
    const technician = await technicianOf(tx, p.assignmentId);
    return technician === null
      ? []
      : [
          {
            to: [technician],
            subject: `You are no longer assigned to ${f.number}`,
            paragraphs: [
              `Job ${f.number} ("${f.title}") is no longer assigned to you. No action is needed.`,
            ],
            path: '/jobs',
            label: 'Open your jobs',
          },
        ];
  }
}

// ---------------------------------------------------------------- not emails

const orderPayload = z.object({ orderId: z.uuid() });
const offerPayload = z.object({ offerId: z.uuid() });

/** A ready order gets its job (the sweep catches anything missed). */
@Injectable()
export class JobOrderReadyHandler implements EventHandler {
  readonly type = 'jobs.order_ready';
  constructor(private readonly lifecycle: JobLifecycleService) {}
  async handle(envelope: EventEnvelope): Promise<void> {
    await this.lifecycle.ensureForOrder(orderPayload.parse(envelope.payload).orderId);
  }
}

/** The delayed expiry of an offer (P9-4). */
@Injectable()
export class JobOfferExpireHandler implements EventHandler {
  readonly type = 'jobs.offer_expire';
  constructor(private readonly lifecycle: JobLifecycleService) {}
  async handle(envelope: EventEnvelope): Promise<void> {
    await this.lifecycle.expireOffer(offerPayload.parse(envelope.payload).offerId);
  }
}

/** The delayed auto-confirmation of a report (P9-7). */
@Injectable()
export class JobAutoConfirmHandler implements EventHandler {
  readonly type = 'jobs.auto_confirm';
  constructor(private readonly lifecycle: JobLifecycleService) {}
  async handle(envelope: EventEnvelope): Promise<void> {
    await this.lifecycle.autoConfirm(jobPayload.parse(envelope.payload).jobId);
  }
}

/** Keeps the order in step with its job (P9-10). */
@Injectable()
export class JobOrderSyncHandler implements EventHandler {
  readonly type = 'jobs.order_sync';
  constructor(private readonly lifecycle: JobLifecycleService) {}
  async handle(envelope: EventEnvelope): Promise<void> {
    await this.lifecycle.syncOrder(jobPayload.parse(envelope.payload).jobId);
  }
}

export const PHASE_9_HANDLERS = [
  JobOfferedEmail,
  JobOfferWithdrawnEmail,
  JobOfferDeclinedEmail,
  JobOfferExpiredEmail,
  JobAssignedEmail,
  JobOnTheWayEmail,
  JobReportSubmittedEmail,
  JobCompletedEmail,
  JobProblemReportedEmail,
  JobRemovedEmail,
  JobOrderReadyHandler,
  JobOfferExpireHandler,
  JobAutoConfirmHandler,
  JobOrderSyncHandler,
] as const;
