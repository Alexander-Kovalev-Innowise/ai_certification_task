import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { Public } from '../security/decorators/public.decorator';

import { DevMailAdapter, type DevMailboxEntry } from './adapters/dev-mail.adapter';
import { MailService } from './mail.service';

// Contract consumed by the Playwright e2e suite:
//   GET    /__dev/mailbox?to=<email>  -> DevMailboxEntry[] (newest last)
//   DELETE /__dev/mailbox             -> 204
// Registered ONLY when MAIL_PROVIDER=dev AND NODE_ENV !== 'production'
// (MailModule's `controllers` list) — the route does not exist otherwise.
// @Public(): no auth, it exists purely so a browser test can read the mail
// (and its links/tokens) the app would have sent. Hidden from Swagger.
@ApiExcludeController()
@Controller('__dev/mailbox')
export class DevMailboxController {
  constructor(@Inject(MailService) private readonly mail: MailService) {}

  @Public()
  @Get()
  list(@Query('to') to?: string): DevMailboxEntry[] {
    return this.adapter().list(to);
  }

  @Public()
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(): void {
    this.adapter().clear();
  }

  private adapter(): DevMailAdapter {
    if (!(this.mail instanceof DevMailAdapter)) {
      // Unreachable while MailModule only registers this controller alongside DevMailAdapter.
      throw new Error('DevMailboxController requires MailService to be the DevMailAdapter');
    }
    return this.mail;
  }
}
