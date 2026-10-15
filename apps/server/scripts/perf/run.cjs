'use strict';
/**
 * `npm run perf -w apps/server [-- <flags>]` — end-to-end performance run of the Epic-01 API.
 *
 *   1. CREATE DATABASE practiceperfect_perf (isolated; never the dev or the Playwright database)
 *   2. prisma migrate deploy
 *   3. seed the Super Admin (prisma/seed.ts) + PERF_USER_COUNT users (scripts/perf/seed-users.ts)
 *   4. compile apps/server -> apps/server/.perf-dist and start the API on :3200
 *      (RATE_LIMITS_DISABLED=true, MAIL_PROVIDER=console, scheduler off)
 *   5. run scripts/perf/load-test.mjs against it (exit code = threshold verdict)
 *   6. stop the API and DROP the perf database
 *
 * Flags (anything else is forwarded to load-test.mjs, e.g. --duration=20 --stress):
 *   --keep        keep the database afterwards (the next run reuses it instead of re-seeding)
 *   --reset       drop the perf database first (re-seed from scratch)
 *   --skip-build  reuse the previous .perf-dist build
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const env = require('./perf-env.cjs');

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const reset = args.includes('--reset');
const skipBuild = args.includes('--skip-build');
const loadArgs = args.filter((a) => !['--keep', '--reset', '--skip-build'].includes(a));

const log = (msg) => console.log(`[perf] ${msg}`);

function run(label, nodeArgs, extraEnv) {
  log(label);
  const res = spawnSync(process.execPath, nodeArgs, {
    cwd: env.SERVER_DIR,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (res.status !== 0) throw new Error(`${label} failed (exit ${res.status})`);
}

async function withAdmin(fn) {
  const { Client } = env.serverRequire('pg');
  const { adminUrl, dbName } = env.databaseUrls();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    return await fn(admin, dbName);
  } finally {
    await admin.end();
  }
}

const dropDatabase = () =>
  withAdmin(async (admin, dbName) => {
    log(`dropping database "${dbName}"`);
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  });

const ensureDatabase = () =>
  withAdmin(async (admin, dbName) => {
    if (reset) await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (found.rowCount === 0) {
      log(`creating database "${dbName}"`);
      await admin.query(`CREATE DATABASE "${dbName}"`);
    } else {
      log(`database "${dbName}" exists (reusing)`);
    }
  });

function waitForApi(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${env.API_URL}/share-links/healthcheck`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
    };
    const retry = () => (Date.now() > deadline ? reject(new Error('API did not become ready in time')) : setTimeout(attempt, 500));
    attempt();
  });
}

async function main() {
  const apiEnv = env.apiEnv();
  let api;
  let exitCode = 1;

  try {
    await ensureDatabase();

    const prismaCli = env.serverRequire.resolve('prisma/build/index.js');
    run('prisma migrate deploy', [prismaCli, 'migrate', 'deploy'], apiEnv);

    const tsNode = env.serverRequire.resolve('ts-node/dist/bin.js');
    run('seed Super Admin', [tsNode, 'prisma/seed.ts'], apiEnv);
    run('seed users', [tsNode, '--transpile-only', 'scripts/perf/seed-users.ts'], apiEnv);

    const entry = path.join(env.SERVER_OUT_DIR, 'main.js');
    if (!skipBuild || !fs.existsSync(entry)) {
      const tsc = env.serverRequire.resolve('typescript/bin/tsc');
      log('compiling apps/server -> apps/server/.perf-dist');
      spawnSync(
        process.execPath,
        [tsc, '-p', 'tsconfig.build.json', '--outDir', env.SERVER_OUT_DIR, '--tsBuildInfoFile', path.join(env.SERVER_OUT_DIR, 'tsconfig.tsbuildinfo')],
        { cwd: env.SERVER_DIR, stdio: 'inherit' },
      );
    }
    if (!fs.existsSync(entry)) throw new Error('tsc produced no main.js; the server does not compile');

    fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });
    log(`starting API on ${env.API_URL}`);
    // stdout (pino access log) is discarded: the load test must not be bounded by a console pipe.
    api = spawn(process.execPath, [entry], { cwd: env.SERVER_DIR, env: { ...process.env, ...apiEnv }, stdio: ['ignore', 'ignore', 'inherit'] });
    api.on('exit', (code) => {
      if (code) log(`API exited early with code ${code}`);
    });
    await waitForApi();

    const admin = env.seedCredentials();
    if (!admin.email || !admin.password) throw new Error('SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD are not available.');

    const load = spawnSync(process.execPath, [path.join(__dirname, 'load-test.mjs'), ...loadArgs], {
      cwd: env.SERVER_DIR,
      env: {
        ...process.env,
        PERF_API_URL: env.API_URL,
        PERF_ADMIN_EMAIL: admin.email,
        PERF_ADMIN_PASSWORD: admin.password,
        PERF_USER_PASSWORD: env.PERF_USER_PASSWORD,
        PERF_USER_COUNT: String(env.USER_COUNT),
      },
      stdio: 'inherit',
    });
    exitCode = load.status ?? 1;
  } catch (err) {
    console.error(`[perf] FAILED: ${err.message}`);
  } finally {
    if (api && api.exitCode === null) {
      api.kill();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!keep) await dropDatabase().catch((e) => console.error(`[perf] could not drop database: ${e.message}`));
  }
  process.exit(exitCode);
}

main();
