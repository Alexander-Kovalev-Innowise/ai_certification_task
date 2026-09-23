// Task 1.10 (arch §13, INT-001). The port — an abstract class, not an
// interface, so it can be used both as a NestJS DI token and as a type.
// Bound to a concrete adapter by MailModule's `useClass` factory, keyed off
// config (INT-001's "pluggable provider" requirement). No module imports an
// SDK (e.g. the AWS SES client) directly; only adapters/ may.
export interface SendMailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  // job-type constants (shared/jobs/job-types.const.ts, Task 1.12) identify
  // *which* of the 9 transactional email types this is; templates/ (this
  // directory) holds the actual per-type template files, added alongside
  // the feature that first sends them (e.g. Task 2.16 adds the
  // password-reset template) — this port doesn't need to know about either.
  templateId?: string;
  templateData?: Record<string, unknown>;
}

export abstract class MailService {
  abstract send(options: SendMailOptions): Promise<void>;
}
