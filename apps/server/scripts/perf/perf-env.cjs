'use strict';
/**
 * Single source of truth for the isolated performance stack (port, database, env).
 * Same approach as apps/e2e/scripts/e2e-env.cjs: the root `.env` is parsed
 * PROGRAMMATICALLY (dotenv.parse) and never printed or copied anywhere. The
 * dev database and the Playwright database (`practiceperfect_e2e`) are never
 * touched: the perf run owns its own database, `practiceperfect_perf`.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const SERVER_DIR = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(SERVER_DIR, '..', '..');

const API_PORT = Number(process.env.PERF_API_PORT ?? 3200);
const API_URL = `http://localhost:${API_PORT}`;
const PERF_DB_NAME = process.env.PERF_DB_NAME ?? 'practiceperfect_perf';
const USER_COUNT = Number(process.env.PERF_USER_COUNT ?? 10000);
/** The compiled API lives here (NOT apps/server/dist, which `nest start --watch` owns). */
const SERVER_OUT_DIR = path.join(SERVER_DIR, '.perf-dist');
const UPLOADS_DIR = path.join(SERVER_DIR, '.perf-uploads');
/** Shared plaintext password of every seeded perf user (throwaway database, never a real credential). */
const PERF_USER_PASSWORD = 'PerfLoad2026x';

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

/** Connection strings derived from the root .env DATABASE_URL (or PERF_DATABASE_URL). */
function databaseUrls() {
  const rootEnv = loadRootEnv();
  const base = process.env.PERF_DATABASE_URL ?? process.env.DATABASE_URL ?? rootEnv.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL not found (root .env or process env); cannot derive the perf database URL.');
  const perfUrl = process.env.PERF_DATABASE_URL ?? swapDatabase(base, PERF_DB_NAME);
  const dbName = decodeURIComponent(new URL(perfUrl).pathname.slice(1));
  const originalDb = decodeURIComponent(new URL(base).pathname.slice(1));
  if (!process.env.PERF_DATABASE_URL && dbName === originalDb) {
    throw new Error(`Refusing to use the dev database "${originalDb}" for the perf run.`);
  }
  if (dbName === 'practiceperfect_e2e') {
    throw new Error('Refusing to use the Playwright database "practiceperfect_e2e" for the perf run.');
  }
  return { perfUrl, adminUrl: swapDatabase(base, 'postgres'), dbName };
}

/** Env for the perf NestJS API process and the seed scripts (merged over process.env by the launcher). */
function apiEnv() {
  const rootEnv = loadRootEnv();
  const { perfUrl } = databaseUrls();
  return {
    ...rootEnv, // JWT_SECRET, SEED_SUPER_ADMIN_* ... (never printed)
    DATABASE_URL: perfUrl,
    PORT: String(API_PORT),
    CLIENT_URL: 'http://localhost:3101',
    NODE_ENV: 'development',
    MAIL_PROVIDER: 'console',
    RATE_LIMITS_DISABLED: 'true',
    SCHEDULER_ENABLED: 'false', // keep cron sweeps out of the measurements
    PUBLIC_API_URL: API_URL,
    UPLOADS_DIR,
    PERF_USER_COUNT: String(USER_COUNT),
    PERF_USER_PASSWORD,
  };
}

/** Seeded Super Admin credentials (SEED_SUPER_ADMIN_* in the root .env / process env). */
function seedCredentials() {
  const rootEnv = loadRootEnv();
  return {
    email: process.env.SEED_SUPER_ADMIN_EMAIL ?? rootEnv.SEED_SUPER_ADMIN_EMAIL,
    password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? rootEnv.SEED_SUPER_ADMIN_PASSWORD,
  };
}

module.exports = {
  ROOT,
  SERVER_DIR,
  API_PORT,
  API_URL,
  PERF_DB_NAME,
  USER_COUNT,
  SERVER_OUT_DIR,
  UPLOADS_DIR,
  PERF_USER_PASSWORD,
  serverRequire,
  loadRootEnv,
  databaseUrls,
  apiEnv,
  seedCredentials,
};
