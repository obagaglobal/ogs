import { Module } from '@nestjs/common';
import { JobLifecycleService } from '../jobs/job-lifecycle.service.js';
import { QuotationExpiryService } from '../orders/quotation-expiry.service.js';
import { TicketAutoCloseService } from '../tickets/ticket-auto-close.service.js';
import { EmailSender, SmtpEmailSender } from './email-sender.js';
import { IDENTITY_EMAIL_HANDLERS } from './identity-email.handlers.js';
import { PHASE_9_HANDLERS } from './job-email.handlers.js';
import { PHASE_7_HANDLERS } from './order-email.handlers.js';
import { PHASE_4_EMAIL_HANDLERS } from './organisation-email.handlers.js';
import { PHASE_5_EMAIL_HANDLERS } from './provider-email.handlers.js';
import { PHASE_8_HANDLERS } from './ticket-email.handlers.js';

/** Worker only: turns outbox events into emails (and runs the timed jobs). */
@Module({
  providers: [
    { provide: EmailSender, useClass: SmtpEmailSender },
    ...IDENTITY_EMAIL_HANDLERS,
    ...PHASE_4_EMAIL_HANDLERS,
    ...PHASE_5_EMAIL_HANDLERS,
    ...PHASE_7_HANDLERS,
    ...PHASE_8_HANDLERS,
    ...PHASE_9_HANDLERS,
    QuotationExpiryService,
    TicketAutoCloseService,
    JobLifecycleService,
  ],
  exports: [
    ...IDENTITY_EMAIL_HANDLERS,
    ...PHASE_4_EMAIL_HANDLERS,
    ...PHASE_5_EMAIL_HANDLERS,
    ...PHASE_7_HANDLERS,
    ...PHASE_8_HANDLERS,
    ...PHASE_9_HANDLERS,
    QuotationExpiryService,
    TicketAutoCloseService,
    JobLifecycleService,
  ],
})
export class NotificationsModule {}
