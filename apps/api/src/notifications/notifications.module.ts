import { Module } from '@nestjs/common';
import { EmailSender, SmtpEmailSender } from './email-sender.js';
import { IDENTITY_EMAIL_HANDLERS } from './identity-email.handlers.js';
import { PHASE_4_EMAIL_HANDLERS } from './organisation-email.handlers.js';

import { PHASE_5_EMAIL_HANDLERS } from './provider-email.handlers.js';
import { PHASE_7_HANDLERS } from './order-email.handlers.js';
import { QuotationExpiryService } from '../orders/quotation-expiry.service.js';
/** Worker only: turns outbox events into emails. */
@Module({
  providers: [
    { provide: EmailSender, useClass: SmtpEmailSender },
    ...IDENTITY_EMAIL_HANDLERS,
    ...PHASE_4_EMAIL_HANDLERS,
    ...PHASE_5_EMAIL_HANDLERS,
    ...PHASE_7_HANDLERS,
    QuotationExpiryService,
  ],
  exports: [
    ...IDENTITY_EMAIL_HANDLERS,
    ...PHASE_4_EMAIL_HANDLERS,
    ...PHASE_5_EMAIL_HANDLERS,
    ...PHASE_7_HANDLERS,
    QuotationExpiryService,
  ],
})
export class NotificationsModule {}
