# Architecture: PracticePerfect

System design, components, and data flow. Entry point is [MANIFEST.md](./MANIFEST.md).

**Depends on:** - (root spec)
**Consumed by:** `api-designer-spec.md`, `frontend-design-spec.md`, `docs-generator-implementation.md`

## Global Conventions

**Layering (all backend modules):** `Controller → Service → Repository → PrismaService`.
Allowed: any layer → `shared/`. Forbidden: `Repository → Service`, `Service → Controller`, `Service → Service` across module boundaries except through an explicitly exported facade.

**Prisma adaptation of the module template.** This project uses Prisma, not TypeORM. The canonical module shape is:

```
apps/server/src/modules/<module>/
├── <module>.module.ts
├── <module>.controller.ts
├── <module>.service.ts          # business logic, transactions, invariants
├── <module>.repository.ts       # ONLY place Prisma queries for this module live
├── dto/
│   ├── create-<module>.dto.ts
│   └── update-<module>.dto.ts
└── (no entities/ directory)
```

- There are **no per-module entity files and no entity decorators**. The single source of truth for the data model is `apps/server/prisma/schema.prisma`.
- `PrismaService extends PrismaClient` lives in `shared/prisma/prisma.service.ts`, exported by a `@Global() PrismaModule`. It is injected **into repositories only** — a service that injects `PrismaService` directly is a review failure, except inside `shared/` infrastructure.
- Repositories expose domain-shaped methods (`findActiveByTrainer(scope, page)`), never leak `Prisma.XWhereInput` into services' public signatures.
- Transactions are opened in the **service** layer via `prisma.$transaction(async (tx) => ...)`; repository methods accept an optional `tx: Prisma.TransactionClient` as their last parameter so multi-repository writes join one transaction.

---

### [TASK-001] Epic-01 — User Management & Authentication (2026-09-22)

**Inputs:** `tasks/TASK-001/requirements-analyst-requirements.md` (14 entities / 11 services / 9 controllers / ~20 frontend routes), `Task/Epics/Epic-01_User_Management_Authentication_SPEC.md`.
**Scope:** Epic-01 only. Epics 02–08 appear solely as forward-reference seams (§18).

> ### ⚠ AMENDMENT — Lean / Single-Instance Infrastructure (2026-09-22)
>
> The project owner reviewed this architecture and **chose the lean / single-instance deployment scope**, resolving OQ-1 and OQ-2. This is a certification / demo-scale deployment: **exactly one API process, no horizontal scaling planned.**
>
> **Removed from the design:** Redis, BullMQ, PgBouncer.
>
> | Concern | Was | Now |
> |---|---|---|
> | Immediate revocation (§6.3) | Redis-cached auth snapshot, 60 s TTL | Direct `User` row read per authenticated request (Postgres) |
> | Scheduled work (§13) | BullMQ repeatable jobs | `@nestjs/schedule` in-process `@Cron` — **single replica only** |
> | Async email / media (§13) | BullMQ `email` / `media` queues | Transactional outbox table + cron drain (§13.2) |
> | Rate limiting (§12) | `@nestjs/throttler` + Redis storage | `@nestjs/throttler` default in-memory storage, same named limiters |
> | Connection pooling (§14) | PgBouncer transaction mode | Direct Prisma → Postgres |
> | Branding cache (§14) | Redis `trainer:branding:{id}` | Indexed Postgres read + optional in-process memo |
>
> **Unchanged and still authoritative:** the 10-module map (§2), the Prisma data model shape (§3), the guard pipeline and RBAC/capability design (§5, §7, §9.2), the impersonation `act`-claim design (§10), three-layer multi-tenancy including the typed `TenantScope` and the **throwing** Prisma extension (§8), soft-delete + GDPR anonymization (§11), the `X-Trainer-Context` transport (OQ-3), `GET /me/bootstrap` (OQ-4), and Testcontainers for integration tests (§16 — a test-time dependency, unaffected by runtime infra choices).
>
> Sections amended in place below are marked **[AMENDED 2026-09-22]**. Superseded ADRs are marked in §17. The scaling exit criteria are in §21.

---

#### 1. Repository Topology

```
practiceperfect/
├── apps/
│   ├── server/                      # NestJS API (the only thing that touches the DB)
│   │   ├── prisma/
│   │   │   ├── schema.prisma        # single source of truth for all 14 models
│   │   │   ├── migrations/
│   │   │   └── seed.ts              # bootstrap Super Admin (no self-registration path)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts        # global guard pipeline registered here
│   │       ├── modules/             # §2
│   │       └── shared/              # §13
│   └── client/                      # Next.js App Router (no DB access, calls the API)
├── packages/
│   ├── eslint-config/               # ESLint 9 flat presets: base / nest / next
│   └── tsconfig/                    # base.json, nest.json, next.json
└── turbo.json
```

**`apps/client` never talks to PostgreSQL.** All authorization is server-side (SEC-001); the Next.js layer only mirrors it for UX. Next.js route handlers are used exclusively as a thin BFF for the refresh-cookie handshake (§6.4), not for business logic.

---

#### 2. Backend Module Map

| Module | Owns (Prisma models) | Controller responsibilities | Key services |
|---|---|---|---|
| `auth` | `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken` | `/auth/register`, `/login`, `/logout`, `/refresh`, `/verify-email`, `/forgot-password`, `/reset-password` | `AuthService`, `TokenService`, `PasswordService` |
| `users` | `User`, `UserDeletionLog` | Super Admin directory `GET/POST/PATCH /users`, `/users/:id/deactivate`, `/reactivate`, `DELETE /users/:id` | `UserService`, `AccountLifecycleService`, `AccountProvisioningService` |
| `trainers` | `TrainerProfile` (incl. branding fields) | `POST /trainers`, `GET/PATCH /trainers/:id`, `PATCH /trainers/:id/branding` | `TrainerService`, `PortalBrandingService` |
| `coaches` | `CoachProfile` | `POST /coaches/invite`, `POST /coaches/accept/:code`, `GET /trainers/:id/coaches`, `PATCH /coaches/:id` | `CoachService` |
| `player-profiles` | `PlayerProfile` | `GET/POST/PATCH /player-profiles`, `GET /player-profiles/:id/trainers` | `PlayerProfileService` |
| `associations` | `PlayerTrainerAssociation` | `GET /me/contexts`, `POST /player-profiles/:id/trainers`, `DELETE /player-profiles/:id/trainers/:trainerId` | `PlayerTrainerAssociationService` |
| `share-links` | `ShareLink` | `POST /share-links`, `GET /share-links/:code`, `POST /share-links/:code/redeem`, `DELETE /share-links/:id` | `ShareLinkService`, `ShareLinkRedemptionService` |
| `availability` | `Availability`, `CoachAvailabilityOverride` | `GET/PUT /player-profiles/:id/availability`, `GET/PUT /coaches/:id/availability`, `POST /coaches/:id/availability/override` | `AvailabilityService`, `ConflictCheckService` |
| `child-approvals` | `ChildPurchaseApproval` | `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/deny` | `ChildPurchaseApprovalService`, `ApprovalExpiryJob` |
| `impersonation` | `ImpersonationLog` | `POST /impersonation/start`, `/end`, `GET /impersonation/history` | `ImpersonationService` |

**Deviations from the requirements doc, with rationale:**

- **`PortalBrandingService` folded into `trainers`**, not its own module — it mutates two columns on `TrainerProfile` and shares its authorization rule ("owner trainer or Super Admin"). A separate module would duplicate the ownership guard for no boundary benefit.
- **`associations` promoted to its own module** (the requirements doc listed only a service). Three different flows write it — ShareLink redemption, child-trainer management, and removal-with-cascade — and both `share-links` and `player-profiles` depend on it. Without its own module the dependency becomes a `share-links ↔ player-profiles` cycle.
- **`EmailService` and `FileStorageService` are not modules under `modules/`** — they are cross-cutting infrastructure ports in `shared/` (§13).
- **`PlayerProfilesController` + `AssociationsController` both mount under `/player-profiles`.** Nest allows this; the API designer should treat them as one resource surface with two owning modules.

