import { Injectable, Logger } from '@nestjs/common';

import { MailService, SendMailOptions } from '../mail.service';

// Task 1.10. Dev/test adapter — logs instead of sending. Default binding for
// MailModule until a real provider is wired (MAIL_PROVIDER defaults to
// 'console').
@Injectable()
export class ConsoleMailAdapter extends MailService {
  private readonly logger = new Logger(ConsoleMailAdapter.name);

  async send(options: SendMailOptions): Promise<void> {
    this.logger.log(
      `[console-mail] to=${options.to} subject="${options.subject}" templateId=${options.templateId ?? 'n/a'}`,
    );
    await Promise.resolve();
  }
}
