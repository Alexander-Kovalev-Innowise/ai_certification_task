import { API_URL } from './seed';

/** Shape of an entry in the API's in-memory dev mailbox (MAIL_PROVIDER=dev). */
export interface MailMessage {
  to: string;
  subject: string;
  templateId: string;
  html: string;
  text: string;
  links: string[];
  sentAt: string;
}

export interface WaitOptions {
  subject?: string | RegExp;
  timeoutMs?: number;
  intervalMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function subjectMatches(m: MailMessage, subject: WaitOptions['subject']): boolean {
  if (subject === undefined) return true;
  return typeof subject === 'string' ? m.subject.includes(subject) : subject.test(m.subject);
}

/**
 * Client for the dev mailbox contract:
 *   GET    /__dev/mailbox?to=<email>  -> MailMessage[]
 *   DELETE /__dev/mailbox             -> clears everything
 * Only exists when the API runs with MAIL_PROVIDER=dev (the e2e stack does).
 */
export class Mailbox {
  constructor(private readonly baseUrl: string = API_URL) {}

  async list(to: string): Promise<MailMessage[]> {
    const res = await fetch(new URL(`/__dev/mailbox?to=${encodeURIComponent(to)}`, this.baseUrl));
    if (!res.ok) {
      throw new Error(`GET /__dev/mailbox failed (${res.status}). Is the API running with MAIL_PROVIDER=dev?`);
    }
    return (await res.json()) as MailMessage[];
  }

  /** Is the dev mailbox endpoint available on this API? */
  async isAvailable(): Promise<boolean> {
    try {
      return (await fetch(new URL('/__dev/mailbox?to=probe%40e2e.test', this.baseUrl))).ok;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    await fetch(new URL('/__dev/mailbox', this.baseUrl), { method: 'DELETE' });
  }

  /** Poll until an email to `to` (optionally matching `subject`) arrives; returns the newest match. */
  async waitFor(to: string, opts: WaitOptions = {}): Promise<MailMessage> {
    const { timeoutMs = 15_000, intervalMs = 300, subject } = opts;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const matches = (await this.list(to)).filter((m) => subjectMatches(m, subject));
        if (matches.length) return matches[matches.length - 1];
      } catch (e) {
        lastError = e;
      }
      await sleep(intervalMs);
    }
    throw new Error(
      `No email to ${to}${subject ? ` matching ${String(subject)}` : ''} within ${timeoutMs}ms${lastError ? ` (${String(lastError)})` : ''}`,
    );
  }

  /** Wait for an email to `to` and return the first link in it matching `pattern`, e.g. `/register\?token=/`. */
  async linkTo(to: string, pattern: RegExp, opts: WaitOptions = {}): Promise<string> {
    const { timeoutMs = 15_000, intervalMs = 300, subject } = opts;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msgs = (await this.list(to).catch(() => [] as MailMessage[])).filter((m) => subjectMatches(m, subject));
      for (const m of [...msgs].reverse()) {
        const link = m.links.find((l) => pattern.test(l));
        if (link) return link;
      }
      await sleep(intervalMs);
    }
    throw new Error(`No link matching ${pattern} in any email to ${to} within ${timeoutMs}ms`);
  }
}
