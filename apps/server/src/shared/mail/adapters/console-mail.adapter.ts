import { Injectable, Logger } from '@nestjs/common';

import { env } from '../../config/config.module';
import { MailService, SendMailOptions } from '../mail.service';

// Task 1.10. Dev/test adapter — logs instead of sending. Default binding for
// MailModule (MAIL_PROVIDER defaults to 'console'). Outside production it also
// logs the rendered subject + links (which contain single-use tokens) so a
// developer can click through flows without a mail server; in production it
// logs only recipient/template metadata, never links.
@Injectable()
export class ConsoleMailAdapter extends MailService {
  private readonly logger = new Logger(ConsoleMailAdapter.name);

  async send(options: SendMailOptions): Promise<void> {
    this.logger.log(
      `[console-mail] to=${options.to} subject="${options.subject}" templateId=${options.templateId ?? 'n/a'}`,
    );
    if (env.NODE_ENV !== 'production' && options.links && options.links.length > 0) {
      this.logger.log(`[console-mail] links: ${options.links.join(' ')}`);
    }
    await Promise.resolve();
  }
}
