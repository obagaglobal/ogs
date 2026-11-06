import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { TypedConfigService } from '../config/env.js';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** ADR-025: providers sit behind this interface; the vendor is chosen at integration time. */
export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<void>;
}

/** SMTP via nodemailer. Mailpit in development and CI (decision P3-2). */
@Injectable()
export class SmtpEmailSender extends EmailSender implements OnApplicationShutdown {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(@Inject(ConfigService) config: TypedConfigService) {
    super();
    this.transport = nodemailer.createTransport(config.get('SMTP_URL', { infer: true }));
    this.from = config.get('EMAIL_FROM', { infer: true });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
