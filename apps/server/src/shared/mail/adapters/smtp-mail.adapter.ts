import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { env } from '../../config/config.module';
import { MailService, SendMailOptions } from '../mail.service';

// MAIL_PROVIDER=smtp. nodemailer over SMTP_URL (e.g. smtp://user:pass@host:587,
// smtps:// for implicit TLS); sender is MAIL_FROM. env.schema.ts guarantees
// both are set when this provider is selected. SMTP_URL may embed
// credentials, so it is never logged. A thrown error propagates to
// OutboxService, which owns retry/backoff.
@Injectable()
export class SmtpMailAdapter extends MailService {
  private readonly logger = new Logger(SmtpMailAdapter.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    super();
    this.transporter = createTransport(env.SMTP_URL as string);
    this.from = env.MAIL_FROM as string;
  }

  async send(options: SendMailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    this.logger.log(`[smtp-mail] sent to=${options.to} templateId=${options.templateId ?? 'n/a'}`);
  }
}
