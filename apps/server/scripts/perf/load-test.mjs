#!/usr/bin/env node
/**
 * Load test for the Epic-01 API against a seeded perf database (see run.cjs / seed-users.ts).
 * Dependency-free: a small closed-loop HTTP runner on node:http with a keep-alive agent.
 *
 * Environment (set by run.cjs; pass them yourself when running it standalone):
 *   PERF_API_URL         API base URL, default http://localhost:3200
 *   PERF_ADMIN_EMAIL / PERF_ADMIN_PASSWORD   Super Admin credentials
 *   PERF_USER_PASSWORD   shared password of the seeded perf users
 *   PERF_SHARE_CODE      reusable PLAYER_STATIC link used for registrations (default PerfStaticBigTrainer)
 *
 * Flags: --duration=<s> per time-boxed scenario (default 10)   --mixed-duration=<s> (default 30)
 *        --only=<regex> run only the scenarios whose name matches
 *        --vus=<n> virtual users in the mixed workload (default 1000)   --stress  also run the
 *        no-think-time saturation test   --json=<file>  write the result table as JSON
 *
 * Exit code: 0 = every threshold met, 1 = at least one threshold violated, 2 = setup failure.
 */
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const API = new URL(process.env.PERF_API_URL ?? 'http://localhost:3200');
const ADMIN = { email: process.env.PERF_ADMIN_EMAIL, password: process.env.PERF_ADMIN_PASSWORD };
const USER_PASSWORD = process.env.PERF_USER_PASSWORD ?? 'PerfLoad2026x';
const SHARE_CODE = process.env.PERF_SHARE_CODE ?? 'PerfStaticBigTrainer';
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DURATION_S = Number(flag('duration', 10));
const MIXED_DURATION_S = Number(flag('mixed-duration', 30));
const MIXED_VUS = Number(flag('vus', 1000));
const STRESS = process.argv.includes('--stress');
const JSON_OUT = flag('json', '');
// --only=<regex>: run just the scenarios whose name matches (handy while tuning)
const ONLY = flag('only', '') ? new RegExp(flag('only', ''), 'i') : null;

// ---- spec targets (Task/Epics/Epic-01_User_Management_Authentication_SPEC.md §11) --------------------
const SPEC = { dashboardMs: 2000, userListMs: 3000, profileSaveMs: 1000, registrationMs: 2000 };
// Not in the spec; project budgets for the remaining endpoints.
const BUDGET = { loginMs: 1000, loginBurstMs: 5000, rosterMs: 2000, mixedP95Ms: 2000, mixedP99Ms: 3000 };

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity, maxFreeSockets: 2048 });

// ---- tiny HTTP client ----------------------------------------------------------------------------------
let connectRetries = 0;

/**
 * One logical request. A refused TCP connect (listen backlog overflow when ~1,000 clients connect at the
 * same instant; the OS, not the app, drops it - Windows caps the backlog at a few hundred) is retried with a
 * short backoff, exactly like a Linux TCP stack's SYN retransmit or a browser would. The retry delay is
 * included in the measured latency, and the number of retries is reported.
 */
async function request(method, path, opts = {}) {
  const started = performance.now();
  for (let attempt = 0; ; attempt += 1) {
    const res = await requestOnce(method, path, opts);
    if (res.error === 'ECONNREFUSED' && attempt < 4) {
      connectRetries += 1;
      await sleep(250 * (attempt + 1));
      continue;
    }
    return { ...res, ms: performance.now() - started };
  }
}

function requestOnce(method, path, { token, body, headers } = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const started = performance.now();
    let settled = false;
    const done = (status, data, error) => {
      if (settled) return;
      settled = true;
      resolve({ status, ms: performance.now() - started, data, error });
    };
    const req = http.request(
      {
        agent,
        host: API.hostname,
        port: API.port,
        method,
        path,
        timeout: 60_000,
        headers: {
          accept: 'application/json',
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = text ? JSON.parse(text) : undefined;
          } catch {
            data = text;
          }
          done(res.statusCode ?? 0, data);
        });
        res.on('error', (e) => done(0, undefined, e.code ?? e.message));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => done(0, undefined, e.code ?? e.message));
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
const fmt = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

