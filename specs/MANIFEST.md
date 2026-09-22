# Project: PracticePerfect

Multi-role training/coaching platform (Super Admin, Trainer, Coach, Player/Parent) covering scheduling, CRM, payments, content and marketing. Current implementation scope: **Epic-01 (User Management & Authentication)** only — see [Task/Epics/Epic-01_User_Management_Authentication_SPEC.md](../Task/Epics/Epic-01_User_Management_Authentication_SPEC.md).

## Specs Index

| File | Purpose | Depends On | Last Updated |
|------|---------|------------|--------------|
| architect-architecture.md | System design, components, data flow | - | 2026-09-22 (TASK-001, amended: lean single-instance scope) |
| api-designer-spec.md | Endpoints, schemas, authentication | architect-architecture | - |
| frontend-design-spec.md | Pages, components, state management | architect-architecture, api-designer-spec | - |
| docs-generator-implementation.md | Build process, deployment, tooling | - | - |

## Key Decisions

- [2026-09-22] Scope locked to Epic-01 only (User Management & Authentication); Epics 02-08 out of scope for now.
- [2026-09-22] Monorepo via Turborepo, apps split as `apps/server` (NestJS) and `apps/client` (Next.js) rather than a combined full-stack Next.js app.
- [2026-09-22] ESLint 9 flat config shared via `packages/eslint-config`, each app extends the shared preset in its own `eslint.config.mjs`.

### Architecture (TASK-001, see `architect-architecture.md`)

- [2026-09-22] Backend modules: `auth`, `users`, `trainers`, `coaches`, `player-profiles`, `associations`, `share-links`, `availability`, `child-approvals`, `impersonation` — plus `shared/{prisma,security,tenancy,mail,storage,jobs,config,logging,http}` (`queue` + `cache` replaced by `jobs` in the 2026-09-22 lean amendment). Branding folded into `trainers`; `associations` promoted to its own module to break a `share-links ↔ player-profiles` cycle.
- [2026-09-22] Prisma module convention: no entity files, no decorators — one root `prisma/schema.prisma`; `PrismaService` injected into per-module repositories only (never into services); transactions opened in services, repositories accept an optional `tx`.
- [2026-09-22] Data model (ADR-01): one `User` identity row + separate `TrainerProfile`/`CoachProfile`/`PlayerProfile` tables, `User.role` as discriminator. Single-table inheritance rejected — a parent owns N `PlayerProfile` rows.
- [2026-09-22] Auth (ADR-02, amended): argon2id passwords; JWT access 15 min held in client memory; opaque rotating refresh 7 days in an httpOnly `Path=/auth` cookie, persisted + individually revocable; `User.tokenVersion` checked by a **direct Postgres read in `JwtAuthGuard` on every authenticated request** for immediate revocation on deactivate/GDPR-delete (no cache, therefore no stale window). Guard must use `findUnique` so the soft-delete extension cannot hide an inactive user's row.
- [2026-09-22] Email verification is non-blocking (ratifies G-05); reversible via a single `EmailVerifiedGuard` insertion point.
- [2026-09-22] Impersonation (ADR-03): RFC 8693 `act` actor claim carries the admin identity while `sub`/`role` are the target's; **no refresh token issued**, making the 1-hour cap structurally unextendable; destructive Super-Admin capabilities blocked while impersonating.
- [2026-09-22] Multi-tenancy (ADR-04): required typed `TenantScope` parameter on every tenant-owned repository method + a Prisma client extension that **throws** on an unscoped tenant query (assert, never silently inject) + mandatory per-controller isolation tests. Player/parent context comes from a server-validated `X-Trainer-Context`, never from the token. PostgreSQL RLS deferred (ADR-07).
- [2026-09-22] Child accounts (ADR-05): capability deny-list keyed off a `typ: CHILD` JWT claim, enforced by a global `CapabilitiesGuard`; boot fails if any non-`@Public` route lacks `@RequiresCapability`.
- [2026-09-22] Lifecycle (ADR-06): soft delete via a `deletedAt` Prisma extension with explicit `withDeleted` opt-in; GDPR anonymization via a multi-provider `Anonymizer` registry writing its snapshot to a write-only `audit` PostgreSQL schema — irreversibility is structural (no restore path exists).
- [2026-09-22] Rate limiting (ADR-14): `@nestjs/throttler` with its **default in-memory storage** and named limiters (`auth-ip` 20/15m, `auth-identity` 5/15m on hashed email, `token-consume`, `impersonation`); generic responses + dummy hashing to block enumeration; never a permanent lockout.
- [2026-09-22] **Lean / single-instance infrastructure scope chosen by the project owner (ADR-11) — resolves OQ-1 and OQ-2. Redis, BullMQ and PgBouncer are all dropped; Postgres is the only runtime infrastructure.**
  - Scheduled work is in-process `@nestjs/schedule` `@Cron` (ADR-12, supersedes ADR-09) — approval 48 h expiry sweep, token purge, stale-impersonation close, ShareLink expiry. **Correct only at one replica**; no double-fire guard is built. `SCHEDULER_ENABLED` env gates the scheduler as an emergency valve.
  - Async email/media use a Postgres **transactional outbox** (`OutboxJob`, ADR-13) drained by cron + an after-commit nudge — preserves retry/backoff/crash-durability without a broker, and is strictly more durable than the previous `afterCommit` enqueue. **Adds one model: Epic-01 is now 15 models, not 14.**
  - Accepted cost: **NFR-003 (1,000 concurrent) is no longer architecturally guaranteed** — it relied on horizontal scaling. Re-negotiated deliberately; exit criteria for revisiting the whole lean set are in §21 of the architecture doc.
