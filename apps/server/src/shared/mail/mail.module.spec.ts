import { Test } from '@nestjs/testing';

import { ConsoleMailAdapter } from './adapters/console-mail.adapter';
import { MailModule } from './mail.module';
import { MailService } from './mail.service';

describe('MailModule (Task 1.10)', () => {
  it('resolves MailService to the console adapter in test config (MAIL_PROVIDER unset -> default console)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MailModule] }).compile();

    const mailService = moduleRef.get(MailService);

    expect(mailService).toBeInstanceOf(ConsoleMailAdapter);
  });
});