// ---- scenario runner -----------------------------------------------------------------------------------
const results = [];
let failed = false;

/**
 * Closed-loop: `concurrency` workers each fire the next request as soon as the previous one
 * finishes, until `requests` have been sent or `durationS` has elapsed.
 * `make(i)` -> [method, path, opts]; `ok` = accepted status codes.
 */
async function scenario({ name, concurrency, requests, durationS, make, ok = [200], limits = {}, note = '' }) {
  if (ONLY && !ONLY.test(name)) return undefined;
  const latencies = [];
  const statusCounts = {};
  let errors = 0;
  let sent = 0;
  let sample; // first failing response, for the report
  const startedAt = performance.now();
  const deadline = durationS ? startedAt + durationS * 1000 : Infinity;

  const worker = async () => {
    for (;;) {
      if (performance.now() >= deadline) return;
      const i = sent++;
      if (requests !== undefined && i >= requests) return;
      const [method, path, opts] = make(i);
      const res = await request(method, path, opts);
      latencies.push(res.ms);
      const key = res.error ?? String(res.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      if (!ok.includes(res.status)) {
        errors += 1;
        sample ??= `${method} ${path} -> ${res.status} ${JSON.stringify(res.data ?? res.error)?.slice(0, 300)}`;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return finish({ name, concurrency, latencies, errors, statusCounts, elapsedS: (performance.now() - startedAt) / 1000, limits, note, sample });
}

function finish({ name, concurrency, latencies, errors, statusCounts, elapsedS, limits, note, sample }) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const row = {
    name,
    concurrency,
    requests: sorted.length,
    errors,
    rps: sorted.length / elapsedS,
    p50: pct(sorted, 50),
    p95: pct(sorted, 95),
    p99: pct(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    limits,
    note,
  };
  const violations = [];
  if (errors > (limits.maxErrors ?? 0)) violations.push(`${errors} errors (statuses ${JSON.stringify(statusCounts)}${sample ? `; first: ${sample}` : ''})`);
  if (limits.p95 !== undefined && row.p95 > limits.p95) violations.push(`p95 ${fmt(row.p95)}ms > ${limits.p95}ms`);
  if (limits.p99 !== undefined && row.p99 > limits.p99) violations.push(`p99 ${fmt(row.p99)}ms > ${limits.p99}ms`);
  row.violations = violations;
  if (violations.length) failed = true;
  results.push(row);
  console.log(
    `${violations.length ? 'FAIL' : ' ok '} ${name.padEnd(46)} c=${String(concurrency).padStart(4)} n=${String(row.requests).padStart(6)} ` +
      `err=${String(errors).padStart(4)} ${fmt(row.rps).padStart(7)} req/s  p50=${fmt(row.p50).padStart(7)} p95=${fmt(row.p95).padStart(7)} ` +
      `p99=${fmt(row.p99).padStart(7)} max=${fmt(row.max).padStart(7)} ms${violations.length ? `\n       -> ${violations.join('; ')}` : ''}`,
  );
  return row;
}

// ---- setup ---------------------------------------------------------------------------------------------
async function login(email, password) {
  const res = await request('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`login ${email} -> ${res.status} ${res.error ?? JSON.stringify(res.data)}`);
  return { token: res.data.accessToken, user: res.data.user };
}

async function loginMany(emails, concurrency = 8) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < emails.length) {
        const i = next++;
        out[i] = await login(emails[i], USER_PASSWORD);
      }
    }),
  );
  return out;
}

