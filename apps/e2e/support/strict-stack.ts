import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as env from '../scripts/e2e-env.cjs';

import { ApiClient } from './api';

/**
 * The "strict" stack: a second API (:3102) and client (:3103) on the SAME e2e database, for the specs that need the
 * production behaviour the main stack switches off:
 *   - rate limits ON (RATE_LIMITS_DISABLED=false, the production default),
 *   - a short impersonation lifetime (IMPERSONATION_TTL_SECONDS, spec says 1 hour).
 * Both processes are spawned by a `*.strict.spec.ts` file in `test.beforeAll` and killed (whole process tree) in
 * `test.afterAll`, so the throttle counters start from zero on every run, nothing else in the suite ever talks to them and
 * no port stays occupied. The API's own dev mailbox is per process - arrange users and
 * e-mails through the MAIN api (`api` / `mailbox` fixtures), only the browser talks to the strict pair.
 */
export interface StrictStack {
  apiUrl: string;
  clientUrl: string;
  /** Typed client for the strict API (rate limits on). */
  api: ApiClient;
  impersonationTtlSeconds: number;
  /** Kills both processes (whole trees). */
  stop: () => void;
}

const LOG_DIR = path.join(env.E2E_DIR, 'test-results');

function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function waitFor(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`strict stack: ${label} did not come up at ${url} within ${timeoutMs}ms (${last})`);
}

async function portIsFree(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return false;
  } catch {
    return true;
  }
}

/** Routes the strict specs navigate to; compiled by `next dev` on first hit, so warm them before the first test. */
const WARM_ROUTES = ['/login', '/dashboard', '/users', '/users/00000000-0000-0000-0000-000000000000', '/impersonation-history', '/coaches'];

export async function startStrictStack(): Promise<StrictStack> {
  const apiUrl = env.STRICT_API_URL;
  const clientUrl = env.STRICT_CLIENT_URL;

  for (const url of [apiUrl, clientUrl]) {
    if (!(await portIsFree(url))) throw new Error(`strict stack: ${url} is already in use (stop whatever is listening there)`);
  }
  const entry = path.join(env.SERVER_OUT_DIR, 'main.js');
  if (!fs.existsSync(entry)) throw new Error(`strict stack: ${entry} is missing - the main e2e API (scripts/start-api.cjs) compiles it first`);

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const apiLog = fs.openSync(path.join(LOG_DIR, 'strict-api.log'), 'w');
  const clientLog = fs.openSync(path.join(LOG_DIR, 'strict-client.log'), 'w');

  const children: ChildProcess[] = [];
  const stop = () => children.forEach(killTree);

  try {
    const apiProc = spawn(process.execPath, [entry], {
      cwd: env.SERVER_DIR,
      env: { ...process.env, ...env.strictApiEnv() },
      stdio: ['ignore', apiLog, apiLog],
    });
    children.push(apiProc);

    const clientProc = spawn(process.execPath, [path.join(env.E2E_DIR, 'scripts', 'start-client.cjs')], {
      cwd: env.E2E_DIR,
      env: {
        ...process.env,
        E2E_CLIENT_PORT: String(env.STRICT_CLIENT_PORT),
        E2E_CLIENT_API_URL: apiUrl,
        E2E_CLIENT_SNAPSHOT: env.STRICT_CLIENT_SNAPSHOT_DIR,
      },
      stdio: ['ignore', clientLog, clientLog],
    });
    children.push(clientProc);

    await waitFor(`${apiUrl}/docs`, 120_000, 'API');
    await waitFor(`${clientUrl}/login`, 240_000, 'client');
    await Promise.all(WARM_ROUTES.map((route) => fetch(new URL(route, clientUrl), { signal: AbortSignal.timeout(180_000) }).catch(() => undefined)));
  } catch (e) {
    stop();
    throw e;
  }

  return { apiUrl, clientUrl, api: new ApiClient(apiUrl), impersonationTtlSeconds: env.STRICT_IMPERSONATION_TTL_SECONDS, stop };
}
