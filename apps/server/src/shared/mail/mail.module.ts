import { Module, Type } from '@nestjs/common';

import { env } from '../config/config.module';
import { isDevMailboxEnabled } from '../config/env.schema';

import { ConsoleMailAdapter } from './adapters/console-mail.adapter';
import { DevMailAdapter } from './adapters/dev-mail.adapter';
import { SesMailAdapterStub } from './adapters/ses-mail.adapter.stub';
import { SmtpMailAdapter } from './adapters/smtp-mail.adapter';
import { DevMailboxController } from './dev-mailbox.controller';
import { MailService } from './mail.service';

// `dev` in production is refused at the adapter level too: it would silently
// retain mail in memory with no way to read it, so fall back to console.
function selectAdapter(): Type<MailService> {
  switch (env.MAIL_PROVIDER) {
    case 'ses':
      return SesMailAdapterStub;
    case 'smtp':
      return SmtpMailAdapter;
    case 'dev':
      return isDevMailboxEnabled(env) ? DevMailAdapter : ConsoleMailAdapter;
    default:
      return ConsoleMailAdapter;
  }
}

// Task 1.10. Binds MailService (the port) to a concrete adapter via
// `useClass`, keyed off MAIL_PROVIDER (shared/config) — INT-001's "pluggable
// provider" requirement. Not @Global(): modules that send mail import this
// explicitly, same as any other feature module dependency.
//
// The dev mailbox controller (GET/DELETE /__dev/mailbox) exists only when
// MAIL_PROVIDER=dev AND NODE_ENV !== 'production'.
@Module({
  controllers: isDevMailboxEnabled(env) ? [DevMailboxController] : [],
  providers: [{ provide: MailService, useClass: selectAdapter() }],
  exports: [MailService],
})
export class MailModule {}