/** Emails of seeded users matching `query` (newest first); accounts registered by earlier load runs are skipped (other password). */
async function listEmails(adminToken, query, limit) {
  const emails = [];
  let cursor;
  for (let page = 0; page < 20 && emails.length < limit; page += 1) {
    const res = await request('GET', `/users?limit=100&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token: adminToken });
    if (res.status !== 200) throw new Error(`GET /users?${query} -> ${res.status}`);
    emails.push(...res.data.items.map((u) => u.email).filter((e) => !e.startsWith('perf.signup.')));
    if (!res.data.hasMore) break;
    cursor = res.data.nextCursor;
  }
  return emails.slice(0, limit);
}

async function main() {
  if (!ADMIN.email || !ADMIN.password) {
    console.error('PERF_ADMIN_EMAIL / PERF_ADMIN_PASSWORD are required.');
    process.exit(2);
  }
  console.log(`Load test against ${API.origin}  (spec: list<${SPEC.userListMs}ms dashboard<${SPEC.dashboardMs}ms save<${SPEC.profileSaveMs}ms register<${SPEC.registrationMs}ms)\n`);

  // -- sessions
  const admin = await login(ADMIN.email, ADMIN.password);
  const adminToken = admin.token;
  const parentEmails = await listEmails(adminToken, 'role=PLAYER_PARENT&status=ACTIVE', 100);
  const trainerEmails = await listEmails(adminToken, 'role=TRAINER&status=ACTIVE', 100);
  const coachEmails = await listEmails(adminToken, 'role=COACH&status=ACTIVE', 100);
  const bigTrainerEmail = (await listEmails(adminToken, 'search=perf.bigtrainer', 5))[0];
  if (!bigTrainerEmail || !parentEmails.length || !trainerEmails.length || !coachEmails.length) {
    console.error('Perf data set not found: run seed-users.ts first.');
    process.exit(2);
  }
  const parents = await loginMany(parentEmails.slice(0, 40));
  const coaches = await loginMany(coachEmails.slice(0, 20));
  const trainers = await loginMany([...new Set([bigTrainerEmail, ...trainerEmails])].slice(0, 20));
  const trainerIds = [];
  for (const t of trainers) {
    const res = await request('GET', '/me/bootstrap', { token: t.token });
    trainerIds.push(res.data.trainerProfile.id);
  }
  const big = { token: trainers[0].token, id: trainerIds[0] };
  const pick = (arr, i) => arr[i % arr.length];

  // A deep keyset cursor (~ row 2,500 of the directory) for the "deep page" case.
  let cursor;
  for (let page = 0; page < 50; page += 1) {
    const res = await request('GET', `/users?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token: adminToken });
    cursor = res.data.nextCursor ?? cursor;
    if (!res.data.hasMore) break;
  }
  const deepCursor = cursor;

  // -- warm-up (JIT, connection pool, plan cache) -- not measured
  for (let i = 0; i < 30; i += 1) {
    await request('GET', '/users?limit=50', { token: adminToken });
    await request('GET', '/dashboard/stats', { token: adminToken });
  }

  const c = 10; // moderate concurrency: ten people using the admin tools at once
  const timed = { concurrency: c, durationS: DURATION_S };

  // -- 1. SUPER_ADMIN user list (spec: < 3 s with 10,000 users)
  console.log('--- GET /users (SUPER_ADMIN directory)');
  const listLimit = { p99: SPEC.userListMs };
  const listCase = (name, path, extra = {}) =>
    scenario({ name, ...timed, make: () => ['GET', path, { token: adminToken }], limits: listLimit, ...extra });
  await listCase('users list: first page (limit=50 default)', '/users');
  await listCase('users list: limit=20', '/users?limit=20');
  await listCase('users list: limit=100 (max page)', '/users?limit=100');
  await listCase('users list: role=TRAINER', '/users?role=TRAINER');
  await listCase('users list: role=COACH&status=ACTIVE', '/users?role=COACH&status=ACTIVE');
  await listCase('users list: role=PLAYER_PARENT&status=ACTIVE', '/users?role=PLAYER_PARENT&status=ACTIVE');
  await listCase('users list: status=INACTIVE', '/users?status=INACTIVE');
  await listCase('users list: status=DELETED', '/users?status=DELETED');
  await listCase('users list: search=garcia (name, common)', '/users?search=garcia');
  await listCase('users list: search=olivia.kowalski (email)', '/users?search=olivia.kowalski');
  await listCase('users list: search=zzzz (no match)', '/users?search=zzzz');
  await listCase('users list: search=an&role=PLAYER_PARENT', '/users?search=an&role=PLAYER_PARENT&status=ACTIVE');
  await listCase('users list: deep page (cursor ~row 2,500)', `/users?cursor=${encodeURIComponent(deepCursor)}`);
  // sequential single-user latency (what one admin actually experiences)
  await scenario({ name: 'users list: first page, single client', concurrency: 1, requests: 100, make: () => ['GET', '/users', { token: adminToken }], limits: listLimit });

  // -- 2. dashboards (spec: < 2 s)
  console.log('\n--- dashboards');
  const dash = { p99: SPEC.dashboardMs };
  await scenario({ name: 'GET /dashboard/stats (SUPER_ADMIN)', ...timed, make: () => ['GET', '/dashboard/stats', { token: adminToken }], limits: dash });
  await scenario({ name: 'GET /me/bootstrap (SUPER_ADMIN)', ...timed, make: () => ['GET', '/me/bootstrap', { token: adminToken }], limits: dash });
  await scenario({ name: 'GET /dashboard/stats (big TRAINER)', ...timed, make: () => ['GET', '/dashboard/stats', { token: big.token }], limits: dash });
  await scenario({ name: 'GET /dashboard/stats (TRAINER)', ...timed, make: (i) => ['GET', '/dashboard/stats', { token: pick(trainers, i).token }], limits: dash });
  await scenario({ name: 'GET /dashboard/stats (COACH)', ...timed, make: (i) => ['GET', '/dashboard/stats', { token: pick(coaches, i).token }], limits: dash });
  await scenario({ name: 'GET /dashboard/stats (PLAYER_PARENT)', ...timed, make: (i) => ['GET', '/dashboard/stats', { token: pick(parents, i).token }], limits: dash });
  await scenario({ name: 'GET /me/bootstrap (PLAYER_PARENT)', ...timed, make: (i) => ['GET', '/me/bootstrap', { token: pick(parents, i).token }], limits: dash });
  await scenario({ name: 'GET /me/bootstrap (big TRAINER)', ...timed, make: () => ['GET', '/me/bootstrap', { token: big.token }], limits: dash });

  // -- 3. trainer roster (big trainer has ~35% of all players)
  console.log('\n--- trainer roster / share links');
  const roster = { p99: BUDGET.rosterMs };
  await scenario({ name: 'GET /trainers/:id/players (big trainer)', ...timed, make: () => ['GET', `/trainers/${big.id}/players?limit=50`, { token: big.token }], limits: roster });
  await scenario({ name: 'GET /trainers/:id/players?dayOfWeek=2', ...timed, make: () => ['GET', `/trainers/${big.id}/players?limit=50&dayOfWeek=2`, { token: big.token }], limits: roster });
  await scenario({ name: 'GET /trainers/:id/share-links', ...timed, make: () => ['GET', `/trainers/${big.id}/share-links`, { token: big.token }], limits: roster });

  // -- 4. profile save (spec: < 1 s)
  console.log('\n--- profile save');
  await scenario({
    name: 'PATCH /me (PLAYER_PARENT profile save)',
    ...timed,
    make: (i) => ['PATCH', '/me', { token: pick(parents, i).token, body: { firstName: `Perf${i % 50}`, lastName: 'Parent' } }],
    limits: { p99: SPEC.profileSaveMs },
  });

  // -- 5. login (argon2id verify)
  console.log('\n--- login');
  const loginPool = [...parentEmails.slice(0, 60), ...coachEmails.slice(0, 20), ...trainerEmails.slice(0, 20)];
  await scenario({
    name: 'POST /auth/login',
    concurrency: c,
    requests: 200,
    make: (i) => ['POST', '/auth/login', { body: { email: pick(loginPool, i), password: USER_PASSWORD } }],
    limits: { p95: BUDGET.loginMs },
  });

  // The 08:00 "everybody signs in at once" case: 1,000 simultaneous logins, every one must succeed.
  await scenario({
    name: `POST /auth/login burst (${MIXED_VUS} simultaneous)`,
    concurrency: MIXED_VUS,
    requests: MIXED_VUS,
    make: (i) => ['POST', '/auth/login', { body: { email: pick(loginPool, i), password: USER_PASSWORD } }],
    limits: { p99: BUDGET.loginBurstMs },
  });

  // -- 6. ShareLink registration (spec: < 2 s)
  console.log('\n--- ShareLink registration');
  const runId = Date.now().toString(36);
  const registration = (i) => [
    'POST',
    `/share-links/${SHARE_CODE}/redeem`,
    {
      body: {
        email: `perf.signup.${runId}.${i}@example.com`,
        password: 'PerfSignup2026x',
        phone: '+14155552671',
        playerName: `Perf Signup${i}`,
        dateOfBirth: '1990-05-05',
        gender: 'FEMALE',
        isSelf: true,
      },
    },
  ];
  await scenario({ name: 'POST /share-links/:code/redeem (register)', concurrency: 5, requests: 100, make: registration, ok: [201], limits: { p99: SPEC.registrationMs } });
  await scenario({ name: 'GET /share-links/:code (public preview)', ...timed, make: () => ['GET', `/share-links/${SHARE_CODE}`, {}], limits: { p99: SPEC.registrationMs } });

  // -- 7. 1,000 concurrent users
  console.log(`\n--- ${MIXED_VUS} concurrent users, mixed workload (${MIXED_DURATION_S}s, 1-3 s think time)`);
  if (!ONLY || ONLY.test('mixed workload')) await mixedWorkload({ adminToken, parents, coaches, trainers, trainerIds, loginPool, registration });

  if (STRESS) {
    console.log(`\n--- saturation: ${MIXED_VUS} connections, NO think time (informational: only errors fail)`);
    await scenario({
      name: `stress: ${MIXED_VUS} connections GET /me/bootstrap`,
      concurrency: MIXED_VUS,
      durationS: DURATION_S,
      make: (i) => ['GET', '/me/bootstrap', { token: pick(parents, i).token }],
      limits: {},
    });
    await scenario({
      name: `stress: ${MIXED_VUS} connections GET /users`,
      concurrency: MIXED_VUS,
      durationS: DURATION_S,
      make: () => ['GET', '/users', { token: adminToken }],
      limits: {},
    });
  }

  // -- verdict
  console.log('');
  if (connectRetries) console.log(`note: ${connectRetries} refused TCP connects were retried (OS listen-backlog overflow under simultaneous connects)`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
  if (failed) {
    console.log('RESULT: FAIL');
    for (const r of results.filter((x) => x.violations.length)) console.log(`  - ${r.name}: ${r.violations.join('; ')}`);
  } else {
    console.log('RESULT: PASS (all thresholds met)');
  }
  agent.destroy();
  process.exit(failed ? 1 : 0);
}

