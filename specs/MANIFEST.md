# Project: PracticePerfect

Multi-role training/coaching platform (Super Admin, Trainer, Coach, Player/Parent) covering scheduling, CRM, payments, content and marketing. Current implementation scope: **Epic-01 (User Management & Authentication)** only — see [Task/Epics/Epic-01_User_Management_Authentication_SPEC.md](../Task/Epics/Epic-01_User_Management_Authentication_SPEC.md).

## Specs Index

| File | Purpose | Depends On | Last Updated |
|------|---------|------------|--------------|
| architect-architecture.md | System design, components, data flow | - | 2026-09-22 (TASK-001, amended: lean single-instance scope) |
| api-designer-spec.md | Endpoints, schemas, authentication | architect-architecture | 2026-09-22 (TASK-001) |
| frontend-design-spec.md | Pages, components, state management | architect-architecture, api-designer-spec | 2026-09-22 (TASK-001) |
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

### API Design (TASK-001, see `api-designer-spec.md`)

- [2026-09-22] Full REST surface designed for Epic-01: 9 architecture-defined controllers **plus a 10th, `AssociationsController`**, promoted by the architecture doc's own module map but not named in the original 9-controller brief — flagged for sign-off (spec §8.7). ~45 endpoints total, including 3 gap-fill additions with no upstream controller row (`GET /trainers/:id/players`, `GET /trainers/:id/share-links`, `GET /coaches/:id/availability/check` — spec §8.8/§8.9).
- [2026-09-22] Auth endpoints (`/auth/register|login|refresh|logout|forgot-password|reset-password|verify-email(+resend)|change-password`) fully specified: 15 min JWT access (body), 7-day rotating opaque refresh (httpOnly `Path=/auth` cookie), double-submit CSRF on `/auth/refresh` + `/auth/logout`, named-limiter annotations (`auth-ip`/`auth-identity`/`token-consume`) per endpoint.
- [2026-09-22] Impersonation `act`-claim round trip fully worked (`POST /impersonation/start` → no refresh token issued, decoded JWT before/after shown → `POST /impersonation/end` → client calls `POST /auth/refresh` on the untouched admin cookie to return to the admin's own token, zero re-login).
- [2026-09-22] `X-Trainer-Context` documented per-endpoint across all controllers as Required / N/A-path-scoped / N/A-own-tenant / N/A-platform. Finding: it is genuinely **Required** on almost nothing in Epic-01's actual data model (`Availability`/`ChildPurchaseApproval` carry no `trainerId`) — flagged as open question §8.1, expected to become load-bearing at Epic-02.
- [2026-09-22] Child (`typ: CHILD`) capability deny-list wired to every gated endpoint, returning `403 { errorCode: 'CHILD_CAPABILITY_DENIED' }` (never a silent no-op) plus a narrower `403 CHILD_FIELD_NOT_EDITABLE` for field-level restrictions on `PATCH /me` / `PATCH /player-profiles/:id`. Added `Capability.APPROVE_CHILD_PURCHASE` to the architecture doc's literal deny-list to reconcile it with the §7.3 role matrix — flagged for sign-off (spec §8.2).
- [2026-09-22] `GET /me/bootstrap` response shape defined per role (`SUPER_ADMIN` / `TRAINER` / `COACH` / `PLAYER_PARENT` adult / `PLAYER_PARENT` child) as a discriminated union; `X-Trainer-Context` is optional on this one endpoint by design (it enumerates contexts rather than assuming one).
- [2026-09-22] Standard error shape (RFC 7807-flavored) + `class-validator` → `details[]` mapping + full `errorCode` catalog defined once in spec §0, referenced (not repeated) per endpoint.
- [2026-09-22] Nine additional inconsistencies/gaps found between the architecture doc, requirements doc, and business spec during design — logged in `api-designer-spec.md` §8, none blocking but all recommended for sign-off before `frontend-design` locks UI contracts against these shapes.

### Frontend Design (TASK-001, see `frontend-design-spec.md`)

- [2026-09-22] Aesthetic direction: "Court Glow" — dark performance surface (`#0D0D0D`-based ground, inverted from the source grayscale scale) with a tenant-driven accent glow computed from each trainer's `primaryColorHex`/`derivedPalette`; Clash Display (headings) + General Sans (body) type pairing, self-hosted via `next/font/local`.
- [2026-09-22] Route map: 23 pages under `apps/client/app/` (6 public/auth incl. `/join/[code]` ShareLink dispatcher, 1 forced-password-change, 3 Super Admin, 5 trainer, 3 coach, 4 player/parent, 1 shared account) plus global layout-mounted components (`ImpersonationBanner`, `ContextSwitcher`, `BrandingProvider`, 4 role-scoped `RoleGuard` shells) and the shared `AvailabilityGrid` — reconciled against api-designer-spec's ~45 endpoints and against the requirements doc's ~20-route estimate (three routes added on top: `/register` is trainer-setup-only per API spec §8.4, not public signup; `/change-password` forced landing for `mustChangePassword`; `/verify-email` as its own non-blocking route).
- [2026-09-22] State management: in-memory access token in a Zustand store (never persisted to browser storage), a hand-rolled `apiClient` interceptor that auto-attaches `Authorization`/`X-Trainer-Context` and does one silent-refresh retry on 401, TanStack Query for all server-state caching/pagination (keyset-only, matching architect §3.3), Zustand for client-only UI state (auth, active trainer context, impersonation countdown). Impersonation and context-switcher state are mounted at layout level (not page level) so they survive client-side navigation.
- [2026-09-22] Form validation: Zod schemas mirror `class-validator` DTOs 1:1 (React Hook Form + `@hookform/resolvers/zod`), UX-only — server remains source of truth. Child-field restrictions (`CHILD_FIELD_NOT_EDITABLE`) are enforced primarily by omitting fields from the rendered form, not just by validation.
- [2026-09-22] Branding: `BrandingProvider` applies trainer `logoUrl`/`primaryColorHex`/server-computed `derivedPalette` (or a client-side recomputation using the same transform names when only the raw hex is available) as CSS custom properties on a `data-branding` wrapper; non-blocking `contrastWarning` from `PATCH /trainers/:id/branding` renders as a dismissible post-save banner, matching the server's non-blocking design (architect OQ-7) with no added client-side gate.
- [2026-09-22] Seven open items logged in `frontend-design-spec.md` §11 needing sign-off before `writing-plans`, most notably: `CreateTrainerDto.trainerName` single-field-vs-split UI question, the undocumented `PASSWORD_POLICY` regex (blocks implementing password schemas precisely), and whether availability-slot overlap should be client-blocked.

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
