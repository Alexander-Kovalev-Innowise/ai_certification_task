# API Specification: PracticePerfect

REST API design for Epic-01 (User Management & Authentication). Entry point is [MANIFEST.md](./MANIFEST.md).

**Depends on:** `architect-architecture.md`
**Consumed by:** `frontend-design-spec.md`

> **Assumption (flag for sign-off):** the architecture doc does not state a global route prefix or a `main.ts` `setGlobalPrefix()` value. This spec assumes **no version prefix** (paths exactly as `/auth/login`, not `/api/v1/auth/login`), matching the architecture doc's own path notation verbatim. Confirm before `frontend-design` hard-codes base URLs.

---

## 0. Shared Conventions

### 0.1 Guard pipeline recap (applies to every endpoint below)

Every endpoint in this spec passes through the global pipeline from `architect-architecture.md` §5: `helmet/CORS → RequestContext → ThrottlerGuard → JwtAuthGuard (skips @Public) → RolesGuard (@Roles) → CapabilitiesGuard (@RequiresCapability) → TenantContextInterceptor → Controller`. Per the architecture's boot-time assertion, **every non-`@Public` route in this spec is annotated with `@RequiresCapability`** — this is called out explicitly per endpoint below, not left implicit.

### 0.2 Authentication header

```
Authorization: Bearer <accessToken>
```

Absent on `@Public()` routes and on the refresh/logout pair, which instead rely on the `refreshToken` httpOnly cookie (`Path=/auth`).

### 0.3 `X-Trainer-Context` header — when it is required

Per ADR / OQ-3, player/parent tenant scope is never read from the token; it travels in `X-Trainer-Context: <trainerId>` (server-validated against an `ACTIVE` `PlayerTrainerAssociation` on every request that carries it). Three buckets, used consistently in every endpoint table below:

| Bucket | Meaning | Who |
|---|---|---|
| **Required** | Endpoint returns/mutates data scoped to one trainer relationship and does not already carry `trainerId` in the path; the header is the *only* scoping input | `PLAYER_PARENT` / `CHILD` callers only |
| **N/A — path-scoped** | The trainer is already unambiguous from a `:trainerId`/`:id` path segment (validated by an ownership/association check instead of the header) | any role |
| **N/A — own tenant** | Caller is `TRAINER`/`COACH` acting as themselves; their tenant is the `tid` claim, not a header | `TRAINER`, `COACH` |
| **N/A — platform** | `SUPER_ADMIN` has no tenant scope (`TenantScope.kind = 'PLATFORM'`) | `SUPER_ADMIN` |

**Open finding (flag for sign-off — see §8.1):** Epic-01's data model gives players almost nothing that is *literally* trainer-partitioned yet (`Availability` and `ChildPurchaseApproval` carry no `trainerId`). The header is therefore genuinely **Required** on very few Epic-01 endpoints today; its authorization value in this epic is mostly forward-looking (validating the player really has an active relationship with the trainer named in the header) rather than row-filtering. Each endpoint below states its bucket explicitly so this isn't silently glossed over.

### 0.4 Standard error shape (RFC 7807-flavored, per `GlobalExceptionFilter`)

```jsonc
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "errorCode": "VALIDATION_ERROR",
  "path": "/player-profiles",
  "requestId": "3f9c2e10-...",
  "details": [
    { "field": "dateOfBirth", "message": "age must be between 1 and 18" }
  ]
}
```

`class-validator` mapping: the global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true, transform: true`) throws a `BadRequestException` whose `getResponse().message` is an array of constraint-violation strings; `GlobalExceptionFilter` flattens that array into `details[]` (one entry per failed property/constraint pair, `field` = property path, `message` = the human-readable constraint message), sets `errorCode: 'VALIDATION_ERROR'`, and always returns `400`. A non-validation `HttpException` maps `error` to the standard phrase for its status and `errorCode` to the catalog below; an unhandled exception maps to `500 / INTERNAL_ERROR` with no `details`.

### 0.5 Error code catalog

| `errorCode` | HTTP | Raised by |
|---|---|---|
| `VALIDATION_ERROR` | 400 | global `ValidationPipe` |
| `UNAUTHORIZED` | 401 | `JwtAuthGuard` — missing/invalid/expired access token |
| `ACCOUNT_INACTIVE` | 401 | `JwtAuthGuard` — `tv` mismatch or `status != ACTIVE` on the per-request Postgres read (§6.3) |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `CapabilitiesGuard` (folded `PasswordChangeRequiredGuard`) — `mustChangePassword = true` and route isn't in the allow-list |
| `FORBIDDEN` | 403 | `RolesGuard` / `CapabilitiesGuard` — generic role/capability denial |
| `CHILD_CAPABILITY_DENIED` | 403 | `CapabilitiesGuard` — `typ: CHILD` hit a deny-listed capability (§0.7) |
| `TENANT_CONTEXT_INVALID` | 403 | `TenantContextInterceptor` — `X-Trainer-Context` missing/not an `ACTIVE` association for the caller |
| `IMPERSONATION_NOT_ALLOWED` | 403 | `CapabilitiesGuard` — destructive Super-Admin action attempted while `act` is present |
| `CHILD_SHARE_LINK_BLOCKED` | 403 | `ShareLinkRedemptionService` — `typ: CHILD` hit `/share-links/:code/redeem` (FR-052) |
| `NOT_FOUND` | 404 | resource missing, or cross-tenant read (deliberately 404, never 403 — §8 Layer 3) |
| `CONFLICT` | 409 | unique-constraint / state-machine conflicts (duplicate email, already-claimed ShareLink, wrong role redeeming) |
| `SHARE_LINK_UNAVAILABLE` | 409 | ShareLink expired/exhausted/revoked at redemption time |
| `IMPERSONATION_TARGET_INVALID` | 422 | `assertNotTargetingSuperAdmin` — target is a `SUPER_ADMIN` (validation error, not authz — FR-015) |
| `RATE_LIMITED` | 429 | `ThrottlerGuard` / `AuthThrottlerGuard` — carries `Retry-After` header |
| `TENANT_SCOPE_VIOLATION` | 500 | Prisma tenant-guard extension threw (bug, not a client error — alerted, not user-facing copy) |

### 0.6 Rate-limit annotation legend

Each endpoint below states its `@Throttle(...)` name(s) from the named limiters in `architect-architecture.md` §12. Endpoints with none listed fall through to the global `default` limiter (300/60s per IP) only.

| Named limiter | Limit | Tracker |
|---|---|---|
| `auth-ip` | 20 / 15 min | IP |
| `auth-identity` | 5 / 15 min | `sha256(route + normalizedEmail)` |
| `token-consume` | 10 / 15 min | IP |
| `impersonation` | 10 / hour | `adminUserId` |

### 0.7 Capability catalog & the `typ: CHILD` deny-list

```ts
export enum Capability {
  CREATE_TRAINER_ACCOUNT, MANAGE_ANY_USER, DEACTIVATE_REACTIVATE_USER, GDPR_DELETE_USER,
  IMPERSONATE_USER,
  GENERATE_SHARE_LINK, REDEEM_SHARE_LINK,
  INVITE_COACH, VIEW_OWN_COACH_ROSTER, MANAGE_COACH_PROFILE,
  MANAGE_PORTAL_BRANDING,
  MANAGE_CHILD_PROFILES, MANAGE_TRAINER_ASSOCIATIONS,
  SET_OWN_AVAILABILITY, VIEW_PLAYER_AVAILABILITY, OVERRIDE_COACH_CONFLICT,
  APPROVE_CHILD_PURCHASE,
  EDIT_OWN_PROFILE, DELETE_OWN_ACCOUNT, VIEW_GUARDIAN_DATA,
  MANAGE_PAYMENT_METHODS, PURCHASE_TOKENS, COMPLETE_PURCHASE,
}

// architect-architecture.md §9.2, verbatim
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

Every endpoint whose `@RequiresCapability(...)` names a capability in `CHILD_DENIED` returns **`403 { errorCode: 'CHILD_CAPABILITY_DENIED' }`** for a `typ: CHILD` token — never a silent no-op, never a 200 with an empty effect. This is called out per-endpoint below rather than only here.

**Open finding (flag for sign-off — see §8.2):** `Capability.APPROVE_CHILD_PURCHASE` is **not** in the architecture doc's literal `CHILD_DENIED` set, yet §7.3's role-capability matrix shows "Approve/deny child purchase" as ❌ for a child login. I have added `APPROVE_CHILD_PURCHASE` to the deny-list in this spec (§4.9) to make the matrix and the deny-list agree, since a child approving its own purchase request would be a logic error, not merely an unlikely UI path. Confirm this addition before implementation.

### 0.8 Access-token claims (verbatim from architecture §6.2, reproduced for reference)

```jsonc
{
  "sub": "<effective user id>", "role": "PLAYER_PARENT", "typ": "CHILD",
  "gid": "<guardian user id|null>", "tid": "<trainerId|null>", "tv": 3,
  "act": { "sub": "<admin id>", "role": "SUPER_ADMIN", "imp": "<ImpersonationLog id>" },
  "jti": "...", "iat": 0, "exp": 0
}
```

