# Epic-01 performance harness

Verifies the performance targets of `Task/Epics/Epic-01_User_Management_Authentication_SPEC.md` §11 against a
realistic, 10,000-user data set, on an isolated database.

| Spec target | Checked as |
|:---|:---|
| User list with 10,000 users < 3 s (with pagination) | `GET /users` (SUPER_ADMIN), p99 < 3000 ms, 14 variants |
| Dashboard load < 2 s | `GET /dashboard/stats` and `GET /me/bootstrap` for every role, p99 < 2000 ms |
| Profile save < 1 s | `PATCH /me`, p99 < 1000 ms |
| ShareLink registration < 2 s | `POST /share-links/:code/redeem` (new player + account), p99 < 2000 ms |
| Platform handles 1,000 concurrent users | 1,000 virtual users, mixed workload, 0 errors, p95 < 2 s, p99 < 3 s |

Not in the spec, so project budgets: login p95 < 1 s (c=10), trainer roster p99 < 2 s, 1,000 *simultaneous* logins
p99 < 5 s with 0 errors.

## Run

```bash
npm run perf -w apps/server                 # whole pipeline, drops the database when done
npm run perf -w apps/server -- --keep       # keep practiceperfect_perf (next run reuses the seed)
npm run perf -w apps/server -- --reset --stress --duration=20
```

`run.cjs` does: create `practiceperfect_perf` (never the dev DB, never `practiceperfect_e2e`) -> `prisma migrate deploy`
-> seed Super Admin -> `seed-users.ts` (10,000 users) -> compile to `apps/server/.perf-dist` -> start the API on **:3200**
(`RATE_LIMITS_DISABLED=true`, `MAIL_PROVIDER=console`, scheduler off) -> `load-test.mjs` -> stop API -> drop DB.
The connection string is derived from the root `.env` programmatically (never printed), like `apps/e2e`.

Flags: `--keep`, `--reset`, `--skip-build` (run.cjs); `--duration=<s>` (per scenario, default 10), `--mixed-duration=<s>` (30),
`--vus=<n>` (1000), `--stress` (also saturate with 1,000 connections and no think time; informational), `--only=<regex>`,
`--json=<file>` (load-test.mjs). Env: `PERF_USER_COUNT` (10000), `PERF_API_PORT` (3200), `PERF_DB_NAME`.
The process exit code is non-zero when any threshold is violated.

* `seed-users.ts` — deterministic bulk insert (`createMany`, one argon2 hash reused): 4 admins, 2 % trainers, 8 % coaches, rest
  players/parents; 90 % ACTIVE / 7 % INACTIVE / 3 % DELETED (anonymised); ~18k player profiles, ~21k trainer associations
  (one "big" trainer holds ~35 % of all players), availability, share links, impersonation history; then `ANALYZE`.
* `load-test.mjs` — dependency-free closed-loop runner (`node:http`, keep-alive). Mixed workload = 600 parents, 150 coaches,
  150 trainers, 90 anonymous visitors, 10 admins, each looping "think 1-3 s, do one weighted action" (bootstrap, dashboard,
  roster, profile save, list/search, ~3 % logins, ~10 % of anonymous visits register). A refused TCP connect (OS listen
  backlog overflow when ~1,000 clients connect in the same instant) is retried with back-off like a TCP stack would, and counted.
* Run on an otherwise idle machine: the load generator and API share it, and background CPU load visibly inflates results
  (one run was 100x slower on the mixed workload while something else was busy).

## Results (10,000 users, local: 24 cores, Docker PostgreSQL 16, API and load generator on the same host)

Latencies in ms, 10 concurrent clients unless stated, final run after the fixes below.

| Scenario | req/s | p50 | p95 | p99 | Target |
|:---|--:|--:|--:|--:|:---|
| users list: first page (50) | 1048 | 9.3 | 11.9 | 13.7 | p99 < 3000 |
| users list: first page, single client | 600 | 1.6 | 2.1 | 2.9 | < 3000 |
| users list: limit=100, role/status filters, deep page | 830-1210 | 8-12 | 10-14 | 11-16 | < 3000 |
| users list: search (name / email / no match) | 1073-1911 | 5-9 | 7-11 | 8-14 | < 3000 |
| dashboard stats: SUPER_ADMIN / big TRAINER / TRAINER / COACH / PARENT | 313-950 | 10-32 | 13-39 | 15-45 | p99 < 2000 |
| `GET /me/bootstrap` (admin / parent / big trainer) | 274-1743 | 5-34 | 8-60 | 9-74 | p99 < 2000 |
| trainer roster (big trainer, 50 / day filter) | 374-497 | 20-26 | 26-32 | 29-35 | p99 < 2000 |
| `PATCH /me` profile save | 1450 | 6.6 | 8.9 | 13.5 | p99 < 1000 |
| `POST /auth/login` (argon2id) | 271 | 36 | 40 | 48 | p95 < 1000 |
| 1,000 simultaneous logins | 277 | 1836 | 3428 | 3568 | p99 < 5000, 0 errors |
| ShareLink registration (c=5) | 106 | 42 | 73 | 87 | p99 < 2000 |
| **Mixed workload, 1,000 concurrent users (432 req/s)** | 432 | 5.1 | 18.8 | 34.6 | 0 errors, p95 < 2000, p99 < 3000 |
| saturation, 1,000 connections, no think time, `/me/bootstrap` | 732 | 1325 | 1509 | 1747 | informational |
| saturation, 1,000 connections, no think time, `/users` | 1209 | 823 | 874 | 949 | informational |

