'use strict';
/**
 * Launches the ISOLATED e2e API (port 3100, database `practiceperfect_e2e`).
 *
 * Playwright starts `webServer` entries BEFORE globalSetup, and the API needs a
 * migrated + seeded database to boot, so the DB preparation lives here:
 *   1. CREATE DATABASE practiceperfect_e2e if missing (E2E_RESET_DB=1 drops it first)
 *   2. prisma migrate deploy
 *   3. seed the Super Admin (idempotent)
 *   4. compile apps/server to apps/server/.e2e-dist (incremental tsc) — a separate
 *      out dir so we never clobber the `nest start --watch` dist of the dev server
 *   5. exec `node .e2e-dist/main.js` with the e2e env
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./e2e-env.cjs');

function log(msg) {
  console.log(`[e2e:api] ${msg}`);
}

function run(label, args, extraEnv) {
  log(label);
  const res = spawnSync(process.execPath, args, {
    cwd: env.SERVER_DIR,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status})`);
}

async function ensureDatabase() {
  const { Client } = env.serverRequire('pg');
  const { adminUrl, dbName } = env.databaseUrls();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    if (process.env.E2E_RESET_DB === '1') {
      log(`E2E_RESET_DB=1 -> dropping database "${dbName}"`);
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    }
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (found.rowCount === 0) {
      log(`creating database "${dbName}"`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
    } else {
      log(`database "${dbName}" exists`);
    }
  } finally {
    await admin.end();
  }
}

async function main() {
  const apiEnv = env.apiEnv();
  await ensureDatabase();

  const prismaCli = env.serverRequire.resolve('prisma/build/index.js');
  run('prisma migrate deploy', [prismaCli, 'migrate', 'deploy'], apiEnv);

  const tsNode = env.serverRequire.resolve('ts-node/dist/bin.js');
  run('seed Super Admin', [tsNode, 'prisma/seed.ts'], apiEnv);

  const tsc = env.serverRequire.resolve('typescript/bin/tsc');
  log('compiling apps/server -> apps/server/.e2e-dist');
  const build = spawnSync(
    process.execPath,
    [tsc, '-p', 'tsconfig.build.json', '--outDir', env.SERVER_OUT_DIR, '--tsBuildInfoFile', path.join(env.SERVER_OUT_DIR, 'tsconfig.tsbuildinfo')],
    { cwd: env.SERVER_DIR, stdio: 'inherit' },
  );
  const entry = path.join(env.SERVER_OUT_DIR, 'main.js');
  if (!fs.existsSync(entry)) throw new Error('tsc produced no main.js; the server does not compile');
  if (build.status !== 0) log('WARNING: tsc reported errors (output was still emitted); starting anyway');

  fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });
  log(`starting API on ${env.API_URL}`);
  const child = spawn(process.execPath, [entry], { cwd: env.SERVER_DIR, env: { ...process.env, ...apiEnv }, stdio: 'inherit' });
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('[e2e:api] FAILED:', err.message);
  process.exit(1);
});