- [2026-09-22] OQ-3 confirmed (player trainer context travels in a server-validated `X-Trainer-Context` header) and OQ-4 approved (`GET /me/bootstrap` aggregate endpoint kept). **No blocking open question remains — `/api-designer` is unblocked.**

## Tech Stack

**Backend** (`apps/server`): NestJS, TypeScript, PostgreSQL, Prisma ORM
**Frontend** (`apps/client`): Next.js, React, TypeScript, Tailwind CSS
**Monorepo**: Turborepo, npm/pnpm workspaces
**Tooling**: ESLint 9 (flat config, shared via `packages/eslint-config`), shared `packages/tsconfig`

**Added by TASK-001 architecture** (revised 2026-09-22 — lean / single-instance scope, OQ-1 resolved):
- **Infrastructure**: **PostgreSQL only.** No Redis, no PgBouncer, no message broker. Prisma connects directly to Postgres. Deployment is **a single API process** — see ADR-11/12 and §21 of the architecture doc before adding a second replica
- **Auth/security**: `@nestjs/jwt`, `@nestjs/passport`, `argon2`, `@nestjs/throttler` (default in-memory storage), `helmet`
- **Scheduling**: `@nestjs/schedule` in-process `@Cron` (expiry sweeps, token purge, outbox pump) — single-replica only
- **Async**: Postgres transactional outbox (`OutboxJob` model) + after-commit nudge; replaces the BullMQ `email`/`media` queues
- **Validation/config**: `class-validator` + `class-transformer`, `zod` for typed env (incl. `SCHEDULER_ENABLED`)
- **Media**: `sharp` (photo thumbnails, logo resize toward 200×200)
- **Observability**: `pino` with request-id correlation and PII redaction
- **Testing**: Testcontainers (integration tests run against real PostgreSQL, not a mocked Prisma) — kept; it is a test-time dependency, not runtime infrastructure, and the lean amendment makes it more load-bearing (revocation + outbox are both DB behaviour)
- **PostgreSQL extensions**: `pg_trgm` (directory search), separate `audit` schema with write-only app grants

---

*This manifest is updated automatically by architect, api-designer, and frontend-design skills.*
*See `../spec-desc.md` for specification structure guidelines.*
