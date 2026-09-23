import { Module } from '@nestjs/common';

import { env } from '../config/config.module';

import { ConsoleMailAdapter } from './adapters/console-mail.adapter';
import { SesMailAdapterStub } from './adapters/ses-mail.adapter.stub';
import { MailService } from './mail.service';

// Task 1.10. Binds MailService (the port) to a concrete adapter via
// `useClass`, keyed off MAIL_PROVIDER (shared/config) — INT-001's "pluggable
// provider" requirement. Not @Global(): modules that send mail import this
// explicitly, same as any other feature module dependency.
@Module({
  providers: [
    {
      provide: MailService,
      useClass: env.MAIL_PROVIDER === 'ses' ? SesMailAdapterStub : ConsoleMailAdapter,
    },
  ],
  exports: [MailService],
})
export class MailModule {}