**Module dependency graph (acyclic):**

```
auth ──────► users ──────► (shared/prisma, shared/mail)
  ▲            ▲
  │            │
share-links ──┼──► associations ──► player-profiles
  │            │                         ▲
  └──► coaches ┘                         │
impersonation ──► users            child-approvals
availability ──► player-profiles, coaches
trainers ──► users
```

`auth` depends on `users` for lookup/creation (never the reverse). `AuthModule` exports `TokenService` only; guards are registered globally (§7.1) so no module imports `AuthModule` for authorization.

---

#### 3. Data Model Architecture (Prisma)

##### 3.1 Identity vs. Profile — DECISION

**Chosen: one `User` row for identity + separate profile tables (`TrainerProfile`, `CoachProfile`, `PlayerProfile`), with `User.role` as the discriminator.**

Rejected alternatives:

| Option | Why rejected |
|---|---|
| Single `User` table, all role fields nullable (single-table inheritance) | Produces ~25 nullable columns, no DB-enforceable required-ness per role, and **cannot express BR-007/FR-030 at all**: a parent owns *many* `PlayerProfile` rows (self + each child). A 1:1 flattening makes children impossible without a second table anyway. |
| Separate `Trainer` / `Coach` / `Player` tables each with their own credentials | Breaks BR-013 (email globally unique across roles) and forces three auth paths. Also breaks FR-034 (a child login is a `User` whose profile is owned by the parent's `User`). |
| Polymorphic `profileId` + `profileType` on `User` | No referential integrity in PostgreSQL; still can't model 1:N player profiles. |

**Cardinalities that make this the only coherent shape:**

```
User (role=TRAINER)        1 ──1  TrainerProfile
User (role=COACH)          1 ──1  CoachProfile ──N──1 TrainerProfile   (BR-003: exactly one trainer)
User (role=PLAYER_PARENT)  1 ──N  PlayerProfile   via PlayerProfile.accountUserId   (the parent/owner)
User (role=PLAYER_PARENT)  0/1─1  PlayerProfile   via PlayerProfile.childUserId     (optional child login)
PlayerProfile  N ──N  TrainerProfile   via PlayerTrainerAssociation    (BR-004: multi-trainer, isolated)
```

The parent's own "I train too" record is just a `PlayerProfile` with `isSelf = true` and `accountUserId = childUserId = <parent user id>`… **no** — `childUserId` stays `NULL` for self profiles; `isSelf = true` is the marker. This keeps "does this profile have its own login?" (`childUserId IS NOT NULL`) orthogonal to "is this the account holder's own profile?" (`isSelf`).

##### 3.2 Enforcing "exactly one role" (BR-001)

Prisma's schema language cannot express cross-table exclusivity. Three enforcement layers, all required:

1. **`User.role` enum** — `SUPER_ADMIN | TRAINER | COACH | PLAYER_PARENT`, non-null.
2. **Raw SQL constraints added in the migration** (Prisma migrations accept hand-edited SQL):
   - `UNIQUE (userId)` on `TrainerProfile` and `CoachProfile` (Prisma `@unique` covers this).
   - Deferred trigger `assert_single_profile_kind()` raising if a `User` gains a `TrainerProfile` while a `CoachProfile` exists, or vice versa.
   - `CHECK` on `Availability`: exactly one of `playerProfileId` / `coachProfileId` is non-null, and it agrees with `subjectType` (exclusive arc).
   - `CHECK` on `User`: `status = 'DELETED'` implies `deletedAt IS NOT NULL` (supports §11 irreversibility).
3. **`AccountProvisioningService` (in `users`)** is the *only* code path that creates a `User` together with its profile, always inside one `$transaction`. No module creates a bare `User`. This is the layer that makes the invariant true by construction; the DB constraints are the net.

##### 3.3 Indexing strategy (NFR-002: 10k-row directory < 3s)

| Model | Indexes |
|---|---|
| `User` | `@@unique([email])`; `@@index([status, role, createdAt])` (directory default sort + facet filters); `pg_trgm` GIN index on `lower(email)` and on the name column for the tool-specific search (`ILIKE '%q%'` is unindexable otherwise) |
| `PlayerTrainerAssociation` | `@@unique([trainerId, playerProfileId])`; `@@index([trainerId, status])` (roster); `@@index([playerProfileId, status])` (context switcher) |
| `CoachProfile` | `@@unique([userId])`; **partial unique** `WHERE status = 'ACTIVE'` on `userId` — this is the DB-level enforcement of BR-003 (one active trainer per coach) |
| `ShareLink` | `@@unique([code])`; `@@index([trainerId, status])` |
| `RefreshToken` | `@@unique([tokenHash])`; `@@index([userId, revokedAt])` |
| `ChildPurchaseApproval` | `@@index([parentUserId, status])`; `@@index([status, expiresAt])` (expiry sweep) |
| `Availability` | `@@index([playerProfileId, dayOfWeek])`, `@@index([coachProfileId, dayOfWeek])` |

Pagination for the directory is **keyset/cursor-based** (`createdAt, id`), not `OFFSET` — offset degrades past a few thousand rows and NFR-002 is a hard acceptance criterion.

##### 3.4 Time & money types

- `Availability.startTime/endTime`: `SMALLINT` minutes-from-midnight (0–1440), not `TIME` — makes overlap math (`aStart < bEnd AND bStart < aEnd`) index-friendly and timezone-free. Weekly recurrence is intentionally trainer-local wall-clock; no timezone normalization in Epic-01 (see open question OQ-5).
- `ChildPurchaseApproval.amount`: `Decimal @db.Decimal(10,2)`. Never `Float`.

---

#### 4. Module Placement Decisions (decision-tree application)

| New functionality | Placement | Why |
|---|---|---|
| JWT issuance/validation | `modules/auth` | Business domain (session lifecycle) |
| Guards & decorators (`@Roles`, `@Public`, `@RequiresCapability`, `@CrossTenant`) | Decorators in `shared/security/decorators/` (zero-dependency metadata), guards in `shared/security/guards/` | Guards are consumed by every module; putting them in `auth` would force every module to import `AuthModule` and create cycles |
| Tenant context propagation | `shared/tenancy` (AsyncLocalStorage) | Cross-cutting infrastructure |
| Transactional email | `shared/mail` (port + provider adapter) | External service integration, INT-001 explicitly wants a swappable provider |
| Photo/logo upload + resize | `shared/storage` | External service integration, INT-002 |
| Soft-delete filtering, anonymization registry | `shared/prisma` extensions + `users/AccountLifecycleService` | Cross-cutting data concern + one owner for the workflow (§11) |
| Approval 48h expiry sweep | `modules/child-approvals` — `@Cron` method on `ApprovalExpiryJob` | Business logic owned by the module that owns the state machine **[AMENDED 2026-09-22: in-process cron, not a BullMQ worker]** |
| Cron registration, outbox drain, job contracts | `shared/jobs` | Cross-cutting infrastructure; modules declare `@Cron` locally, `shared/jobs` owns `ScheduleModule` wiring + the outbox pump **[ADDED 2026-09-22]** |

---

#### 5. Request Pipeline

```
HTTP request
  │
  ├─ 1. helmet + CORS (credentials, single client origin)
  ├─ 2. RequestContextMiddleware      → AsyncLocalStorage: requestId, ip, userAgent
  ├─ 3. ValidationPipe (global)       → class-validator, whitelist+forbidNonWhitelisted, transform
  ├─ 4. ThrottlerGuard        (APP_GUARD #1)  → §12  (in-memory storage)
  ├─ 5. JwtAuthGuard          (APP_GUARD #2)  → skips @Public(); resolves AuthContext; §7.2
  │        └─ one indexed User findUnique per authenticated request (§6.3) — runs BEFORE
  │           any TenantScope exists in ALS, so the tenant-guard extension skips it (§8)
  ├─ 6. RolesGuard            (APP_GUARD #3)  → @Roles(...) vs AuthContext.effectiveRole
  ├─ 7. CapabilitiesGuard     (APP_GUARD #4)  → @RequiresCapability(...) vs child deny-list; §9.2
  ├─ 8. TenantContextInterceptor              → publishes TenantScope into ALS; §8
  ├─ 9. Controller → Service → Repository → PrismaService
  │        └─ Prisma client extensions: tenant assertion, soft-delete filter, audit stamping
  └─ 10. AuditInterceptor + GlobalExceptionFilter (RFC 7807 problem+json)
```

Guard order is the `APP_GUARD` provider registration order in `AppModule`. Throttling runs **before** auth so that unauthenticated brute force is cheap to reject.

---

#### 6. Authentication Architecture

##### 6.1 Token strategy (ratifies G-07)

| Token | Form | Lifetime | Storage | Revocable |
|---|---|---|---|---|
| Access token | JWT (HS256 via `JWT_SECRET`; RS256 upgrade path noted) | 15 min | Client memory only — never `localStorage`/`sessionStorage` | Indirectly (§6.3) |
| Refresh token | Opaque 256-bit random, **SHA-256 hash** stored in `RefreshToken.tokenHash` | 7 days, sliding | `httpOnly; Secure; SameSite=Lax; Path=/auth` cookie | Yes, per row |
| Email verification | Opaque random, hashed at rest | 24 h, single-use | Email link | n/a |
| Password reset | Opaque random, hashed at rest | 1 h, single-use | Email link | n/a |
| Impersonation access token | JWT with `act` claim, **no refresh token issued** | 60 min hard cap | Client memory | Yes (§10) |

Passwords: **argon2id** (NFR-006) — `memoryCost 19456 KiB, timeCost 2, parallelism 1` (OWASP baseline). bcrypt is the fallback only if the deploy target forbids native modules.

##### 6.2 Access-token claims

```jsonc
{
  "sub":  "<effective user id>",        // who the request acts AS
  "role": "PLAYER_PARENT",              // effective role — RolesGuard reads this
  "typ":  "CHILD",                      // "ADULT" | "CHILD"  → CapabilitiesGuard
  "gid":  "<guardian user id|null>",    // child only
  "tid":  "<trainerId|null>",           // TRAINER: own id. COACH: employing trainer. else null
  "tv":   3,                            // tokenVersion — see 6.3
  "act":  { "sub": "<admin id>", "role": "SUPER_ADMIN", "imp": "<ImpersonationLog id>" }, // impersonation only
  "jti": "...", "iat": ..., "exp": ...
}
```

`sub`/`role` are always the **effective** identity; `act` (RFC 8693 actor claim) carries the real one. Every guard reads effective; every audit write reads `act.sub ?? sub`. This is the single mechanism that satisfies "impersonated permissions exactly match the target" (FR-015) and "stamp writes with both ids" (SEC-003) without duplicated logic.

##### 6.3 Immediate revocation (deactivate / GDPR delete must kill live sessions) **[AMENDED 2026-09-22]**

A 15-minute access token would otherwise let a just-deactivated user keep working. Mechanism:

- `User.tokenVersion INT NOT NULL DEFAULT 0`. Incremented by: deactivate, GDPR delete, password reset/change, and "logout everywhere".
- `JwtAuthGuard` reads `{id, status, role, tokenVersion, mustChangePassword}` **directly from Postgres** on every authenticated request, via `AuthSnapshotRepository.findForAuth(userId)`. Token rejected if `payload.tv !== row.tokenVersion` or `row.status !== 'ACTIVE'` or the row is missing.
- The guarantee is **identical to the previous Redis design and in fact strictly stronger**: there is no 60 s cache TTL window at all, so a lifecycle write takes effect on the very next request with no explicit invalidation step to forget.
- Cost: one primary-key `findUnique` with a narrow `select` per authenticated request — a single-row index hit on a local connection, sub-millisecond, and it replaces a network round-trip to Redis rather than adding to one. Acceptable at single-instance scale; see §21 for when this stops being true.

**Three implementation constraints this places on the guard** (all are consequences of moving the read into Prisma, and none existed while the read was in Redis):

1. **It must use `findUnique`, not `findFirst`.** §11.1's soft-delete extension merges `deletedAt: null` into `findFirst`/`findMany`, which would make a deactivated or GDPR-deleted user's row invisible to the guard. `findUnique` is deliberately unfiltered (§11.1), so the guard sees `status` and rejects on it explicitly — the difference between a precise `401 ACCOUNT_INACTIVE` and a confusing "user not found".
2. **It must run before any `TenantScope` is published to ALS** — which it does, at pipeline step 5 versus the interceptor at step 8 (§5). `User` is not in the tenant-owned model set anyway (§8), so the throwing tenant-guard extension has two independent reasons to skip it. This ordering is now load-bearing and is covered by a test (§20).
3. **It is memoized per request** (`AsyncLocalStorage`), so a handler that also loads the user later in the same request does not pay for a second read. Memoization is request-scoped only — never process-scoped, which would silently reintroduce the cache-invalidation problem this change removes.

- Deactivation additionally revokes all `RefreshToken` rows for the user in the same transaction.

##### 6.4 Refresh rotation & cookie handling

- `/auth/refresh` rotates: the presented token is marked `revokedAt`, a new one issued with the same `familyId`. **Reuse of an already-revoked token revokes the entire family** and increments `tokenVersion` (stolen-token detection).
- CSRF (NFR-007): the refresh cookie is the only ambient credential; all other endpoints use `Authorization: Bearer`. `/auth/refresh` and `/auth/logout` additionally require a double-submit CSRF token (non-httpOnly `csrf` cookie echoed in `X-CSRF-Token`), and cookies are `SameSite=Lax` with `Path=/auth`.
- The Next.js client obtains its in-memory access token by calling `/auth/refresh` on boot and on 401; a Next route handler proxies this so the cookie domain stays first-party.

##### 6.5 Email verification — non-blocking (ratifies G-05)

`emailVerifiedAt` is **not** checked by `JwtAuthGuard` or any guard. It is surfaced as `emailVerified: false` on `GET /me`, which the client renders as a persistent banner with a resend action. No Epic-01 endpoint is gated on it. If this is ever reversed, the single change point is a new `EmailVerifiedGuard` added to the pipeline at position 5.5 — deliberately designed so the decision is one-line reversible.

##### 6.6 Forced password change (FR-010)

`User.mustChangePassword BOOLEAN`. Set when Super Admin creates a trainer with a temp password. Enforced by a `PasswordChangeRequiredGuard` folded into `CapabilitiesGuard`: when true, every route except `/auth/change-password`, `/auth/logout`, `/me` returns `403 PASSWORD_CHANGE_REQUIRED`. Preferred flow is the setup-link variant (no temp password ever transits email), with the temp password as fallback.

---

#### 7. Authorization Architecture (RBAC)

##### 7.1 Decorators

| Decorator | Read by | Purpose |
|---|---|---|
| `@Public()` | `JwtAuthGuard` | Opt out of auth (login, share-link preview, register) |
| `@Roles(Role.TRAINER, Role.SUPER_ADMIN)` | `RolesGuard` | Coarse role gate |
| `@RequiresCapability(Capability.MANAGE_TRAINER_ASSOCIATIONS)` | `CapabilitiesGuard` | Fine-grained, child-account-aware gate (§9.2) |
| `@CrossTenant()` | `TenantContextInterceptor` + Prisma extension | Super-Admin-only escape from tenant scoping; refuses to apply for non-`SUPER_ADMIN` effective roles |
| `@CurrentUser()` | param decorator | Injects the typed `AuthContext` |

Default posture is **deny**: a route with no `@Public()` requires a valid token; a route with no `@Roles()` is available to all authenticated roles but still subject to tenancy and capability checks. Ownership checks that depend on row data (e.g. "is this `PlayerProfile` mine?") are **not** guards — they live in the service layer, because a guard cannot make the ownership query without duplicating the repository.

##### 7.2 `AuthContext` (the object every layer reads)

```ts
interface AuthContext {
  userId: string;            // effective
  role: Role;                // effective
  accountType: 'ADULT' | 'CHILD';
  guardianUserId?: string;
  trainerId?: string;        // tenant anchor; TRAINER & COACH only
  impersonation?: { actorUserId: string; actorRole: Role; logId: string; expiresAt: Date };
  get auditActorId(): string;   // impersonation?.actorUserId ?? userId
}
```

Built once in `JwtAuthGuard`, attached to the request, and published to `AsyncLocalStorage` so repositories and Prisma extensions can read it without prop-drilling.

##### 7.3 Role capability matrix (Epic-01 surface)

| Capability | SUPER_ADMIN | TRAINER | COACH | PLAYER_PARENT (adult) | PLAYER_PARENT (child login) |
|---|:--:|:--:|:--:|:--:|:--:|
| Create trainer account | ✅ | ❌ | ❌ | ❌ | ❌ |
| Global user directory / edit any user | ✅ | ❌ | ❌ | ❌ | ❌ |
| Deactivate / reactivate / GDPR-delete | ✅ | ❌ | ❌ | ❌ | ❌ |
| Impersonate | ✅ (not another SUPER_ADMIN) | ❌ | ❌ | ❌ | ❌ |
| Generate ShareLinks | ✅ | ✅ (own) | ❌ | ❌ | ❌ |
| Redeem ShareLink (new trainer association) | ✅ | ❌ | ✅ (coach link) | ✅ | ❌ **FR-051** |
| Invite coach / view own roster | ✅ | ✅ (own) | ❌ | ❌ | ❌ |
| Portal branding | ✅ | ✅ (own) | ❌ | ❌ | ❌ |
| Create/edit child profile | ✅ | ❌ | ❌ | ✅ | ❌ |
| Change trainer associations | ✅ | ❌ | ❌ | ✅ | ❌ **FR-051** |
| Set own availability | ✅ | ❌ | ✅ | ✅ (self + children) | ✅ (own profile only) |
| View player availability | ✅ | ✅ (own roster) | ❌ | ✅ (own family) | ✅ (own) |
| Override coach conflict | ✅ | ✅ (own coaches) | ❌ | ❌ | ❌ |
| Approve/deny child purchase | ✅ | ❌ | ❌ | ✅ (own children) | ❌ |
| Edit own profile basics | ✅ | ✅ | ✅ | ✅ | ✅ (limited fields) |
| Delete own account | ❌ (SA uses admin path) | ❌ | ❌ | ❌ | ❌ **FR-051** |

---

#### 8. Multi-Tenancy Enforcement (BR-002, SEC-002)

Three layers. Layer 1 is the mechanism; layers 2 and 3 exist because a single mechanism *will* eventually be bypassed by a new endpoint.

**Layer 1 — typed `TenantScope` parameter (primary, compile-time).**
Every repository method touching a tenant-owned model takes `scope: TenantScope` as its **first** parameter:

```ts
type TenantScope =
  | { kind: 'TRAINER'; trainerId: string }
  | { kind: 'PLATFORM' };            // only constructible under @CrossTenant() + SUPER_ADMIN

// coaches.repository.ts
findAll(scope: TenantScope, page: PageArgs) {
  return this.prisma.coachProfile.findMany({ where: { ...tenantWhere(scope), status: 'ACTIVE' }, ... });
}
```

`tenantWhere()` returns `{ trainerId }` or `{}`. Because the parameter is required and the type has no default, **a developer cannot write an unscoped query without visibly constructing a `PLATFORM` scope** — which is exactly the thing code review and grep look for. `TenantScope` is produced only by `TenantContextInterceptor` from `AuthContext.trainerId`; there is no public constructor.

**Layer 2 — Prisma client extension assertion (runtime net).**
`shared/prisma/extensions/tenant-guard.extension.ts` wraps `$allOperations`. For a declared set of tenant-owned models (`TrainerProfile`, `CoachProfile`, `PlayerTrainerAssociation`, `ShareLink`, `CoachAvailabilityOverride`), if the ALS tenant scope is `TRAINER` and the query's `where` does not contain a `trainerId` equal to the scope, it **throws** `TenantScopeViolationError` (500 + alert), rather than silently injecting the filter.

Deliberate choice: **assert, do not auto-inject.** Silent injection makes a missing filter invisible and produces confusing empty results; an exception surfaces the bug in the first integration test run. `PLATFORM` scope and models with no `trainerId` are skipped.

**Layer 3 — mandatory isolation tests.**
For every tenant-owned controller the integration suite includes a "trainer B cannot read/modify trainer A's row → 404 (not 403, to avoid existence disclosure)" case. This is a Definition-of-Done item, not optional.

**Player/parent isolation is different and must not be confused with trainer tenancy.** A player's tenant is not fixed by their token — they have N associations. Their scope comes from an explicit `X-Trainer-Context` header (or `?trainerId=`) validated on every request against `PlayerTrainerAssociation (status=ACTIVE)`. An invalid/unassociated context is `403`. The active context persists client-side (cookie + Zustand store) but is **never trusted**; the server re-validates each request. This is what guarantees FR-022's "no combined cross-trainer view" — there is no API shape that can return two trainers' data in one response.

**Row-Level Security (PostgreSQL RLS) was considered and deferred.** It would give the strongest guarantee, but requires per-request `SET LOCAL app.trainer_id` with a dedicated non-superuser DB role, and interacts badly with Prisma migrations and with Prisma's connection reuse (a `SET LOCAL` must be pinned to the same connection as the query, which Prisma does not guarantee outside an explicit `$transaction`). Revisit if the platform ever goes multi-region or gains a non-Nest data consumer. Documented as ADR-07.

> **[AMENDED 2026-09-22]** The original rationale also cited PgBouncer transaction-mode pooling as an obstacle. **That obstacle no longer exists** — PgBouncer is dropped (§14, ADR-11). RLS remains deferred for the two reasons above, which are independent of PgBouncer, so the decision is unchanged; only its justification is narrower. If RLS is ever revisited, note that the removal of PgBouncer has made it meaningfully cheaper to adopt than this document originally implied.

---

#### 9. ShareLink Registration & Parent/Child Linking

##### 9.1 Redemption flows

`GET /share-links/:code` is `@Public()` and returns only `{ type, trainerDisplayName, logoUrl, primaryColorHex, valid, reason? }` — no PII, no trainer internal ids, so an enumerated code leaks nothing beyond public branding.

```
POST /share-links/:code/redeem
   │
   ├─ no auth token ────────────► ANONYMOUS_REGISTRATION
   │      one $transaction: User(PLAYER_PARENT) + PlayerProfile(isSelf|child)
   │      + PlayerTrainerAssociation + ShareLink.useCount++ + OutboxJob(EMAIL_*), all one tx (§13.2)
   │
   ├─ auth, typ=ADULT, role=PLAYER_PARENT ──► ASSOCIATE_EXISTING
   │      body.subjectProfileIds[] = chosen family members (FR-021 checklist)
   │      validates each profile is owned by caller; idempotent per (trainer, profile)
   │
   ├─ auth, typ=CHILD ─────────► 403 CHILD_SHARE_LINK_BLOCKED   (FR-052, SEC-006)
   │      side effects: email guardian with the code + "Review Registration" CTA;
   │      NO association created, NO partial state written
   │
   ├─ auth, role=COACH or anonymous on a COACH_UNIQUE link ──► COACH_ACCEPT
   │      asserts target email match, single-use, not expired,
   │      and no existing ACTIVE CoachProfile for this user (BR-003)
   │
   └─ auth, role=TRAINER|SUPER_ADMIN ──► 409 (a trainer cannot be someone's player in Epic-01)
```

**Single-use atomicity (BR-006).** Coach-link redemption never does read-then-write. It performs a conditional update inside the transaction:

```ts
const claimed = await tx.shareLink.updateMany({
  where: { code, status: 'ACTIVE', expiresAt: { gt: new Date() }, useCount: { lt: 1 } },
  data:  { useCount: { increment: 1 }, status: 'EXPIRED' },
});
if (claimed.count === 0) throw new ShareLinkUnavailableError();
```

Two concurrent clicks: one gets `count = 1`, the other `0`. Static player links use the same shape with the `useCount` predicate omitted.

##### 9.2 Child account constraints as capabilities, not UI (SEC-006)

`typ: 'CHILD'` in the JWT drives a **server-side deny-list** evaluated by `CapabilitiesGuard`:

```ts
const CHILD_DENIED: ReadonlySet<Capability> = new Set([
  Capability.REDEEM_SHARE_LINK,
  Capability.MANAGE_TRAINER_ASSOCIATIONS,
  Capability.MANAGE_PAYMENT_METHODS,
  Capability.PURCHASE_TOKENS,
  Capability.COMPLETE_PURCHASE,
  Capability.DELETE_OWN_ACCOUNT,
  Capability.VIEW_GUARDIAN_DATA,
  Capability.MANAGE_CHILD_PROFILES,
]);
```

A deny-list (rather than an allow-list) is chosen because FR-050/FR-051 are written as an explicit prohibition set, and because a new endpoint added later defaults to *available to children* only if nobody annotates it — so the rule is: **every new controller method must carry `@RequiresCapability`**, enforced by a custom ESLint rule in `packages/eslint-config` and a startup assertion that fails boot if any non-`@Public` route lacks the decorator. That converts an easy-to-forget convention into a build failure.

Additionally, a child's data access is bounded in the service layer: a `CHILD` context can only resolve `PlayerProfile` rows where `childUserId = auth.userId` (never sibling or guardian profiles), and its context switcher lists only that profile's associations (FR-034).

##### 9.3 Child purchase approval state machine

```
        create (child initiates USD, or TOKEN while allowChildTokenSpendWithoutApproval=false)
                 │
              PENDING ──approve──► APPROVED  → hands off {approved:true} to Epic-05 (no charge here)
                 │  │
                 │  └──deny─────► DENIED
                 └──48h sweep──► EXPIRED     (auto-deny + notify both parties, FR-042)
```

Terminal states are immutable; transitions are guarded by a conditional `updateMany` on `status = 'PENDING'` so a race between the parent's click and the expiry sweep cannot double-transition. When `allowChildTokenSpendWithoutApproval = true`, no row is created at all — an informational notification is queued instead (FR-041).

---

#### 10. Impersonation Architecture

| Concern | Design |
|---|---|
| Start | `POST /impersonation/start` → `@Roles(SUPER_ADMIN)`; `assertNotTargetingSuperAdmin` (FR-015/BR-010) returns `422`, not `403`, so the UI can show a validation message; creates `ImpersonationLog`; returns an access token with `sub = target`, `role = target.role`, `act = {admin, logId}`, `exp = min(now+60m, …)` |
| No refresh | **No refresh token is issued for impersonation.** This makes the 1-hour cap structurally unextendable — there is no code path that can renew it. |
| Admin session survival | The admin's own refresh cookie is never touched. "Exit Impersonation" = `POST /impersonation/end` (accepts the impersonation token), stamps `endedAt`/`durationSeconds`, then the client discards the token and calls `/auth/refresh` to get its admin access token back. Zero re-login. |
| Effective permissions | Guards read `sub`/`role` only → impersonated navigation and data match the target exactly, with no branch logic anywhere in feature code. |
| Audit | A Prisma extension stamps `actorUserId` / `impersonationLogId` onto every write while `AuthContext.impersonation` is present, and `AuditInterceptor` logs `{actor, effective, route, logId}`. `auditActorId` is the only accessor feature code should use. |
| Blast radius | Destructive Super-Admin capabilities (GDPR delete, create trainer, start another impersonation) are **blocked while impersonating**: `CapabilitiesGuard` denies them when `act` is present, regardless of the effective role. Prevents an impersonated-trainer session from being escalated. |
| History | `GET /impersonation/history` — Super Admin only, keyset-paginated, filterable by admin/target/date. |

---

#### 11. Account Lifecycle: Soft Delete & GDPR Anonymization

One owner: `AccountLifecycleService` in `modules/users`. No module reimplements either operation.

##### 11.1 Soft delete (deactivation, FR-013 / BR-011)

- `User.status = INACTIVE` + `deletedAt` set + `tokenVersion++` + all `RefreshToken` rows revoked, in one transaction. Reversible via `reactivate` (blocked when `status = DELETED`).
- **Read filtering is a Prisma client extension**, `soft-delete.extension.ts`, applied to models carrying `deletedAt` (`User`, `PlayerProfile`, `PlayerTrainerAssociation`): `findMany/findFirst/count/aggregate` get `deletedAt: null` merged into `where` unless the call passes `withDeleted: true` (a typed extension argument). Historical/admin reads opt in explicitly — which is what FR-013's "all historical records remain visible, marked inactive" requires.
- Deliberate exception: `findUnique` is **not** filtered (Prisma restricts its `where` to unique fields, and silently returning null for a known id causes more bugs than it prevents). Repositories that must exclude deleted rows by id use `findFirst`. This is documented in the repository template so it is not rediscovered per module.

##### 11.2 GDPR anonymization (FR-014 / SEC-005)

An **anonymizer registry**, so PII erasure is not reimplemented per module:

```ts
export const ANONYMIZER = Symbol('ANONYMIZER');
export interface Anonymizer {
  readonly model: string;
  anonymize(userId: string, tx: Prisma.TransactionClient): Promise<void>;
}
```

Each module that stores PII provides one (`useClass` with `provide: ANONYMIZER, multi: true`): `users` (name/email/phone/photo), `player-profiles` (child names, school, jersey, emergencyContact), `coaches` (bio/credentials), `trainers` (business details). `AccountLifecycleService.gdprDelete()` runs, in one transaction:

1. Serialize the full pre-anonymization snapshot → `UserDeletionLog.dataBackupJson` in the **`audit` PostgreSQL schema**, written by a separate connection whose role has `INSERT` but no `UPDATE`/`DELETE`/`SELECT` from the application role. The app literally cannot read back or mutate what it wrote.
2. Invoke every registered `Anonymizer` (ordering irrelevant; all within the tx).
3. `User`: `email = deleted_{id}@example.com`, name → `Deleted User`, `phone = null`, `photoUrl = null`, `status = DELETED`, `deletedAt = now`, `tokenVersion++`, `passwordHash` → unusable sentinel.
4. Revoke all refresh/verification/reset tokens.
5. Emit `user.deleted` domain event.

**Irreversibility is structural, not procedural** (SEC-005): there is no `restore()` method, `reactivate()` hard-rejects `status = DELETED` (mirrored by a DB `CHECK`), and the snapshot is in a schema the app role cannot read. Foreign keys to `User` are `ON DELETE RESTRICT` throughout — rows are never physically removed, so analytics totals and historical joins stay intact.

---

#### 12. Rate Limiting (SEC-004, spec §13) **[AMENDED 2026-09-22]**

`@nestjs/throttler` v6 with **named throttlers** and its **default in-memory storage**. The named-limiter strategy below is unchanged — only the storage backend swapped. With exactly one API process, the process-local counter *is* the global counter, so per-IP and per-identity limits are enforced exactly as specified.

Two honest consequences of in-memory storage, neither of which breaks SEC-004 at this scale:

- **A process restart clears all counters**, granting a fresh window. An attacker cannot trigger restarts, so this is a liveness quirk rather than a bypass; the account-level protections (generic responses, dummy hashing, progressive delay) are unaffected.
- **Counter memory is bounded by TTL**, not by cardinality. The largest window is 15 minutes, so the key set is bounded by distinct attacker IPs within 15 minutes — fine for this deployment. `@nestjs/throttler` evicts expired records itself.

| Named limiter | Applies to | Limit | Tracker key |
|---|---|---|---|
| `default` | everything | 300 / 60 s | ip |
| `auth-ip` | `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/share-links/:code/redeem` | 20 / 15 min | ip |
| `auth-identity` | `/auth/login`, `/auth/forgot-password` | 5 / 15 min | `sha256(route + normalizedEmail)` |
| `token-consume` | `/auth/reset-password`, `/auth/verify-email` | 10 / 15 min | ip |
| `impersonation` | `/impersonation/start` | 10 / h | adminUserId |

A custom `AuthThrottlerGuard` overrides `getTracker()` to hash the submitted email (never store a raw email as a throttler key — still true for in-memory storage, which keeps raw addresses out of heap dumps and logs) and applies `auth-ip` and `auth-identity` **together** — IP-only misses distributed credential stuffing against one account; identity-only misses spraying across accounts.

Supporting rules (FR-001/FR-002 anti-enumeration): login and forgot-password return a **single generic response** regardless of whether the email exists; forgot-password always returns `202` and always performs a dummy hash so timing does not leak existence; `429` carries `Retry-After` and **never** permanently locks the account (FR-005). Progressive delay (exponential backoff per identity, capped) is layered on top of the hard limit. Failed-login counters and their outcomes are logged for security monitoring.

---

#### 13. Cross-Cutting Infrastructure (`apps/server/src/shared/`)

```
shared/
├── prisma/        PrismaModule(@Global), PrismaService, extensions/{soft-delete,tenant-guard,audit-stamp}
├── security/      guards/{jwt-auth,roles,capabilities,auth-throttler}, decorators/, AuthContext, Capability enum
├── tenancy/       TenantContextInterceptor, TenantScope, AsyncLocalStorage store
├── mail/          MailModule, MailService (port) + adapters/{ses,sendgrid,console}, templates/  — INT-001
├── storage/       StorageModule, StorageService (port) + adapters/{s3,local}, ImageProcessor (sharp)  — INT-002
├── jobs/          ScheduleModule registration, OutboxService + OutboxPump, job contracts  — §13.2
├── config/        typed env via zod, ConfigModule(@Global)
├── logging/       pino logger, request-id correlation, PII redaction
└── http/          GlobalExceptionFilter (problem+json), pagination primitives, ApiError catalog
```

**Ports, not providers.** `MailService` and `StorageService` are abstract classes bound by token in the module's `useClass` factory keyed off config, so INT-001/INT-002's "pluggable provider" requirement is satisfied and tests bind an in-memory fake. No module imports an SDK directly.

##### 13.1 Scheduled work — `@nestjs/schedule` **[AMENDED 2026-09-22]**

| Cron | Schedule | Owner |
|---|---|---|
| Approval 48 h expiry sweep (FR-042) | every 5 min | `child-approvals/ApprovalExpiryJob` |
| Expired token purge (refresh / verification / reset) | hourly | `auth/TokenMaintenanceJob` |
| Stale impersonation close (past the 60 min cap) | every 10 min | `impersonation/ImpersonationMaintenanceJob` |
| ShareLink expiry marking | every 15 min | `share-links/ShareLinkMaintenanceJob` |
| Outbox pump (safety net — see §13.2) | every 30 s | `shared/jobs/OutboxPump` |

> **⚠ This is correct only for a single replica.** `@Cron` fires in *every* process that registers it. At one replica there is exactly one firing and therefore **no double-fire risk to guard against** — no distributed lock, no leader election, no job-claim table is needed, and none is built here. **If this project is ever deployed with more than one API process, every cron above becomes a duplicate-execution bug** (duplicate expiry notifications to parents being the user-visible one). See §21 for the exit criteria and the minimum change required.
>
> **The designed escape hatch is one env var, not a rewrite.** `SCHEDULER_ENABLED` (typed in `shared/config`, default `true`) gates `ScheduleModule` registration. A second replica can therefore be brought up today with `SCHEDULER_ENABLED=false` and be correct immediately, with exactly one process retaining the crons. That is a stopgap for an emergency scale-out, **not** a scaling design — it makes the scheduler a single point of failure and is explicitly not the thing to build on.

Each sweep is written to be **idempotent and re-entrant**: transitions use the conditional `updateMany` on `status = 'PENDING'` already specified in §9.3, so a slow run overlapping the next tick cannot double-transition a row. This was true under BullMQ too and remains the actual correctness guarantee — the scheduler choice only controls *how often* the sweep is attempted, never whether a row can transition twice.

##### 13.2 Async work — transactional outbox **[AMENDED 2026-09-22]**

Dropping BullMQ removes the `email` and `media` queues, which were not merely scheduling: they carried **retry with backoff**, **crash durability**, and **after-commit semantics** ("a rolled-back registration never emails the user"). Losing those would be a silent regression, so they are preserved with a Postgres-backed transactional outbox — the standard lean substitute, and it reuses the cron mechanism §13.1 already introduces.

```
service (inside the business $transaction)
   └─ outbox.enqueue(tx, { type: 'EMAIL_VERIFICATION', payload })   ← same tx as the User insert
        │
        ├─ commit ──► in-process nudge: drain immediately (typical latency < 100 ms)
        └─ rollback ─► the outbox row is gone too. Nothing to un-send.
                          │
                    OutboxPump @Cron every 30 s ──► safety net: picks up rows the nudge
                                                    missed because the process crashed
```

**One new Prisma model, `OutboxJob`** — `{ id, type, payload Json, status (PENDING|DONE|FAILED), attempts Int, nextAttemptAt, lastError, createdAt }`, with `@@index([status, nextAttemptAt])`. **This takes the Epic-01 model count from 14 to 15** and is the only schema addition in this amendment; it is called out explicitly so it is not a surprise at migration time.

| Job type | Replaces | Notes |
|---|---|---|
| `EMAIL_*` (8 transactional emails, INT-001) | `email` queue | Provider latency stays out of the HTTP transaction; exponential backoff via `attempts` + `nextAttemptAt`; a failed send never rolls back a successful registration |
| `MEDIA_THUMBNAIL`, `MEDIA_LOGO_RESIZE` | `media` queue | CPU-bound `sharp` work stays off the request path, so profile save still meets NFR-001's 1 s and returns the processing placeholder |

**Why this is better than the `afterCommit` hook it replaces, not merely equivalent:** the previous design enqueued to Redis in an `afterCommit` callback, which has a real gap — commit succeeds, process dies before the enqueue, email is lost forever. Writing the outbox row *inside* the transaction closes that gap: the job and the business state commit atomically or not at all. Dropping BullMQ made the email pipeline **more** durable, not less.

**Rejected alternative:** fire-and-forget `setImmediate`/floating promise after commit. Zero infrastructure, but loses every in-flight email on restart, has no retry, and turns a provider outage into permanent data loss. Not acceptable for account verification and password reset, which are the two flows a user cannot proceed without.

The pump processes rows one at a time with a bounded batch size, marks `DONE` on success, and on failure increments `attempts` with exponential backoff up to a cap, then `FAILED` + an error log. Because there is one process, no row-claiming lock (`FOR UPDATE SKIP LOCKED`) is required — **but the query is written with `SKIP LOCKED` anyway**, since it costs nothing today and is the single thing that would otherwise make a second replica corrupt the outbox rather than merely duplicate crons.

---

#### 14. Scalability & Performance

| Target | Mechanism |
|---|---|
| NFR-002: 10k-user directory < 3 s | Keyset pagination + composite index `(status, role, createdAt)` + `pg_trgm` GIN for search; `select` only directory columns (never `passwordHash`); count via `estimated_row_count` with exact count only on filtered queries |
| NFR-001: dashboard < 2 s | `GET /me/bootstrap` returns user + profiles + contexts + branding in one round trip (prevents a 5-request waterfall on the Next.js server component) |
| NFR-001: profile save < 1 s | Image processing offloaded to the outbox (`MEDIA_*` jobs, §13.2); the PATCH returns immediately with a processing placeholder |
| NFR-003: 1,000 concurrent | **[AMENDED 2026-09-22 — see the note below; this target is no longer architecturally guaranteed]** Single API process, vertical scaling only. Direct Prisma → Postgres connections with `connection_limit` tuned to the instance; no PgBouncer |
| Branding read amplification (every page load of every player of a trainer) | **[AMENDED 2026-09-22]** Served from Postgres — it is a primary-key read of two columns on `TrainerProfile`, which at this scale does not need a cache at all. If measurement shows it matters, add a small in-process LRU (bounded, TTL ≤ 60 s) inside `PortalBrandingService`, invalidated locally on `PATCH /trainers/:id/branding`. Correct only because there is one process; it is deliberately *not* built up front |
| N+1 risk in roster/context queries | Repository methods use explicit `include`/`select`; a `PRISMA_LOG_SLOW_QUERIES` threshold logs anything > 200 ms in non-prod |

> **NFR-003 must be re-negotiated, and this is the one real cost of the lean scope. [2026-09-22]**
> "1,000 concurrent users" was originally met by *horizontal* scaling — stateless pods behind shared Redis. A single Node process cannot be scaled that way, so NFR-003 is now addressed by vertical capacity and by the fact that this deployment is certification/demo-scale, where the real concurrent load is a small number of reviewers. **The architecture no longer guarantees NFR-003 as literally written.** This is an accepted, deliberate trade, not an oversight — recorded here so nobody later reads the target as satisfied.
> Note that the per-request `User` read (§6.3) is *not* what limits this: it is a single indexed lookup on the same pooled connection the request already uses, and Postgres serves such reads at far beyond the rate a single Node event loop can produce requests. The binding constraint is the single process, not the extra query.

---

#### 15. Security Requirement Traceability

| Req | Satisfied by |
|---|---|
| SEC-001 RBAC server-side | Global `RolesGuard` + `CapabilitiesGuard`; boot-time assertion that every non-`@Public` route is annotated (§9.2) |
| SEC-002 tenant isolation at query layer | Three-layer scheme, §8 |
| SEC-003 impersonation constraints | `act` claim, no refresh token, audit-stamp extension, destructive-capability block, §10 |
| SEC-004 auth rate limiting | Named throttlers (in-memory storage, single instance) + composite tracker, §12 |
| FR-013 immediate effect of deactivation | `tokenVersion` + per-request `User` read in `JwtAuthGuard`, §6.3 |
| SEC-005 irreversible anonymization | Registry + write-only audit schema + absent restore path, §11.2 |
| SEC-006 child constraints at API layer | Capability deny-list on the JWT `typ` claim + lint/boot enforcement, §9.2 |
| NFR-006 password hashing | argon2id, §6.1 |
| NFR-007 CSRF / token theft | Bearer for API + `SameSite`/`httpOnly`/`Path`-scoped refresh cookie + double-submit CSRF on `/auth/*` + access token never in web storage, §6.4 |
| BR-013 global email uniqueness | `@@unique` on `User.email` with citext/`lower()` normalization at write time |
| Audit logging | `AuditInterceptor` + `ImpersonationLog` + `UserDeletionLog` + `CoachAvailabilityOverride` |

---

#### 16. Testing Architecture Hooks

- **Integration tests run against a real PostgreSQL** (Testcontainers), never a mock Prisma — the tenant-guard extension, CHECK constraints, partial unique index, and transactional invariants are exactly what needs testing, and none of them exist in a mock. **[Reconfirmed 2026-09-22: Testcontainers is a test-time dependency, not runtime infrastructure. The lean-scope amendment does not touch it — and it matters more now, since the revocation path (§6.3) and the outbox (§13.2) are both DB-behaviour that a mock cannot exercise.]**
- Each module ships a `*.repository.fake.ts`? No — repositories are tested through the DB; **services** are unit-tested against repository interfaces.
- `shared/testing/` provides `asUser(role, opts)` to mint tokens (including child and impersonation shapes) so the security matrix in §7.3 is expressible as a table-driven test.
- Mandatory per-controller cases: tenant isolation (trainer A vs B → 404), child capability denial by direct API call, throttle 429, impersonation audit stamping.

---

#### 17. Decision Records

| ID | Decision | Alternatives rejected | Consequence |
|---|---|---|---|
| ADR-01 | `User` + separate profile tables, `role` as discriminator | single-table inheritance; per-role credential tables | Cannot enforce one-role-per-user in Prisma alone → trigger + single provisioning service (§3.2) |
| ADR-02 | JWT access (15 m, memory) + opaque rotating refresh (7 d, httpOnly cookie, DB-persisted) | server-side session store; stateless JWT with no revocation | **[AMENDED 2026-09-22]** Per-request **Postgres** lookup for `tokenVersion`/status (was: Redis snapshot); gains immediate revocation with no cache-invalidation window |
| ADR-03 | Impersonation via RFC 8693 `act` claim, no refresh token | separate "admin mode" flag; dual sessions | 1-hour cap is structurally unextendable; zero branching in feature code |
| ADR-04 | Tenant isolation: required `TenantScope` param + Prisma assertion extension + mandatory tests | implicit filter injection; RLS | Slightly noisier repository signatures; violations fail loudly instead of silently |
| ADR-05 | Child constraints as a capability deny-list on the token, enforced by a global guard | UI-only hiding; per-endpoint `if` checks | New routes must carry `@RequiresCapability` — enforced by lint + boot assertion |
| ADR-06 | GDPR anonymization via multi-provider `Anonymizer` registry + write-only `audit` schema | per-module ad-hoc deletion; physical row deletion | Adding a PII-holding module means adding one provider; analytics totals preserved |
| ADR-07 | PostgreSQL RLS deferred | enable RLS now | **[AMENDED 2026-09-22]** Decision unchanged; PgBouncer is no longer part of the rationale (§8). Revisit at multi-region or on a second (non-Nest) data consumer |
| ~~ADR-08~~ | ~~Redis introduced as required infrastructure (throttling, auth snapshot cache, BullMQ)~~ | ~~in-memory throttler + `@nestjs/schedule`~~ | **SUPERSEDED 2026-09-22 by ADR-11/12/13/14.** The project owner chose the lean / single-instance scope; the ">1 replica correctness" premise no longer holds, and with it the entire justification for Redis |
| ~~ADR-09~~ | ~~Scheduled work as BullMQ repeatable jobs, not `@Cron`~~ | ~~`@nestjs/schedule`~~ | **SUPERSEDED 2026-09-22 by ADR-12.** The rejected alternative is now the decision: at one replica a `@Cron` fires exactly once, so the duplicate-notification hazard this ADR existed to prevent cannot occur |
| ADR-10 | Email verification non-blocking (ratifies G-05) | gate login on verification | One-line reversible via an `EmailVerifiedGuard` insertion point |
| **ADR-11** (2026-09-22) | **Lean single-instance infrastructure baseline: Postgres only. No Redis, no PgBouncer.** | Redis + PgBouncer (ADR-08); DB-backed throttler storage | Owner decision for a certification/demo-scale deployment. Eliminates two ops dependencies and one cache-coherency failure mode; **forfeits horizontal scaling and with it NFR-003 as written** (§14). Exit criteria in §21 |
| **ADR-12** (2026-09-22) | **Scheduled work via in-process `@nestjs/schedule` `@Cron`** | BullMQ repeatable jobs (ADR-09); pg_cron; DB advisory-lock leader election | Correct **only at one replica** — no double-fire guard is built. Sweeps stay idempotent via conditional `updateMany`, and `SCHEDULER_ENABLED` is the emergency valve (§13.1) |
| **ADR-13** (2026-09-22) | **Async email/media via a Postgres transactional outbox (`OutboxJob`) drained by cron + an after-commit nudge** | BullMQ `email`/`media` queues; fire-and-forget after commit | Preserves retry, backoff and crash durability without a broker; **strictly more durable** than the previous `afterCommit` enqueue. Costs one new model (14 → 15) and ≤ 30 s worst-case latency if the nudge is missed (§13.2) |
| **ADR-14** (2026-09-22) | **`@nestjs/throttler` default in-memory storage, named limiters unchanged** | Redis storage (ADR-08); DB-backed storage | Process-local counter == global counter at one replica. Counters reset on restart (liveness quirk, not a bypass); hashed-identity keys retained (§12) |

---

#### 18. Forward-Reference Seams (Epics 02–08)

| Seam | Epic-01 treatment |
|---|---|
| `ChildPurchaseApproval.eventId`, `CoachAvailabilityOverride.eventId` | `String @db.Uuid`, **no FK** and no relation field, indexed. A migration adds the constraint when Epic-02 lands. |
| Payment execution | `approve()` only transitions status and emits `child-approval.approved`. No charging, no Stripe call. Epic-05 subscribes. |
| `TrainerProfile.stripeCustomerId` / `subscriptionStatus` / `platformFeePercent` | Nullable columns, written by nothing in Epic-01. |
| ShareLink analytics (Epic-06) | `useCount` and a `ShareLinkUse` audit trail are recorded; no dashboard, no aggregation endpoints. |
| Camp-to-User conversion (Epic-08) | Excluded entirely (G-08). No stub. |
| Full CRM (Epic-03) | Trainer roster view is limited to `{player, age, availability summary}` + day/time filter. No notes, tags, or pipeline. |

---

#### 19. Open Questions Requiring Sign-Off (before `/api-designer`)

> **Status 2026-09-22: all four blocking questions are closed.** OQ-1 and OQ-2 resolved by the owner's lean-scope decision; OQ-3 and OQ-4 confirmed as recommended. **No blocking question remains — `/api-designer` can proceed.** OQ-5 through OQ-9 are non-blocking for architecture and remain open as noted.

| ID | Question | Resolution / Recommendation | Blocking? |
|---|---|---|---|
| ~~OQ-1~~ | ~~**Redis becomes required infrastructure** (ADR-08) — throttling across replicas, auth-snapshot cache, BullMQ. Is adding it to the deployment target acceptable?~~ | **✅ RESOLVED 2026-09-22 — Redis refused; lean / single-instance scope chosen by the project owner.** The documented fallback path was taken in full: single-replica deployment, in-memory throttler storage (ADR-14), in-process cron (ADR-12), outbox instead of a broker (ADR-13), and **NFR-003 re-negotiated** as the question itself required (§14). PgBouncer dropped with it (ADR-11). | Closed |
| ~~OQ-2~~ | ~~Immediate revocation costs **one Redis GET per authenticated request** (§6.3). Accept, or accept instead a ≤15-minute window where a deactivated user keeps working?~~ | **✅ RESOLVED 2026-09-22 — the immediate guarantee is kept; the lookup moves to Postgres.** The ≤15-minute stale window was *not* accepted: FR-013 still reads as immediate, and revocation is now even tighter than the Redis design (no 60 s cache TTL). Cost is one indexed `findUnique` per authenticated request (ADR-02 as amended, §6.3). | Closed |
| ✅ OQ-3 | Trainer-context selection transport: `X-Trainer-Context` header vs. `/t/{trainerId}/...` path prefix vs. `?trainerId=`. This shapes **every** player-facing endpoint. | **✅ CONFIRMED 2026-09-22 — header + server-side validation, as recommended. No change.** `api-designer` is unblocked on this. | Closed |
| ✅ OQ-4 | `GET /me/bootstrap` aggregate endpoint (§14) — approve as a first-class API resource, or should the client make N calls? | **✅ APPROVED 2026-09-22 — keep it.** Its value increases under the lean scope: it also collapses N per-request `User` auth reads (§6.3) into one request's worth. | Closed |
| OQ-5 | Availability stored as trainer-local wall-clock with **no timezone handling** in Epic-01. Confirm all users of a given trainer are in one timezone. | Confirm; retrofitting timezones after Epic-02 schedules exist is expensive. | Yes |
| OQ-6 | Child ShareLink blocking (FR-052) currently produces **an email only** — no in-app "pending registration review" queue for the parent. Is an entity + inbox needed? | Email-only for MVP, matching the spec's literal AC. Say so now if an in-app queue is wanted; it adds an entity. | No |
| OQ-7 | G-11 (WCAG vs. arbitrary trainer brand color). Architecture position: store the raw hex, compute an **accessible derived palette** server-side at save time (store both), warn non-blockingly in the picker. | Confirm with `frontend-design`; the storage shape (`primaryColorHex` + derived tokens) is decided here. | No |
| OQ-8 | Trainer temp password vs. setup link (FR-010). | Setup link only (no password ever transits email); `mustChangePassword` retained for the fallback path. | No |
| OQ-9 | Inherited from requirements and still unanswered: G-02 (skill-level enum values), G-04 (email list completeness), G-06 (notify coach on override). None block architecture; all block API/UI copy. | — | No |

---

#### 20. Definition of Done for this Architecture

- [ ] `prisma/schema.prisma` contains all **15** models (14 + `OutboxJob`, §13.2) with the indexes in §3.3 and the raw-SQL constraints in §3.2.
- [ ] Global guard pipeline registered in `AppModule` in the order given in §5.
- [ ] Boot-time assertion fails startup if any non-`@Public` route lacks `@RequiresCapability`.
- [ ] Tenant-guard Prisma extension active, with a passing test proving it throws on an unscoped tenant query.
- [ ] Isolation, child-capability, throttle, and impersonation-audit tests green for every controller.
- [ ] No service injects `PrismaService`; no repository imports a service.

**Added by the lean-scope amendment (2026-09-22):**

- [ ] `docker-compose` / deploy config declares **Postgres only** — no Redis, no PgBouncer service.
- [ ] Integration test: deactivating a user causes their **already-issued, still-unexpired** access token to be rejected on the very next request (proves §6.3 end to end, and that no stale cache was reintroduced).
- [ ] Integration test: the `JwtAuthGuard` auth read succeeds for a user whose `status` is `INACTIVE`/`DELETED` — i.e. the guard sees the row and rejects on `status`, rather than the soft-delete extension hiding it and producing a misleading error (§6.3 constraint 1).
- [ ] Integration test: an authenticated request completes without the tenant-guard extension throwing, proving the pre-ALS ordering in §6.3 constraint 2 holds.
- [ ] Outbox: a rolled-back registration transaction leaves **no** `OutboxJob` row and sends no email; a committed one is drained by the nudge, and by the cron alone if the nudge is skipped.
- [ ] Outbox drain uses `FOR UPDATE SKIP LOCKED` and is idempotent under a re-run.
- [ ] `SCHEDULER_ENABLED` is present in the typed env schema (`shared/config`) and gates `ScheduleModule`.
- [ ] **The single-replica constraint is stated in the deploy README**, not only here — the failure mode (duplicate cron side-effects) is invisible in code review.

---

#### 21. Scaling Exit Criteria — when this lean design must be revisited **[ADDED 2026-09-22]**

The lean scope is a deliberate, well-scoped trade, not a default. It stops being correct at exactly one trigger: **a second API process.** Recording the boundary here so the decision is re-openable on evidence rather than rediscovered through a production incident.

| Trigger | What breaks first | Minimum change |
|---|---|---|
| **A second API replica** (the only hard trigger) | Crons double-fire → duplicate 48 h expiry notifications to parents (FR-042), duplicate ShareLink expiry marking | Stopgap today: `SCHEDULER_ENABLED=false` on all but one replica. Proper fix: a leader-election lock (Postgres advisory lock) or restore ADR-09's broker |
| Same | Throttler counters become per-process → effective limits multiply by replica count, weakening SEC-004 | Restore a shared throttler storage (Redis, or a DB-backed store) |
| Same | Outbox is already safe — `SKIP LOCKED` was written in for this reason (§13.2) | None |
| Same | Auth reads multiply Postgres load linearly with replicas | Re-evaluate a shared auth-snapshot cache — i.e. reinstate the superseded ADR-08 mechanism deliberately, with its TTL trade-off re-accepted |
| Sustained load approaching NFR-003's 1,000 concurrent | Single event loop saturates before Postgres does (§14) | Horizontal scale-out — which is the trigger above; NFR-003 and this ADR set must be reopened together |

**What does *not* need revisiting on scale-out**, because none of it was ever Redis-dependent: the data model (§3), the guard pipeline and RBAC (§5, §7), the capability deny-list (§9.2), the impersonation `act` design (§10), all three multi-tenancy layers including the throwing Prisma extension (§8), soft-delete and GDPR anonymization (§11), and the test architecture (§16). The lean amendment is confined to **infrastructure and the auth-read path**; the security architecture is untouched by it.
