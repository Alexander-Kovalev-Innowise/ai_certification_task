'use strict';
/**
 * Single source of truth for the isolated e2e stack (ports, database, env).
 * Plain CommonJS so it can be required by BOTH `playwright.config.ts` and the
 * node launch scripts in this folder.
 *
 * The root `.env` is loaded PROGRAMMATICALLY (dotenv.parse) and is never
 * printed or copied anywhere.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const E2E_DIR = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'apps', 'server');
const CLIENT_DIR = path.join(ROOT, 'apps', 'client');

const API_PORT = Number(process.env.E2E_API_PORT ?? 3100);
const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT ?? 3101);
const API_URL = `http://localhost:${API_PORT}`;
const CLIENT_URL = `http://localhost:${CLIENT_PORT}`;
const E2E_DB_NAME = process.env.E2E_DB_NAME ?? 'practiceperfect_e2e';
const UPLOADS_DIR = path.join(E2E_DIR, '.uploads');
/** The e2e API is compiled here (NOT apps/server/dist, which the dev watcher owns). */
const SERVER_OUT_DIR = path.join(SERVER_DIR, '.e2e-dist');
/** A throwaway snapshot of apps/client so `next dev` gets its own .next + lock. */
const CLIENT_SNAPSHOT_DIR = path.join(E2E_DIR, '.client-snapshot');

/**
 * The "strict" stack: a second API + client pair (ports 3102 / 3103, same e2e database) for the few
 * specs that need the production behaviour the main stack switches off - rate limits ON and a SHORT
 * impersonation lifetime. Started lazily by the `strictStack` fixture (support/strict-stack.ts), never by
 * Playwright's webServer, so it only exists for runs that include a `*.strict.spec.ts`.
 */
const STRICT_API_PORT = Number(process.env.E2E_STRICT_API_PORT ?? 3102);
const STRICT_CLIENT_PORT = Number(process.env.E2E_STRICT_CLIENT_PORT ?? 3103);
const STRICT_API_URL = `http://localhost:${STRICT_API_PORT}`;
const STRICT_CLIENT_URL = `http://localhost:${STRICT_CLIENT_PORT}`;
const STRICT_CLIENT_SNAPSHOT_DIR = path.join(E2E_DIR, '.client-snapshot-strict');
/** Impersonation lifetime on the strict API, in seconds (the spec'd 1 hour is 3600). */
const STRICT_IMPERSONATION_TTL_SECONDS = 45;

// Resolve tooling from apps/server's dependency tree (pg, dotenv, prisma, ts-node, typescript).
const serverRequire = createRequire(path.join(SERVER_DIR, 'package.json'));

function loadRootEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  return serverRequire('dotenv').parse(fs.readFileSync(file));
}

function swapDatabase(connectionString, dbName) {
  const url = new URL(connectionString);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** Connection strings derived from the root .env DATABASE_URL (or E2E_DATABASE_URL). */
function databaseUrls() {
  const rootEnv = loadRootEnv();
  const base = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? rootEnv.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL not found (root .env or process env); cannot derive the e2e database URL.');
  const e2eUrl = process.env.E2E_DATABASE_URL ?? swapDatabase(base, E2E_DB_NAME);
  const dbName = decodeURIComponent(new URL(e2eUrl).pathname.slice(1));
  const originalDb = decodeURIComponent(new URL(base).pathname.slice(1));
  if (!process.env.E2E_DATABASE_URL && dbName === originalDb) {
    throw new Error(`Refusing to use the dev database "${originalDb}" for e2e.`);
  }
  return { e2eUrl, adminUrl: swapDatabase(base, 'postgres'), dbName };
}

/** Env for the e2e NestJS API process (merged over process.env by the launcher). */
function apiEnv() {
  const rootEnv = loadRootEnv();
  const { e2eUrl } = databaseUrls();
  return {
    ...rootEnv, // JWT_SECRET, SEED_SUPER_ADMIN_*, ... (the server also self-loads these; explicit here for the seed)
    DATABASE_URL: e2eUrl,
    PORT: String(API_PORT),
    CLIENT_URL,
    NODE_ENV: 'development',
    MAIL_PROVIDER: 'dev',
    RATE_LIMITS_DISABLED: 'true',
    SCHEDULER_ENABLED: 'true',
    PUBLIC_API_URL: API_URL,
    UPLOADS_DIR,
  };
}

/**
 * Env for the strict API: the main stack's env, but with rate limits ON (RATE_LIMITS_DISABLED=false - the
 * production default), a short impersonation lifetime, its own port/client origin, and the background jobs OFF
 * (a second outbox pump on the shared database would steal e-mails from the main API's dev mailbox).
 */
function strictApiEnv() {
  return {
    ...apiEnv(),
    PORT: String(STRICT_API_PORT),
    CLIENT_URL: STRICT_CLIENT_URL,
    PUBLIC_API_URL: STRICT_API_URL,
    RATE_LIMITS_DISABLED: 'false',
    IMPERSONATION_TTL_SECONDS: String(STRICT_IMPERSONATION_TTL_SECONDS),
    SCHEDULER_ENABLED: 'false',
  };
}

/** Seeded Super Admin credentials (from SEED_SUPER_ADMIN_* in the root .env / process env). */
function seedCredentials() {
  const rootEnv = loadRootEnv();
  return {
    email: process.env.SEED_SUPER_ADMIN_EMAIL ?? rootEnv.SEED_SUPER_ADMIN_EMAIL,
    password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? rootEnv.SEED_SUPER_ADMIN_PASSWORD,
  };
}

module.exports = {
  ROOT,
  E2E_DIR,
  SERVER_DIR,
  CLIENT_DIR,
  API_PORT,
  CLIENT_PORT,
  API_URL,
  CLIENT_URL,
  E2E_DB_NAME,
  UPLOADS_DIR,
  SERVER_OUT_DIR,
  CLIENT_SNAPSHOT_DIR,
  serverRequire,
  loadRootEnv,
  databaseUrls,
  apiEnv,
  strictApiEnv,
  STRICT_API_PORT,
  STRICT_CLIENT_PORT,
  STRICT_API_URL,
  STRICT_CLIENT_URL,
  STRICT_CLIENT_SNAPSHOT_DIR,
  STRICT_IMPERSONATION_TTL_SECONDS,
  seedCredentials,
};
