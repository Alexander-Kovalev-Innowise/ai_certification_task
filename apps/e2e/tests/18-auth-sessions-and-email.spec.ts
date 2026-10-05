import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  showEmail,
  expireResetTokens,
  expireVerificationTokens,
  strongPassword,
  uniqueEmail,
} from '../support/test';

/**
 * Epic-01 section 3 / 9 / 13: email+password sign-in, password reset (1h link), email verification (24h link),
 * voluntary password change, session handling (refresh cookie, logout, logout-everywhere, token rotation).
 * Login rate limiting is DISABLED in the e2e stack (RATE_LIMITS_DISABLED) and therefore not covered here.
 */
test.describe('Auth: sign-in form, password reset, email verification, sessions', () => {
  test('sign-in form validates input and never reveals whether an email exists', async ({ page, api, mailbox, narrate }) => {
    const trainer = await createTrainer(api, mailbox);
    await page.goto('/login');

    await narrate('Empty form: both fields are required');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email is required.')).toBeVisible();
    await expect(page.getByText('Password is required.')).toBeVisible();

    await narrate('A malformed email is flagged');
    await page.getByLabel('Email').fill('nope');
    await page.getByLabel('Password', { exact: true }).fill('whatever1A');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address, e.g. name@example.com.')).toBeVisible();

    await narrate('Show / hide password toggle');
    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await narrate('Wrong password for a REAL account...');
    await page.getByLabel('Email').fill(trainer.email);
    await password.fill('Wrong-Password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const wrong = page.getByRole('alert').filter({ hasText: 'Invalid email or password.' });
    await expect(wrong).toBeVisible();

    await narrate('...and an UNKNOWN email give exactly the same message (no account enumeration)');
    await page.getByLabel('Email').fill(uniqueEmail('ghost'));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' })).toBeVisible();
    await highlight(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' }));
    await expect(page).toHaveURL(/\/login/);

    await narrate('Correct credentials sign the trainer in to their own dashboard');
    await page.getByLabel('Email').fill(trainer.email);
    await password.fill(trainer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
  });

  test('password reset end to end through the mailbox (link is single-use, old password stops working, sessions are revoked)', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const newPassword = strongPassword();
    await mailbox.clear();

    await narrate('"Forgot your password?" on the sign-in page');
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: /reset|forgot/i }).first()).toBeVisible();
    await page.getByLabel('Email').fill(trainer.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    const sent = page.getByRole('status').filter({ hasText: "If that email exists, we've sent a link to reset your password." });
    await expect(sent).toBeVisible();
    await highlight(sent);

    await narrate('The reset email arrives with a link');
    const mail = await mailbox.waitFor(trainer.email, { subject: /Reset your .* password/i });
    const link = await mailbox.linkTo(trainer.email, /reset-password\?token=/);
    await showEmail(page, mail);

    await narrate('Open the link: choose a new password (policy enforced)');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
    await page.getByLabel('New password').fill('short');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
    await page.getByLabel('New password').fill('alllowercase');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Password must include an uppercase letter, a lowercase letter, and a number.')).toBeVisible();
    await page.getByLabel('New password').fill(newPassword);
    await page.getByRole('button', { name: 'Reset password' }).click();
    const done = page.getByRole('status').filter({ hasText: 'Your password has been reset. You can now sign in.' });
    await expect(done).toBeVisible();
    await highlight(done);

    await narrate('Old sessions are revoked (reset = logout everywhere)');
    expect((await api.get('/me', { auth: trainer.session })).status).toBe(401);

    await narrate('The link cannot be reused');
    await page.goto(link);
    await page.getByLabel('New password').fill(strongPassword());
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' })).toBeVisible();

    await narrate('The OLD password no longer works');
    await page.goto('/login');
    await page.getByLabel('Email').fill(trainer.email);
    await page.getByLabel('Password', { exact: true }).fill(trainer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' })).toBeVisible();

    await narrate('The NEW password signs in');
    await loginAs(trainer.email, newPassword);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
  });

  test('reset request for an unknown email gets the same answer and sends no mail; expired (1h) and bogus links are refused', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const ghost = uniqueEmail('ghost');

    await narrate('Unknown email: identical confirmation message');
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(ghost);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status').filter({ hasText: "If that email exists, we've sent a link to reset your password." })).toBeVisible();
    await narrate('...and nothing is mailed');
    expect(await mailbox.list(ghost)).toHaveLength(0);

    await narrate('Request a real reset link, then let it "age" past 1 hour');
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(trainer.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    const link = await mailbox.linkTo(trainer.email, /reset-password\?token=/);
    await expireResetTokens(trainer.email);

    await page.goto(link);
    await page.getByLabel('New password').fill(strongPassword());
    await page.getByRole('button', { name: 'Reset password' }).click();
    const expired = page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' });
    await expect(expired).toBeVisible();
    await highlight(expired);

    await narrate('A made-up token or a missing token is refused too');
    await page.goto('/reset-password?token=bogus-token');
    await page.getByLabel('New password').fill(strongPassword());
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' })).toBeVisible();
    await page.goto('/reset-password');
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' })).toBeVisible();
  });

  test('email verification: banner, resend, link verifies and the banner disappears', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const first = await mailbox.waitFor(trainer.email, { subject: /Verify your .* email/i });
    const firstLink = first.links.find((l) => /verify-email\?token=/.test(l))!;
    expect(firstLink).toBeTruthy();

    await narrate('A freshly set-up account is not verified: a non-blocking banner shows on every page');
    await loginAs(trainer.email, trainer.password);
    const banner = page.getByRole('status').filter({ hasText: 'Verify your email to unlock all features.' });
    await expect(banner).toBeVisible();
    await highlight(banner);
    await shell(page).goTo('Coaches');
    await expect(banner).toBeVisible();

    await narrate('The banner can be dismissed (it returns on the next sign-in)');
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(banner).toBeVisible();

    await narrate('Resend the verification email');
    await banner.getByRole('button', { name: 'Resend verification email' }).click();
    await expect(banner.getByRole('button', { name: 'Sent' })).toBeVisible();
    await expect.poll(async () => (await mailbox.list(trainer.email)).filter((m) => /Verify your/.test(m.subject)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    const mails = (await mailbox.list(trainer.email)).filter((m) => /Verify your/.test(m.subject));
    const latestLink = mails[mails.length - 1].links.find((l) => /verify-email\?token=/.test(l))!;
    expect(latestLink).not.toBe(firstLink);

    await narrate('The previous link was invalidated by the resend');
    await page.goto(firstLink);
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' })).toBeVisible();

    await narrate('The new link verifies the address');
    await showEmail(page, mails[mails.length - 1]);
    await page.goto(latestLink);
    const verified = page.getByRole('status').filter({ hasText: 'Your email has been verified.' });
    await expect(verified).toBeVisible();
    await highlight(verified);
    await page.getByRole('link', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();

    await narrate('Verified: the banner is gone');
    await expect(page.getByText('Verify your email to unlock all features.')).toHaveCount(0);

    await narrate('The verification link is single-use');
    await page.goto(latestLink);
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' })).toBeVisible();
  });

  test('an expired (24h) verification link is refused', async ({ page, api, mailbox, narrate }) => {
    const trainer = await createTrainer(api, mailbox);
    const mail = await mailbox.waitFor(trainer.email, { subject: /Verify your .* email/i });
    const link = mail.links.find((l) => /verify-email\?token=/.test(l))!;
    await expireVerificationTokens(trainer.email);

    await narrate('Open a verification link that is older than 24 hours');
    await page.goto(link);
    const alert = page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' });
    await expect(alert).toBeVisible();
    await highlight(alert);
    await narrate('No token at all');
    await page.goto('/verify-email');
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' })).toBeVisible();
  });

  test('voluntary password change from the Account page requires the current password and signs the user out', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const next = strongPassword();
    await loginAs(trainer.email, trainer.password);

    await narrate('Account -> "Change password"');
    await shell(page).goTo('Account');
    await page.getByRole('link', { name: 'Change password' }).click();
    await expect(page.getByRole('heading', { name: 'Change your password' })).toBeVisible();

    await narrate('A wrong current password is rejected');
    await page.getByLabel('Current password').fill('Not-My-Password-1');
    await page.getByLabel('New password').fill(next);
    await page.getByRole('button', { name: 'Change password' }).click();
    const wrong = page.getByRole('alert').filter({ hasText: 'Current password is incorrect.' });
    await expect(wrong).toBeVisible();
    await highlight(wrong);

    await narrate('Correct current password + a policy-compliant new one');
    await page.getByLabel('Current password').fill(trainer.password);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    await narrate('Every session was revoked; the new password works, the old one does not');
    expect((await api.get('/me', { auth: trainer.session })).status).toBe(401);
    await page.getByLabel('Email').fill(trainer.email);
    await page.getByLabel('Password', { exact: true }).fill(trainer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' })).toBeVisible();
    await loginAs(trainer.email, next);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
  });

  test('sessions: reload keeps the user signed in; sign-out clears the session; deleting the cookie ends it', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
    context,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const app = shell(page);

    await narrate('Sign in, then hard-reload several pages: the refresh cookie restores the session each time');
    await loginAs(trainer.email, trainer.password);
    await page.reload();
    await expect(app.userMenuButton).toContainText(trainer.firstName);
    await app.goTo('Branding');
    await page.reload();
    await expect(page).toHaveURL(/\/branding/);
    await expect(app.userMenuButton).toContainText(trainer.firstName);

    await narrate('Sign out: protected pages bounce to /login, and Back does not restore the session');
    await app.signOut();
    await expect(page).toHaveURL(/\/login/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await page.goto('/coaches');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    await narrate('Sign in again, then drop the refresh cookie (session expiry): the next load requires a login');
    await loginAs(trainer.email, trainer.password);
    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name === 'refreshToken')).toBe(true);
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  });

  test('logout everywhere revokes every session; refresh tokens rotate and a replayed one is rejected', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);

    await narrate('Sign in in the browser (session #1)');
    await loginAs(trainer.email, trainer.password);
    await expect(shell(page).userMenuButton).toContainText(trainer.firstName);

    await narrate('A second device (API session #2) signs in too, then uses "logout everywhere"');
    const second = await api.login(trainer.email, trainer.password);
    expect((await api.get('/me', { auth: second })).status).toBe(200);
    const out = await api.post('/auth/logout', { auth: second, query: { everywhere: true }, headers: { Cookie: second.cookie, 'X-CSRF-Token': second.csrfToken } });
    expect(out.status).toBe(204);
    expect((await api.get('/me', { auth: second })).status).toBe(401);

    await narrate('The browser session is gone as well: after a reload the user must sign in again');
    await page.reload();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    await narrate('Refresh-token rotation: each refresh issues a new cookie; replaying the old one is rejected');
    const s1 = await api.login(trainer.email, trainer.password);
    const s2 = await api.refresh(s1);
    expect(s2.cookie).not.toBe(s1.cookie);
    const replay = await api.post('/auth/refresh', { headers: { Cookie: s1.cookie, 'X-CSRF-Token': s1.csrfToken } });
    expect(replay.status).toBe(401);
    // theft detection revokes the whole token family
    const afterReplay = await api.post('/auth/refresh', { headers: { Cookie: s2.cookie, 'X-CSRF-Token': s2.csrfToken } });
    expect(afterReplay.status).toBe(401);
  });
});
