import { Injectable, Logger } from '@nestjs/common';

import { MailService, SendMailOptions } from '../mail.service';

// Task 1.10. Stub — not wired to the real AWS SES SDK yet; flagged as a
// later infra task, out of Epic-01's functional scope. Exists so
// MailModule's config-keyed `useClass` factory has a second branch to select
// (MAIL_PROVIDER='ses') without that branch being reachable in a working
// state yet.
@Injectable()
export class SesMailAdapterStub extends MailService {
  private readonly logger = new Logger(SesMailAdapterStub.name);

  send(_options: SendMailOptions): Promise<void> {
    this.logger.error(
      'SesMailAdapterStub.send() called, but the SES adapter is not implemented (out of Epic-01 scope). ' +
        "Set MAIL_PROVIDER=console, or implement this adapter's real SES SDK call before using MAIL_PROVIDER=ses.",
    );
    return Promise.reject(new Error('SesMailAdapterStub is not implemented'));
  }
}
