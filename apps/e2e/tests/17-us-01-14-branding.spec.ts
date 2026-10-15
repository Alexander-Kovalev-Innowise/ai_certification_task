import { test, expect, highlight, shell, createTrainer, createCoach, makePng, makeSvg } from '../support/test';
import type { Page } from '@playwright/test';

/**
 * US-01.14 - Trainer customises portal branding (logo upload + primary colour).
 * Logo: PNG/JPG/SVG up to 2MB (server stores a 200x200-bounded PNG; SVG is rasterised). Colour: hex.
 * Branding is applied to the trainer's own portal and to the portal of the trainer's coaches. "Reset to default" restores it.
 */
test.describe('US-01.14: Trainer customises portal branding', () => {
  const DEFAULT_ACCENT = '#00b300';
  const BRAND = '#1e5adc';

  const accentOf = (page: Page) =>
    page
      .locator('[data-branding]')
      .first()
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--brand-primary').trim().toLowerCase());

  const portalLogo = (page: Page) => shell(page).sidebar.getByAltText('Portal logo');
  const logoLoaded = (page: Page) => portalLogo(page).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

  test('upload a PNG logo and pick a colour: live preview before save, applied to the trainer and to their coach after save', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const otherTrainer = await createTrainer(api, mailbox);
    const app = shell(page);

    await narrate('Trainer signs in: default logo and default accent colour');
    await loginAs(trainer.email, trainer.password);
    await expect(portalLogo(page)).toHaveAttribute('src', /default_logo\.svg/);
    expect(await accentOf(page)).toBe(DEFAULT_ACCENT);

    await narrate('Navigate to Branding');
    await app.goTo('Branding');
    await expect(page.getByRole('heading', { name: 'Branding', level: 1 })).toBeVisible();

    await narrate('Choose a PNG logo - a preview appears before saving');
    await page.getByLabel('Logo', { exact: true }).setInputFiles({ name: 'brand-logo.png', mimeType: 'image/png', buffer: makePng([30, 90, 220], 300) });
    const logoPreview = page.getByAltText('Logo preview').first();
    await expect(logoPreview).toBeVisible();
    await expect(logoPreview).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await highlight(logoPreview);

    await narrate('Pick a primary colour - the live preview updates in real time');
    await page.getByLabel('Hex color').fill('#1E5ADC');
    const previewButton = page.getByTestId('branding-live-preview').getByRole('button', { name: 'Preview button' });
    await expect(previewButton).toHaveCSS('background-color', 'rgb(30, 90, 220)');
    await highlight(page.getByTestId('branding-live-preview'));

    await narrate('Nothing is applied to the portal until Save is pressed');
    expect(await accentOf(page)).toBe(DEFAULT_ACCENT);
    await expect(portalLogo(page)).toHaveAttribute('src', /default_logo\.svg/);

    await narrate('Save branding');
    await page.getByRole('button', { name: 'Save branding' }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Branding saved.' });
    await expect(saved).toBeVisible();
    await highlight(saved);

    await narrate('The sidebar logo and the accent colour change immediately');
    await expect(portalLogo(page)).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await expect.poll(() => accentOf(page)).toBe(BRAND);
    await expect.poll(() => logoLoaded(page)).toBe(true);
    await highlight(app.sidebar);

    await narrate('The WCAG contrast advisory is non-blocking and can be dismissed');
    const dismiss = page.getByRole('button', { name: 'Dismiss contrast warning' });
    await expect(dismiss).toBeVisible();
    await dismiss.click();
    await expect(dismiss).toBeHidden();

    await narrate('A hard reload keeps the branding (stored on the trainer profile)');
    await page.reload();
    await expect(portalLogo(page)).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await expect.poll(() => accentOf(page)).toBe(BRAND);

    await narrate('The trainer\'s dashboard shows the logo and colour too');
    await app.goTo('Dashboard');
    await expect(page.getByAltText(`${trainer.businessName} logo`)).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await expect(page.getByText(BRAND.toUpperCase())).toBeVisible();

    await narrate('Now the trainer\'s coach signs in: same logo and accent colour');
    await app.signOut();
    await loginAs(coach.email, coach.password);
    await expect(portalLogo(page)).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await expect.poll(() => accentOf(page)).toBe(BRAND);
    await expect.poll(() => logoLoaded(page)).toBe(true);
    await expect(page.getByAltText(`${trainer.businessName} logo`)).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await highlight(app.sidebar);

    await narrate('Another trainer is NOT affected (tenant isolation)');
    await app.signOut();
    await loginAs(otherTrainer.email, otherTrainer.password);
    await expect(portalLogo(page)).toHaveAttribute('src', /default_logo\.svg/);
    expect(await accentOf(page)).toBe(DEFAULT_ACCENT);
    const cross = await api.patch(`/trainers/${trainer.trainerId}/branding`, { auth: otherTrainer.session, body: { primaryColorHex: '#FF0000' } });
    expect(cross.status).toBe(404);
  });

  test('an SVG logo is accepted (rasterised to PNG on the server) and shown in the portal', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Branding');

    await narrate('Choose an SVG logo');
    await page.getByLabel('Logo', { exact: true }).setInputFiles({ name: 'brand-logo.svg', mimeType: 'image/svg+xml', buffer: makeSvg('#d62828') });
    const preview = page.getByAltText('Logo preview').first();
    await expect(preview).toBeVisible();
    await narrate('The server stores a PNG version (never the raw SVG)');
    await expect(preview).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);

    await page.getByLabel('Hex color').fill('#D62828');
    await page.getByRole('button', { name: 'Save branding' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Branding saved.' })).toBeVisible();
    await expect(portalLogo(page)).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await expect.poll(() => logoLoaded(page)).toBe(true);
    await expect.poll(() => accentOf(page)).toBe('#d62828');
    await highlight(portalLogo(page));
  });

  test('invalid files and colours are rejected (type, 2MB size, hex format; server re-validates)', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Branding');
    const fileInput = page.getByLabel('Logo', { exact: true });

    await narrate('A PDF/text file is not an accepted logo type');
    await fileInput.setInputFiles({ name: 'logo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake') });
    const typeError = page.getByRole('alert').filter({ hasText: 'Unsupported file type. Use PNG, JPEG, WebP or SVG.' });
    await expect(typeError).toBeVisible();
    await highlight(typeError);

    await narrate('A file larger than 2MB is refused');
    await fileInput.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 2048, 7) });
    const sizeError = page.getByRole('alert').filter({ hasText: 'The image is larger than 2MB. Choose a smaller file.' });
    await expect(sizeError).toBeVisible();
    await highlight(sizeError);

    await narrate('A file that only CLAIMS to be a PNG is refused by the server');
    await fileInput.setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is definitely not a png image') });
    const serverError = page.getByRole('alert').filter({ hasText: 'Something went wrong uploading your logo. Please try again.' });
    await expect(serverError).toBeVisible();
    await highlight(serverError);

    await narrate('The colour must be a hex code');
    const hex = page.getByLabel('Hex color');
    await hex.fill('not-a-colour');
    await page.getByRole('button', { name: 'Save branding' }).click();
    const hexError = page.getByRole('alert').filter({ hasText: 'Enter a valid hex color, e.g. #00B300.' });
    await expect(hexError).toBeVisible();
    await highlight(hexError);
    await expect(page.getByText('Branding saved.')).toHaveCount(0);

    await narrate('A short hex like "6ee" is normalised to #66eeee on blur');
    await hex.fill('6ee');
    await hex.blur();
    await expect(hex).toHaveValue('#66eeee');

    await narrate('The API enforces the same rules: oversize / non-image uploads and bad hex codes -> 400');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(Buffer.alloc(2 * 1024 * 1024 + 2048, 7))], { type: 'image/png' }), 'big.png');
    const big = await fetch(`${api.baseUrl}/storage/logo`, { method: 'POST', headers: { Authorization: `Bearer ${trainer.session.accessToken}` }, body: form });
    expect(big.status).toBe(400);
    const badHex = await api.patch(`/trainers/${trainer.trainerId}/branding`, { auth: trainer.session, body: { primaryColorHex: 'red' } });
    expect(badHex.status).toBe(400);
  });

  test('"Reset to default" restores the platform logo and accent for the trainer and their coach', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const app = shell(page);

    // Arrange a customised portal through the API (the UI for it is covered above).
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(makePng([200, 40, 40], 120))], { type: 'image/png' }), 'logo.png');
    const upload = await fetch(`${api.baseUrl}/storage/logo`, { method: 'POST', headers: { Authorization: `Bearer ${trainer.session.accessToken}` }, body: form });
    expect(upload.status).toBe(201);
    const { logoUrl } = (await upload.json()) as { logoUrl: string };
    const patched = await api.patch(`/trainers/${trainer.trainerId}/branding`, { auth: trainer.session, body: { logoUrl, primaryColorHex: '#C82828' } });
    expect(patched.status).toBe(200);

    await narrate('Trainer\'s portal is customised');
    await loginAs(trainer.email, trainer.password);
    await expect(portalLogo(page)).toHaveAttribute('src', /\/uploads\/logo-.*\.png/);
    await expect.poll(() => accentOf(page)).toBe('#c82828');

    await narrate('Branding -> "Reset to default"');
    await app.goTo('Branding');
    await expect(page.getByLabel('Hex color')).toHaveValue('#C82828');
    await page.getByRole('button', { name: 'Reset to default' }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Branding reset to the default.' });
    await expect(toast).toBeVisible();
    await highlight(toast);

    await narrate('Logo and accent go back to the platform defaults immediately');
    await expect(portalLogo(page)).toHaveAttribute('src', /default_logo\.svg/);
    await expect.poll(() => accentOf(page)).toBe(DEFAULT_ACCENT);
    await expect(page.getByLabel('Hex color')).toHaveValue('#00B300');
    // Only the live preview remains, showing the platform default mark.
    await expect(page.getByAltText('Logo preview')).toHaveCount(1);
    await expect(page.getByAltText('Logo preview')).toHaveAttribute('src', /default_logo\.svg/);

    await narrate('The coach sees the defaults too');
    await app.signOut();
    await loginAs(coach.email, coach.password);
    await expect(portalLogo(page)).toHaveAttribute('src', /default_logo\.svg/);
    expect(await accentOf(page)).toBe(DEFAULT_ACCENT);
  });
});
