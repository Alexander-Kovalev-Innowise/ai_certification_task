import * as zlib from 'node:zlib';

import { expect } from '@playwright/test';

import type { ApiClient, ApiSession } from './api';
import { strongPassword, uniqueEmail, uniqueName } from './ids';
import type { Mailbox } from './mailbox';

/**
 * Arrange-by-API helpers: create the data a story needs WITHOUT driving the UI,
 * so the test video only shows the behaviour that is actually under test.
 */

export interface TrainerFixture {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  businessName: string;
  phone: string;
  userId: string;
  /** TrainerProfile id (what /trainers/:id and /coaches/invite use). */
  trainerId: string;
  /** The (already consumed) one-time setup link from the invite email. */
  setupLink: string;
  session: ApiSession;
}

export interface CoachFixture {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** CoachProfile id (what /coaches/:id/availability uses). */
  coachId: string;
  userId: string;
  session: ApiSession;
}

/** A valid E.164 number the server's libphonenumber validator accepts (unique-ish last digits). */
export function validPhone(): string {
  return `+1415555${String(Math.floor(1000 + Math.random() * 8999))}`;
}

/** Super Admin creates a trainer, the setup link from the mailbox is completed, returns a logged-in session. */
export async function createTrainer(api: ApiClient, mailbox: Mailbox, overrides: Partial<Pick<TrainerFixture, 'businessName'>> = {}): Promise<TrainerFixture> {
  const admin = await api.superAdmin();
  const email = uniqueEmail('trainer');
  const { firstName, lastName } = uniqueName('Trainer');
  const businessName = overrides.businessName ?? `${lastName} Academy`;
  const phone = validPhone();

  const created = await api.post<{ id: string; userId: string }>('/trainers', {
    auth: admin,
    body: { businessName, firstName, lastName, email, phone },
  });
  expect(created.status, `POST /trainers -> ${JSON.stringify(created.body)}`).toBe(201);

  const link = await mailbox.linkTo(email, /register\?token=/);
  const token = new URL(link).searchParams.get('token');
  expect(token).toBeTruthy();

  const password = strongPassword();
  const registered = await api.post('/auth/register', { body: { setupToken: token, password } });
  expect(registered.status, `POST /auth/register -> ${JSON.stringify(registered.body)}`).toBeLessThan(300);

  const session = await api.login(email, password);
  return { email, password, firstName, lastName, businessName, phone, userId: created.body.userId, trainerId: created.body.id, setupLink: link, session };
}

/** Trainer invites a coach by email, the coach accepts through the join link (anonymous accept), returns a coach session. */
export async function createCoach(api: ApiClient, mailbox: Mailbox, trainer: TrainerFixture): Promise<CoachFixture> {
  const email = uniqueEmail('coach');
  const { firstName, lastName } = uniqueName('Coach');
  const invite = await api.post('/coaches/invite', { auth: trainer.session, body: { email, name: `${firstName} ${lastName}` } });
  expect(invite.status, `POST /coaches/invite -> ${JSON.stringify(invite.body)}`).toBe(201);

  const link = await mailbox.linkTo(email, /\/join\//);
  const code = decodeURIComponent(new URL(link).pathname.split('/').pop() ?? '');

  const password = strongPassword();
  const redeemed = await api.post('/share-links/' + encodeURIComponent(code) + '/redeem', { body: { password, firstName, lastName } });
  expect(redeemed.status, `redeem coach link -> ${JSON.stringify(redeemed.body)}`).toBeLessThan(300);

  const session = await api.login(email, password);
  const roster = await api.get<{ items: Array<{ id: string; userId: string | null; email: string }> }>(`/trainers/${trainer.trainerId}/coaches`, {
    auth: trainer.session,
  });
  const row = roster.body.items.find((r) => r.email === email);
  expect(row, 'coach appears on the roster').toBeTruthy();
  return { email, password, firstName, lastName, coachId: row!.id, userId: session.user.id, session };
}

/** Next calendar date (local, YYYY-MM-DD) that falls on `dayOfWeek` (0 = Sunday ... 6 = Saturday), at least 1 day ahead. */
export function nextDateOnWeekday(dayOfWeek: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- tiny image generators (no dependencies) --------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A solid-colour PNG of `size` x `size` pixels (RGB). */
export function makePng(rgb: [number, number, number] = [220, 30, 90], size = 64): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A tiny valid SVG (a coloured circle). */
export function makeSvg(fill = '#1e5adc'): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" fill="#ffffff"/><circle cx="60" cy="60" r="48" fill="${fill}"/></svg>`,
    'utf8',
  );
}

/**
 * Renders a dev-mailbox message in the page so the video shows the email the user "received".
 * Replaces the current document (callers navigate / reload afterwards).
 */
export async function showEmail(page: import('@playwright/test').Page, mail: { subject: string; html: string }, ms = 2200): Promise<void> {
  await page.setContent(mail.html, { waitUntil: 'domcontentloaded' });
  await page.evaluate((subject) => {
    const bar = document.createElement('div');
    bar.textContent = `Inbox - ${subject}`;
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:8px 14px;background:#111;color:#fff;font:600 14px system-ui;z-index:99999';
    document.body.appendChild(bar);
    document.body.style.paddingTop = '40px';
  }, mail.subject);
  await page.waitForTimeout(ms);
}

export interface PlayerFixture {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  userId: string;
  session: ApiSession;
}

/** An adult player/parent who registered through the trainer's static player ShareLink (isSelf = true). */
export async function createPlayer(api: ApiClient, trainer: TrainerFixture): Promise<PlayerFixture> {
  const link = await api.post<{ code: string }>('/share-links', { auth: trainer.session, body: { type: 'PLAYER_STATIC' } });
  expect(link.status, `POST /share-links -> ${JSON.stringify(link.body)}`).toBeLessThan(300);
  const email = uniqueEmail('player');
  const { firstName, lastName } = uniqueName('Player');
  const password = strongPassword();
  const redeemed = await api.post(`/share-links/${encodeURIComponent(link.body.code)}/redeem`, {
    body: { email, password, phone: validPhone(), playerName: `${firstName} ${lastName}`, dateOfBirth: '1990-05-05', gender: 'MALE', isSelf: true },
  });
  expect(redeemed.status, `redeem player link -> ${JSON.stringify(redeemed.body)}`).toBeLessThan(300);
  const session = await api.login(email, password);
  return { email, password, firstName, lastName, userId: session.user.id, session };
}