Every spec target is met by two orders of magnitude at 10,000 users. A second pass at **100,000 users** (10x the spec) is the
headroom check that exposed the problems fixed below:

| 100,000 users | before | after |
|:---|--:|--:|
| `/users` first page p50 / single client p50 | 21.5 / 12.4 ms | 9.6 / 1.4 ms |
| `/users?role=TRAINER` p50 | 18.9 ms | 8.5 ms |
| `/users` deep page p50 | 20.1 ms | 8.5 ms |
| big-trainer roster p50 | 79 ms | 62 ms (19 ms at 10k users) |
| big-trainer dashboard (58k players) under 10 clients | 60 % HTTP 500 | 0 errors with `shm_size` (see below) |

## Findings and fixes

1. **Name search never used its trigram index** (`users.repository.ts`). The index is on
   `lower(firstName) || ' ' || lower(lastName)` but the query filtered on `lower(firstName || ' ' || lastName)`; the planner
   treats them as different expressions, so `EXPLAIN ANALYZE` showed a sequential scan (3.6 ms at 10k users, linear in users)
   instead of a BitmapOr over both GIN indexes (0.09 ms). Query rewritten to the index's exact expression. No migration.
2. **Unfiltered / role-only directory pages scanned and sorted every user** (`Seq Scan` + top-N heapsort, 2.3 ms at 10k,
   linear). Migration `20261005120000_perf_indexes`: `User(createdAt DESC, id DESC)` and `User(role, createdAt DESC, id DESC)`;
   `PlayerTrainerAssociation(trainerId, status, connectedAt DESC, id DESC)` (roster keyset order + dashboard range counts,
   replaces the `(trainerId, status)` prefix index); `ImpersonationLog(startedAt)`. `schema.prisma` declares the same indexes
   (`prisma migrate diff` against the migrated database is empty).
3. **Big-trainer dashboard returned HTTP 500 under concurrency.** Cause: PostgreSQL parallel workers need dynamic shared memory
   and the Docker default `/dev/shm` is 64 MB (`could not resize shared memory segment ... No space left on device`). Proven by
   setting `max_parallel_workers_per_gather = 0` (0 errors, same latency). Fix: `shm_size: 256mb` in `docker-compose.yml`
   (recreate the container: `docker compose up -d --force-recreate postgres`).
4. **Unhandled exceptions were never logged** (`global-exception.filter.ts`): the 500 above left no trace in the server output.
   They are now logged server-side with stack and `requestId` (the response body is unchanged).
5. **argon2 was capped at 4 concurrent hashes** by libuv's default thread pool, regardless of cores
   (`shared/runtime/threadpool.ts`, imported first in `main.ts`): `UV_THREADPOOL_SIZE` now defaults to `min(8, cores)` (>= 4,
   an explicit env value wins). Login throughput 200 -> ~280/s; 1,000 simultaneous logins p99 5.0 s -> 3.6 s. More than 8 threads
   gave nothing (the rest of the request path is single-threaded) and each in-flight hash costs ~19 MiB.
6. Checked and **not** a bottleneck: Prisma/pg pool size (10 vs 30 vs 60 connections: identical throughput; the single Node event
   loop saturates first at ~1,000-1,200 req/s per instance), the login path (argon2id parameters unchanged, OWASP baseline).

## Known limits

* One API instance saturates at roughly 1,000-1,200 simple req/s (one event loop). The 1,000-concurrent-user target is met with
  large margin for human think times (432 req/s offered, p99 35 ms); sustained 1,000 un-throttled connections queue (p50 ~1 s).
  Scale out horizontally / put a reverse proxy in front for more.
* ~1,000 clients opening TCP connections in the very same instant overflow the OS listen backlog (Windows caps it low; Linux
  retransmits SYN after 1 s). The harness retries and reports the count; terminate TLS/keep-alive at a reverse proxy in production.
* A trainer with tens of thousands of players (100k-user data set) makes the "players with availability" dashboard count take
  ~175 ms; fine at spec scale, a candidate for a cached/denormalised counter if trainers ever get that large.
