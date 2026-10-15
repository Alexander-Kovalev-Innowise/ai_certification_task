import { Injectable } from '@nestjs/common';

import { MailService, SendMailOptions } from '../mail.service';

export const DEV_MAILBOX_CAPACITY = 500;

export interface DevMailboxEntry {
  to: string;
  subject: string;
  templateId: string | null;
  html: string;
  text: string;
  links: string[];
  sentAt: string;
}

// MAIL_PROVIDER=dev (never in production — see mail.module.ts). Keeps the
// last DEV_MAILBOX_CAPACITY mails in memory; DevMailboxController exposes them
// for the Playwright e2e suite. Process-local by design (single instance).
@Injectable()
export class DevMailAdapter extends MailService {
  private entries: DevMailboxEntry[] = [];

  send(options: SendMailOptions): Promise<void> {
    this.entries.push({
      to: options.to,
      subject: options.subject,
      templateId: options.templateId ?? null,
      html: options.html ?? '',
      text: options.text ?? '',
      links: options.links ?? [],
      sentAt: new Date().toISOString(),
    });
    if (this.entries.length > DEV_MAILBOX_CAPACITY) {
      this.entries = this.entries.slice(this.entries.length - DEV_MAILBOX_CAPACITY);
    }
    return Promise.resolve();
  }

  /** Oldest first, newest last. `to` filters case-insensitively on the recipient address. */
  list(to?: string): DevMailboxEntry[] {
    const wanted = to?.trim().toLowerCase();
    return this.entries.filter((e) => !wanted || e.to.toLowerCase() === wanted).map((e) => ({ ...e, links: [...e.links] }));
  }

  clear(): void {
    this.entries = [];
  }
}
