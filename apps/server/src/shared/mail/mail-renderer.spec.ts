import { EMAIL_JOB_TYPES, JOB_TYPES } from '../jobs/job-types.const';

import { buildClientUrl, escapeHtml, hasMailTemplate, MailRenderError, renderMail } from './mail-renderer';

const CLIENT = 'https://app.example.com/';

describe('renderMail', () => {
  it('has a template for every EMAIL_* job type', () => {
    for (const type of EMAIL_JOB_TYPES) {
      expect(hasMailTemplate(type)).toBe(true);
    }
  });

  it.each([
    [JOB_TYPES.EMAIL_TRAINER_INVITE, { firstName: 'T', businessName: 'Biz', setupToken: 'a b/c' }, 'https://app.example.com/register?token=a%20b%2Fc'],
    [JOB_TYPES.EMAIL_PASSWORD_RESET, { firstName: 'T', resetToken: 'rt' }, 'https://app.example.com/reset-password?token=rt'],
    [JOB_TYPES.EMAIL_VERIFICATION, { firstName: 'T', verificationToken: 'vt' }, 'https://app.example.com/verify-email?token=vt'],
    [JOB_TYPES.EMAIL_SHARELINK_CONFIRMATION, { firstName: 'T', trainerBusinessName: 'Biz' }, 'https://app.example.com/login'],
    [JOB_TYPES.EMAIL_COACH_INVITE, { trainerBusinessName: 'Biz', shareLinkCode: 'CODE1' }, 'https://app.example.com/join/CODE1'],
    [JOB_TYPES.EMAIL_CHILD_BLOCKED_SHARELINK, { guardianFirstName: 'G', childFirstName: 'C', shareLinkCode: 'CODE2' }, 'https://app.example.com/join/CODE2'],
    [JOB_TYPES.EMAIL_CHILD_APPROVAL_REQUEST, { playerName: 'Kid', amount: '10', paymentType: 'USD' }, 'https://app.example.com/approvals'],
    [JOB_TYPES.EMAIL_CHILD_APPROVAL_DECISION, { playerName: 'Kid', amount: '10', paymentType: 'TOKEN', decision: 'DENIED' }, 'https://app.example.com/'],
    [JOB_TYPES.EMAIL_COACH_OVERRIDE_NOTIFY, { coachFirstName: 'C', trainerBusinessName: 'Biz', reason: 'r' }, 'https://app.example.com/my-times'],
  ])('%s renders subject + html + text with an absolute link', (templateId, data, expectedLink) => {
    const mail = renderMail(templateId, data, CLIENT);

    expect(mail.subject.length).toBeGreaterThan(0);
    expect(mail.links).toEqual([expectedLink]);
    expect(mail.text).toContain(expectedLink);
    expect(mail.html).toContain(`href="${expectedLink}"`);
  });

  it('guardian notice uses the "Review Registration" CTA', () => {
    const mail = renderMail(
      JOB_TYPES.EMAIL_CHILD_BLOCKED_SHARELINK,
      { guardianFirstName: 'G', childFirstName: 'C', shareLinkCode: 'X' },
      CLIENT,
    );
    expect(mail.html).toContain('>Review Registration</a>');
  });

  it('guardian notice subject names the child and the trainer', () => {
    const mail = renderMail(
      JOB_TYPES.EMAIL_CHILD_BLOCKED_SHARELINK,
      { guardianFirstName: 'G', childFirstName: 'Alex Kid', trainerBusinessName: 'Ace Academy', shareLinkCode: 'X' },
      CLIENT,
    );
    expect(mail.subject).toBe("Alex Kid wants to join Ace Academy's program");
  });

  it.each([
    ['APPROVED', 'Your purchase request was approved'],
    ['DENIED', 'Your purchase request was denied'],
    ['EXPIRED', 'Your purchase request has expired'],
    ['INFO_REQUESTED', 'Your parent needs more information about your request'],
  ])('child decision email for %s has its own subject', (decision, subject) => {
    const mail = renderMail(JOB_TYPES.EMAIL_CHILD_APPROVAL_DECISION, { playerName: 'Kid', amount: '10', paymentType: 'USD', decision }, CLIENT);
    expect(mail.subject).toBe(subject);
  });

  it('token-spend notice (no decision) is rendered as an informational guardian email', () => {
    const mail = renderMail(JOB_TYPES.EMAIL_CHILD_APPROVAL_DECISION, { parentFirstName: 'P', playerName: 'Kid', amount: '5.00', title: 'Clinic' }, CLIENT);
    expect(mail.subject).toBe('Kid spent tokens (no approval needed)');
    expect(mail.text).toContain('5.00 tokens');
  });

  it('escapes user-controlled values in HTML but not in plain text', () => {
    const mail = renderMail(
      JOB_TYPES.EMAIL_COACH_INVITE,
      { trainerBusinessName: '<b>Evil</b> & Co', message: '"hi" <script>', shareLinkCode: 'C' },
      CLIENT,
    );
    expect(mail.html).not.toContain('<b>Evil</b>');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
    expect(mail.text).toContain('<b>Evil</b> & Co');
  });

  it('throws when the token a link needs is missing', () => {
    expect(() => renderMail(JOB_TYPES.EMAIL_VERIFICATION, { firstName: 'T' }, CLIENT)).toThrow(MailRenderError);
    expect(() => renderMail(JOB_TYPES.EMAIL_PASSWORD_RESET, undefined, CLIENT)).toThrow(/resetToken/);
  });

  it('throws on an unknown template id', () => {
    expect(() => renderMail('NOPE', {}, CLIENT)).toThrow(/No mail template/);
  });
});

describe('buildClientUrl / escapeHtml', () => {
  it('joins without a double slash', () => {
    expect(buildClientUrl('http://x/', '/a', { t: '1' })).toBe('http://x/a?t=1');
    expect(buildClientUrl('http://x', '/a')).toBe('http://x/a');
  });

  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
