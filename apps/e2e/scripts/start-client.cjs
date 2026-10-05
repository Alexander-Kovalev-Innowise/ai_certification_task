'use strict';
/**
 * Launches the ISOLATED e2e client (port 3101) against the e2e API (3100).
 *
 * `next dev` takes an exclusive lock on <project>/.next/dev, so it cannot run
 * next to the developer's own `next dev -p 3001` in apps/client. We therefore
 * copy the client sources (app/, src/, public/, configs) into
 * apps/e2e/.client-snapshot/ on every start (node_modules is a junction to the
 * real one) and run `next dev -p 3101 --webpack` there.
 * NEXT_PUBLIC_API_URL is the only env var the client reads.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./e2e-env.cjs');

const log = (msg) => console.log(`[e2e:client] ${msg}`);
const SYNC = ['app', 'src', 'public'];
const FILES = ['package.json', 'tsconfig.json', 'postcss.config.mjs', 'next.config.mjs'];

function sync() {
  const dest = env.CLIENT_SNAPSHOT_DIR;
  fs.mkdirSync(dest, { recursive: true });
  for (const dir of SYNC) {
    const from = path.join(env.CLIENT_DIR, dir);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(path.join(dest, dir), { recursive: true, force: true });
    fs.cpSync(from, path.join(dest, dir), { recursive: true, filter: (src) => !/\.spec\.tsx?$/.test(src) });
  }
  for (const file of FILES) {
    const from = path.join(env.CLIENT_DIR, file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, file));
  }
  const link = path.join(dest, 'node_modules');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(env.CLIENT_DIR, 'node_modules'), link, 'junction');
}

log('snapshotting apps/client sources');
sync();

const nextBin = env.serverRequire.resolve('next/dist/bin/next', { paths: [env.CLIENT_DIR] });
log(`next dev -p ${env.CLIENT_PORT} --webpack (API -> ${env.API_URL})`);
const child = spawn(process.execPath, [nextBin, 'dev', '-p', String(env.CLIENT_PORT), '--webpack'], {
  cwd: env.CLIENT_SNAPSHOT_DIR,
  env: { ...process.env, NEXT_PUBLIC_API_URL: env.API_URL, NEXT_TELEMETRY_DISABLED: '1' },
  stdio: 'inherit',
});
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