/**
 * MIXED_VUS virtual users, each a persona that loops "think 1-3 s, do one weighted action".
 * Thresholds: zero errors, p95 < 2 s, p99 < 3 s across the whole population.
 */
async function mixedWorkload({ adminToken, parents, coaches, trainers, trainerIds, loginPool, registration }) {
  const pickR = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const weighted = (table) => {
    const total = table.reduce((s, [w]) => s + w, 0);
    return () => {
      let r = Math.random() * total;
      for (const [w, fn] of table) if ((r -= w) <= 0) return fn;
      return table[0][1];
    };
  };
  let registrationSeq = 0;
  const loginAction = () => ['POST', '/auth/login', { body: { email: pickR(loginPool), password: USER_PASSWORD } }];
  const parentActions = weighted([
    [30, (s) => ['GET', '/me/bootstrap', { token: s.token }]],
    [30, (s) => ['GET', '/dashboard/stats', { token: s.token }]],
    [20, (s) => ['GET', '/me/contexts', { token: s.token }]],
    [8, (s) => ['PATCH', '/me', { token: s.token, body: { firstName: `Mix${Math.floor(Math.random() * 50)}`, lastName: 'Parent' } }]],
    [3, loginAction],
  ]);
  const coachActions = weighted([
    [40, (s) => ['GET', '/me/bootstrap', { token: s.token }]],
    [40, (s) => ['GET', '/dashboard/stats', { token: s.token }]],
    [3, loginAction],
  ]);
  const trainerActions = weighted([
    [25, (s) => ['GET', '/me/bootstrap', { token: s.token }]],
    [25, (s) => ['GET', '/dashboard/stats', { token: s.token }]],
    [30, (s) => ['GET', `/trainers/${s.trainerId}/players?limit=50`, { token: s.token }]],
    [10, (s) => ['GET', `/trainers/${s.trainerId}/share-links`, { token: s.token }]],
    [3, loginAction],
  ]);
  const adminActions = weighted([
    [25, () => ['GET', '/users', { token: adminToken }]],
    [15, () => ['GET', `/users?search=${pickR(['smith', 'garcia', 'lee', 'anna', 'perf'])}`, { token: adminToken }]],
    [15, () => ['GET', `/users?role=${pickR(['TRAINER', 'COACH', 'PLAYER_PARENT'])}&status=ACTIVE`, { token: adminToken }]],
    [30, () => ['GET', '/dashboard/stats', { token: adminToken }]],
    [15, () => ['GET', '/me/bootstrap', { token: adminToken }]],
  ]);
  const anonActions = weighted([
    [90, () => ['GET', `/share-links/${SHARE_CODE}`, {}]],
    [10, () => registration(1_000_000 + registrationSeq++)],
  ]);

  // persona mix of the population
  const n = MIXED_VUS;
  const plan = [
    ['admin', Math.max(1, Math.round(n * 0.01)), adminActions, () => ({})],
    ['trainer', Math.round(n * 0.15), trainerActions, (i) => ({ token: trainers[i % trainers.length].token, trainerId: trainerIds[i % trainerIds.length] })],
    ['coach', Math.round(n * 0.15), coachActions, (i) => ({ token: coaches[i % coaches.length].token })],
    ['anon', Math.round(n * 0.09), anonActions, () => ({})],
  ];
  const used = plan.reduce((s, p) => s + p[1], 0);
  plan.push(['parent', n - used, parentActions, (i) => ({ token: parents[i % parents.length].token })]);

  const latencies = [];
  const statusCounts = {};
  let errors = 0;
  const startedAt = performance.now();
  const deadline = startedAt + MIXED_DURATION_S * 1000;

  const vu = async (actions, session) => {
    await sleep(Math.random() * 5000); // ramp-up: spread connection setup over 5 s
    while (performance.now() < deadline) {
      const [method, path, opts] = actions()(session);
      const res = await request(method, path, opts);
      latencies.push(res.ms);
      const key = res.error ?? String(res.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      const expected = method === 'POST' && path.endsWith('/redeem') ? [201] : [200];
      if (!expected.includes(res.status)) errors += 1;
      await sleep(1000 + Math.random() * 2000);
    }
  };
  const vus = [];
  for (const [, count, actions, mk] of plan) for (let i = 0; i < count; i += 1) vus.push(vu(actions, mk(i)));
  await Promise.all(vus);

  console.log(`     persona mix: ${plan.map(([name, count]) => `${name}=${count}`).join(' ')}   statuses ${JSON.stringify(statusCounts)}`);
  finish({
    name: `mixed workload, ${n} concurrent users`,
    concurrency: n,
    latencies,
    errors,
    statusCounts,
    elapsedS: (performance.now() - startedAt) / 1000,
    limits: { p95: BUDGET.mixedP95Ms, p99: BUDGET.mixedP99Ms },
  });
}

main().catch((err) => {
  console.error(`Load test setup failed: ${err.stack ?? err}`);
  process.exit(2);
});
