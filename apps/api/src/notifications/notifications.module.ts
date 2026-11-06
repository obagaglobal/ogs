import { Module } from '@nestjs/common';
import { EmailSender, SmtpEmailSender } from './email-sender.js';
import { IDENTITY_EMAIL_HANDLERS } from './identity-email.handlers.js';
import { PHASE_4_EMAIL_HANDLERS } from './organisation-email.handlers.js';

/** Worker only: turns outbox events into emails. */
@Module({
  providers: [
    { provide: EmailSender, useClass: SmtpEmailSender },
    ...IDENTITY_EMAIL_HANDLERS,
    ...PHASE_4_EMAIL_HANDLERS,
  ],
  exports: [...IDENTITY_EMAIL_HANDLERS, ...PHASE_4_EMAIL_HANDLERS],
})
export class NotificationsModule {}