### 0.9 Pagination

Keyset/cursor pagination (never `OFFSET`) per NFR-002:

```
GET /users?limit=50&cursor=eyJjcmVhdGVkQXQiOi4uLn0
```
```jsonc
// PaginatedResponseDto<T>
{ "items": [ /* T[] */ ], "nextCursor": "eyJjcmVhdGVkQXQiOi4uLn0" | null, "hasMore": true }
```

---

## 1. `AuthController` — `/auth` (module `auth`)

Owns `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken`. Session/token lifecycle only — never injects `PrismaService` for `User` business fields (that's `UsersController`/`UserService`).

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` | Rate limiter(s) |
|---|---|---|---|---|
| `POST /auth/register` | `@Public()` | n/a (public) | N/A — platform | `auth-ip` |
| `POST /auth/login` | `@Public()` | n/a (public) | N/A — platform | `auth-ip` + `auth-identity` |
| `POST /auth/refresh` | cookie only | n/a (public) | N/A — platform | default only |
| `POST /auth/logout` | Bearer + cookie | `EDIT_OWN_PROFILE`* | N/A — platform | default only |
| `POST /auth/forgot-password` | `@Public()` | n/a (public) | N/A — platform | `auth-ip` + `auth-identity` |
| `POST /auth/reset-password` | `@Public()` | n/a (public) | N/A — platform | `token-consume` |
| `POST /auth/verify-email` | `@Public()` | n/a (public) | N/A — platform | `token-consume` |
| `POST /auth/verify-email/resend` | Bearer | `EDIT_OWN_PROFILE` | N/A — platform | `token-consume` |
| `POST /auth/change-password` | Bearer | `EDIT_OWN_PROFILE` | N/A — platform | default only |

\* `logout` technically needs no fine-grained capability (every authenticated identity may log itself out); it's annotated with the closest existing capability rather than left bare, to satisfy the boot-time "every non-`@Public` route must carry `@RequiresCapability`" assertion. Flagged in §8.3 as a case where the deny-list model produces a slightly awkward annotation — worth a `@AlwaysAllowed()` escape hatch decorator instead, but that's an implementation-detail suggestion, not a blocking issue.

### [TASK-001] POST /auth/register (2026-09-22)

**Design note (flag for sign-off — see §8.4):** the architecture module map lists `/auth/register` without further detail. Given BR-005 (no trainer self-registration) and §9.1 (players/coaches register exclusively through `POST /share-links/:code/redeem`), there is **no public self-registration flow** in Epic-01. I have scoped this endpoint to the one remaining registration-shaped gap: **completing a Super-Admin-provisioned trainer account's setup-link** (OQ-8 — setup link only, no temp password over email). If this reading is wrong, the endpoint should instead be removed from the surface entirely; either way it needs explicit confirmation before `coder` builds it.

**Request `CompleteTrainerSetupDto`:**
```ts
class CompleteTrainerSetupDto {
  @IsString() @IsNotEmpty() setupToken: string;       // opaque, from the invite email link
  @IsString() @MinLength(12) @Matches(PASSWORD_POLICY) password: string;
}
```

**Response `AuthSessionResponseDto`** (200):
```ts
class AuthSessionResponseDto {
  accessToken: string;         // JWT, 15 min
  expiresIn: number;           // seconds, 900
  user: UserSummaryDto;
}
```
Also sets `refreshToken` (httpOnly, `Secure`, `SameSite=Lax`, `Path=/auth`, 7 d) and `csrf` (non-httpOnly, same path) cookies — i.e. this endpoint auto-logs-in the trainer on successful setup.

**Status codes:** `200` success · `400 VALIDATION_ERROR` weak password · `404 NOT_FOUND` unknown token · `409 CONFLICT` token already consumed / account already active · `410 Gone` (`errorCode: TOKEN_EXPIRED`) setup link expired.

### [TASK-001] POST /auth/login (2026-09-22)

**Request `LoginDto`:**
```ts
class LoginDto {
  @IsEmail() @MaxLength(255) email: string;
  @IsString() @IsNotEmpty() password: string;
}
```

**Response:** `AuthSessionResponseDto` (same shape as above) + cookies. `user.mustChangePassword` surfaces so the client can immediately redirect into the forced-change flow (§6.6).

**Status codes:** `200` · `400 VALIDATION_ERROR` · `401 UNAUTHORIZED` — **generic message regardless of whether the email exists** (FR-001 anti-enumeration: `"Invalid email or password.""` for both "no such user" and "wrong password") · `401 ACCOUNT_INACTIVE` deactivated/deleted account, same generic-looking copy pattern but distinct `errorCode` for client-side messaging · `429 RATE_LIMITED`.

**Swagger:**
```ts
@Public()
@Throttle({ 'auth-ip': {}, 'auth-identity': {} })
@Post('login')
@ApiOperation({ summary: 'Authenticate with email + password' })
@ApiResponse({ status: 200, type: AuthSessionResponseDto })
@ApiResponse({ status: 401, description: 'Invalid credentials or inactive account' })
@ApiResponse({ status: 429, description: 'Too many attempts', headers: { 'Retry-After': { schema: { type: 'integer' } } } })
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) { /* ... */ }
```

### [TASK-001] POST /auth/refresh (2026-09-22)

No body — reads the `refreshToken` cookie. Rotates: presented token marked `revokedAt`, new one issued with the same `familyId` (§6.4). Reuse of an already-revoked token **revokes the whole family and bumps `tokenVersion`** (stolen-token detection) and responds `401`.

Requires the double-submit CSRF pair: `X-CSRF-Token` header must equal the `csrf` cookie value, since the refresh cookie is the one ambient credential in this API.

**Response:** `AuthSessionResponseDto`, new rotated `refreshToken` + `csrf` cookies set.

**Status codes:** `200` · `401 UNAUTHORIZED` missing/expired/revoked/reused refresh token · `403 FORBIDDEN` (`errorCode: CSRF_MISMATCH`) missing/mismatched `X-CSRF-Token`.

**This is also the impersonation exit mechanism's second half** — see §2.

### [TASK-001] POST /auth/logout (2026-09-22)

Revokes the presented refresh-token row (and, if `?everywhere=true`, all of the user's refresh tokens + bumps `tokenVersion` — "logout everywhere"). Requires CSRF header same as refresh.

**Status codes:** `204` · `401 UNAUTHORIZED` · `403 FORBIDDEN` CSRF mismatch.

### [TASK-001] POST /auth/forgot-password (2026-09-22)

**Request:** `{ email: string }` (`@IsEmail`).

**Response:** always `202 Accepted`, always `{ message: 'If that email exists, a reset link has been sent.' }` — **identical response whether or not the email exists**, and a dummy argon2 hash is computed on the not-found path so response timing doesn't leak existence (FR-002).

**Status codes:** `202` (always) · `429 RATE_LIMITED`.

### [TASK-001] POST /auth/reset-password (2026-09-22)

**Request `ResetPasswordDto`:**
```ts
class ResetPasswordDto {
  @IsString() @IsNotEmpty() token: string;
  @IsString() @MinLength(12) @Matches(PASSWORD_POLICY) newPassword: string;
}
```
Single-use, 1 h expiry. On success: `passwordHash` updated, `tokenVersion++` (revokes all existing sessions — a password reset is itself a "logout everywhere"), all `RefreshToken` rows revoked.

**Status codes:** `200 { message }` · `400 VALIDATION_ERROR` · `404/410` invalid or expired token (generic copy, doesn't distinguish "wrong token" from "no such token") · `429 RATE_LIMITED` (`token-consume`).

### [TASK-001] POST /auth/verify-email (2026-09-22)

**Request:** `{ token: string }`. Single-use, 24 h expiry. Sets `emailVerifiedAt`. **Non-blocking** — see §0 note: no guard anywhere checks this value; it is purely informational, surfaced on `GET /me` as `emailVerified: boolean` for the client's persistent reminder banner (architecture §6.5). If this project ever reverses G-05, the single insertion point is a new `EmailVerifiedGuard` at pipeline position 5.5 — no endpoint contract in this spec changes.

**Status codes:** `200 { emailVerified: true }` · `404/410` invalid or expired token.

### [TASK-001] POST /auth/verify-email/resend (2026-09-22)

Authenticated; re-issues a fresh `EmailVerificationToken`, invalidating the previous one, and enqueues `OutboxJob(EMAIL_VERIFICATION)`.

**Status codes:** `202 Accepted` · `409 CONFLICT` already verified · `429 RATE_LIMITED` (`token-consume`).

### [TASK-001] POST /auth/change-password (2026-09-22)

The one route (besides `/auth/logout` and `GET /me`) exempted from `PASSWORD_CHANGE_REQUIRED` blocking (§6.6). Request: `{ currentPassword?, newPassword }` — `currentPassword` optional only on the forced-first-change path (identified by `mustChangePassword: true` on the caller's row), required otherwise.

**Status codes:** `200` · `400 VALIDATION_ERROR` · `401 UNAUTHORIZED` wrong `currentPassword`.

---

## 2. `ImpersonationController` — `/impersonation` (module `impersonation`)

Owns `ImpersonationLog`. This section shows the full `act`-claim round trip end to end, as required.

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` | Rate limiter(s) |
|---|---|---|---|---|
| `POST /impersonation/start` | Bearer | `IMPERSONATE_USER` | N/A — platform | `impersonation` |
| `POST /impersonation/end` | Bearer (impersonation token) | `IMPERSONATE_USER`† | N/A — platform | default only |
| `GET /impersonation/history` | Bearer | `IMPERSONATE_USER` | N/A — platform | default only |

† `/impersonation/end` is guarded by role/capability like any Super-Admin route, but is reachable *only* while `AuthContext.impersonation` is set (i.e. only from inside an impersonation session) — enforced in the service, not the guard, since the guard has no "must be impersonating" primitive.

### [TASK-001] POST /impersonation/start (2026-09-22)

**Request:**
```ts
class StartImpersonationDto {
  @IsUUID() targetUserId: string;
}
```

**Guard order for this endpoint specifically:** `@Roles(SUPER_ADMIN)` → `@RequiresCapability(IMPERSONATE_USER)` → service calls `assertNotTargetingSuperAdmin(target)` (returns `422`, not `403`, so the UI renders it as a validation message per FR-015) → service also rejects with `403 IMPERSONATION_NOT_ALLOWED` if `AuthContext.impersonation` is already set on the caller (an impersonated session cannot start a second impersonation — blast-radius block, architecture §10).

**Response `ImpersonationStartResponseDto`** (201):
```ts
class ImpersonationStartResponseDto {
  accessToken: string;   // JWT, sub/role = TARGET, act = {admin}, exp = now+60m
  expiresIn: number;     // seconds, always <= 3600, min(3600, ...)
  impersonationLogId: string;
  target: UserSummaryDto;
}
```

**No `refreshToken` is issued and no refresh cookie is written or modified.** The admin's own `refreshToken` cookie is left completely untouched by this call — that is what makes the 1-hour cap structurally unextendable (architecture §10, ADR-03).

**The `act` claim round trip, concretely:**

```jsonc
// BEFORE — admin's own access token
{ "sub": "admin-42", "role": "SUPER_ADMIN", "typ": "ADULT", "tid": null, "tv": 1, "jti": "j1", "exp": 1758549000 }

// POST /impersonation/start  { "targetUserId": "trainer-7" }  →  201

// AFTER — impersonation access token returned in the response body
{
  "sub": "trainer-7", "role": "TRAINER", "typ": "ADULT", "tid": "trainer-7", "tv": 4,
  "act": { "sub": "admin-42", "role": "SUPER_ADMIN", "imp": "implog-99" },
  "jti": "j2", "exp": 1758549000 + 3600   // hard cap, independent of admin's own exp
}
```

Every guard downstream reads `sub`/`role`/`tid` as-is — RolesGuard, CapabilitiesGuard and the tenant extension all see "TRAINER acting on trainer-7's own tenant" with **zero branching in feature code** (this is the whole point of RFC 8693 `act`, per architecture §6.2/§10). Only the audit stamp and `AuditInterceptor` read `act.sub ?? sub` (`AuthContext.auditActorId`), so every write during the session is stamped with **both** `actorUserId: 'admin-42'` and the effective `trainerId: 'trainer-7'` (SEC-003).

**Status codes:** `201` · `400 VALIDATION_ERROR` · `403 FORBIDDEN` non-Super-Admin caller · `403 IMPERSONATION_NOT_ALLOWED` already impersonating · `404 NOT_FOUND` unknown target · `422 IMPERSONATION_TARGET_INVALID` target is a `SUPER_ADMIN` · `429 RATE_LIMITED` (`impersonation`, 10/h keyed by the admin's own id).

### [TASK-001] POST /impersonation/end (2026-09-22)

Called with the **impersonation** access token in the `Authorization` header (not the admin's). No body required.

**Effect:** stamps `ImpersonationLog.endedAt` + `durationSeconds`; the impersonation access token is not itself revocable (it's already exp-capped) but the service records the explicit exit.

**Response:** `204 No Content`.

**Client-side exit sequence (documented explicitly, since this is the "back to admin's own token" half of the round trip):**
```
1. POST /impersonation/end        (Authorization: Bearer <impersonation token>)  → 204
2. discard the impersonation access token client-side
3. POST /auth/refresh              (uses the admin's own refresh cookie, which was never touched)  → 200, new admin AuthSessionResponseDto
```
Zero re-login. The admin's `sub`/`role`/`tv` on the refreshed token are exactly what they were before impersonation started.

**Status codes:** `204` · `401 UNAUTHORIZED` impersonation token itself already expired (60 min cap) — client still proceeds to step 3 in that case, since the admin's refresh cookie is independent · `404 NOT_FOUND` log row missing (defensive; shouldn't happen).

**Stale-impersonation safety net:** `impersonation/ImpersonationMaintenanceJob` (`@Cron`, every 10 min, architecture §13.1) closes any `ImpersonationLog` past its 60-minute cap that never received an explicit `/end` call, so the audit trail doesn't have permanently-open sessions even if a client crashes mid-session.

### [TASK-001] GET /impersonation/history (2026-09-22)

**Query:** `?limit&cursor&adminUserId?&targetUserId?&dateFrom?&dateTo?` — keyset pagination (§0.9).

**Response:** `PaginatedResponseDto<ImpersonationLogResponseDto>` where each row is `{ id, admin: UserSummaryDto, target: UserSummaryDto, startedAt, endedAt, durationSeconds }`.

**Status codes:** `200` · `403 FORBIDDEN` non-Super-Admin.

**Blast-radius note (applies platform-wide, documented once here):** while `AuthContext.impersonation` is present, `CapabilitiesGuard` denies `IMPERSONATE_USER`, `GDPR_DELETE_USER`, and `CREATE_TRAINER_ACCOUNT` regardless of the effective role being `SUPER_ADMIN` — i.e. `POST /impersonation/start`, `DELETE /users/:id`, and `POST /trainers` all return `403 IMPERSONATION_NOT_ALLOWED` if called with an impersonation token, even though the effective role on that token is whatever the target's role is (never actually `SUPER_ADMIN` in practice, but the check is defense-in-depth against a future bug, not just role-based).

---

## 3. `UsersController` — `/users`, `/me` (module `users`)

Owns `User`, `UserDeletionLog`. Global directory + lifecycle (Super Admin only) plus the universal self-profile surface (any authenticated role, ownership-checked in the service per architecture §7.1 — "ownership checks... are not guards").

**Inconsistency found (flag for sign-off — see §8.5):** the architecture module map's `users` row lists `GET/POST/PATCH /users` verbatim from the requirements doc. But `POST /trainers` (in `TrainersController`, explicitly annotated "Super Admin create" in the same module table) is the **only** account-creation flow Epic-01 actually specifies — coaches arrive via ShareLink accept, players via ShareLink redeem, and BR-005 forbids trainer self-registration. A `POST /users` that creates an arbitrary-role user has no acceptance criteria anywhere in the requirements or business spec. I have **dropped `POST /users` from this surface** and treated `POST /trainers` as the sole SA-creates-account endpoint. If a generic "SA creates any role of user" capability is actually wanted, it needs new acceptance criteria before `coder` builds it.

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` | Rate limiter(s) |
|---|---|---|---|---|
| `GET /me` | Bearer | `EDIT_OWN_PROFILE` | N/A — platform | default only |
| `PATCH /me` | Bearer | `EDIT_OWN_PROFILE` | N/A — platform | default only |
| `GET /me/bootstrap` | Bearer | `EDIT_OWN_PROFILE` | Required (optional, see §5) | default only |
| `GET /users` | Bearer | `MANAGE_ANY_USER` | N/A — platform | default only |
| `GET /users/:id` | Bearer | `MANAGE_ANY_USER` | N/A — platform | default only |
| `PATCH /users/:id` | Bearer | `MANAGE_ANY_USER` | N/A — platform | default only |
| `POST /users/:id/deactivate` | Bearer | `DEACTIVATE_REACTIVATE_USER` | N/A — platform | default only |
| `POST /users/:id/reactivate` | Bearer | `DEACTIVATE_REACTIVATE_USER` | N/A — platform | default only |
| `DELETE /users/:id` | Bearer | `GDPR_DELETE_USER` | N/A — platform | default only |

### [TASK-001] GET /me (2026-09-22)

**Response `MeResponseDto`:**
```ts
class MeResponseDto {
  id: string; email: string; role: Role; accountType: 'ADULT' | 'CHILD';
  firstName: string; lastName: string; phone: string | null; photoUrl: string | null;
  emailVerified: boolean;          // emailVerifiedAt !== null — informational only, §0
  mustChangePassword: boolean;
  createdAt: string;
}
```
No `passwordHash`, ever — enforced via `@Exclude()` on the response DTO's underlying entity mapping, not just by omission in `select`.

**Status codes:** `200` · `401 UNAUTHORIZED` · `401 ACCOUNT_INACTIVE`.

### [TASK-001] PATCH /me (2026-09-22)

**Request `UpdateMeDto`** — common fields only; role-specific fields (bio, business name, etc.) go through their owning controller (`TrainersController`, `CoachesController`, `PlayerProfilesController`) per FR-080:
```ts
class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsPhoneNumber() phone?: string;
  @IsOptional() @IsUrl() photoUrl?: string;
  @IsOptional() @IsObject() notificationPrefs?: Record<string, boolean>;  // Super Admin's own "profile" per FR-080
}
```

**Child-token field restriction:** FR-050 allows a `CHILD` session to "update basic profile info (photo, preferences)" only. The service enforces a **narrower whitelist for `typ: CHILD`** — `photoUrl`, `notificationPrefs` only; `firstName`/`lastName`/`phone` are guardian-owned data for a minor and are rejected. This is a service-layer field-level check (the capability itself, `EDIT_OWN_PROFILE`, is **not** in `CHILD_DENIED`, so the guard lets the request through; the narrower rule lives below the guard) — returns `403` with `errorCode: 'CHILD_FIELD_NOT_EDITABLE'` naming the offending field(s) in `details[]`, rather than silently dropping them.

**Status codes:** `200 MeResponseDto` · `400 VALIDATION_ERROR` · `403 CHILD_FIELD_NOT_EDITABLE`.

### [TASK-001] GET /users (2026-09-22)

Super Admin's global directory (FR-011). Query: `?limit&cursor&search?&role?&status?` — `search` hits the `pg_trgm` GIN index on `lower(email)`/name (NFR-002, <3 s @ 10k rows). `select` is directory columns only, never `passwordHash`.

**Response:** `PaginatedResponseDto<UserDirectoryRowDto>` where each row is `{ id, email, role, status, firstName, lastName, createdAt, lastLoginAt }`.

**Status codes:** `200` · `403 FORBIDDEN`.

### [TASK-001] GET /users/:id (2026-09-22)

**Response:** `UserDetailResponseDto` — `MeResponseDto` shape plus `status`, `lastLoginAt`, `deletedAt`. Uses `findUnique` with `withDeleted: true` so a Super Admin can still look up a soft-deleted/GDPR-deleted row (per §11.1's "historical/admin reads opt in explicitly").

**Status codes:** `200` · `403 FORBIDDEN` · `404 NOT_FOUND`.

### [TASK-001] PATCH /users/:id (2026-09-22)

FR-012 — SA edits any user's account/profile fields. Body is a superset of `UpdateMeDto` plus `{ role? }` — **role changes are deliberately excluded from this DTO** (BR-001's single-role-per-user invariant is enforced by the `AccountProvisioningService` construction path, not by a generic PATCH; changing role post-creation is out of Epic-01's scope and not in any acceptance criteria).

**Status codes:** `200` · `400 VALIDATION_ERROR` · `403 FORBIDDEN` · `404 NOT_FOUND` · `409 CONFLICT` email uniqueness.

### [TASK-001] POST /users/:id/deactivate (2026-09-22)

FR-013 / BR-011. No body. Sets `status = INACTIVE`, `deletedAt = now`, `tokenVersion++`, revokes all `RefreshToken` rows for the user — all in one transaction, so an **already-issued, unexpired access token is rejected on the very next request** (§6.3, DoD item).

**Status codes:** `200 UserDetailResponseDto` · `403 FORBIDDEN` · `404 NOT_FOUND` · `409 CONFLICT` already inactive/deleted.

### [TASK-001] POST /users/:id/reactivate (2026-09-22)

Reverses deactivation. **Hard-rejects if `status = DELETED`** (mirrored by a DB `CHECK`, per §11.2 — irreversibility is structural, not just a service-layer `if`).

**Status codes:** `200` · `403 FORBIDDEN` · `404 NOT_FOUND` · `409 CONFLICT` (`errorCode: CANNOT_REACTIVATE_DELETED_USER`) target is `DELETED`.

### [TASK-001] DELETE /users/:id (2026-09-22)

FR-014 / SEC-005. Body: `{ reason: string }` (required — becomes part of the `UserDeletionLog` row for legal retention). Runs `AccountLifecycleService.gdprDelete()` (architecture §11.2): snapshot to the write-only `audit` schema, every registered `Anonymizer` invoked, `User` fields anonymized, all tokens revoked, `user.deleted` domain event emitted.

**Status codes:** `204` · `400 VALIDATION_ERROR` missing reason · `403 FORBIDDEN` · `403 IMPERSONATION_NOT_ALLOWED` if called with an impersonation token (blast-radius block, §2) · `404 NOT_FOUND` · `409 CONFLICT` already `DELETED`.

---

## 4. Remaining controllers

### 4.1 `TrainersController` — `/trainers` (module `trainers`, includes folded `PortalBrandingService`)

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` |
|---|---|---|---|
| `POST /trainers` | Bearer | `CREATE_TRAINER_ACCOUNT` | N/A — platform |
| `GET /trainers/:id` | Bearer | `EDIT_OWN_PROFILE`\* | N/A — path-scoped |
| `PATCH /trainers/:id` | Bearer | `EDIT_OWN_PROFILE`\* | N/A — own tenant |
| `PATCH /trainers/:id/branding` | Bearer | `MANAGE_PORTAL_BRANDING` | N/A — own tenant |

\* Trainer detail/edit uses `EDIT_OWN_PROFILE` plus a service-layer ownership check (`:id === caller.tid` for `TRAINER`, or `SUPER_ADMIN` unconditionally) rather than a dedicated capability, consistent with §7.1's "ownership checks live in the service."

#### [TASK-001] POST /trainers (2026-09-22)

FR-010 / BR-005. Only Super Admin. One transaction: `User(role=TRAINER, status=ACTIVE, mustChangePassword=true)` + `TrainerProfile` (`AccountProvisioningService`), `OutboxJob(EMAIL_TRAINER_INVITE)` with the setup-link token consumed by `POST /auth/register` (§1). **No password is ever generated or emailed** (OQ-8 resolution — setup-link only).

**Request `CreateTrainerDto`:**
```ts
class CreateTrainerDto {
  @IsString() @MaxLength(200) businessName: string;
  @IsString() @MaxLength(100) trainerName: string;   // split into firstName/lastName server-side, or kept as one field — confirm with frontend-design
  @IsEmail() @MaxLength(255) email: string;
  @IsPhoneNumber() phone: string;
}
```

**Response:** `201 TrainerResponseDto` — `{ id, userId, businessName, email, status: 'Active', createdAt }`.

**Status codes:** `201` · `400 VALIDATION_ERROR` · `403 FORBIDDEN` · `403 IMPERSONATION_NOT_ALLOWED` (blast-radius) · `409 CONFLICT` duplicate email (FR-010's explicit AC).

#### [TASK-001] GET /trainers/:id (2026-09-22)

**Response `TrainerResponseDto`:** `{ id, userId, businessName, address, website, description, logoUrl, primaryColorHex, createdAt }`. Stripe/subscription/fee columns (Epic-05 stubs) are `null` and are **omitted from the response DTO entirely** in Epic-01, not exposed as `null` fields, to avoid the client coding against a shape that will change under it in Epic-05.

**Status codes:** `200` · `403 FORBIDDEN` non-owning trainer · `404 NOT_FOUND`.

#### [TASK-001] PATCH /trainers/:id (2026-09-22)

Business details only (`businessName`, `address`, `website`, `description`) — branding is a separate endpoint (below) because it has different validation and a different FR (FR-071 vs FR-080).

**Status codes:** `200` · `400 VALIDATION_ERROR` · `403 FORBIDDEN` · `404 NOT_FOUND`.

#### [TASK-001] PATCH /trainers/:id/branding (2026-09-22)

FR-071 / OQ-7. Multipart or two-step (`POST` logo to `shared/storage` first, then this PATCH with the resulting URL — matches `FileStorageService` port design). `sharp` resizes toward 200×200 via the `MEDIA_LOGO_RESIZE` outbox job so the PATCH itself returns fast (NFR-001, processing placeholder).

**Request `UpdateBrandingDto`:**
```ts
class UpdateBrandingDto {
  @IsOptional() @IsUrl() logoUrl?: string;             // pre-uploaded via shared/storage
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) primaryColorHex?: string;
  @IsOptional() @IsBoolean() resetToDefault?: boolean;
}
```

Per OQ-7, the service computes and stores a WCAG-derived accessible palette alongside the raw hex at save time (both persisted; `frontend-design` decides how the derived tokens are consumed), and returns a **non-blocking** `contrastWarning?: string` in the response if the chosen color fails AA against white/black text — it never rejects the PATCH outright.

**Response:** `200 { logoUrl, primaryColorHex, derivedPalette: {...}, contrastWarning?: string }`.

**Status codes:** `200` · `400 VALIDATION_ERROR` bad hex / logo >2MB / wrong type · `403 FORBIDDEN`.

---

### 4.2 `CoachesController` — `/coaches`, `/trainers/:id/coaches` (module `coaches`)

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` |
|---|---|---|---|
| `POST /coaches/invite` | Bearer | `INVITE_COACH` | N/A — own tenant |
| `GET /trainers/:id/coaches` | Bearer | `VIEW_OWN_COACH_ROSTER` | N/A — path-scoped |
| `PATCH /coaches/:id` | Bearer | `MANAGE_COACH_PROFILE` | N/A — own tenant / path-scoped |

**Resolved (was §8.6):** `POST /coaches/accept/:code` is dropped. Coach-link acceptance (`COACH_ACCEPT`) has exactly one entry point — `POST /share-links/:code/redeem` (§4.4) — matching how every other ShareLink type is redeemed. No coach-specific alias route.

#### [TASK-001] POST /coaches/invite (2026-09-22)

FR-060. Trainer only, own tenant (`tid` claim). Generates a `ShareLink(type=COACH_UNIQUE, targetEmail, expiresAt=+7d)` under the hood (delegates to `ShareLinkService.generateCoachLink`), enqueues `OutboxJob(EMAIL_COACH_INVITE)`.

**Request:** `{ email: string, name?: string, message?: string }`.

**Response:** `201 { shareLinkCode: string, expiresAt: string, status: 'PENDING' }`.

**Status codes:** `201` · `400 VALIDATION_ERROR` · `403 FORBIDDEN`.

#### [TASK-001] GET /trainers/:id/coaches (2026-09-22)

Roster list (FR-060's "trainer can view invitation status"). Query: `?status?=PENDING|ACTIVE&limit&cursor`.

**Response:** `PaginatedResponseDto<CoachRosterRowDto>` — `{ id, userId, name, email, status, bio?, joinedAt, invitationStatus: 'Pending'|'Accepted'|'Expired' }`.

**Status codes:** `200` · `403 FORBIDDEN` (`:id` not caller's own `tid` and caller isn't `SUPER_ADMIN` → `404`, per §8 Layer 3: cross-tenant reads are `404`, not `403`, to avoid existence disclosure) · `404 NOT_FOUND`.

#### [TASK-001] PATCH /coaches/:id (2026-09-22)

**Dual-actor endpoint** — same path, different allowed-field sets by caller, enforced in the service:

- **Caller = owning `TRAINER`**: `{ status?: 'ACTIVE' | 'PENDING' }` — administrative status only.
- **Caller = the `COACH` themself** (own profile, via `/me`-equivalent ownership check): `{ bio?, credentials?, certifications?, publicProfile? }` — FR-064.

Both share one `UpdateCoachDto` with all fields optional; the service rejects (`403`, `errorCode: FIELD_NOT_ALLOWED_FOR_ROLE`) any field outside the caller's allowed set rather than silently ignoring it.

**Status codes:** `200` · `400 VALIDATION_ERROR` · `403 FORBIDDEN` / `403 FIELD_NOT_ALLOWED_FOR_ROLE` · `404 NOT_FOUND`.

---

### 4.3 `PlayerProfilesController` + `AssociationsController` — both mount under `/player-profiles`, `/me`, `/trainers` (modules `player-profiles` + `associations`)

**Inconsistency found (flag for sign-off — see §8.7):** the user-facing task brief names 9 controllers and does not include a 10th `AssociationsController`, but `architect-architecture.md` §2 explicitly promotes `associations` to its own module (to break a `share-links ↔ player-profiles` cycle) and states "the API designer should treat them as one resource surface with two owning modules." I have followed the architecture doc here (it is the newer, more deliberate artifact and the task brief itself says to prefer it on divergence) and designed a 10th controller. Flagging because it changes the controller count from what was asked for; recommend confirming whether `AssociationsController` should be a distinct NestJS controller class or literally folded into `PlayerProfilesController` (both mount the same path prefix either way, so this is an internal-organization question, not an API-surface one).

**Gap found (flag for sign-off — see §8.8):** FR-070 ("Trainer views player availability... filter for players available at [day/time]") requires a trainer-facing roster endpoint, and `PlayerTrainerAssociationService.listRosterForTrainer` exists to serve it — but no controller row in the architecture doc's module table actually exposes it. I've added `GET /trainers/:id/players` below to close this gap; it isn't literally specified upstream.

| Method & Path | Owning module | Auth | `@RequiresCapability` | `X-Trainer-Context` |
|---|---|---|---|---|
| `POST /player-profiles` | player-profiles | Bearer | `MANAGE_CHILD_PROFILES` | N/A — own family |
| `GET /player-profiles` | player-profiles | Bearer | `EDIT_OWN_PROFILE` | N/A — own family |
| `GET /player-profiles/:id` | player-profiles | Bearer | `EDIT_OWN_PROFILE` | N/A — path-scoped |
| `PATCH /player-profiles/:id` | player-profiles | Bearer | `EDIT_OWN_PROFILE` | N/A — path-scoped |
| `GET /player-profiles/:id/trainers` | player-profiles | Bearer | `EDIT_OWN_PROFILE` | N/A — path-scoped |
| `GET /me/contexts` | associations | Bearer | `EDIT_OWN_PROFILE` | N/A — this *is* the context list |
| `POST /player-profiles/:id/trainers` | associations | Bearer | `MANAGE_TRAINER_ASSOCIATIONS` | N/A — path-scoped |
| `DELETE /player-profiles/:id/trainers/:trainerId` | associations | Bearer | `MANAGE_TRAINER_ASSOCIATIONS` | N/A — path-scoped |
| `GET /trainers/:id/players` *(added, §8.8)* | associations | Bearer | `VIEW_PLAYER_AVAILABILITY` | N/A — own tenant |

#### [TASK-001] POST /player-profiles (2026-09-22)

FR-030/FR-031 — **child profiles only** (a `PlayerProfile` with `isSelf=true` is created automatically by `AccountProvisioningService`/`ShareLinkRedemptionService` at registration, never through this endpoint — see §4.4). `@RequiresCapability(MANAGE_CHILD_PROFILES)` → **`CHILD` tokens get `403 CHILD_CAPABILITY_DENIED`** (deny-list, §0.7).

**Request `CreateChildProfileDto`:**
```ts
class CreateChildProfileDto {
  @IsString() @MaxLength(100) name: string;
  @IsDateString() dateOfBirth: string;              // service derives age; validated 1–18 (BR: "1-18 years")
  @IsIn(['MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY']) gender: string;   // Gap G-02-adjacent; confirm enum with client
  @IsOptional() @IsString() @MaxLength(200) school?: string;
  @IsOptional() @IsUrl() photoUrl?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) trainerIds?: string[];  // FR-031 selection checklist
}
```

**Response:** `201 PlayerProfileResponseDto`. If `trainerIds` provided, associations are created in the same transaction (each idempotent per `(trainer, profile)` per the `@@unique` constraint).

**Status codes:** `201` · `400 VALIDATION_ERROR` age out of 1–18 range · `403 CHILD_CAPABILITY_DENIED` · `409 CONFLICT` (soft, non-blocking per FR-030 — actually returned as `200` with a `warning` field, not a hard `409`; duplicate name/age is explicitly "non-blocking" in the spec).

#### [TASK-001] GET /player-profiles (2026-09-22)

FR-032. Lists the caller's own family: for an adult `PLAYER_PARENT`, self + all children; for `typ: CHILD`, **only the child's own profile** (service-layer restriction per §9.2 — "a `CHILD` context can only resolve `PlayerProfile` rows where `childUserId = auth.userId`, never sibling or guardian profiles").

**Response:** `PlayerProfileResponseDto[]` where each entry includes a `trainerCount` summary (not full trainer objects — that's the `/trainers` sub-resource below, kept separate so this list stays light for the family-picker UI).

This is **not** a cross-trainer content view (FR-022 doesn't apply) — it's account-management metadata (who are my children, how many trainers each has), not trainer-scoped calendar/token/content data.

**Status codes:** `200` · `401 UNAUTHORIZED`.

#### [TASK-001] GET /player-profiles/:id (2026-09-22)

Ownership-checked (adult owner, the child themself if `childUserId = caller`, or `SUPER_ADMIN`).

**Status codes:** `200` · `404 NOT_FOUND` (not `403`, cross-ownership reads are 404 for the same existence-disclosure reason as tenant isolation).

#### [TASK-001] PATCH /player-profiles/:id (2026-09-22)

Basics only (`name`, `school`, `jerseyNumber`, `photoUrl`, `emergencyContact`); `skillLevel` is trainer-set (per-association concept, not on this DTO — see Gap G-02 in the requirements doc, still open). `allowChildTokenSpendWithoutApproval` (FR-041) is also edited here by the owning adult only — **never** by the child themself even though it's "their" profile, since it's a parental control (service rejects it for `typ: CHILD` alongside the deny-listed fields, same `403 CHILD_FIELD_NOT_EDITABLE` pattern as `PATCH /me`).

**Status codes:** `200` · `400 VALIDATION_ERROR` · `403 CHILD_FIELD_NOT_EDITABLE` · `404 NOT_FOUND`.

#### [TASK-001] GET /player-profiles/:id/trainers (2026-09-22)

FR-032's per-child trainer list with dates. **Response:** `{ trainerId, businessName, logoUrl, connectedAt, status }[]`.

**Status codes:** `200` · `404 NOT_FOUND`.

#### [TASK-001] GET /me/contexts (2026-09-22)

This is the data source that populates the trainer-context switcher and that a client validates its cached `X-Trainer-Context` value against. For an adult parent: every `(profile, trainer)` active pair grouped by profile (the "Me" + "Children" structure in the SPEC's mockup, §9's context-selector examples). For `typ: CHILD`: only that child's own trainer list, no "Me"/parent section (FR-034).

**Response `ContextListResponseDto`:**
```ts
class ContextEntryDto {
  playerProfileId: string; playerProfileName: string; isSelf: boolean;
  trainerId: string; trainerDisplayName: string; logoUrl: string | null; primaryColorHex: string | null;
  connectedAt: string;
}
class ContextListResponseDto { contexts: ContextEntryDto[]; }
```

**Status codes:** `200` · `401 UNAUTHORIZED`.

#### [TASK-001] POST /player-profiles/:id/trainers (2026-09-22)

FR-032 "Add Trainer." `@RequiresCapability(MANAGE_TRAINER_ASSOCIATIONS)` → **`CHILD` tokens get `403 CHILD_CAPABILITY_DENIED`** (FR-051, deny-list).

**Request:** `{ shareLinkCode: string } | { trainerId: string }` (oneOf — manual code entry vs. picking from "My Trainers," both AC-A/B in FR-032).

**Status codes:** `201` · `400 VALIDATION_ERROR` neither field / both fields · `403 CHILD_CAPABILITY_DENIED` · `404 NOT_FOUND` unknown code/trainer · `409 CONFLICT` already associated (idempotent — returns the existing association as `200`, not an error, matching §9.1's "idempotent per (trainer, profile)").

#### [TASK-001] DELETE /player-profiles/:id/trainers/:trainerId (2026-09-22)

FR-032 "Remove Child from Trainer." `@RequiresCapability(MANAGE_TRAINER_ASSOCIATIONS)` → **`CHILD` tokens get `403 CHILD_CAPABILITY_DENIED`**. Client is expected to have already shown the "This will cancel all upcoming RSVPs" confirmation — the API performs the soft-delete-with-cascade unconditionally on call (no server-side confirmation step; RSVP cancellation itself is an Epic-02 concern and out of scope here beyond marking the association `INACTIVE`).

**Status codes:** `204` · `403 CHILD_CAPABILITY_DENIED` · `404 NOT_FOUND`.

#### [TASK-001] GET /trainers/:id/players (2026-09-22) — *added, see §8.8*

FR-070's minimal roster ("Best Times" scheduling aid — `{player, age, availability summary}` + day/time filter, explicitly **not** full CRM per architecture §18). Query: `?dayOfWeek?&startTime?&endTime?&limit&cursor`.

**Response:** `PaginatedResponseDto<RosterRowDto>` — `{ playerProfileId, name, age, availabilitySummary: string /* e.g. "Mon 5-8pm, Wed 6-9pm" */ }`.

**Status codes:** `200` · `404 NOT_FOUND` cross-tenant (`:id` not caller's own `tid`, non-SA caller).

---

### 4.4 `ShareLinksController` — `/share-links` (module `share-links`)

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` | Rate limiter(s) |
|---|---|---|---|---|
| `POST /share-links` | Bearer | `GENERATE_SHARE_LINK` | N/A — own tenant | default only |
| `GET /share-links/:code` | `@Public()` | n/a (public) | N/A — public preview | default only |
| `POST /share-links/:code/redeem` | `@Public()` (auth optional) | `REDEEM_SHARE_LINK`\* | N/A — public/path-scoped | `auth-ip` |
| `DELETE /share-links/:id` | Bearer | `GENERATE_SHARE_LINK` | N/A — own tenant | default only |
| `GET /trainers/:id/share-links` *(added)* | Bearer | `GENERATE_SHARE_LINK` | N/A — own tenant | default only |

\* Only applied when the caller is authenticated with `typ: CHILD` — the deny-list check is what produces the `403 CHILD_SHARE_LINK_BLOCKED` branch below; anonymous and non-child-authenticated callers bypass the capability check entirely (route is `@Public()`), so this line only matters for the one branch it gates.

**Gap found (flag for sign-off, minor — see §8.9):** no controller row anywhere lists a way for a trainer to see their own generated links / usage counts, even though `ShareLinkService.listByTrainer` exists. Added `GET /trainers/:id/share-links` for the same reason as §4.3's roster gap.

#### [TASK-001] POST /share-links (2026-09-22)

FR-023. Trainer (own tenant) or Super Admin.

**Request `CreateShareLinkDto`:**
```ts
class CreateShareLinkDto {
  @IsIn(['PLAYER_STATIC', 'COACH_UNIQUE']) type: 'PLAYER_STATIC' | 'COACH_UNIQUE';
  @ValidateIf(o => o.type === 'COACH_UNIQUE') @IsEmail() targetEmail?: string;
}
```
`PLAYER_STATIC`: `expiresAt: null`, `maxUses: null` (BR-006). `COACH_UNIQUE`: `expiresAt: now+7d`, single-use via the conditional `updateMany` shown in §9.1 of the architecture doc.

**Response:** `201 { id, code, type, joinUrl: '/join/{code}', expiresAt, status: 'ACTIVE' }`.

**Status codes:** `201` · `400 VALIDATION_ERROR` missing `targetEmail` for `COACH_UNIQUE` · `403 FORBIDDEN`.

#### [TASK-001] GET /share-links/:code (2026-09-22)

`@Public()`. Deliberately minimal — **no PII, no trainer internal ids** so an enumerated code leaks nothing beyond public branding (architecture §9.1).

**Response:** `{ type: 'PLAYER_STATIC' | 'COACH_UNIQUE', trainerDisplayName: string, logoUrl: string | null, primaryColorHex: string | null, valid: boolean, reason?: 'EXPIRED' | 'REVOKED' | 'EXHAUSTED' | 'NOT_FOUND' }`. Even an unknown code returns `200 { valid: false, reason: 'NOT_FOUND' }` rather than `404`, so probing codes can't distinguish "wrong code" from "expired code" by status code alone (same enumeration-safety posture as auth).

**Status codes:** `200` (always).

#### [TASK-001] POST /share-links/:code/redeem (2026-09-22)

The canonical dispatch endpoint, exactly as designed in architecture §9.1. `@Public()` at the guard level; auth is read manually if a Bearer token is present. Five branches:

| Branch | Trigger | Request body | Result |
|---|---|---|---|
| `ANONYMOUS_REGISTRATION` | no auth header | `{ email, password, phone, playerName, dateOfBirth, gender, isSelf }` | `201` — one tx: `User(PLAYER_PARENT)` + `PlayerProfile(isSelf\|child)` + `PlayerTrainerAssociation` + `ShareLink.useCount++` + `OutboxJob(EMAIL_SHARELINK_CONFIRMATION)`. Response = `AuthSessionResponseDto` (auto-login, cookies set) |
| `ASSOCIATE_EXISTING` | auth, `typ: ADULT`, `role: PLAYER_PARENT` | `{ subjectProfileIds: string[] }` (FR-021 checklist) | `200` — validates each profile owned by caller; idempotent per `(trainer, profile)` |
| blocked | auth, `typ: CHILD` | — (body ignored) | **`403 { errorCode: 'CHILD_SHARE_LINK_BLOCKED' }`** — FR-052/SEC-006. Side effect: guardian emailed the code + "Review Registration" CTA (`OutboxJob(EMAIL_CHILD_BLOCKED_SHARELINK)`). **No association created, no partial state written.** |
| `COACH_ACCEPT` | auth `role: COACH`, or anonymous **on a `COACH_UNIQUE` link** | `{ password? }` (anonymous case needs one) | `200`/`201` — asserts target-email match, single-use via conditional `updateMany`, no existing `ACTIVE` `CoachProfile` (BR-003) |
| reject | auth `role: TRAINER \| SUPER_ADMIN` | — | `409 CONFLICT` (`errorCode: ROLE_CANNOT_REDEEM_SHARE_LINK`) — "a trainer cannot be someone's player in Epic-01" |

**Single-use atomicity (BR-006), reproduced for completeness:**
```ts
const claimed = await tx.shareLink.updateMany({
  where: { code, status: 'ACTIVE', expiresAt: { gt: new Date() }, useCount: { lt: 1 } },
  data:  { useCount: { increment: 1 }, status: 'EXPIRED' },
});
if (claimed.count === 0) throw new ShareLinkUnavailableError();  // → 409 SHARE_LINK_UNAVAILABLE
```

**Status codes:** `200` / `201` per branch above · `400 VALIDATION_ERROR` · `403 CHILD_SHARE_LINK_BLOCKED` · `404 NOT_FOUND` unknown code · `409 SHARE_LINK_UNAVAILABLE` expired/exhausted/revoked · `409 ROLE_CANNOT_REDEEM_SHARE_LINK` · `429 RATE_LIMITED` (`auth-ip`).

#### [TASK-001] DELETE /share-links/:id (2026-09-22)

Revoke (soft — `status = REVOKED`, not a row delete, so usage history survives for Epic-06's analytics stub).

**Status codes:** `204` · `403 FORBIDDEN` · `404 NOT_FOUND`.

#### [TASK-001] GET /trainers/:id/share-links (2026-09-22) — *added, see §8.9*

**Response:** `PaginatedResponseDto<ShareLinkRowDto>` — `{ id, code, type, targetEmail?, status, useCount, expiresAt, createdAt }`.

**Status codes:** `200` · `404 NOT_FOUND` cross-tenant.

---

### 4.5 `AvailabilityController` — `/player-profiles/:id/availability`, `/coaches/:id/availability`, `/coaches/:id/availability/override` (module `availability`)

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` |
|---|---|---|---|
| `GET /player-profiles/:id/availability` | Bearer | `VIEW_PLAYER_AVAILABILITY` | N/A — path-scoped |
| `PUT /player-profiles/:id/availability` | Bearer | `SET_OWN_AVAILABILITY` | N/A — path-scoped |
| `GET /coaches/:id/availability` | Bearer | `VIEW_PLAYER_AVAILABILITY`\* | N/A — path-scoped |
| `PUT /coaches/:id/availability` | Bearer | `SET_OWN_AVAILABILITY` | N/A — own tenant |
| `GET /coaches/:id/availability/check` *(added)* | Bearer | `OVERRIDE_COACH_CONFLICT` | N/A — own tenant |
| `POST /coaches/:id/availability/override` | Bearer | `OVERRIDE_COACH_CONFLICT` | N/A — own tenant |

\* reused rather than a separate `VIEW_COACH_AVAILABILITY` capability — flagged as a minor naming looseness, not worth a new enum member for one read endpoint.

**Design note on `X-Trainer-Context` here (ties back to §0.3's open finding):** `Availability` has no `trainerId` column — the same weekly grid is visible to every trainer a player is associated with (architecture §3.1/§3.4: "saved availability is immediately visible to trainers," not per-trainer copies). So the header is **not** required for correctness on these two player-availability endpoints; access control is ownership-of-`:id` only. I'm calling this out explicitly rather than requiring the header just to look thorough — requiring an unused header would be worse API design, not better tenant isolation.

#### [TASK-001] GET /player-profiles/:id/availability (2026-09-22)

Owner (adult self/child), the child themself, or any `TRAINER`/`COACH` with the player in their roster (association-based check, not header-based).

**Response `AvailabilityGridResponseDto`:** `{ playerProfileId, slots: { dayOfWeek: 0-6, startTime: number /* minutes from midnight */, endTime: number, isAvailable: boolean }[] }`.

**Status codes:** `200` · `404 NOT_FOUND`.

#### [TASK-001] PUT /player-profiles/:id/availability (2026-09-22)

FR-090. Full replace (weekly grid semantics — `PUT`, not `PATCH`) by the owning adult or the child themself for their own profile.

**Request:** `{ slots: { dayOfWeek, startTime, endTime, isAvailable }[] }` — `startTime`/`endTime` validated `0–1440`, `startTime < endTime`.

**Status codes:** `200` · `400 VALIDATION_ERROR` overlapping/invalid ranges · `404 NOT_FOUND`.

#### [TASK-001] GET /coaches/:id/availability (2026-09-22) / PUT /coaches/:id/availability (2026-09-22)

FR-062 "My Times." Same shapes as the player pair; `PUT` restricted to the coach themself (`AvailabilityService.setCoachAvailability`), `GET` open to the employing trainer too.

**Status codes:** `200` (both) · `400 VALIDATION_ERROR` (PUT) · `403 FORBIDDEN` (PUT by non-owner) · `404 NOT_FOUND`.

#### [TASK-001] GET /coaches/:id/availability/check (2026-09-22) — *added*

FR-063's pre-assignment warning needs a query the trainer's event-assignment UI can call before committing (the actual event assignment itself is Epic-02, out of scope, but the **conflict check** is owned by `ConflictCheckService` here). Query: `?dayOfWeek&startTime&endTime`.

**Response:** `{ hasConflict: boolean }`.

**Status codes:** `200` · `403 FORBIDDEN` non-owning trainer.

#### [TASK-001] POST /coaches/:id/availability/override (2026-09-22)

FR-063/BR-012. Only the employing trainer. **Never blocks** — this endpoint exists to *log* an override the trainer has already decided to make, not to gate it.

**Request `CreateOverrideDto`:**
```ts
class CreateOverrideDto {
  @IsUUID() eventId: string;         // opaque FK, Epic-02 forward reference — no DB constraint yet (G-09)
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;   // required text, BR-012
}
```

**Response:** `201 { id, eventId, coachId, trainerId, reason, createdAt }`. Enqueues `OutboxJob(EMAIL_COACH_OVERRIDE_NOTIFY)` per Gap G-06's default (notify coach) — flagged there as P2/open, included here since the architecture doc took no position against the requirements doc's default.

**Status codes:** `201` · `400 VALIDATION_ERROR` missing reason · `403 FORBIDDEN` non-owning trainer.

---

### 4.6 `ChildApprovalsController` — `/approvals` (module `child-approvals`)

| Method & Path | Auth | `@RequiresCapability` | `X-Trainer-Context` |
|---|---|---|---|
| `GET /approvals` | Bearer | `APPROVE_CHILD_PURCHASE` | N/A — no trainer scoping on this model |
| `POST /approvals/:id/approve` | Bearer | `APPROVE_CHILD_PURCHASE` | N/A |
| `POST /approvals/:id/deny` | Bearer | `APPROVE_CHILD_PURCHASE` | N/A |

**`ChildPurchaseApproval` has no `trainerId` column** (§0.3) — a parent's approval queue spans every trainer their children train with, by design (it's the parent's inbox, not a trainer's).

#### [TASK-001] GET /approvals (2026-09-22)

FR-040/FR-041. Parent's own children's requests only. Query: `?status?=PENDING|APPROVED|DENIED|EXPIRED&limit&cursor`.

Per §0.7's added deny-list entry, **`typ: CHILD` gets `403 CHILD_CAPABILITY_DENIED`** here — a child does not see the parent's approval queue (their own request status is surfaced via the purchase/event record itself in a later epic, not this endpoint).

**Response:** `PaginatedResponseDto<ApprovalRowDto>` — `{ id, playerProfileId, playerName, eventId, amount, paymentType: 'USD'|'TOKEN', status, requestedAt, expiresAt, parentNotes? }`.

**Status codes:** `200` · `403 CHILD_CAPABILITY_DENIED`.

#### [TASK-001] POST /approvals/:id/approve (2026-09-22)

**Request:** `{ notes?: string }`. Conditional `updateMany` on `status = 'PENDING'` (§9.3 — race-safe against the 48h expiry sweep). On success only flips status to `APPROVED` and emits `child-approval.approved` — **no charge happens here**; Epic-05 subscribes to the event (G-09's payment forward-reference).

**Status codes:** `200 ApprovalRowDto` · `403 CHILD_CAPABILITY_DENIED` · `404 NOT_FOUND` not the caller's child · `409 CONFLICT` already resolved/expired (the conditional update matched zero rows).

#### [TASK-001] POST /approvals/:id/deny (2026-09-22)

Same shape, transitions to `DENIED`, child notified via `OutboxJob(EMAIL_CHILD_APPROVAL_DECISION)`.

**Status codes:** `200` · `403 CHILD_CAPABILITY_DENIED` · `404 NOT_FOUND` · `409 CONFLICT`.

**Expiry sweep (not a controller endpoint, noted for completeness):** `ApprovalExpiryJob` (`@Cron`, every 5 min) auto-transitions `PENDING` rows past `expiresAt` to `EXPIRED` via the same conditional-`updateMany` pattern, notifying both parties (FR-042).

---

## 5. `GET /me/bootstrap` — full per-role shapes (OQ-4)

Owned by `UsersController` (§3) since it anchors on `User` identity, aggregating across `users`, `player-profiles`, `associations`, `trainers`, and `coaches` in one round trip — this is precisely what collapses the "5-request waterfall on the Next.js server component" the architecture doc calls out (§14, NFR-001).

**`X-Trainer-Context` on this endpoint is optional, not required:** the whole point of bootstrap for a multi-trainer player is to return *all* contexts in one shot so the client can render the switcher without knowing the active one yet. If the header **is** sent, the server validates it (same `TENANT_CONTEXT_INVALID` rule as everywhere else) and echoes back `activeContext` populated; if absent, `activeContext` is `null` and the client is expected to pick one (e.g. from a persisted cookie) and re-request, or simply render the switcher first.

```ts
// Discriminated union response — @ApiExtraModels + oneOf in Swagger, discriminator = "role"
type BootstrapResponseDto =
  | SuperAdminBootstrapDto
  | TrainerBootstrapDto
  | CoachBootstrapDto
  | PlayerParentBootstrapDto;   // covers both ADULT and CHILD typ — see accountType field
```

| Role | Shape |
|---|---|
| **SUPER_ADMIN** | `{ role: 'SUPER_ADMIN', user: UserSummaryDto }` — deliberately minimal; SA has `PLATFORM` scope and no per-tenant dashboard data to aggregate. No `stats` block in Epic-01 (nothing in the requirements asks for an SA dashboard beyond the Users tool, which paginates separately). |
| **TRAINER** | `{ role: 'TRAINER', user: UserSummaryDto, trainerProfile: TrainerResponseDto, branding: { logoUrl, primaryColorHex }, coachCount: number, activePlayerCount: number }` |
| **COACH** | `{ role: 'COACH', user: UserSummaryDto, coachProfile: CoachProfileDto, employingTrainer: { id, businessName, logoUrl, primaryColorHex }, availabilitySet: boolean }` |
| **PLAYER_PARENT (`accountType: 'ADULT'`)** | `{ role: 'PLAYER_PARENT', accountType: 'ADULT', user: UserSummaryDto, playerProfiles: PlayerProfileResponseDto[] /* self + children */, contexts: ContextEntryDto[], activeContext: ContextEntryDto \| null, pendingApprovalsCount: number }` |
| **PLAYER_PARENT (`accountType: 'CHILD'`)** | `{ role: 'PLAYER_PARENT', accountType: 'CHILD', user: UserSummaryDto, playerProfile: PlayerProfileResponseDto /* own only, per §9.2 */, contexts: ContextEntryDto[] /* own only, no "Me" section, FR-034 */, activeContext: ContextEntryDto \| null }` — no `pendingApprovalsCount` (that's the parent's field, `VIEW_GUARDIAN_DATA` is deny-listed) |

**Status codes:** `200` · `401 UNAUTHORIZED` · `403 TENANT_CONTEXT_INVALID` only if `X-Trainer-Context` was supplied and doesn't match an active association (an absent header never errors here, per the optional design above).

---

## 6. Standard controller/Swagger scaffold (applies to all nine-plus-one controllers)

```ts
@ApiTags('player-profiles')
@ApiBearerAuth()
@Controller('player-profiles')
export class PlayerProfilesController {
  constructor(private readonly playerProfileService: PlayerProfileService) {}

  @Post()
  @RequiresCapability(Capability.MANAGE_CHILD_PROFILES)
  @ApiOperation({ summary: 'Create a child player profile' })
  @ApiResponse({ status: 201, type: PlayerProfileResponseDto })
  @ApiResponse({ status: 403, description: 'Denied for typ: CHILD tokens', schema: { example: { errorCode: 'CHILD_CAPABILITY_DENIED' } } })
  async create(@CurrentUser() ctx: AuthContext, @Body() dto: CreateChildProfileDto): Promise<PlayerProfileResponseDto> {
    return this.playerProfileService.createChildProfile(ctx, dto);
  }
}
```

`@ApiHeader({ name: 'X-Trainer-Context', required: false, description: '...' })` is added at the method level on every endpoint marked **Required** in the per-controller tables above (never at the controller level, since requiredness varies by endpoint even within one controller — e.g. `AvailabilityController`'s player endpoints don't need it while a hypothetical future trainer-scoped-content endpoint would).

---

## 7. Bruno collection

Not generated in this pass — flagged as a follow-up, not a blocker: the endpoint surface above (9 architecture-listed controllers + the `AssociationsController` split, ~45 endpoints) is stable enough to script a Bruno collection from, but doing so before `frontend-design` might reshape a couple of response shapes (see open questions below) risks throwaway work. Recommend generating `specs/api-designer-bruno-collection.md` once §8's open items are resolved.

---

## 8. Open questions & inconsistencies found (need your sign-off before `frontend-design`)

| # | Item | What I did | Needs your decision |
|---|---|---|---|
| 8.1 | `X-Trainer-Context` is architected as required "on every player-facing request" (§8), but Epic-01's data model (`Availability`, `ChildPurchaseApproval`) has almost nothing literally trainer-partitioned yet. | Documented per-endpoint bucket (Required/N-A) honestly rather than forcing the header everywhere for appearance's sake; it ends up **Required** on essentially nothing concrete in Epic-01 beyond optionally scoping `GET /me/bootstrap`'s `activeContext`. | Confirm this is expected — the header becomes load-bearing once Epic-02 adds real trainer-scoped content (events/calendar), not before. |
| 8.2 | `Capability.APPROVE_CHILD_PURCHASE` is missing from the architecture doc's literal `CHILD_DENIED` set (§9.2) even though §7.3's role matrix shows it denied for a child login. | Added it to the deny-list in this spec (§0.7, §4.6). | Confirm the addition — it's a real gap between two sections of the same architecture doc, not something I'm inventing from nothing. |
| 8.3 | The boot-time assertion requires every non-`@Public` route to carry `@RequiresCapability`, but `/auth/logout` has no natural capability of its own. | Annotated it with `EDIT_OWN_PROFILE` as the closest fit. | Consider a dedicated `@AlwaysAllowed()` escape-hatch decorator instead — implementation detail, low priority. |
| 8.4 | `POST /auth/register`'s purpose is unstated beyond the bare path in the module table; BR-005 + §9.1 leave no public self-registration flow for any role. | **RESOLVED (2026-09-22, project owner confirmed):** scoped to "complete a Super-Admin-provisioned trainer's setup link" only. Players/coaches always get an account via `POST /share-links/:code/redeem`; there is no general self-signup path. | — |
| 8.5 | `UsersController`'s module-table row lists `POST /users`, but no acceptance criteria anywhere describe an SA-creates-any-role flow distinct from `POST /trainers`. | Dropped `POST /users` from the surface; `POST /trainers` is the sole creation endpoint. | Confirm, or supply the missing acceptance criteria if a generic create-user flow is actually wanted. |
| 8.6 | `POST /coaches/accept/:code` (module table) duplicates the `COACH_ACCEPT` branch of `POST /share-links/:code/redeem` (§9.1) — same state transition, two entry points. | **RESOLVED (2026-09-22, project owner confirmed):** collapsed to one canonical endpoint. `POST /coaches/accept/:code` is dropped entirely; coach acceptance goes through `POST /share-links/:code/redeem` like every other ShareLink type (§4.2). | — |
| 8.7 | The task brief asked for exactly 9 controllers; the architecture doc's own module map promotes `associations` to a 10th, explicitly instructing the API designer to treat it as a second owning module on the same `/player-profiles` surface. | Followed the architecture doc (per the brief's own precedence rule) and designed a 10th controller, `AssociationsController`. | Confirm 10 controllers is fine, or say whether `associations`' endpoints should be physically folded into `PlayerProfilesController`'s class instead (routing is identical either way). |
| 8.8 | No controller row anywhere exposes `PlayerTrainerAssociationService.listRosterForTrainer`, though FR-070 requires a trainer roster view and the service method already exists for it. | Added `GET /trainers/:id/players`. | Confirm the addition and its response shape (`{playerProfileId, name, age, availabilitySummary}` — deliberately excludes anything CRM-shaped per architecture §18's "no notes/tags/pipeline" boundary). |
| 8.9 | No controller row exposes `ShareLinkService.listByTrainer`, though FR-060's "trainer can view invitation status" and FR-023's usage tracking imply a trainer-facing list. | Added `GET /trainers/:id/share-links`. | Confirm the addition. |
| 8.10 | (Inherited, not newly found) OQ-5/OQ-6/OQ-9 from `architect-architecture.md` §19 remain open and touch this spec: OQ-5 (no timezone handling — affects how `startTime`/`endTime` minutes-from-midnight are interpreted client-side), OQ-6 (email-only child-ShareLink-block notification, no in-app queue endpoint — confirmed absent from this spec on that basis), OQ-9 (skill-level enum values used in `CreateChildProfileDto`'s sibling fields, notify-coach-on-override default assumed ON in §4.5). | Carried the architecture doc's stated defaults through into the DTOs/behavior above without re-deciding them. | These block `frontend-design` copy/enum decisions more than the API shape itself, but flagging since they touch request DTOs directly. |

---

*This spec is updated incrementally by the `api-designer` skill. Endpoint entries carry a `[TASK-N]` tag so future tasks can append without renumbering existing sections.*
