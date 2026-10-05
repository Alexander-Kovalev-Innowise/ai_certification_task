import { JOB_TYPES } from '../jobs/job-types.const';

// Renders every transactional email (EMAIL_* job types, shared/jobs) into
// subject + HTML + plain text, plus the absolute links they contain. Pure —
// no I/O, no env access: the caller passes `clientUrl` (CLIENT_URL). Adapters
// stay dumb transports; OutboxService.dispatchEmail renders once, here.

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
  /** Absolute URLs present in the mail (CTA first). */
  links: string[];
}

type Data = Record<string, unknown>;

interface Cta {
  label: string;
  url: string;
}

interface Body {
  subject: string;
  /** Plain paragraphs (escaped for HTML by the layout). */
  paragraphs: string[];
  cta?: Cta;
  footnote?: string;
}

export class MailRenderError extends Error {}

const BRAND = 'PracticePerfect';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function str(data: Data, key: string, fallback?: string): string {
  const value = data[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new MailRenderError(`templateData.${key} is required`);
}

function optStr(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function greeting(name: string | undefined): string {
  return name ? `Hi ${name},` : 'Hi,';
}

export function buildClientUrl(clientUrl: string, path: string, query?: Record<string, string>): string {
  const base = clientUrl.replace(/\/+$/, '');
  const qs = query
    ? `?${Object.entries(query)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')}`
    : '';
  return `${base}${path}${qs}`;
}

function formatAmount(d: Data): string {
  const amount = optStr(d, 'amount') ?? '?';
  return d.paymentType === 'TOKEN' ? `${amount} tokens` : `$${amount}`;
}

type BodyBuilder = (data: Data, clientUrl: string) => Body;

const BODY_BUILDERS: Record<string, BodyBuilder> = {
  [JOB_TYPES.EMAIL_TRAINER_INVITE]: (d, c) => ({
    subject: `Welcome to ${BRAND} — complete your trainer account setup`,
    paragraphs: [
      greeting(optStr(d, 'firstName')),
      `An account has been created for ${str(d, 'businessName', 'your business')} on ${BRAND}. Set your password to finish setting it up.`,
    ],
    cta: { label: 'Set up your account', url: buildClientUrl(c, '/register', { token: str(d, 'setupToken') }) },
    footnote: 'This link is single-use and expires in 7 days.',
  }),

  [JOB_TYPES.EMAIL_PASSWORD_RESET]: (d, c) => ({
    subject: `Reset your ${BRAND} password`,
    paragraphs: [greeting(optStr(d, 'firstName')), 'We received a request to reset your password.'],
    cta: { label: 'Reset password', url: buildClientUrl(c, '/reset-password', { token: str(d, 'resetToken') }) },
    footnote: "This link expires in 1 hour. If you didn't ask for this, you can ignore this email.",
  }),

  [JOB_TYPES.EMAIL_VERIFICATION]: (d, c) => ({
    subject: `Verify your ${BRAND} email address`,
    paragraphs: [greeting(optStr(d, 'firstName')), 'Please confirm this is your email address.'],
    cta: { label: 'Verify email', url: buildClientUrl(c, '/verify-email', { token: str(d, 'verificationToken') }) },
    footnote: 'This link expires in 24 hours.',
  }),

  [JOB_TYPES.EMAIL_SHARELINK_CONFIRMATION]: (d, c) => ({
    subject: `You're connected with ${str(d, 'trainerBusinessName', 'your trainer')}`,
    paragraphs: [
      greeting(optStr(d, 'firstName')),
      `Your registration is complete and you are now connected with ${str(d, 'trainerBusinessName', 'your trainer')}.`,
    ],
    cta: { label: 'Log in', url: buildClientUrl(c, '/login') },
  }),

  [JOB_TYPES.EMAIL_COACH_INVITE]: (d, c) => {
    const business = str(d, 'trainerBusinessName', 'A trainer');
    const message = optStr(d, 'message');
    return {
      subject: `${business} invited you to coach on ${BRAND}`,
      paragraphs: [
        greeting(optStr(d, 'inviteeName')),
        `${business} invited you to join as a coach on ${BRAND}.`,
        ...(message ? [`Message from ${business}: ${message}`] : []),
      ],
      cta: { label: 'Accept invitation', url: buildClientUrl(c, `/join/${encodeURIComponent(str(d, 'shareLinkCode'))}`) },
    };
  },

  [JOB_TYPES.EMAIL_CHILD_BLOCKED_SHARELINK]: (d, c) => {
    const child = str(d, 'childFirstName', 'Your child');
    const trainer = optStr(d, 'trainerBusinessName');
    return {
      subject: trainer ? `${child} wants to join ${trainer}'s program` : `${child} wants to join a trainer's program`,
      paragraphs: [
        greeting(optStr(d, 'guardianFirstName')),
        `${child} tried to register through ${trainer ? `${trainer}'s` : "a trainer's"} ShareLink. Children cannot register on their own - click to register ${child} with this trainer as their guardian.`,
      ],
      cta: { label: 'Review Registration', url: buildClientUrl(c, `/join/${encodeURIComponent(str(d, 'shareLinkCode'))}`) },
    };
  },

  [JOB_TYPES.EMAIL_CHILD_APPROVAL_REQUEST]: (d, c) => {
    const description = optStr(d, 'description');
    return {
      subject: `${str(d, 'playerName', 'Your child')} is asking for your approval`,
      paragraphs: [
        greeting(optStr(d, 'parentFirstName')),
        `${str(d, 'playerName', 'Your child')} requested a purchase of ${formatAmount(d)}${description ? ` for ${description}` : ''}. It needs your approval before it goes through.`,
      ],
      cta: { label: 'Review request', url: buildClientUrl(c, '/approvals') },
      footnote: 'Requests expire if they are not answered in time.',
    };
  },

  // Also carries the informational "child spent tokens without approval" notice to the guardian (no `decision`).
  [JOB_TYPES.EMAIL_CHILD_APPROVAL_DECISION]: (d, c) => {
    const decision = optStr(d, 'decision');
    const notes = optStr(d, 'parentNotes');
    const playerName = optStr(d, 'playerName');
    const title = optStr(d, 'title');
    const request = `${formatAmount(d)}${title ? ` for ${title}` : ''}${playerName ? ` (${playerName})` : ''}`;
    const notesParagraph = notes ? [`Note from your parent/guardian: ${notes}`] : [];
    const open = { label: `Open ${BRAND}`, url: buildClientUrl(c, '/') };

    switch (decision) {
      case 'APPROVED':
        return { subject: 'Your purchase request was approved', paragraphs: [`Your request for ${request} was approved.`, ...notesParagraph], cta: open };
      case 'INFO_REQUESTED':
        return {
          subject: 'Your parent needs more information about your request',
          paragraphs: [`Your parent has a question about your request for ${request}.`, ...(notes ? [`Your parent asked: ${notes}`] : [])],
          cta: { label: 'Open my requests', url: buildClientUrl(c, '/requests') },
        };
      case 'EXPIRED':
        return { subject: 'Your purchase request has expired', paragraphs: [`Your request for ${request} expired before it was answered.`], cta: open };
      case 'DENIED':
        return { subject: 'Your purchase request was denied', paragraphs: [`Your request for ${request} was denied.`, ...notesParagraph], cta: open };
      default:
        return {
          subject: `${str(d, 'playerName', 'Your child')} spent tokens (no approval needed)`,
          paragraphs: [
            greeting(optStr(d, 'parentFirstName')),
            `${str(d, 'playerName', 'Your child')} spent ${formatAmount({ ...d, paymentType: 'TOKEN' })}${title ? ` on ${title}` : ''}. Your approval setting for tokens is off, so no approval was needed - this is just for your information.`,
          ],
          cta: { label: 'Review approvals', url: buildClientUrl(c, '/approvals') },
        };
    }
  },

  [JOB_TYPES.EMAIL_COACH_OVERRIDE_NOTIFY]: (d, c) => ({
    subject: `${str(d, 'trainerBusinessName', 'Your trainer')} scheduled you despite an availability conflict`,
    paragraphs: [
      greeting(optStr(d, 'coachFirstName')),
      `${str(d, 'trainerBusinessName', 'Your trainer')} scheduled you for a session that conflicts with your availability.`,
      `Reason: ${str(d, 'reason', 'not provided')}`,
    ],
    cta: { label: 'View your schedule', url: buildClientUrl(c, '/my-times') },
  }),
};

export function hasMailTemplate(templateId: string): boolean {
  return templateId in BODY_BUILDERS;
}

function layoutHtml(body: Body): string {
  const para = (text: string): string =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#1f2937;">${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  const button = body.cta
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(body.cta.url)}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(body.cta.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7280;">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(body.cta.url)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(body.cta.url)}</a></p>`
    : '';
  const foot = body.footnote
    ? `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">${escapeHtml(body.footnote)}</p>`
    : '';
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(body.subject)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">` +
    `<h1 style="margin:0 0 24px;font-size:20px;color:#111827;">${BRAND}</h1>` +
    body.paragraphs.map(para).join('') +
    button +
    foot +
    `</div></body></html>`
  );
}

function layoutText(body: Body): string {
  return [
    ...body.paragraphs,
    ...(body.cta ? [`${body.cta.label}: ${body.cta.url}`] : []),
    ...(body.footnote ? [body.footnote] : []),
    `— ${BRAND}`,
  ].join('\n\n');
}

/**
 * Renders the mail for `templateId`. Throws MailRenderError on an unknown
 * template or when a required field (e.g. the token a link needs) is missing
 * — a link-less mail would be useless, so the outbox job fails/retries loudly
 * instead of sending it.
 */
export function renderMail(templateId: string, templateData: Data | undefined, clientUrl: string): RenderedMail {
  const builder = BODY_BUILDERS[templateId];
  if (!builder) {
    throw new MailRenderError(`No mail template registered for "${templateId}"`);
  }
  const body = builder(templateData ?? {}, clientUrl);
  return {
    subject: body.subject,
    html: layoutHtml(body),
    text: layoutText(body),
    links: body.cta ? [body.cta.url] : [],
  };
}
