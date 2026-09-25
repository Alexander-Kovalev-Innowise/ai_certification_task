# Epic-01 User Management & Authentication Implementation Plan

**Task:** TASK-001

> **For Claude:** Use `using-git-worktrees` to create isolated workspace, then implement with `coder`/`coder-frontend` skills, one task per commit, in the order given below.

**Goal:** Build PracticePerfect's Epic-01 (multi-role auth, RBAC, ShareLink onboarding, multi-trainer player/parent contexts, coach availability, Super Admin tools, portal branding) from an empty repository to a working, tested NestJS + Next.js monorepo, exactly matching `specs/architect-architecture.md` (as amended 2026-09-22, lean/single-instance scope), `specs/api-designer-spec.md`, and `specs/frontend-design-spec.md`.

**Architecture:** Turborepo monorepo, `apps/server` (NestJS + Prisma + PostgreSQL only — no Redis/BullMQ/PgBouncer) and `apps/client` (Next.js App Router). Backend follows strict `Controller → Service → Repository → PrismaService` layering, one Prisma schema (15 models, no per-module entities), guards for RBAC/capabilities/tenancy, a transactional outbox for async email/media, and in-process `@nestjs/schedule` cron for scheduled work (single-replica only — see architecture §13.1/§21). Frontend uses Zustand for client-only state (auth token, active trainer context), TanStack Query for all server-state caching, and a hand-rolled `apiClient` interceptor.

**Tech Stack:** NestJS, TypeScript, PostgreSQL, Prisma ORM, `@nestjs/jwt`, `@nestjs/passport`, `argon2`, `@nestjs/throttler` (in-memory), `@nestjs/schedule`, `helmet`, `sharp`, `pino`, `zod`, Testcontainers (integration tests) · Next.js (App Router), React, TypeScript, Tailwind CSS, TanStack Query, Zustand, React Hook Form + `@hookform/resolvers/zod` · Turborepo, npm workspaces, ESLint 9 flat config.

---

## Execution Status (updated 2026-09-25)

Backend (Phases 0–9) and Frontend Phases 10–15 are complete and merged on `feature/epic-01-user-management`. Phase 16 is in progress. Each phase's commits are on that branch, one task = one commit.

- [x] Phase 0 — Monorepo & Tooling Scaffold
- [x] Phase 1 — Data Model Foundation
- [x] Phase 2 — Core Authentication & Authorization
- [x] Phase 3 — User Management Basics
- [x] Phase 4 — ShareLink Invitation System
- [x] Phase 5 — Player/Parent Features
- [x] Phase 6 — Coach Features
- [x] Phase 7 — Super Admin Tools: Impersonation (backend)
- [x] Phase 8 — Portal Branding (backend)
- [x] Phase 9 — Backend Hardening & DoD Verification
- [x] *(unplanned addition)* `GET /me/bootstrap` — found missing during Phase 9's DoD sweep, built as its own pass
- [x] Phase 10 — Frontend Scaffold & Core State (plus two post-hoc fixes: dashboard route collision, `NODE_ENV` build-script hardening)
- [x] Phase 11 — Frontend Public/Auth Routes
- [x] Phase 12 — Frontend Super Admin: User Management
- [x] Phase 13 — Frontend ShareLink Invitations UI: Trainer Coaches & Share-Links Pages
- [x] Phase 14 — Frontend Player/Parent Features
- [x] Phase 15 — Frontend Coach Features
- [x] Phase 16 — Frontend Super Admin Tools: Impersonation
- [ ] Phase 17 — Frontend Portal Branding (**in progress**)
- [ ] Phase 18 — Frontend Shared Routes & Cross-Cutting Polish

---

## Before you start — read once, applies to every task

**Two structural surprises baked into the architecture. Get these wrong and you fail the Definition of Done silently:**

1. **`JwtAuthGuard` must call `prisma.user.findUnique`, never `findFirst`.** The soft-delete Prisma extension (Task 1.5) merges `deletedAt: null` into every `findFirst`/`findMany`/`count`/`aggregate` call. If the guard used `findFirst`, a deactivated or GDPR-deleted user's row would become invisible to it, and a revoked session would 401 with a confusing "not found" instead of the correct `ACCOUNT_INACTIVE`. `findUnique` is deliberately **not** filtered by the extension — that is what lets the guard see `status` and reject on it explicitly. This is Task 2.4 below; architecture §6.3 constraint 1.
2. **The Prisma schema has 15 models, not 14.** `OutboxJob` is the 15th — it is not optional scaffolding, it is how the lean/no-BullMQ architecture preserves retry/backoff/crash-durability for transactional email and media processing (architecture §13.2, ADR-13). It must be in the schema from Task 1.1 onward, or every later "enqueue an email" step in this plan has nothing to write to.

**Conventions used throughout this plan (stated once here, not repeated per task):**

- **Module shape** (architecture "Global Conventions"): every backend module under `apps/server/src/modules/<module>/` has `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `<module>.repository.ts`, `dto/`. **No `entities/` directory, ever.** `PrismaService` is injected into repositories only (exception: code under `shared/` may inject it directly — guards and cross-cutting infra are not repositories). Transactions are opened in services via `prisma.$transaction(async (tx) => ...)`; repository methods take an optional `tx: Prisma.TransactionClient` as their **last** parameter.
- **Testing**: TDD red-green-commit per the `test-driven-development` skill — write the failing test first, confirm it fails, implement, confirm it passes, then commit. Integration tests run against real PostgreSQL via **Testcontainers** (`apps/server/test/`), never a mocked Prisma client — this matters more than usual here because the tenant-guard extension, the soft-delete extension, the `CHECK`/trigger constraints, and the outbox are all real-database behavior a mock cannot exercise. Every task below names its test file(s) and the specific behavior to assert; it does not re-explain the red-green-commit loop each time.
- **Commit granularity**: one task = one commit. Commit messages use Conventional Commits (`feat(auth): ...`, `feat(server-scaffold): ...`, `test(users): ...`).
- **Spec citations**: `arch §N` = `specs/architect-architecture.md` section N. `api §N` = `specs/api-designer-spec.md` section N. `fe §N` = `specs/frontend-design-spec.md` section N. `req FR-0NN`/`BR-0NN` = `tasks/TASK-001/requirements-analyst-requirements.md`.
- **DTOs are reproduced verbatim from `api-designer-spec.md` where it defines them.** Do not invent alternate field names or shapes.
- **One open implementation decision this plan makes that the specs left unresolved:** `POST /auth/register`'s `CompleteTrainerSetupDto.setupToken` (api §1, "opaque, from the invite email link") has no dedicated Prisma model in the 15-model set — the requirements doc's entity table and the architecture's model count both omit a distinct "trainer setup token" table. This plan reuses the **`PasswordResetToken`** model for it (mechanically identical: opaque hashed single-use token → gate a password write), disambiguated by a `purpose: 'PASSWORD_RESET' | 'TRAINER_SETUP'` column (see Task 1.1). Flag this for product sign-off during implementation if a cleaner answer surfaces; it does not change any endpoint contract.

---

## Phase 0 — Monorepo & Tooling Scaffold

Nothing else in this plan builds without this phase. Order matters within it (tsconfig/eslint packages before the apps that extend them).

### Task 0.1: Root workspace manifest

**Files:**
- Create: `package.json` (root, `"workspaces": ["apps/*", "packages/*"]`, npm workspaces — not pnpm/yarn)
- Create: `turbo.json` (pipeline: `build`, `dev`, `lint`, `test`, `test:e2e` — `build`/`test` depend on `^build`)
- Create: `.gitignore` (node_modules, dist, .next, .env, coverage)
- Create: `.editorconfig`
- Create: `.npmrc` (`engine-strict=true`)

**Do:** Root `package.json` has no dependencies of its own beyond `turbo` (devDependency) and scripts `"dev": "turbo run dev"`, `"build": "turbo run build"`, `"lint": "turbo run lint"`, `"test": "turbo run test"`.

**Commit:** `chore(scaffold): initialize turborepo workspace root`

### Task 0.2: Shared tsconfig package

**Files:**
- Create: `packages/tsconfig/package.json` (name `@practiceperfect/tsconfig`)
- Create: `packages/tsconfig/base.json` (strict mode, ES2022 target, module resolution `bundler`)
- Create: `packages/tsconfig/nest.json` (extends `base.json`, `experimentalDecorators`, `emitDecoratorMetadata`, CommonJS output for Nest)
- Create: `packages/tsconfig/next.json` (extends `base.json`, `jsx: preserve`, Next.js plugin settings)

**Commit:** `chore(scaffold): add shared tsconfig bases`

### Task 0.3: Shared ESLint 9 flat config package

**Files:**
- Create: `packages/eslint-config/package.json` (name `@practiceperfect/eslint-config`)
- Create: `packages/eslint-config/base.mjs` (flat config: `@typescript-eslint`, import ordering, no-unused-vars)
- Create: `packages/eslint-config/nestjs.mjs` (extends `base.mjs`, adds `@typescript-eslint/no-extraneous-class` off for `@Module` classes, decorator-friendly rules)
- Create: `packages/eslint-config/next.mjs` (extends `base.mjs`, adds `eslint-plugin-react`, `eslint-plugin-react-hooks`, `@next/eslint-plugin-next`)

**Do:** Leave a `// TODO: custom rule enforcing @RequiresCapability (added in Task 9.1 once the decorator exists)` comment in `nestjs.mjs` — do not implement it yet, the decorator doesn't exist until Phase 2.

**Commit:** `chore(scaffold): add shared ESLint 9 flat config presets`

### Task 0.4: `apps/server` NestJS skeleton

**Files:**
- Create: `apps/server/package.json` (deps: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@prisma/client`; devDeps: `@nestjs/cli`, `typescript`, `prisma`)
- Create: `apps/server/nest-cli.json`
- Create: `apps/server/tsconfig.json` (extends `@practiceperfect/tsconfig/nest.json`)
- Create: `apps/server/eslint.config.mjs` (extends `@practiceperfect/eslint-config/nestjs.mjs`)
- Create: `apps/server/src/main.ts` (placeholder: `NestFactory.create(AppModule)`, `app.listen(3000)` — full pipeline wiring is Task 0.11)
- Create: `apps/server/src/app.module.ts` (placeholder: empty `@Module({ imports: [] })` — guard pipeline registered in Task 2.8)

**Note (revised 2026-09-22, project owner decision):** no per-app `.env.example` — a single root `.env.example` covers both apps (Task 0.7). `apps/server` has no `.env`/`.env.example` file of its own.

**Do:** `npm run dev -w apps/server` (or `turbo run dev --filter=server`) must boot and serve on `:3000` with no routes yet.

**Commit:** `chore(server): bootstrap NestJS application skeleton`

### Task 0.5: `apps/client` Next.js App Router skeleton

**Files:**
- Create: `apps/client/package.json` (deps: `next`, `react`, `react-dom`; devDeps: `typescript`, `@types/react`)
- Create: `apps/client/next.config.mjs` (loads the **root** `.env` via `import { config } from 'dotenv'; import { fileURLToPath } from 'node:url'; config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })` at the top of the file, before `export default nextConfig` — this puts `NEXT_PUBLIC_API_URL` into `process.env` before Next's own build-time env inlining runs, since Next only auto-loads `.env` files from the app's own directory by default. **Use `fileURLToPath`, not `.pathname`** — a `file://` URL's `.pathname` is POSIX-style (`/D:/...`), which is not a valid Windows filesystem path and silently fails to load the file, verified 2026-09-23)
- Create: `apps/client/tsconfig.json` (extends `@practiceperfect/tsconfig/next.json`)
- Create: `apps/client/eslint.config.mjs` (extends `@practiceperfect/eslint-config/next.mjs`)
- Create: `apps/client/app/layout.tsx` (minimal `<html><body>{children}</body></html>`)
- Create: `apps/client/app/page.tsx` (placeholder landing)

**Note (revised 2026-09-22):** no per-app `.env.example` here either — see Task 0.7. `apps/client` has no `.env`/`.env.example` file of its own; `next.config.mjs` loads the root `.env` explicitly (Task 0.7).

**Commit:** `chore(client): bootstrap Next.js App Router skeleton`

### Task 0.6: Tailwind + design tokens wiring

**Files:**
- Create: `apps/client/tailwind.config.ts` (extend `theme.spacing`/`borderRadius`/`boxShadow`/`fontSize` from the token tables below — do not invent new scale values)
- Create: `apps/client/src/styles/globals.css` (`:root` custom properties)
- Modify: `apps/client/app/layout.tsx` (import `globals.css`)

**Do:** Per `fe §1.2`/`1.3` and `Task/designs/DESIGN_TOKENS.md`, define in `globals.css`:
```css
:root {
  --surface-0: #0D0D0D; --surface-1: #171717; --surface-2: #242424; --surface-3: #363636;
  --border-soft: #5E5E5E; --border-strong: #868686; --ink-muted: #CFCFCF; --ink: #F3F3F3;
  --brand-primary: #6EE7B7; /* platform default mint, overridden per-tenant by BrandingProvider (Task 10.10) */
  --success: #4ADE80; --warning: #FBBF24; --danger: #F87171; --info: #60A5FA;
}
```
Spacing (`xxs:4px xs:8px sm:12px md:16px lg:24px xl:32px xxl:40px`), radius (`xs:6px sm:10px md:16px lg:24px xl:32px pill:999px`) map 1:1 into `tailwind.config.ts extend`. Do not build font loading here — that is Task 10.1 (needs actual font files).

**Commit:** `feat(client): wire Tailwind config to design tokens`

### Task 0.7: `docker-compose.yml` — Postgres only — and the single root `.env.example`

**Files:**
- Create: `docker-compose.yml` (single `postgres:16` service, named volume, port 5432, env `POSTGRES_DB=practiceperfect`)
- Create: `.env.example` **(project root — NOT `apps/server/` or `apps/client/`)**, covering every var either app needs:
  ```
  # Server
  NODE_ENV=development
  PORT=3000

  # Database (docker-compose: postgres:16, same directory — Compose reads this root .env natively for its own substitutions too)
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/practiceperfect

  # Auth
  JWT_SECRET=changeme-generate-a-strong-random-secret

  # Scheduler (in-process @nestjs/schedule cron; emergency valve — arch §13.1)
  SCHEDULER_ENABLED=true

  # Client
  NEXT_PUBLIC_API_URL=http://localhost:3000
  ```

**Do:** No Redis service, no PgBouncer service — per `arch` lean-scope amendment. State this explicitly as a comment at the top of `docker-compose.yml`: `# Lean/single-instance scope (ADR-11): PostgreSQL only. No Redis, no PgBouncer, no broker.`

**Revised (2026-09-22, project owner decision): single root `.env`/`.env.example`, not one per app.** Both `apps/server` and `apps/client` sit at the same depth (`apps/<name>`), so both reach the root file via the identical relative path `../../.env` from their own working directory (workspace commands run with `cwd` set to the package directory) — no path-depth mismatch to account for. `.gitignore` already excludes `.env` at the root (added earlier); nothing further needed there.

**Commit:** `chore(scaffold): add docker-compose for local Postgres and root .env.example`

### Task 0.8: Typed environment config (`shared/config`)

**Files:**
- Create: `apps/server/src/shared/config/env.schema.ts` (zod schema: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `SCHEDULER_ENABLED` (boolean, default `true` — arch §13.1 emergency valve), `NODE_ENV`)
- Create: `apps/server/src/shared/config/config.module.ts` (`@Global()`, loads the **root** `.env` via `dotenv.config({ path: resolve(process.cwd(), '../../.env') })` before validating `process.env` against the schema at boot, throws on failure)

**Do (env loading, revised 2026-09-22):** `process.cwd()` is `apps/server` when run via `npm run dev -w apps/server` / `turbo run dev`, so `resolve(process.cwd(), '../../.env')` resolves to the project root regardless of whether the process runs from `src` (ts-node) or `dist` (compiled) — it's a `cwd`-relative path, not `__dirname`-relative, so build output depth never affects it.

**Tests:** `apps/server/src/shared/config/env.schema.spec.ts` — invalid env (missing `DATABASE_URL`) throws; valid env parses; `SCHEDULER_ENABLED` defaults to `true` when unset.

**Commit:** `feat(server): add typed environment config module`

### Task 0.9: Request logging & correlation (`shared/logging`)

**Files:**
- Create: `apps/server/src/shared/logging/logger.module.ts` (pino, PII-redaction config for `password`/`passwordHash`/`token` fields)
- Create: `apps/server/src/shared/logging/request-context.middleware.ts` (`RequestContextMiddleware` — publishes `{ requestId, ip, userAgent }` into `AsyncLocalStorage`, arch §5 step 2)

**Tests:** `request-context.middleware.spec.ts` — a request handler run inside the middleware can read `requestId` from ALS; two concurrent requests don't see each other's `requestId`.

**Commit:** `feat(server): add pino logging and request-context middleware`

### Task 0.10: Global exception filter & pagination primitives (`shared/http`)

**Files:**
- Create: `apps/server/src/shared/http/global-exception.filter.ts` (`GlobalExceptionFilter` — RFC 7807 shape per `api §0.4`)
- Create: `apps/server/src/shared/http/error-codes.const.ts` (full catalog from `api §0.5`: `VALIDATION_ERROR`, `UNAUTHORIZED`, `ACCOUNT_INACTIVE`, `PASSWORD_CHANGE_REQUIRED`, `FORBIDDEN`, `CHILD_CAPABILITY_DENIED`, `TENANT_CONTEXT_INVALID`, `IMPERSONATION_NOT_ALLOWED`, `CHILD_SHARE_LINK_BLOCKED`, `NOT_FOUND`, `CONFLICT`, `SHARE_LINK_UNAVAILABLE`, `IMPERSONATION_TARGET_INVALID`, `RATE_LIMITED`, `TENANT_SCOPE_VIOLATION`)
- Create: `apps/server/src/shared/http/pagination.dto.ts` (`PaginatedResponseDto<T> { items: T[]; nextCursor: string | null; hasMore: boolean }`, keyset cursor encode/decode helpers on `(createdAt, id)` — never `OFFSET`, per `arch §3.3`/NFR-002)

**Do:** `GlobalExceptionFilter` maps `class-validator`'s array-of-strings `BadRequestException` into `details[]` (one entry per `{field, message}`), sets `errorCode: 'VALIDATION_ERROR'`, always `400`. Non-validation `HttpException` maps to the catalog above; unhandled → `500 INTERNAL_ERROR`, no `details`.

**Tests:** `global-exception.filter.spec.ts` — validation error → `400` with `details[]`; generic `HttpException` → mapped `errorCode`; unhandled `Error` → `500 INTERNAL_ERROR`.

**Commit:** `feat(server): add global exception filter and pagination primitives`

### Task 0.11: `main.ts` full bootstrap pipeline

**Files:**
- Modify: `apps/server/src/main.ts`

**Do:** Wire, in this order (arch §5 steps 1–3): `helmet()`, CORS (`credentials: true`, single client origin from env), global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, `app.useGlobalFilters(new GlobalExceptionFilter())`, Swagger (`@nestjs/swagger`, `ApiBearerAuth`, served at `/docs`). **No version prefix** — paths exactly as `/auth/login` (api-spec's stated assumption, api §top).

**Tests:** `apps/server/test/bootstrap.e2e-spec.ts` — app boots; an unknown route with bad JSON body returns `400 VALIDATION_ERROR`, not a raw stack trace; response headers include `helmet`'s security headers.

**Commit:** `feat(server): wire main.ts bootstrap pipeline (helmet, validation, exception filter, swagger)`

### Task 0.12: Root README dev-setup

**Files:**
- Create: `README.md`

**Do:** Cover: prerequisites (Node, Docker, npm), `docker compose up -d`, `npm install`, `npm run prisma:migrate -w apps/server` (once Phase 1 exists), `npm run dev`, running tests (`npm run test`, `npm run test:e2e` — note Testcontainers needs Docker running). **Must state the single-replica constraint explicitly** (DoD item, arch §20): *"This deployment is single-process only. Do not run two instances of `apps/server` — scheduled jobs (`@nestjs/schedule` `@Cron`) will double-fire. See `specs/architect-architecture.md` §21 before scaling out."*

**Commit:** `docs: add root README with dev setup instructions`

### Task 0.13: Turbo pipeline finalization

**Files:**
- Modify: `turbo.json`

**Do:** Confirm `build`/`lint`/`test` tasks are declared for both `apps/server` and `apps/client` workspaces (each app's own `package.json` needs matching `"lint"`/`"test"`/`"build"` scripts — add stubs now if a later phase's tooling isn't installed yet, e.g. `"test": "jest"` even before any spec file exists).

**Commit:** `chore(scaffold): finalize turbo pipeline task graph`

---

## Phase 1 — Data Model Foundation

### Task 1.1: `prisma/schema.prisma` — all 15 models

**Files:**
- Create: `apps/server/prisma/schema.prisma`
- Modify: `apps/server/package.json` (add `prisma`, `@prisma/client` deps if not already; add `"prisma:generate"`, `"prisma:migrate"` scripts)

**Do:** This is the single source of truth for the data model (arch "Global Conventions" — **no per-module entity files anywhere in this codebase**). Enable the `multiSchema` preview feature so `UserDeletionLog` can live in a separate `audit` schema (arch §11.2 — a schema the app's normal DB role cannot `SELECT`/`UPDATE`/`DELETE` from, only `INSERT`; the restrictive grants themselves are applied in Task 1.2's raw migration SQL, not here).

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["public", "audit"]
}

enum Role { SUPER_ADMIN TRAINER COACH PLAYER_PARENT }
enum UserStatus { ACTIVE INACTIVE DELETED }
enum CoachStatus { PENDING ACTIVE }
enum AssociationStatus { ACTIVE INACTIVE }
enum ShareLinkType { PLAYER_STATIC COACH_UNIQUE }
enum ShareLinkStatus { ACTIVE EXPIRED REVOKED }
enum AvailabilitySubjectType { PLAYER COACH }
enum Gender { MALE FEMALE OTHER PREFER_NOT_TO_SAY }
enum SkillLevel { BEGINNER INTERMEDIATE ADVANCED ELITE }
enum PaymentType { USD TOKEN }
enum ApprovalStatus { PENDING APPROVED DENIED EXPIRED }
enum OutboxStatus { PENDING DONE FAILED }

model User {
  id                 String    @id @default(uuid())
  email              String    @unique
  passwordHash       String
  role               Role
  status             UserStatus @default(ACTIVE)
  firstName          String
  lastName            String
  phone              String?
  photoUrl           String?
  notificationPrefs  Json?
  tokenVersion       Int       @default(0)
  mustChangePassword Boolean   @default(false)
  emailVerifiedAt    DateTime?
  lastLoginAt        DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  deletedAt          DateTime?

  trainerProfile          TrainerProfile?
  coachProfile             CoachProfile?
  ownedPlayerProfiles      PlayerProfile[]          @relation("AccountOwner")
  childPlayerProfile       PlayerProfile?           @relation("ChildLogin")
  refreshTokens            RefreshToken[]
  emailVerificationTokens  EmailVerificationToken[]
  passwordResetTokens      PasswordResetToken[]
  createdShareLinks        ShareLink[]              @relation("ShareLinkCreator")
  impersonationsAsAdmin    ImpersonationLog[]       @relation("Admin")
  impersonationsAsTarget   ImpersonationLog[]       @relation("Target")
  childPurchaseApprovals   ChildPurchaseApproval[]  @relation("Parent")
  deletionLogsPerformed    UserDeletionLog[]        @relation("DeletedBy")

  @@index([status, role, createdAt])
  @@schema("public")
}

model TrainerProfile {
  id                 String   @id @default(uuid())
  userId             String   @unique
  businessName       String
  address            String?
  website            String?
  description        String?
  logoUrl            String?
  primaryColorHex    String?
  derivedPaletteJson Json?
  stripeCustomerId   String?  // Epic-05 stub, nullable, written by nothing in Epic-01
  subscriptionStatus String?  // Epic-05 stub
  platformFeePercent Decimal? @db.Decimal(5, 2) // Epic-05 stub
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  user         User                        @relation(fields: [userId], references: [id])
  coachProfiles CoachProfile[]
  associations PlayerTrainerAssociation[]
  shareLinks   ShareLink[]
  overrides    CoachAvailabilityOverride[]

  @@schema("public")
}

model CoachProfile {
  id             String      @id @default(uuid())
  userId         String      @unique
  trainerId      String
  bio            String?
  credentials    String?
  certifications String?
  publicProfile  Boolean     @default(false)
  status         CoachStatus @default(PENDING)
  joinedAt       DateTime    @default(now())

  user         User                        @relation(fields: [userId], references: [id])
  trainer      TrainerProfile              @relation(fields: [trainerId], references: [id])
  availability Availability[]
  overrides    CoachAvailabilityOverride[]

  @@index([trainerId, status])
  @@schema("public")
  // Partial unique index WHERE status = 'ACTIVE' on (userId) is added as raw SQL in Task 1.2 —
  // this is the DB-level enforcement of BR-003 (one active trainer per coach); Prisma cannot express a partial index.
}

model PlayerProfile {
  id                                   String     @id @default(uuid())
  accountUserId                        String
  childUserId                          String?    @unique
  name                                 String
  dateOfBirth                          DateTime
  gender                               Gender
  skillLevel                           SkillLevel @default(BEGINNER)
  school                               String?
  jerseyNumber                         String?
  photoUrl                             String?
  isSelf                               Boolean    @default(false)
  allowChildTokenSpendWithoutApproval  Boolean    @default(false)
  emergencyContact                     Json?
  createdAt                            DateTime   @default(now())
  updatedAt                            DateTime   @updatedAt
  deletedAt                            DateTime?

  accountOwner User                       @relation("AccountOwner", fields: [accountUserId], references: [id])
  childLogin   User?                      @relation("ChildLogin", fields: [childUserId], references: [id])
  associations PlayerTrainerAssociation[]
  availability Availability[]
  approvals    ChildPurchaseApproval[]

  @@index([accountUserId])
  @@schema("public")
}

model PlayerTrainerAssociation {
  id              String            @id @default(uuid())
  trainerId       String
  playerProfileId String
  shareLinkId     String?
  status          AssociationStatus @default(ACTIVE)
  connectedAt     DateTime          @default(now())
  disconnectedAt  DateTime?

  trainer       TrainerProfile @relation(fields: [trainerId], references: [id])
  playerProfile PlayerProfile  @relation(fields: [playerProfileId], references: [id])
  shareLink     ShareLink?     @relation(fields: [shareLinkId], references: [id])

  @@unique([trainerId, playerProfileId])
  @@index([trainerId, status])
  @@index([playerProfileId, status])
  @@schema("public")
}

model ShareLink {
  id              String          @id @default(uuid())
  code            String          @unique
  type            ShareLinkType
  trainerId       String
  createdByUserId String
  targetEmail     String?
  expiresAt       DateTime?
  maxUses         Int?
  useCount        Int             @default(0)
  status          ShareLinkStatus @default(ACTIVE)
  createdAt       DateTime        @default(now())

  trainer      TrainerProfile              @relation(fields: [trainerId], references: [id])
  createdBy    User                        @relation("ShareLinkCreator", fields: [createdByUserId], references: [id])
  associations PlayerTrainerAssociation[]

  @@index([trainerId, status])
  @@schema("public")
}

model Availability {
  id              String                  @id @default(uuid())
  subjectType     AvailabilitySubjectType
  playerProfileId String?
  coachProfileId  String?
  dayOfWeek       Int // 0-6
  startTime       Int // minutes from midnight, 0-1440
  endTime         Int
  isAvailable     Boolean                 @default(true)
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt

  playerProfile PlayerProfile? @relation(fields: [playerProfileId], references: [id])
  coachProfile  CoachProfile?  @relation(fields: [coachProfileId], references: [id])

  @@index([playerProfileId, dayOfWeek])
  @@index([coachProfileId, dayOfWeek])
  @@schema("public")
  // CHECK (exactly one of playerProfileId/coachProfileId is non-null, and it agrees with subjectType)
  // added as raw SQL in Task 1.2 — Prisma cannot express exclusive-arc constraints.
}

model CoachAvailabilityOverride {
  id        String   @id @default(uuid())
  eventId   String   @db.Uuid // opaque FK, no relation — Epic-02 forward reference (arch §18)
  coachId   String
  trainerId String
  reason    String
  createdAt DateTime @default(now())

  coach   CoachProfile   @relation(fields: [coachId], references: [id])
  trainer TrainerProfile @relation(fields: [trainerId], references: [id])

  @@index([eventId])
  @@schema("public")
}

model ImpersonationLog {
  id              String    @id @default(uuid())
  adminUserId     String
  targetUserId    String
  startedAt       DateTime  @default(now())
  endedAt         DateTime?
  durationSeconds Int?
  createdAt       DateTime  @default(now())

  admin  User @relation("Admin", fields: [adminUserId], references: [id])
  target User @relation("Target", fields: [targetUserId], references: [id])

  @@index([adminUserId])
  @@index([targetUserId])
  @@schema("public")
}

model ChildPurchaseApproval {
  id              String         @id @default(uuid())
  playerProfileId String
  parentUserId    String
  eventId         String         @db.Uuid // opaque FK, no relation — Epic-02 forward reference
  amount          Decimal        @db.Decimal(10, 2)
  paymentType     PaymentType
  status          ApprovalStatus @default(PENDING)
  parentNotes     String?
  requestedAt     DateTime       @default(now())
  respondedAt     DateTime?
  expiresAt       DateTime

  playerProfile PlayerProfile @relation(fields: [playerProfileId], references: [id])
  parent        User          @relation("Parent", fields: [parentUserId], references: [id])

  @@index([parentUserId, status])
  @@index([status, expiresAt])
  @@schema("public")
}

model UserDeletionLog {
  id              String   @id @default(uuid())
  originalUserId  String
  originalEmail   String
  deletedByUserId String
  reason          String
  deletedAt       DateTime @default(now())
  dataBackupJson  Json

  deletedBy User @relation("DeletedBy", fields: [deletedByUserId], references: [id])

  @@schema("audit") // write-only for the app's normal DB role — see Task 1.2's GRANT statements
}

model EmailVerificationToken {
  id        String    @id @default(uuid())
  userId    String
  token     String // hashed at rest
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@schema("public")
}

model PasswordResetToken {
  id        String    @id @default(uuid())
  userId    String
  token     String // hashed at rest
  purpose   String    @default("PASSWORD_RESET") // "PASSWORD_RESET" | "TRAINER_SETUP" — see plan header note
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@schema("public")
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String
  familyId  String
  expiresAt DateTime
  createdAt DateTime  @default(now())
  revokedAt DateTime?

  user User @relation(fields: [userId], references: [id])

  @@unique([tokenHash])
  @@index([userId, revokedAt])
  @@index([familyId])
  @@schema("public")
}

model OutboxJob {
  id            String       @id @default(uuid())
  type          String // job-type constants live in code, shared/jobs/job-types.const.ts (Task 1.12) — not a DB enum, kept extensible
  payload       Json
  status        OutboxStatus @default(PENDING)
  attempts      Int          @default(0)
  nextAttemptAt DateTime     @default(now())
  lastError     String?
  createdAt     DateTime     @default(now())

  @@index([status, nextAttemptAt])
  @@schema("public")
}
```

**Commit:** `feat(server): define full Prisma schema (15 models incl. OutboxJob)`

### Task 1.2: Initial migration + raw SQL constraints + `pg_trgm` + `audit` schema grants

**Files:**
- Create: `apps/server/prisma/migrations/<timestamp>_init/migration.sql` (generated by `prisma migrate dev`, then hand-edited to append raw SQL below — Prisma migrations accept hand-edited SQL, per `arch §3.2`)

**Do:** Run `npx prisma migrate dev --name init` inside `apps/server`, then append to the generated `migration.sql`:
```sql
-- pg_trgm for directory search (NFR-002)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "user_email_trgm_idx" ON "User" USING gin (lower(email) gin_trgm_ops);
CREATE INDEX "user_name_trgm_idx" ON "User" USING gin ((lower("firstName") || ' ' || lower("lastName")) gin_trgm_ops);

-- BR-003: exactly one ACTIVE trainer per coach
CREATE UNIQUE INDEX "coach_profile_one_active_trainer" ON "CoachProfile" ("userId") WHERE status = 'ACTIVE';

-- BR-001 (§3.2): a User cannot simultaneously hold a TrainerProfile and a CoachProfile
CREATE OR REPLACE FUNCTION assert_single_profile_kind() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'TrainerProfile' AND EXISTS (SELECT 1 FROM "CoachProfile" WHERE "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'User % already has a CoachProfile', NEW."userId";
  END IF;
  IF TG_TABLE_NAME = 'CoachProfile' AND EXISTS (SELECT 1 FROM "TrainerProfile" WHERE "userId" = NEW."userId") THEN
    RAISE EXCEPTION 'User % already has a TrainerProfile', NEW."userId";
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_trainer_single_role AFTER INSERT ON "TrainerProfile" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_single_profile_kind();
CREATE CONSTRAINT TRIGGER trg_coach_single_role AFTER INSERT ON "CoachProfile" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_single_profile_kind();

-- Availability exclusive arc: exactly one of playerProfileId/coachProfileId, agreeing with subjectType
ALTER TABLE "Availability" ADD CONSTRAINT "availability_exclusive_arc" CHECK (
  (subjectType = 'PLAYER' AND "playerProfileId" IS NOT NULL AND "coachProfileId" IS NULL) OR
  (subjectType = 'COACH' AND "coachProfileId" IS NOT NULL AND "playerProfileId" IS NULL)
);

-- §11.1: status = DELETED implies deletedAt IS NOT NULL (irreversibility is structural)
ALTER TABLE "User" ADD CONSTRAINT "user_deleted_has_timestamp" CHECK (status != 'DELETED' OR "deletedAt" IS NOT NULL);

-- audit schema: write-only grants (§11.2) — the app's normal role can INSERT but never SELECT/UPDATE/DELETE
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
GRANT USAGE ON SCHEMA audit TO CURRENT_USER;
GRANT INSERT ON audit."UserDeletionLog" TO CURRENT_USER;
REVOKE SELECT, UPDATE, DELETE ON audit."UserDeletionLog" FROM CURRENT_USER;
```

**Tests:** `apps/server/test/migration.e2e-spec.ts` (Testcontainers) — inserting a second `CoachProfile` with `status='ACTIVE'` for a `userId` that already has one throws a unique-violation; inserting an `Availability` row with both `playerProfileId` and `coachProfileId` set throws a check-violation; a raw `SELECT` against `audit."UserDeletionLog"` using the app's connection role fails with a permission error (proves write-only).

**Commit:** `feat(server): add initial migration with raw SQL constraints and audit schema grants`

### Task 1.3: Seed script — bootstrap Super Admin

**Files:**
- Create: `apps/server/prisma/seed.ts`
- Modify: `apps/server/package.json` (`"prisma": { "seed": "ts-node prisma/seed.ts" }`)

**Do:** Creates exactly one `User(role=SUPER_ADMIN)` from `SEED_SUPER_ADMIN_EMAIL`/`SEED_SUPER_ADMIN_PASSWORD` env vars (argon2id-hashed — reuse `PasswordService` once Task 2.11 exists; until then, inline `argon2.hash`). No self-registration path exists anywhere in this system (`BR-005`) — this seed is the *only* way a first Super Admin ever exists.

**Commit:** `feat(server): add Super Admin bootstrap seed script`

### Task 1.4: `PrismaService` + `PrismaModule`

**Files:**
- Create: `apps/server/src/shared/prisma/prisma.service.ts` (`PrismaService extends PrismaClient`, implements `OnModuleInit`/`OnModuleDestroy`)
- Create: `apps/server/src/shared/prisma/prisma.module.ts` (`@Global()`)

**Tests:** `prisma.service.spec.ts` — service connects and disconnects cleanly (Testcontainers).

**Commit:** `feat(server): add global PrismaService and PrismaModule`

### Task 1.5: Soft-delete Prisma extension

**Files:**
- Create: `apps/server/src/shared/prisma/extensions/soft-delete.extension.ts`

**Do:** Applies to `User`, `PlayerProfile`, `PlayerTrainerAssociation` (the three models with `deletedAt`). Merges `deletedAt: null` into `where` on `findMany`/`findFirst`/`count`/`aggregate` **unless** the call passes a typed `withDeleted: true` extension argument. Per `arch §11.1`: **`findUnique` is deliberately left unfiltered** — repositories that need to exclude soft-deleted rows by id use `findFirst`, not `findUnique`. Document this exception with a comment at the top of the file so it isn't rediscovered per module (this is exactly what Task 2.4's guard depends on).

**Tests:** `soft-delete.extension.spec.ts` (Testcontainers) — a soft-deleted `User` is excluded from `findMany`/`findFirst`/`count` by default; `withDeleted: true` includes it; `findUnique` returns the soft-deleted row regardless (proves the deliberate non-filtering).

**Commit:** `feat(server): add soft-delete Prisma extension`

### Task 1.6: Tenant-guard Prisma extension (throwing assertion)

**Files:**
- Create: `apps/server/src/shared/prisma/extensions/tenant-guard.extension.ts`
- Create: `apps/server/src/shared/tenancy/tenant-scope-violation.error.ts`

**Do:** Per `arch §8` Layer 2. Wraps `$allOperations` for the declared tenant-owned model set: `TrainerProfile`, `CoachProfile`, `PlayerTrainerAssociation`, `ShareLink`, `CoachAvailabilityOverride`. Reads the current `TenantScope` from ALS (published by `TenantContextInterceptor`, Task 1.8 — not wired into the guard pipeline until Task 2.8, so this extension can be built and unit-tested against a manually-set ALS value now). If scope is `{kind:'TRAINER', trainerId}` and the query's `where` doesn't contain a matching `trainerId`, **throw** `TenantScopeViolationError` (never silently inject the filter — that's the deliberate design, arch §8). `PLATFORM` scope and an absent scope (e.g. this extension running before ALS is populated) both skip the check without throwing — this "skip when absent" behavior is exactly what makes ordering safe for `User` reads in the guard (Task 2.4), since `User` isn't even in the tenant-owned set.

**Tests:** `tenant-guard.extension.spec.ts` (Testcontainers) — a `coachProfile.findMany({ where: {} })` call with `TenantScope={kind:'TRAINER', trainerId:'A'}` in ALS throws `TenantScopeViolationError`; the same call with `where: {trainerId:'A'}` succeeds; the same call with no scope in ALS at all does not throw (models outside the tenant-owned set, or scope not yet published, pass through).

**Commit:** `feat(server): add tenant-guard Prisma extension (throws on unscoped tenant query)`

### Task 1.7: Audit-stamp Prisma extension

**Files:**
- Create: `apps/server/src/shared/prisma/extensions/audit-stamp.extension.ts`

**Do:** While `AuthContext.impersonation` is present in ALS (published once Task 2.2/7.1 exist — build this against a manually-set ALS value now, same pattern as Task 1.6), stamps `actorUserId`/`impersonationLogId` onto write operations for models that carry those columns. (Most Epic-01 models don't have these columns yet — this extension's job in Epic-01 is narrow: it exists and is tested now so impersonation (Phase 7) has nothing left to build here.)

**Tests:** `audit-stamp.extension.spec.ts` — a write with impersonation context in ALS gets the stamp; a write with none doesn't.

**Commit:** `feat(server): add audit-stamp Prisma extension`

### Task 1.8: Tenant context plumbing (`shared/tenancy`)

**Files:**
- Create: `apps/server/src/shared/tenancy/tenant-scope.type.ts` (`type TenantScope = { kind: 'TRAINER'; trainerId: string } | { kind: 'PLATFORM' }` — no public constructor for `PLATFORM`, only reachable via `@CrossTenant()` + `SUPER_ADMIN`, enforced in Task 2.3's decorator + this interceptor)
- Create: `apps/server/src/shared/tenancy/tenant-context.store.ts` (`AsyncLocalStorage<TenantScope>` wrapper)
- Create: `apps/server/src/shared/tenancy/tenant-context.interceptor.ts` (`TenantContextInterceptor` — builds `TenantScope` from `AuthContext.trainerId`, publishes to ALS; arch §5 step 8, runs **after** `JwtAuthGuard`)

**Tests:** `tenant-context.interceptor.spec.ts` — a `TRAINER` `AuthContext` produces `{kind:'TRAINER', trainerId}`; a `SUPER_ADMIN` with `@CrossTenant()` on the route produces `{kind:'PLATFORM'}`; a `SUPER_ADMIN` without `@CrossTenant()` cannot get `PLATFORM` scope.

**Commit:** `feat(server): add TenantScope, ALS store, and TenantContextInterceptor`

### Task 1.9: Testcontainers integration-test harness + auth test helper skeleton

**Files:**
- Create: `apps/server/test/jest-e2e.json` (Testcontainers-backed Postgres, migrations run before suite)
- Create: `apps/server/test/setup/testcontainers.setup.ts`
- Create: `apps/server/src/shared/testing/as-user.helper.ts` (`asUser(role, opts)` — stub returning a plain claims object for now; real JWT signing wired in once `TokenService` exists, Task 2.11)

**Do:** Every later integration test in this plan depends on this harness existing and being fast enough to run per-suite (one container, migrations applied once, each test wrapped in a transaction that's rolled back — or a `TRUNCATE` between tests, whichever this becomes in practice).

**Commit:** `test(server): add Testcontainers Postgres integration test harness`

### Task 1.10: `shared/mail` — provider-agnostic email port

**Files:**
- Create: `apps/server/src/shared/mail/mail.service.ts` (abstract class — the port, `INT-001`)
- Create: `apps/server/src/shared/mail/adapters/console-mail.adapter.ts` (dev/test adapter — logs instead of sending)
- Create: `apps/server/src/shared/mail/adapters/ses-mail.adapter.stub.ts` (stub, not wired to real SES SDK yet — flagged as a later infra task, out of Epic-01's functional scope)
- Create: `apps/server/src/shared/mail/mail.module.ts` (binds `MailService` to `ConsoleMailAdapter` via `useClass` keyed off config — INT-001's "pluggable provider" requirement)
- Create: `apps/server/src/shared/mail/templates/` (empty dir with a `.gitkeep` — templates for the 9 email types are added alongside the features that send them, e.g. Task 2.16 adds the password-reset template)

**Tests:** `mail.module.spec.ts` — resolving `MailService` from the module returns the console adapter in test config.

**Commit:** `feat(server): add MailService port with console adapter`

### Task 1.11: `shared/storage` — provider-agnostic file storage port

**Files:**
- Create: `apps/server/src/shared/storage/storage.service.ts` (abstract class — the port, `INT-002`)
- Create: `apps/server/src/shared/storage/adapters/local-storage.adapter.ts` (dev/test adapter — writes to a local temp dir, returns a `file://`-style or local-server URL)
- Create: `apps/server/src/shared/storage/adapters/s3-storage.adapter.stub.ts` (stub)
- Create: `apps/server/src/shared/storage/image-processor.ts` (`sharp`-based resize helper — thumbnail generation, logo resize toward 200×200)
- Create: `apps/server/src/shared/storage/storage.module.ts`

**Tests:** `image-processor.spec.ts` — resizing a fixture image produces the expected dimensions.

**Commit:** `feat(server): add StorageService port with local adapter and sharp image processor`

### Task 1.12: `shared/jobs` — transactional outbox (the 15th model, made real)

**Files:**
- Create: `apps/server/src/shared/jobs/job-types.const.ts` (string constants: `EMAIL_TRAINER_INVITE`, `EMAIL_COACH_INVITE`, `EMAIL_VERIFICATION`, `EMAIL_PASSWORD_RESET`, `EMAIL_SHARELINK_CONFIRMATION`, `EMAIL_CHILD_BLOCKED_SHARELINK`, `EMAIL_CHILD_APPROVAL_REQUEST`, `EMAIL_CHILD_APPROVAL_DECISION`, `EMAIL_COACH_OVERRIDE_NOTIFY`, `MEDIA_THUMBNAIL`, `MEDIA_LOGO_RESIZE`)
- Create: `apps/server/src/shared/jobs/outbox.repository.ts` (Prisma access to `OutboxJob` — `enqueue(tx, type, payload)`, `claimBatch()` using `FOR UPDATE SKIP LOCKED`)
- Create: `apps/server/src/shared/jobs/outbox.service.ts` (`enqueue()` — must be called **inside** the caller's `$transaction`, never after commit; `drainOnce()` — processes a bounded batch, dispatches by `type` to `MailService`/`StorageService`+`ImageProcessor`, marks `DONE`/increments `attempts` with exponential backoff up to a cap then `FAILED`)
- Create: `apps/server/src/shared/jobs/outbox-pump.ts` (`OutboxPump` — `@Cron` every 30s calling `drainOnce()`)
- Create: `apps/server/src/shared/jobs/jobs.module.ts` (registers `ScheduleModule.forRoot()` gated by `SCHEDULER_ENABLED`)

**Do:** Per `arch §13.2` (ADR-13): this is the mechanism that makes dropping BullMQ **more** durable than the previous `afterCommit` design, not merely equivalent — the job row commits atomically with the business row because `enqueue()` is called inside the same transaction. Use `SKIP LOCKED` in the claim query even though there is only one process today — "it costs nothing today and is the single thing that would otherwise make a second replica corrupt the outbox rather than merely duplicate crons" (arch §13.2).

**Tests:** `outbox.service.spec.ts` / `outbox.e2e-spec.ts` (Testcontainers) — a business transaction that throws after calling `enqueue()` leaves **no** `OutboxJob` row (rollback test, DoD item); a committed transaction's job is visible to `drainOnce()`; `drainOnce()` run twice concurrently doesn't double-process the same row (`SKIP LOCKED` proof); a job that fails repeatedly hits `attempts` cap and lands in `FAILED`, not retried forever.

**Commit:** `feat(server): add transactional outbox (OutboxJob, OutboxService, OutboxPump)`

---

## Phase 2 — Core Authentication & Authorization

This is the largest phase because "core auth" in this architecture is inseparable from the guard pipeline, tenancy, and capability system — none of it is optional middleware, it's the mechanism every later controller depends on.

### Task 2.1: Capability enum + child deny-list

**Files:**
- Create: `apps/server/src/shared/security/capability.enum.ts`

**Do:** Reproduce verbatim from `api §0.7`:
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

export const CHILD_DENIED: ReadonlySet<Capability> = new Set([
  Capability.REDEEM_SHARE_LINK,
  Capability.MANAGE_TRAINER_ASSOCIATIONS,
  Capability.MANAGE_PAYMENT_METHODS,
  Capability.PURCHASE_TOKENS,
  Capability.COMPLETE_PURCHASE,
  Capability.DELETE_OWN_ACCOUNT,
  Capability.VIEW_GUARDIAN_DATA,
  Capability.MANAGE_CHILD_PROFILES,
  Capability.APPROVE_CHILD_PURCHASE, // api §0.7's resolved addition — reconciles CHILD_DENIED with the §7.3 role matrix
]);
```

**Commit:** `feat(server): add Capability enum and child deny-list`

### Task 2.2: `AuthContext` interface + ALS publishing

**Files:**
- Create: `apps/server/src/shared/security/auth-context.interface.ts`

**Do:** Reproduce from `arch §7.2`:
```ts
export interface AuthContext {
  userId: string;
  role: Role;
  accountType: 'ADULT' | 'CHILD';
  guardianUserId?: string;
  trainerId?: string;
  impersonation?: { actorUserId: string; actorRole: Role; logId: string; expiresAt: Date };
  auditActorId: string; // impersonation?.actorUserId ?? userId
}
```
Also add `apps/server/src/shared/security/auth-context.store.ts` (`AsyncLocalStorage<AuthContext>`), published by `JwtAuthGuard` (Task 2.4) — this is what lets Task 1.6/1.7's extensions read it without prop-drilling.

**Commit:** `feat(server): add AuthContext interface and ALS store`

### Task 2.3: Security decorators

**Files:**
- Create: `apps/server/src/shared/security/decorators/public.decorator.ts` (`@Public()`)
- Create: `apps/server/src/shared/security/decorators/roles.decorator.ts` (`@Roles(...)`)
- Create: `apps/server/src/shared/security/decorators/requires-capability.decorator.ts` (`@RequiresCapability(...)`)
- Create: `apps/server/src/shared/security/decorators/cross-tenant.decorator.ts` (`@CrossTenant()`)
- Create: `apps/server/src/shared/security/decorators/current-user.decorator.ts` (`@CurrentUser()` param decorator, reads `request.authContext`)

**Do:** Per `arch §7.1`. `@CrossTenant()` is metadata-only here; `TenantContextInterceptor` (Task 1.8) is what actually refuses to build a `PLATFORM` scope for non-`SUPER_ADMIN` — this task just defines the marker.

**Commit:** `feat(server): add @Public, @Roles, @RequiresCapability, @CrossTenant, @CurrentUser decorators`

### Task 2.4: `JwtAuthGuard` — the structural-surprise task

**Files:**
- Create: `apps/server/src/shared/security/auth-snapshot.repository.ts` (`findForAuth(userId)` — a **`findUnique`** on `User`, narrow `select: {id, status, role, tokenVersion, mustChangePassword}`; injects `PrismaService` directly — this is `shared/` infrastructure, the documented exception to "repositories only")
- Create: `apps/server/src/shared/security/guards/jwt-auth.guard.ts`

**Do:** Per `arch §6.3`, verbatim constraints:
1. **Must call `prisma.user.findUnique`, never `findFirst`.** The soft-delete extension (Task 1.5) only filters `findFirst`/`findMany`/`count`/`aggregate`; `findUnique` is deliberately unfiltered. If this guard used `findFirst`, a deactivated/deleted user's row would vanish from its own revocation check and produce a wrong error. Write the query as:
   ```ts
   const row = await this.prisma.user.findUnique({
     where: { id: userId },
     select: { id: true, status: true, role: true, tokenVersion: true, mustChangePassword: true },
   });
   ```
2. Skips `@Public()` routes entirely. Otherwise: decode JWT → reject `401 UNAUTHORIZED` if invalid/expired/missing → call `findForAuth(payload.sub)` → reject `401 ACCOUNT_INACTIVE` if the row is missing, `row.status !== 'ACTIVE'`, or `payload.tv !== row.tokenVersion`.
3. Builds `AuthContext` from the token claims (`sub`, `role`, `typ`, `gid`, `tid`, `act`) and publishes it to the ALS store (Task 2.2) **before** any later pipeline step runs — this must happen at guard-pipeline position 5 (before `TenantContextInterceptor` at position 8), so the tenant-guard extension has nothing to check yet when this guard's own `User` read happens (`User` isn't in the tenant-owned model set anyway — two independent reasons the ordering is safe, arch §6.3 constraint 2).
4. **Memoize per request**, not per process — store the resolved `AuthContext` on the request object so a handler that loads the user again later in the same request doesn't pay for a second read. Never cache across requests (that would silently reintroduce the exact staleness problem this design removes).

**Tests:** `jwt-auth.guard.spec.ts` + `jwt-auth-guard.e2e-spec.ts` (Testcontainers, mandatory DoD items from `arch §20`):
- A user whose `status` is `INACTIVE` — the guard sees the row (proves `findUnique`, not `findFirst`) and rejects with `401 ACCOUNT_INACTIVE`, not a "not found"-shaped error.
- A user whose `status` is `DELETED` — same proof.
- A request with a valid, unexpired token for a user whose `tokenVersion` was just bumped (simulating deactivation) is rejected on the very next request.
- The guard's `User` read completes without the tenant-guard extension throwing (proves the pre-ALS-population ordering holds).
- Two handlers in the same request both call the guard's memoized context and only one DB read happens.

**Commit:** `feat(server): add JwtAuthGuard with findUnique-based tokenVersion revocation check`

### Task 2.5: `RolesGuard`

**Files:**
- Create: `apps/server/src/shared/security/guards/roles.guard.ts`

**Do:** Reads `@Roles(...)` metadata, compares against `AuthContext.role` (the **effective** role — always `sub`/`role`, never `act`, per `arch §6.2`). No `@Roles()` on a route means available to any authenticated role (still subject to tenancy/capability checks downstream).

**Tests:** `roles.guard.spec.ts` — matching role passes; non-matching role → `403 FORBIDDEN`; no `@Roles()` metadata passes for any role.

**Commit:** `feat(server): add RolesGuard`

### Task 2.6: `CapabilitiesGuard` (child deny-list + forced-password-change fold-in)

**Files:**
- Create: `apps/server/src/shared/security/guards/capabilities.guard.ts`

**Do:** Two responsibilities folded into one guard per `arch §6.6`/`§9.2`:
1. If `AuthContext.accountType === 'CHILD'` and the route's `@RequiresCapability(...)` names a capability in `CHILD_DENIED` (Task 2.1) → `403 { errorCode: 'CHILD_CAPABILITY_DENIED' }`.
2. If `AuthContext` resolves to a user with `mustChangePassword: true` (available from the guard's own memoized read, Task 2.4) and the route is not `/auth/change-password`, `/auth/logout`, or `/me` → `403 { errorCode: 'PASSWORD_CHANGE_REQUIRED' }`.
Leave the blast-radius impersonation blocks (`IMPERSONATION_NOT_ALLOWED` on `IMPERSONATE_USER`/`GDPR_DELETE_USER`/`CREATE_TRAINER_ACCOUNT` while `act` is present) as a `// TODO: wired fully in Task 7.5 once impersonation exists` — add the check now if the plumbing is trivial, but don't block this task on it.

**Tests:** `capabilities.guard.spec.ts` — a `CHILD` token hitting a deny-listed capability → `403 CHILD_CAPABILITY_DENIED`; `mustChangePassword: true` blocks a non-exempt route → `403 PASSWORD_CHANGE_REQUIRED`; the three exempt routes pass through regardless.

**Commit:** `feat(server): add CapabilitiesGuard (child deny-list, forced password change)`

### Task 2.7: `AuthThrottlerGuard` + named limiters

**Files:**
- Create: `apps/server/src/shared/security/guards/auth-throttler.guard.ts`
- Modify: `apps/server/src/app.module.ts` (register `ThrottlerModule.forRoot(...)` with named throttlers — **default in-memory storage**, arch §12/ADR-14)

**Do:** Named limiters exactly as `arch §12`/`api §0.6`: `default` (300/60s, IP), `auth-ip` (20/15min, IP), `auth-identity` (5/15min, `sha256(route + normalizedEmail)`), `token-consume` (10/15min, IP), `impersonation` (10/hour, adminUserId). `AuthThrottlerGuard` overrides `getTracker()` to hash the submitted email — **never** store a raw email as a throttler key.

**Tests:** `auth-throttler.guard.spec.ts` — tracker key for `auth-identity` is a hash, not the raw email; exceeding a named limit returns `429` with `Retry-After`.

**Commit:** `feat(server): add named rate limiters with in-memory storage`

### Task 2.8: `AppModule` — global guard pipeline + boot-time capability assertion

**Files:**
- Modify: `apps/server/src/app.module.ts`

**Do:** Register, in the exact `arch §5` order, as `APP_GUARD`/`APP_INTERCEPTOR`/`APP_FILTER` providers: `ThrottlerGuard` (#1) → `JwtAuthGuard` (#2) → `RolesGuard` (#3) → `CapabilitiesGuard` (#4) → `TenantContextInterceptor` (as interceptor, after the guards) → `GlobalExceptionFilter` (already wired in `main.ts`, Task 0.11 — confirm no double-registration). Add `RequestContextMiddleware` (Task 0.9) via `configure(consumer)`.

Add the **boot-time assertion** (arch §20 DoD item): on `onModuleInit`, walk every registered route via `Reflector`/`DiscoveryService`; for any route not marked `@Public()`, verify it carries `@RequiresCapability(...)`. If any route is missing it, **throw and fail startup** — this is what makes "every new controller method must carry `@RequiresCapability`" a build failure, not a convention (arch §9.2).

**Tests:** `app-module-boot.e2e-spec.ts` — a deliberately-added throwaway controller with a non-`@Public()` route lacking `@RequiresCapability` causes `app.init()` to throw; removing the decorator gap lets it boot (this test module is temporary/local to the spec file, not shipped code).

**Commit:** `feat(server): wire global guard pipeline and boot-time capability assertion`

### Task 2.9: `users` module skeleton + `UsersRepository`

**Files:**
- Create: `apps/server/src/modules/users/users.module.ts`
- Create: `apps/server/src/modules/users/users.repository.ts` (`findByEmail`, `findById` (uses `findFirst`, not `findUnique` — per the soft-delete-exclusion convention), `create`, `update`)

**Commit:** `feat(users): add users module skeleton and repository`

### Task 2.10: `AccountProvisioningService` — the single User-creation entry point

**Files:**
- Create: `apps/server/src/modules/users/account-provisioning.service.ts`

**Do:** Per `arch §3.2` point 3: **the only code path that creates a `User` together with its profile**, always inside one `$transaction`. Start with a minimal `createUserWithProfile(tx, {role, email, passwordHash, firstName, lastName, ...profileFields})` shape general enough that Task 3.8 (trainer creation) and Task 4.6 (anonymous ShareLink registration) both call into it rather than writing their own `prisma.user.create`. No other service in this codebase is allowed to call `prisma.user.create` directly — say so in a code comment.

**Tests:** `account-provisioning.service.spec.ts` — creating a user and profile together commits atomically; a failure partway through leaves no orphan `User` row.

**Commit:** `feat(users): add AccountProvisioningService as sole User-creation entry point`

### Task 2.11: `TokenService` + `PasswordService`

**Files:**
- Create: `apps/server/src/modules/auth/token.service.ts` (issues JWT access tokens with the exact claim shape from `arch §6.2`: `sub, role, typ, gid, tid, tv, act?, jti, iat, exp`; 15-min expiry; validates/decodes)
- Create: `apps/server/src/modules/auth/password.service.ts` (`hash`/`verify` via `argon2id` — `memoryCost: 19456, timeCost: 2, parallelism: 1` per NFR-006/`arch §6.1`; `dummyHash()` — computes a wasted argon2 hash so a not-found lookup takes the same time as a real one, FR-002 anti-enumeration)

**Tests:** `token.service.spec.ts` — issued token round-trips through decode with all claims intact; `act` claim present only when passed. `password.service.spec.ts` — `hash`/`verify` round-trip; `dummyHash()` takes roughly the same wall-clock time as a real `verify` (a loose timing assertion, not exact).

**Commit:** `feat(auth): add TokenService and PasswordService`

### Task 2.12: `RefreshToken` repository + rotation logic

**Files:**
- Create: `apps/server/src/modules/auth/refresh-token.repository.ts`
- Create: `apps/server/src/modules/auth/token-rotation.service.ts` (or fold into `AuthService` if smaller than expected — engineer's call, keep it one file either way)

**Do:** Per `arch §6.4`. `rotate(presentedTokenHash)`: mark presented row `revokedAt`, issue a new row with the same `familyId`. `detectReuse`: if the presented token is already `revokedAt`, revoke every row sharing its `familyId` and bump `User.tokenVersion` (stolen-token detection) — this is a distinct code path from ordinary rotation, test it as such.

**Tests:** `token-rotation.service.spec.ts` (Testcontainers) — normal rotation marks old row revoked, creates new row, same `familyId`; presenting an already-revoked token revokes the whole family and bumps `tokenVersion`.

**Commit:** `feat(auth): add refresh token rotation with reuse (stolen-token) detection`

### Task 2.13: `POST /auth/login`

**Files:**
- Create: `apps/server/src/modules/auth/dto/login.dto.ts`
- Create: `apps/server/src/modules/auth/auth.controller.ts` (new file, first endpoint)
- Create: `apps/server/src/modules/auth/auth.service.ts` (new file, `login()` method)

**Do:** `LoginDto`:
```ts
class LoginDto {
  @IsEmail() @MaxLength(255) email: string;
  @IsString() @IsNotEmpty() password: string;
}
```
`AuthService.login`: look up by email (generic `401 UNAUTHORIZED` — *"Invalid email or password."* — for both "no such user" and "wrong password", FR-001); if found but `status !== 'ACTIVE'` → `401 ACCOUNT_INACTIVE` (distinct `errorCode`, still generic-looking copy); on success issue access token + rotating refresh cookie (`httpOnly; Secure; SameSite=Lax; Path=/auth`) + `csrf` cookie; response is `AuthSessionResponseDto { accessToken, expiresIn: 900, user: UserSummaryDto }` including `user.mustChangePassword`. Annotate `@Public() @Throttle({'auth-ip':{}, 'auth-identity':{}})`.

**Tests:** `auth.controller.e2e-spec.ts` (start this file here, extend it in every later auth task) — valid credentials → `200` + cookies set; wrong password and unknown email both → identical `401` body; inactive account → `401 ACCOUNT_INACTIVE`; rate limit exceeded → `429` with `Retry-After`.

**Commit:** `feat(auth): implement POST /auth/login`

### Task 2.14: `POST /auth/refresh`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.controller.ts`
- Modify: `apps/server/src/modules/auth/auth.service.ts`

**Do:** No body — reads `refreshToken` cookie. Requires double-submit CSRF (`X-CSRF-Token` header must equal `csrf` cookie). Calls `TokenRotationService.rotate`; on reuse-detection, `401`. `@Public()` at guard level (cookie-only auth), `default` throttle only.

**Tests:** valid refresh → `200` + new rotated cookies; missing/mismatched CSRF header → `403 { errorCode: 'CSRF_MISMATCH' }`; reused (already-revoked) token → `401`, and a subsequent login for that user now requires re-auth (proves the family-wide revoke).

**Commit:** `feat(auth): implement POST /auth/refresh with rotation and CSRF check`

### Task 2.15: `POST /auth/logout`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.controller.ts`, `auth.service.ts`

**Do:** Revokes the presented refresh-token row; `?everywhere=true` revokes all of the user's refresh tokens **and** bumps `tokenVersion`. Same CSRF requirement as refresh. `@RequiresCapability(EDIT_OWN_PROFILE)` (api §1's documented "closest-fit" annotation, needed to satisfy the boot-time assertion — flagged there as slightly awkward, not worth a new decorator for Epic-01).

**Tests:** logout revokes the token (a subsequent refresh with it fails); `?everywhere=true` revokes all sessions.

**Commit:** `feat(auth): implement POST /auth/logout`

### Task 2.16: `POST /auth/forgot-password`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.controller.ts`, `auth.service.ts`
- Create: `apps/server/src/modules/auth/password-reset-token.repository.ts`
- Create: `apps/server/src/shared/mail/templates/password-reset.template.ts`

**Do:** Always `202 { message: 'If that email exists, a reset link has been sent.' }`, identical response whether or not the email exists (FR-002). On the not-found path, call `PasswordService.dummyHash()` so timing doesn't leak existence. On the found path, create a `PasswordResetToken(purpose: 'PASSWORD_RESET')`, enqueue `OutboxJob(EMAIL_PASSWORD_RESET)` inside the same transaction (Task 1.12's pattern). `@Public() @Throttle({'auth-ip':{}, 'auth-identity':{}})`.

**Tests:** existing and non-existing email produce byte-identical response bodies and status; a `PasswordResetToken` row and matching `OutboxJob` row both exist after a real request; neither exists after a not-found request.

**Commit:** `feat(auth): implement POST /auth/forgot-password`

### Task 2.17: `POST /auth/reset-password`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.controller.ts`, `auth.service.ts`

**Do:** `ResetPasswordDto`:
```ts
class ResetPasswordDto {
  @IsString() @IsNotEmpty() token: string;
  @IsString() @MinLength(8) @Matches(PASSWORD_POLICY) newPassword: string;
}
```
where `PASSWORD_POLICY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/` (api §0.10 — min length **8**, not 12; one lowercase, one uppercase, one digit, no special-character requirement). Single-use, 1h expiry, `purpose: 'PASSWORD_RESET'` only. On success: `passwordHash` updated, `tokenVersion++`, all `RefreshToken` rows revoked (a password reset is itself "logout everywhere"). `@Public() @Throttle({'token-consume':{}})`.

**Tests:** valid token resets password and revokes all sessions; expired/already-used/wrong-purpose token → `404`/`410` (generic copy, doesn't distinguish reasons); weak password → `400 VALIDATION_ERROR`.

**Commit:** `feat(auth): implement POST /auth/reset-password`

### Task 2.18: `POST /auth/verify-email` + `POST /auth/verify-email/resend`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.controller.ts`, `auth.service.ts`
- Create: `apps/server/src/modules/auth/email-verification-token.repository.ts`

**Do:** `verify-email`: `{token: string}`, single-use, 24h expiry, sets `emailVerifiedAt`. **Non-blocking** — no guard anywhere checks this value (arch §6.5); this task must not add one. `resend`: authenticated, `@RequiresCapability(EDIT_OWN_PROFILE)`, `@Throttle({'token-consume':{}})`, invalidates the previous token, enqueues `OutboxJob(EMAIL_VERIFICATION)`, `409 CONFLICT` if already verified.

**Tests:** verify sets `emailVerifiedAt`; expired/invalid token → `404`/`410`; resend on an already-verified account → `409`.

**Commit:** `feat(auth): implement POST /auth/verify-email and /verify-email/resend`

### Task 2.19: `POST /auth/change-password`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.controller.ts`, `auth.service.ts`

**Do:** Request `{ currentPassword?, newPassword }` — `currentPassword` optional only when `mustChangePassword: true` on the caller's row, required otherwise (service-level check, not DTO-level, since it's data-dependent). One of the three routes exempt from `PASSWORD_CHANGE_REQUIRED` blocking (Task 2.6).

**Tests:** forced-first-change path succeeds without `currentPassword`; voluntary path requires and validates it; wrong `currentPassword` → `401`.

**Commit:** `feat(auth): implement POST /auth/change-password`

### Task 2.20: `POST /auth/register` (trainer setup-link completion)

**Files:**
- Create: `apps/server/src/modules/auth/dto/complete-trainer-setup.dto.ts`
- Modify: `apps/server/src/modules/auth/auth.controller.ts`, `auth.service.ts`

**Do:** **Not public self-registration** (api §8.4, resolved) — the only path players/coaches get accounts is `POST /share-links/:code/redeem` (Phase 4). This endpoint completes a Super-Admin-provisioned trainer's setup link, created by Task 3.8 (which doesn't exist yet — this task can be implemented and unit-tested against a manually-seeded `PasswordResetToken(purpose:'TRAINER_SETUP')` row now, and re-verified end-to-end once Task 3.8 lands).
```ts
class CompleteTrainerSetupDto {
  @IsString() @IsNotEmpty() setupToken: string;
  @IsString() @MinLength(8) @Matches(PASSWORD_POLICY) password: string;
}
```
On success: sets `passwordHash`, marks the `PasswordResetToken(purpose:'TRAINER_SETUP')` used, auto-logs-in (same cookie-setting as login). `@Public() @Throttle({'auth-ip':{}})`.

**Tests:** valid setup token → `200` + auto-login cookies; unknown token → `404`; already-consumed → `409`; expired → `410`.

**Commit:** `feat(auth): implement POST /auth/register (trainer setup-link completion)`

### Task 2.21: `TokenMaintenanceJob` — expired token purge

**Files:**
- Create: `apps/server/src/modules/auth/token-maintenance.job.ts` (`@Cron` hourly — purges expired `RefreshToken`/`EmailVerificationToken`/`PasswordResetToken` rows)

**Tests:** seeding expired rows of each type and running the job's method directly removes them, leaves unexpired rows untouched.

**Commit:** `feat(auth): add hourly TokenMaintenanceJob`

### Task 2.22: `GET /me` + `PATCH /me`

**Files:**
- Create: `apps/server/src/modules/users/dto/me-response.dto.ts`
- Create: `apps/server/src/modules/users/dto/update-me.dto.ts`
- Create: `apps/server/src/modules/users/users.controller.ts` (first endpoints)
- Create: `apps/server/src/modules/users/users.service.ts`

**Do:** `MeResponseDto` per `api §3` (`id, email, role, accountType, firstName, lastName, phone, photoUrl, emailVerified, mustChangePassword, createdAt` — **never** `passwordHash`, enforced via `@Exclude()`). `UpdateMeDto`:
```ts
class UpdateMeDto {
  @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @IsOptional() @IsPhoneNumber() phone?: string;
  @IsOptional() @IsUrl() photoUrl?: string;
  @IsOptional() @IsObject() notificationPrefs?: Record<string, boolean>;
}
```
**Child-token field restriction** (service-layer, not guard-layer — `EDIT_OWN_PROFILE` is not in `CHILD_DENIED`): a `typ: CHILD` caller may only send `photoUrl`/`notificationPrefs`; `firstName`/`lastName`/`phone` → `403 { errorCode: 'CHILD_FIELD_NOT_EDITABLE', details: [...offending fields] }`.

**Tests:** `GET /me` never leaks `passwordHash` even via a raw JSON diff; `PATCH /me` as a child sending `firstName` → `403 CHILD_FIELD_NOT_EDITABLE` naming the field.

**Commit:** `feat(users): implement GET /me and PATCH /me with child field restriction`

### Task 2.23: Integration test sweep — Auth + JwtAuthGuard DoD

**Files:**
- Extend: `apps/server/test/auth.e2e-spec.ts`, `apps/server/test/jwt-auth-guard.e2e-spec.ts`

**Do:** Consolidate and confirm every `arch §20` DoD item touching auth is actually asserted end-to-end (not just unit-level from earlier tasks): deactivation → next request rejected; `findUnique` sees `INACTIVE`/`DELETED` rows; pre-ALS ordering holds; full login → refresh → logout round trip; rate limiting on `/auth/login` and `/auth/forgot-password`.

**Commit:** `test(auth): consolidate DoD-mandated auth and guard integration tests`

---

## Phase 3 — User Management Basics

### Task 3.1: `GET /users` — Super Admin directory

**Files:**
- Create: `apps/server/src/modules/users/dto/user-directory-row.dto.ts`
- Modify: `apps/server/src/modules/users/users.repository.ts` (`findAllPaginated` — keyset on `(createdAt, id)`, `pg_trgm` search via raw `ILIKE`/similarity on `lower(email)` and the name trigram index from Task 1.2)
- Modify: `apps/server/src/modules/users/users.controller.ts`, `users.service.ts`

**Do:** Query `?limit&cursor&search?&role?&status?`. `select` restricted to directory columns, never `passwordHash`. `@RequiresCapability(MANAGE_ANY_USER)`.

**Tests:** search hits the trigram index (assert via `EXPLAIN` containing the GIN index name, or simply assert correctness + a rough timing bound with a seeded few-thousand-row fixture — full 10k/<3s NFR-002 timing is a Phase 9 concern, this task proves correctness); keyset pagination never uses `OFFSET`; non-Super-Admin → `403`.

**Commit:** `feat(users): implement GET /users directory with keyset pagination and trigram search`

### Task 3.2: `GET /users/:id`

**Files:**
- Create: `apps/server/src/modules/users/dto/user-detail-response.dto.ts`
- Modify: `users.controller.ts`, `users.service.ts`, `users.repository.ts` (`findByIdWithDeleted` — explicit `withDeleted: true` opt-in per Task 1.5)

**Tests:** a Super Admin can look up a soft-deleted user's row; non-Super-Admin → `403`; unknown id → `404`.

**Commit:** `feat(users): implement GET /users/:id`

### Task 3.3: `PATCH /users/:id`

**Files:**
- Create: `apps/server/src/modules/users/dto/update-user.dto.ts` (superset of `UpdateMeDto` — **no `role` field**, role changes are out of scope per api §3)
- Modify: `users.controller.ts`, `users.service.ts`

**Tests:** SA edits any user's fields; duplicate-email `PATCH` → `409 CONFLICT`; attempting to send `role` in the body is rejected by `whitelist: true` (global `ValidationPipe`), not silently ignored.

**Commit:** `feat(users): implement PATCH /users/:id`

### Task 3.4: Anonymizer registry + `users`' own anonymizer

**Files:**
- Create: `apps/server/src/shared/prisma/anonymizer.interface.ts` (`ANONYMIZER` DI token, `Anonymizer { model: string; anonymize(userId, tx): Promise<void> }`)
- Create: `apps/server/src/modules/users/users.anonymizer.ts` (registers via `useClass`, `multi: true`; anonymizes `firstName`/`lastName` → "Deleted User" (split sensibly), `email` → `deleted_{id}@example.com`, `phone` → `null`, `photoUrl` → `null`)

**Tests:** `users.anonymizer.spec.ts` — running it against a seeded user produces exactly the field transforms above.

**Commit:** `feat(users): add anonymizer registry and users module anonymizer`

### Task 3.5: `POST /users/:id/deactivate`

**Files:**
- Create: `apps/server/src/modules/users/account-lifecycle.service.ts` (new file, `deactivate()` method)
- Modify: `users.controller.ts`

**Do:** One transaction: `status = INACTIVE`, `deletedAt = now`, `tokenVersion++`, revoke all `RefreshToken` rows. `@RequiresCapability(DEACTIVATE_REACTIVATE_USER)`.

**Tests:** (Testcontainers, DoD-critical) an already-issued, unexpired access token for the deactivated user is rejected on the **very next** request after this call — this is the same end-to-end assertion as Task 2.23 but triggered via the real endpoint, not a manually-bumped `tokenVersion`. Already-inactive/deleted target → `409`.

**Commit:** `feat(users): implement POST /users/:id/deactivate`

### Task 3.6: `POST /users/:id/reactivate`

**Files:**
- Modify: `account-lifecycle.service.ts` (`reactivate()`), `users.controller.ts`

**Do:** Hard-rejects if `status = DELETED` — mirrored by the DB `CHECK` from Task 1.2 as the structural backstop (arch §11.2).

**Tests:** reactivating an `INACTIVE` user restores login; reactivating a `DELETED` user → `409 CANNOT_REACTIVATE_DELETED_USER` and the DB-level `CHECK` would also reject a direct bypass attempt.

**Commit:** `feat(users): implement POST /users/:id/reactivate`

### Task 3.7: `DELETE /users/:id` — GDPR anonymization

**Files:**
- Modify: `account-lifecycle.service.ts` (`gdprDelete()`), `users.controller.ts`
- Create: `apps/server/src/modules/users/user-deletion-log.repository.ts` (writes to the `audit` schema — a second Prisma client connection or the same client scoped to the `audit."UserDeletionLog"` model per Task 1.2's grants)

**Do:** Per `arch §11.2`, one transaction: (1) serialize pre-anonymization snapshot → `UserDeletionLog.dataBackupJson` in the `audit` schema; (2) invoke every registered `Anonymizer`; (3) `User` fields anonymized + `status = DELETED` + `deletedAt` + `tokenVersion++` + `passwordHash` → unusable sentinel; (4) revoke all tokens; (5) emit `user.deleted` (a simple in-process event emitter is enough for Epic-01 — nothing subscribes to it yet). Request body `{ reason: string }` required.

**Tests:** (Testcontainers, DoD-critical) after deletion, `User` row is anonymized exactly per FR-014; `UserDeletionLog` row exists with the pre-anonymization snapshot; a raw query against `audit."UserDeletionLog"` using the app's normal role cannot `SELECT` it back (re-proves Task 1.2's grant); `reactivate` on this user now hard-fails; missing `reason` → `400`.

**Commit:** `feat(users): implement DELETE /users/:id (GDPR anonymization)`

### Task 3.8: `POST /trainers` — Super Admin creates trainer account

**Files:**
- Create: `apps/server/src/modules/trainers/trainers.module.ts`
- Create: `apps/server/src/modules/trainers/trainers.repository.ts`
- Create: `apps/server/src/modules/trainers/trainer.service.ts`
- Create: `apps/server/src/modules/trainers/dto/create-trainer.dto.ts`
- Create: `apps/server/src/modules/trainers/dto/trainer-response.dto.ts`
- Create: `apps/server/src/modules/trainers/trainers.controller.ts`
- Modify: `account-provisioning.service.ts` (extend for `TRAINER` role + `TrainerProfile` creation, still one transaction)

**Do:**
```ts
class CreateTrainerDto {
  @IsString() @MaxLength(200) businessName: string;
  @IsString() @MaxLength(100) firstName: string;
  @IsString() @MaxLength(100) lastName: string;
  @IsEmail() @MaxLength(255) email: string;
  @IsPhoneNumber() phone: string;
}
```
One transaction: `User(role=TRAINER, status=ACTIVE, mustChangePassword=true)` + `TrainerProfile` via `AccountProvisioningService` + a `PasswordResetToken(purpose:'TRAINER_SETUP')` + `OutboxJob(EMAIL_TRAINER_INVITE)` carrying the setup-link URL. **No password is ever generated or emailed** (OQ-8, setup-link only). `@RequiresCapability(CREATE_TRAINER_ACCOUNT)`.

**Tests:** duplicate email → `409 CONFLICT`; success creates exactly one `User`+`TrainerProfile`+setup token + outbox row, all in the same transaction (a forced failure after the `User` insert leaves nothing behind); response is `201 TrainerResponseDto`.

**Commit:** `feat(trainers): implement POST /trainers (Super Admin creates trainer account)`

### Task 3.9: `GET /trainers/:id` + `PATCH /trainers/:id`

**Files:**
- Modify: `trainers.controller.ts`, `trainer.service.ts`, `trainers.repository.ts`
- Create: `apps/server/src/modules/trainers/dto/update-trainer.dto.ts` (`businessName`, `address`, `website`, `description` — **not** branding fields, those are Task 8.1)

**Do:** `GET`: Stripe/subscription/fee columns are **omitted from the response DTO entirely**, not exposed as `null` (api §4.1). Both endpoints use `EDIT_OWN_PROFILE` + a service-layer ownership check (`:id === caller.tid` for `TRAINER`, unconditional for `SUPER_ADMIN`) rather than a dedicated capability (api §4.1 footnote).

**Tests:** owning trainer can read/edit; a different trainer → `404` (not `403` — cross-tenant reads are `404` per arch §8 Layer 3, avoiding existence disclosure); Super Admin can read/edit any.

**Commit:** `feat(trainers): implement GET and PATCH /trainers/:id`

### Task 3.10: `trainers` anonymizer

**Files:**
- Create: `apps/server/src/modules/trainers/trainers.anonymizer.ts` (business details — `businessName`, `address`, `website`, `description` → generic placeholders on GDPR delete of the owning user)

**Tests:** anonymizer transforms verified against a seeded `TrainerProfile`.

**Commit:** `feat(trainers): add trainers module anonymizer`

### Task 3.11: Integration tests — Users directory, GDPR delete, trainer creation

**Files:**
- Extend: `apps/server/test/users.e2e-spec.ts`, `apps/server/test/trainers.e2e-spec.ts`

**Do:** Consolidate: directory pagination/search/RBAC; full GDPR-delete irreversibility chain (delete → reactivate fails → historical reference still resolves to "Deleted User"-shaped data, once a later phase has something referencing a deleted user — otherwise assert the `User` row alone); trainer duplicate-email conflict.

**Commit:** `test(users): add users-directory and GDPR-delete integration coverage`

### Task 3.12: Integration tests — trainer tenant isolation (Layer 3, mandatory)

**Files:**
- Extend: `apps/server/test/trainers.e2e-spec.ts`

**Do:** Per `arch §8` Layer 3 — this exact test shape ("trainer B cannot read/modify trainer A's row → `404`") is required for **every** tenant-owned controller in this plan, not just this one. Establish the reusable test fixture/helper here (two seeded trainers + their tokens) so later phases' isolation tests (Tasks 4.15, 5.14, 6.5) reuse it instead of re-deriving it.

**Commit:** `test(trainers): add mandatory tenant-isolation test (trainer B vs trainer A)`

---

## Phase 4 — ShareLink Invitation System

### Task 4.1: `associations` module skeleton

**Files:**
- Create: `apps/server/src/modules/associations/associations.module.ts`
- Create: `apps/server/src/modules/associations/associations.repository.ts` (`create`, `findActive`, `disconnect` — full service logic comes in Phase 5, this task is repository-only so Phase 4's redemption flows have something to call)

**Commit:** `feat(associations): add module skeleton and repository`

### Task 4.2: `POST /share-links`

**Files:**
- Create: `apps/server/src/modules/share-links/share-links.module.ts`
- Create: `apps/server/src/modules/share-links/share-links.repository.ts`
- Create: `apps/server/src/modules/share-links/share-link.service.ts` (`generatePlayerLink`, `generateCoachLink`)
- Create: `apps/server/src/modules/share-links/dto/create-share-link.dto.ts`
- Create: `apps/server/src/modules/share-links/share-links.controller.ts`

**Do:**
```ts
class CreateShareLinkDto {
  @IsIn(['PLAYER_STATIC', 'COACH_UNIQUE']) type: 'PLAYER_STATIC' | 'COACH_UNIQUE';
  @ValidateIf(o => o.type === 'COACH_UNIQUE') @IsEmail() targetEmail?: string;
}
```
`PLAYER_STATIC`: `expiresAt: null, maxUses: null` (BR-006). `COACH_UNIQUE`: `expiresAt: now+7d`, single-use enforced later at redemption via conditional `updateMany` (Task 4.9), not at creation time. `@RequiresCapability(GENERATE_SHARE_LINK)`, own tenant.

**Tests:** missing `targetEmail` for `COACH_UNIQUE` → `400`; `PLAYER_STATIC` link has null expiry/uses.

**Commit:** `feat(share-links): implement POST /share-links`

### Task 4.3: `GET /share-links/:code`

**Files:**
- Modify: `share-links.controller.ts`, `share-link.service.ts`

**Do:** `@Public()`. **Never 404s** — even an unknown code returns `200 { valid: false, reason: 'NOT_FOUND' }`. No PII, no trainer internal ids — only `{type, trainerDisplayName, logoUrl, primaryColorHex, valid, reason?}`.

**Tests:** unknown code → `200 {valid:false, reason:'NOT_FOUND'}`; expired/revoked/exhausted each produce their distinct `reason`; valid link → `200 {valid:true, ...branding}`.

**Commit:** `feat(share-links): implement GET /share-links/:code (public preview)`

### Task 4.4: `GET /trainers/:id/share-links`

**Files:**
- Modify: `share-links.controller.ts`, `share-link.service.ts`, `share-links.repository.ts` (`listByTrainer`)

**Do:** Gap-fill endpoint (api §8.9/§4.4). `PaginatedResponseDto<ShareLinkRowDto>`. `@RequiresCapability(GENERATE_SHARE_LINK)`, own tenant.

**Tests:** cross-tenant → `404`; usage counts reflect redemptions once Task 4.6+ exist (revisit/extend this test then if easier).

**Commit:** `feat(share-links): implement GET /trainers/:id/share-links`

### Task 4.5: `DELETE /share-links/:id`

**Files:**
- Modify: `share-links.controller.ts`, `share-link.service.ts`

**Do:** Soft revoke (`status = REVOKED`), not a row delete — usage history survives for the Epic-06 analytics stub (arch §18).

**Tests:** revoked link's `GET /share-links/:code` now reports `reason: 'REVOKED'`.

**Commit:** `feat(share-links): implement DELETE /share-links/:id`

### Task 4.6: `POST /share-links/:code/redeem` — `ANONYMOUS_REGISTRATION` branch

**Files:**
- Create: `apps/server/src/modules/share-links/share-link-redemption.service.ts`
- Create: `apps/server/src/modules/share-links/dto/redeem-share-link.dto.ts` (union body — this branch's shape: `{email, password, phone, playerName, dateOfBirth, gender, isSelf}`)
- Modify: `apps/server/src/modules/users/account-provisioning.service.ts` (extend again for `PLAYER_PARENT` + `PlayerProfile` in the same transaction)
- Modify: `share-links.controller.ts`

**Do:** No auth header. One `$transaction`: `User(PLAYER_PARENT)` + `PlayerProfile(isSelf|child per body)` + `PlayerTrainerAssociation` + `ShareLink.useCount++` + `OutboxJob(EMAIL_SHARELINK_CONFIRMATION)`. Response is `AuthSessionResponseDto` (auto-login). `@Public()` at guard level, `@Throttle({'auth-ip':{}})`.

**Tests:** full flow creates all four rows in one transaction and returns a working session; a forced failure after the `User` insert leaves nothing behind (transaction atomicity, same pattern as Task 3.8).

**Commit:** `feat(share-links): implement redeem ANONYMOUS_REGISTRATION branch`

### Task 4.7: redeem — `ASSOCIATE_EXISTING` branch

**Files:**
- Modify: `share-link-redemption.service.ts`, `redeem-share-link.dto.ts`, `share-links.controller.ts`
- Modify: `associations.repository.ts` (fill in real `associate()` logic if still a stub)

**Do:** Auth, `typ: ADULT`, `role: PLAYER_PARENT`. Body `{ subjectProfileIds: string[] }` (FR-021 checklist). Validates each profile owned by caller; idempotent per `(trainer, profile)` — an already-active association returns `200` with the existing row, not an error.

**Tests:** associating an already-connected profile is idempotent; associating a profile not owned by the caller → rejected (not a data leak — generic error, not confirming/denying the other profile's existence).

**Commit:** `feat(share-links): implement redeem ASSOCIATE_EXISTING branch`

### Task 4.8: redeem — `CHILD_SHARE_LINK_BLOCKED` branch

**Files:**
- Modify: `share-link-redemption.service.ts`, `share-links.controller.ts`
- Create: `apps/server/src/shared/mail/templates/child-blocked-sharelink.template.ts`

**Do:** Auth, `typ: CHILD`. Body ignored. `403 { errorCode: 'CHILD_SHARE_LINK_BLOCKED' }` (FR-052/SEC-006). Side effect only: enqueue `OutboxJob(EMAIL_CHILD_BLOCKED_SHARELINK)` to the guardian with the code + "Review Registration" CTA. **No association created, no partial state written** — assert this explicitly.

**Tests:** response is exactly `403 CHILD_SHARE_LINK_BLOCKED`; no `PlayerTrainerAssociation` row is created; the guardian-notification outbox job exists.

**Commit:** `feat(share-links): implement redeem CHILD_SHARE_LINK_BLOCKED branch`

### Task 4.9: redeem — `COACH_ACCEPT` branch (single-use atomicity)

**Files:**
- Modify: `share-link-redemption.service.ts`, `share-links.controller.ts`
- Modify: `apps/server/src/modules/users/account-provisioning.service.ts` (extend for `COACH` role, anonymous case)

**Do:** Auth `role: COACH`, or anonymous **on a `COACH_UNIQUE` link**. Asserts target-email match, no existing `ACTIVE` `CoachProfile` for this user (BR-003 — backstopped by the partial unique index from Task 1.2). **Single-use atomicity, exact shape from `arch §9.1`:**
```ts
const claimed = await tx.shareLink.updateMany({
  where: { code, status: 'ACTIVE', expiresAt: { gt: new Date() }, useCount: { lt: 1 } },
  data:  { useCount: { increment: 1 }, status: 'EXPIRED' },
});
if (claimed.count === 0) throw new ShareLinkUnavailableError(); // → 409 SHARE_LINK_UNAVAILABLE
```

**Tests:** (Testcontainers, race-condition-critical) two concurrent redemption requests against the same single-use code — exactly one succeeds (`count===1`), the other gets `409 SHARE_LINK_UNAVAILABLE`; a coach already `ACTIVE` elsewhere is rejected.

**Commit:** `feat(share-links): implement redeem COACH_ACCEPT branch with single-use atomicity`

### Task 4.10: redeem — role-cannot-redeem branch + controller assembly

**Files:**
- Modify: `share-link-redemption.service.ts`, `share-links.controller.ts`

**Do:** Auth `role: TRAINER | SUPER_ADMIN` → `409 { errorCode: 'ROLE_CANNOT_REDEEM_SHARE_LINK' }`. Assemble the full `POST /share-links/:code/redeem` handler dispatching to all five branches (Tasks 4.6–4.10) by auth-state × `typ` × link-type, with Swagger docs covering every response shape. `@Public()` at guard level (auth read manually inside the handler).

**Tests:** a full branch-matrix test (auth state × `typ` × link type × expected branch) — this is the single highest-value test target per `fe §10`, build it thoroughly here even though the UI equivalent is a later frontend task.

**Commit:** `feat(share-links): assemble full POST /share-links/:code/redeem branch dispatch`

### Task 4.11: `POST /coaches/invite`

**Files:**
- Create: `apps/server/src/modules/coaches/coaches.module.ts`
- Create: `apps/server/src/modules/coaches/coaches.repository.ts`
- Create: `apps/server/src/modules/coaches/coach.service.ts`
- Create: `apps/server/src/modules/coaches/dto/invite-coach.dto.ts` (`{email, name?, message?}`)
- Create: `apps/server/src/modules/coaches/coaches.controller.ts`

**Do:** Trainer only, own tenant. Delegates to `ShareLinkService.generateCoachLink` (Task 4.2), enqueues `OutboxJob(EMAIL_COACH_INVITE)`. `@RequiresCapability(INVITE_COACH)`. Response `201 {shareLinkCode, expiresAt, status:'PENDING'}`.

**Tests:** invite generates a `COACH_UNIQUE` link with the invitee's `targetEmail`.

**Commit:** `feat(coaches): implement POST /coaches/invite`

### Task 4.12: `GET /trainers/:id/coaches`

**Files:**
- Modify: `coaches.controller.ts`, `coach.service.ts`, `coaches.repository.ts` (`listByTrainer`)
- Create: `apps/server/src/modules/coaches/dto/coach-roster-row.dto.ts`

**Do:** Derives `invitationStatus: 'Pending'|'Accepted'|'Expired'` from the underlying `ShareLink`/`CoachProfile.status`. `@RequiresCapability(VIEW_OWN_COACH_ROSTER)`; cross-tenant → `404`.

**Tests:** roster reflects pending vs. accepted vs. expired correctly; cross-tenant → `404`.

**Commit:** `feat(coaches): implement GET /trainers/:id/coaches`

### Task 4.13: `PATCH /coaches/:id`

**Files:**
- Create: `apps/server/src/modules/coaches/dto/update-coach.dto.ts` (all fields optional: `status?`, `bio?`, `credentials?`, `certifications?`, `publicProfile?`)
- Modify: `coaches.controller.ts`, `coach.service.ts`

**Do:** Dual-actor per `api §4.2`: owning `TRAINER` may only send `status`; the `COACH` themself may only send `bio/credentials/certifications/publicProfile`. Service rejects any field outside the caller's allowed set with `403 { errorCode: 'FIELD_NOT_ALLOWED_FOR_ROLE' }` rather than silently dropping it. `@RequiresCapability(MANAGE_COACH_PROFILE)`.

**Tests:** trainer sending `bio` → `403 FIELD_NOT_ALLOWED_FOR_ROLE`; coach sending `status` → same; each actor's allowed fields succeed.

**Commit:** `feat(coaches): implement PATCH /coaches/:id (dual-actor field restriction)`

### Task 4.14: `ShareLinkMaintenanceJob`

**Files:**
- Create: `apps/server/src/modules/share-links/share-link-maintenance.job.ts` (`@Cron` every 15 min — marks expired links)

**Tests:** an expired-but-still-`ACTIVE` link is marked `EXPIRED` by the job.

**Commit:** `feat(share-links): add ShareLinkMaintenanceJob (15-minute expiry sweep)`

### Task 4.15: Integration tests — ShareLink/coach tenant isolation & race conditions

**Files:**
- Extend: `apps/server/test/share-links.e2e-spec.ts`, `apps/server/test/coaches.e2e-spec.ts`

**Do:** Reuse the two-trainer fixture from Task 3.12. Assert: trainer B cannot see/revoke trainer A's share-links (`404`); trainer B cannot see trainer A's coach roster (`404`); the single-use race test from Task 4.9 is included here too if not already in that task's own suite.

**Commit:** `test(share-links): add tenant-isolation and single-use race integration coverage`

---

## Phase 5 — Player/Parent Features (profiles, children, Best Times, purchase approvals)

### Task 5.1: `POST /player-profiles`

**Files:**
- Create: `apps/server/src/modules/player-profiles/player-profiles.module.ts`
- Create: `apps/server/src/modules/player-profiles/player-profiles.repository.ts`
- Create: `apps/server/src/modules/player-profiles/player-profile.service.ts`
- Create: `apps/server/src/modules/player-profiles/dto/create-child-profile.dto.ts`
- Create: `apps/server/src/modules/player-profiles/player-profiles.controller.ts`

**Do:**
```ts
class CreateChildProfileDto {
  @IsString() @MaxLength(100) name: string;
  @IsDateString() dateOfBirth: string; // service derives age, validates 1–18
  @IsIn(['MALE','FEMALE','OTHER','PREFER_NOT_TO_SAY']) gender: string;
  @IsOptional() @IsString() @MaxLength(200) school?: string;
  @IsOptional() @IsUrl() photoUrl?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) trainerIds?: string[];
}
```
Child profiles only — self-profiles are created exclusively by `AccountProvisioningService` at registration time (Tasks 2.10/4.6), never through this endpoint. `@RequiresCapability(MANAGE_CHILD_PROFILES)` → `CHILD` tokens get `403 CHILD_CAPABILITY_DENIED` automatically via the deny-list. If `trainerIds` provided, create the associations in the same transaction. Duplicate-name/age is **non-blocking**: return `200`-with-`warning`, not `409` (FR-030).

**Tests:** age outside 1–18 → `400`; child token → `403 CHILD_CAPABILITY_DENIED`; providing `trainerIds` creates associations atomically with the profile; duplicate name/age produces a `warning` field, not an error status.

**Commit:** `feat(player-profiles): implement POST /player-profiles`

### Task 5.2: `GET /player-profiles`

**Files:**
- Modify: `player-profiles.controller.ts`, `player-profile.service.ts`, `player-profiles.repository.ts`

**Do:** Adult `PLAYER_PARENT`: self + all children. `typ: CHILD`: **only** that child's own profile (`childUserId = auth.userId`, never siblings/guardian — arch §9.2). Each entry includes `trainerCount` summary only, not full trainer objects.

**Tests:** a child session's list contains exactly one profile, never a sibling's.

**Commit:** `feat(player-profiles): implement GET /player-profiles`

### Task 5.3: `GET /player-profiles/:id`

**Files:**
- Modify: `player-profiles.controller.ts`, `player-profile.service.ts`

**Do:** Ownership-checked: adult owner, the child themself (`childUserId = caller`), or `SUPER_ADMIN`. Non-owner → `404` (not `403`).

**Tests:** cross-ownership read → `404`.

**Commit:** `feat(player-profiles): implement GET /player-profiles/:id`

### Task 5.4: `PATCH /player-profiles/:id`

**Files:**
- Create: `apps/server/src/modules/player-profiles/dto/update-player-profile.dto.ts` (`name, school, jerseyNumber, photoUrl, emergencyContact, allowChildTokenSpendWithoutApproval` — **not** `skillLevel`, trainer-set concept per Gap G-02, still open)
- Modify: `player-profiles.controller.ts`, `player-profile.service.ts`

**Do:** `allowChildTokenSpendWithoutApproval` is owning-adult-only, **never** the child, even on their own profile (it's a parental control) — same `403 CHILD_FIELD_NOT_EDITABLE` pattern as `PATCH /me` (Task 2.22).

**Tests:** child sending `allowChildTokenSpendWithoutApproval` → `403 CHILD_FIELD_NOT_EDITABLE`.

**Commit:** `feat(player-profiles): implement PATCH /player-profiles/:id`

### Task 5.5: `GET /player-profiles/:id/trainers`

**Files:**
- Modify: `player-profiles.controller.ts`, `player-profile.service.ts`

**Do:** `{trainerId, businessName, logoUrl, connectedAt, status}[]` — FR-032's per-child trainer list with dates.

**Commit:** `feat(player-profiles): implement GET /player-profiles/:id/trainers`

### Task 5.6: `player-profiles` anonymizer

**Files:**
- Create: `apps/server/src/modules/player-profiles/player-profiles.anonymizer.ts` (child names, school, jersey, emergencyContact)

**Commit:** `feat(player-profiles): add player-profiles module anonymizer`

### Task 5.7: `GET /me/contexts`

**Files:**
- Modify: `apps/server/src/modules/associations/associations.repository.ts`, create `associations.service.ts` (`PlayerTrainerAssociationService.listContextsForUser`)
- Create: `apps/server/src/modules/associations/dto/context-list-response.dto.ts`
- Create: `apps/server/src/modules/associations/associations.controller.ts`

**Do:**
```ts
class ContextEntryDto {
  playerProfileId: string; playerProfileName: string; isSelf: boolean;
  trainerId: string; trainerDisplayName: string; logoUrl: string | null; primaryColorHex: string | null;
  connectedAt: string;
}
class ContextListResponseDto { contexts: ContextEntryDto[]; }
```
Adult: every `(profile, trainer)` active pair grouped by profile. `typ: CHILD`: only that child's own list, no "Me"/parent section (FR-034).

**Tests:** child context list never includes a "Me" entry or sibling data.

**Commit:** `feat(associations): implement GET /me/contexts`

### Task 5.8: `POST /player-profiles/:id/trainers`

**Files:**
- Modify: `associations.controller.ts`, `associations.service.ts`

**Do:** Body `{shareLinkCode} | {trainerId}` (oneOf). `@RequiresCapability(MANAGE_TRAINER_ASSOCIATIONS)` → `CHILD` gets `403 CHILD_CAPABILITY_DENIED`. Idempotent per `(trainer, profile)`.

**Tests:** neither/both fields present → `400`; unknown code/trainer → `404`; already-associated → `200` with existing row, not `409`.

**Commit:** `feat(associations): implement POST /player-profiles/:id/trainers`

### Task 5.9: `DELETE /player-profiles/:id/trainers/:trainerId`

**Files:**
- Modify: `associations.controller.ts`, `associations.service.ts`

**Do:** Soft-delete-with-cascade unconditionally on call (client is expected to have already confirmed; no server-side confirmation step). `@RequiresCapability(MANAGE_TRAINER_ASSOCIATIONS)` → `CHILD` denied.

**Tests:** removal marks the association `INACTIVE`, immediately excludes the child from the trainer's roster query (Task 5.10).

**Commit:** `feat(associations): implement DELETE /player-profiles/:id/trainers/:trainerId`

### Task 5.10: `GET /trainers/:id/players`

**Files:**
- Modify: `associations.controller.ts`, `associations.service.ts` (`listRosterForTrainer`)
- Create: `apps/server/src/modules/associations/dto/roster-row.dto.ts`
- Create: `apps/server/src/modules/associations/availability-summary.formatter.ts` (produces `"Mon 5-8pm, Wed 6-9pm"` from a slot array — this exact formatting logic is duplicated client-side per `fe §5.4`/§11.7, so keep this function pure and well-named so the frontend engineer building Task 14.6 can port the same rule)

**Do:** Gap-fill (api §8.8). Query `?dayOfWeek?&startTime?&endTime?&limit&cursor`. `{playerProfileId, name, age, availabilitySummary}` only — **no notes/tags/pipeline** (arch §18, not full CRM). `@RequiresCapability(VIEW_PLAYER_AVAILABILITY)`.

**Tests:** cross-tenant → `404`; day/time filter narrows results correctly; `availabilitySummary` formatting matches the documented example format.

**Commit:** `feat(associations): implement GET /trainers/:id/players`

### Task 5.11: Player availability ("Best Times")

**Files:**
- Create: `apps/server/src/modules/availability/availability.module.ts`
- Create: `apps/server/src/modules/availability/availability.repository.ts`
- Create: `apps/server/src/modules/availability/availability.service.ts` (`setPlayerAvailability`, `getSummaryForPlayer`)
- Create: `apps/server/src/modules/availability/dto/availability-grid.dto.ts`
- Create: `apps/server/src/modules/availability/availability.controller.ts`

**Do:** `GET /player-profiles/:id/availability`: owner (adult self/child), the child themself, or any `TRAINER`/`COACH` with the player in their roster (association-based check, not header-based — `Availability` has no `trainerId` column, api §4.5's explicit design note). `PUT /player-profiles/:id/availability`: full replace (weekly grid semantics), body `{slots: [{dayOfWeek, startTime, endTime, isAvailable}]}`, `startTime`/`endTime` validated `0–1440`, `startTime < endTime`. `@RequiresCapability(VIEW_PLAYER_AVAILABILITY)` (GET) / `SET_OWN_AVAILABILITY` (PUT).

**Tests:** invalid range (`startTime >= endTime` or out of `0–1440`) → `400`; a trainer with the player on their roster can `GET` but not `PUT`; non-associated trainer → `404`.

**Commit:** `feat(availability): implement player availability GET/PUT ("Best Times")`

### Task 5.12: `child-approvals` module + `GET /approvals`

**Files:**
- Create: `apps/server/src/modules/child-approvals/child-approvals.module.ts`
- Create: `apps/server/src/modules/child-approvals/child-approvals.repository.ts`
- Create: `apps/server/src/modules/child-approvals/child-purchase-approval.service.ts` (`createRequest` — **internal method only**, no public endpoint creates approvals in Epic-01; it exists as the Epic-02 checkout forward-integration seam, INT-003. Add a small internal test/seed helper so this plan's own tests can create `PENDING` rows without a real checkout flow.)
- Create: `apps/server/src/modules/child-approvals/dto/approval-row.dto.ts`
- Create: `apps/server/src/modules/child-approvals/child-approvals.controller.ts`

**Do:** `GET /approvals`: parent's own children's requests only, query `?status?&limit&cursor`. `@RequiresCapability(APPROVE_CHILD_PURCHASE)` → `CHILD` gets `403 CHILD_CAPABILITY_DENIED` (api §0.7's resolved deny-list addition).

**Tests:** child session → `403`; parent sees only their own children's requests.

**Commit:** `feat(child-approvals): add module and implement GET /approvals`

### Task 5.13: `POST /approvals/:id/approve` + `/deny` + expiry sweep

**Files:**
- Modify: `child-approvals.controller.ts`, `child-purchase-approval.service.ts`
- Create: `apps/server/src/modules/child-approvals/approval-expiry.job.ts` (`@Cron` every 5 min)
- Create: `apps/server/src/shared/mail/templates/child-approval-decision.template.ts`

**Do:** Conditional `updateMany` on `status = 'PENDING'` (race-safe against the sweep, arch §9.3):
```ts
const result = await tx.childPurchaseApproval.updateMany({
  where: { id, status: 'PENDING' },
  data: { status: 'APPROVED', respondedAt: new Date(), parentNotes: dto.notes },
});
if (result.count === 0) throw new ConflictException(); // 409, already resolved/expired
```
`approve` emits `child-approval.approved` (no charge — Epic-05 subscribes later, G-09). `deny` notifies child via `OutboxJob(EMAIL_CHILD_APPROVAL_DECISION)`. `ApprovalExpiryJob`: auto-transitions `PENDING` rows past `expiresAt` to `EXPIRED` via the same conditional-update pattern, notifies both parties (FR-042).

**Tests:** (Testcontainers, race-critical) approving a row the expiry job has *just* expired in a concurrent transaction → `409 CONFLICT`, never a double-transition; the sweep itself correctly flips only past-due `PENDING` rows.

**Commit:** `feat(child-approvals): implement approve/deny with race-safe conditional updates and 5-minute expiry sweep`

### Task 5.14: Integration tests — player-profiles/associations/approvals

**Files:**
- Extend: `apps/server/test/player-profiles.e2e-spec.ts`, `apps/server/test/associations.e2e-spec.ts`, `apps/server/test/child-approvals.e2e-spec.ts`

**Do:** RBAC + tenant + child-capability sweep across all three modules using the fixtures established in Task 3.12; explicitly include the approve/deny-vs-expiry race test if not already covered by Task 5.13's own suite.

**Commit:** `test(player-profiles): add RBAC, tenant, and child-capability integration coverage`

---

## Phase 6 — Coach Features (My Times, conflict override)

### Task 6.1: Coach availability ("My Times")

**Files:**
- Modify: `apps/server/src/modules/availability/availability.service.ts` (`setCoachAvailability`), `availability.controller.ts`

**Do:** `GET /coaches/:id/availability` / `PUT /coaches/:id/availability`. Same DTO shapes as the player pair (Task 5.11). `PUT` restricted to the coach themself; `GET` open to the employing trainer too. `@RequiresCapability(VIEW_PLAYER_AVAILABILITY)` (GET, reused per api §4.5 footnote) / `SET_OWN_AVAILABILITY` (PUT).

**Tests:** non-owner `PUT` → `403`; employing trainer can `GET`.

**Commit:** `feat(availability): implement coach availability GET/PUT ("My Times")`

### Task 6.2: `GET /coaches/:id/availability/check`

**Files:**
- Create: `apps/server/src/modules/availability/conflict-check.service.ts`
- Modify: `availability.controller.ts`

**Do:** Gap-fill (api §8.9/§4.5). Query `?dayOfWeek&startTime&endTime` → `{hasConflict: boolean}`. `@RequiresCapability(OVERRIDE_COACH_CONFLICT)`, own tenant.

**Tests:** overlapping slot → `hasConflict: true`; non-owning trainer → `403`.

**Commit:** `feat(availability): implement GET /coaches/:id/availability/check`

### Task 6.3: `POST /coaches/:id/availability/override`

**Files:**
- Create: `apps/server/src/modules/availability/dto/create-override.dto.ts`
- Modify: `availability.controller.ts`, `availability.service.ts`
- Create: `apps/server/src/shared/mail/templates/coach-override-notify.template.ts`

**Do:**
```ts
class CreateOverrideDto {
  @IsUUID() eventId: string; // opaque, no DB FK — Epic-02 forward reference (G-09)
  @IsString() @IsNotEmpty() @MaxLength(500) reason: string;
}
```
Only the employing trainer. **Never blocks** — logs a decision already made (BR-012). Enqueues `OutboxJob(EMAIL_COACH_OVERRIDE_NOTIFY)` per Gap G-06's default (notify coach).

**Tests:** missing `reason` → `400`; non-owning trainer → `403`; success always `201`, never blocked by a conflict.

**Commit:** `feat(availability): implement POST /coaches/:id/availability/override`

### Task 6.4: `coaches` anonymizer

**Files:**
- Create: `apps/server/src/modules/coaches/coaches.anonymizer.ts` (bio/credentials)

**Commit:** `feat(coaches): add coaches module anonymizer`

### Task 6.5: Integration tests — coach availability & overrides

**Files:**
- Extend: `apps/server/test/availability.e2e-spec.ts`

**Do:** CRUD correctness for both subjects, override authorization + logging, cross-tenant isolation using the Task 3.12 fixture pattern.

**Commit:** `test(availability): add coach availability and override integration coverage`

---

## Phase 7 — Super Admin Tools: Impersonation

### Task 7.1: `POST /impersonation/start`

**Files:**
- Create: `apps/server/src/modules/impersonation/impersonation.module.ts`
- Create: `apps/server/src/modules/impersonation/impersonation.repository.ts`
- Create: `apps/server/src/modules/impersonation/impersonation.service.ts` (`start`, `assertNotTargetingSuperAdmin`)
- Create: `apps/server/src/modules/impersonation/dto/start-impersonation.dto.ts` (`{targetUserId: string}` — `@IsUUID()`)
- Create: `apps/server/src/modules/impersonation/dto/impersonation-start-response.dto.ts`
- Create: `apps/server/src/modules/impersonation/impersonation.controller.ts`
- Modify: `apps/server/src/modules/auth/token.service.ts` (add an `issueImpersonationToken()` variant carrying `act`)

**Do:** `@Roles(SUPER_ADMIN)` → `@RequiresCapability(IMPERSONATE_USER)` → `assertNotTargetingSuperAdmin(target)` returns `422 IMPERSONATION_TARGET_INVALID` (not `403` — FR-015, validation error not authz) → reject `403 IMPERSONATION_NOT_ALLOWED` if `AuthContext.impersonation` already set on the caller (blast-radius). Creates `ImpersonationLog`. Issues an access token with `sub/role = target`, `act = {sub: admin, role: 'SUPER_ADMIN', imp: logId}`, `exp = min(now+60m, ...)`. **No refresh token issued, admin's own refresh cookie is completely untouched.** `@Throttle({'impersonation':{}})`.

**Tests:** decode the returned token and assert the exact `act`-claim shape from `arch §6.2`; targeting a `SUPER_ADMIN` → `422`; already-impersonating caller → `403 IMPERSONATION_NOT_ALLOWED`; no `Set-Cookie` for `refreshToken` appears in the response.

**Commit:** `feat(impersonation): implement POST /impersonation/start`

### Task 7.2: `POST /impersonation/end`

**Files:**
- Modify: `impersonation.controller.ts`, `impersonation.service.ts`

**Do:** Called with the impersonation access token itself. Stamps `endedAt`/`durationSeconds`. `204`. Reachable only while `AuthContext.impersonation` is set — enforced in the service (the guard has no "must be impersonating" primitive, api §2 footnote).

**Tests:** ending a session stamps both fields; calling `/auth/refresh` afterward on the admin's untouched cookie returns the admin's own token with `sub`/`role`/`tv` unchanged — full round trip.

**Commit:** `feat(impersonation): implement POST /impersonation/end`

### Task 7.3: `GET /impersonation/history`

**Files:**
- Create: `apps/server/src/modules/impersonation/dto/impersonation-log-response.dto.ts`
- Modify: `impersonation.controller.ts`, `impersonation.service.ts`, `impersonation.repository.ts`

**Do:** `?limit&cursor&adminUserId?&targetUserId?&dateFrom?&dateTo?`, keyset paginated. Super Admin only.

**Commit:** `feat(impersonation): implement GET /impersonation/history`

### Task 7.4: `ImpersonationMaintenanceJob`

**Files:**
- Create: `apps/server/src/modules/impersonation/impersonation-maintenance.job.ts` (`@Cron` every 10 min — closes any `ImpersonationLog` past its 60-minute cap that never got an explicit `/end` call)

**Tests:** a stale open log (started >60 min ago, `endedAt: null`) gets closed by the job; a fresh one doesn't.

**Commit:** `feat(impersonation): add stale-session maintenance job (10-minute sweep)`

### Task 7.5: Blast-radius capability blocks — complete the wiring

**Files:**
- Modify: `apps/server/src/shared/security/guards/capabilities.guard.ts` (started as a stub in Task 2.6)

**Do:** While `AuthContext.impersonation` is present, `CapabilitiesGuard` denies `IMPERSONATE_USER`, `GDPR_DELETE_USER`, `CREATE_TRAINER_ACCOUNT` regardless of effective role, returning `403 IMPERSONATION_NOT_ALLOWED` (arch §10 "Blast radius").

**Tests:** with an impersonation token, `POST /impersonation/start`, `DELETE /users/:id`, `POST /trainers` all → `403 IMPERSONATION_NOT_ALLOWED` even though the effective role on the token is whatever the target's role is.

**Commit:** `feat(impersonation): complete blast-radius capability blocks in CapabilitiesGuard`

### Task 7.6: Integration tests — impersonation full round trip

**Files:**
- Create: `apps/server/test/impersonation.e2e-spec.ts`

**Do:** Full `start → do something as target → end → refresh → back to admin` sequence; every write made during the session is audit-stamped with both `actorUserId` (admin) and the effective identity (Task 1.7's extension, now exercised for real); blast-radius denial from Task 7.5; stale-session cron from Task 7.4.

**Commit:** `test(impersonation): add full round-trip and blast-radius integration coverage`

---

## Phase 8 — Portal Branding

### Task 8.1: `PATCH /trainers/:id/branding`

**Files:**
- Create: `apps/server/src/modules/trainers/portal-branding.service.ts`
- Create: `apps/server/src/modules/trainers/dto/update-branding.dto.ts`
- Modify: `trainers.controller.ts`

**Do:**
```ts
class UpdateBrandingDto {
  @IsOptional() @IsUrl() logoUrl?: string;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) primaryColorHex?: string;
  @IsOptional() @IsBoolean() resetToDefault?: boolean;
}
```
Computes and stores a WCAG-derived accessible palette alongside the raw hex at save time (both persisted in `derivedPaletteJson`). Returns a **non-blocking** `contrastWarning?: string` if the color fails AA against white/black text — **never rejects the PATCH outright** (OQ-7). `@RequiresCapability(MANAGE_PORTAL_BRANDING)`, own tenant.

**Tests:** a low-contrast hex still saves successfully and returns `contrastWarning`; a well-contrasted hex saves with no warning; `resetToDefault` clears branding fields.

**Commit:** `feat(trainers): implement PATCH /trainers/:id/branding`

### Task 8.2: Logo upload two-step + `MEDIA_LOGO_RESIZE` outbox handler

**Files:**
- Modify: `apps/server/src/shared/jobs/outbox.service.ts` (add the `MEDIA_LOGO_RESIZE` dispatch case, using `ImageProcessor` from Task 1.11)
- Create: `apps/server/src/shared/storage/dto/upload-logo-response.dto.ts`
- Modify: `apps/server/src/shared/storage/storage.module.ts` or a small controller under it, exposing the pre-upload step referenced by `api §4.1` ("`shared/storage` upload first, then this PATCH with the resulting URL")

**Do:** `sharp` resizes toward 200×200 via the outbox job so the `PATCH` itself returns fast (NFR-001) — the PATCH response carries the pre-resize URL immediately, the resized one lands after the job runs.

**Tests:** enqueuing `MEDIA_LOGO_RESIZE` and draining the outbox produces a resized asset via the storage adapter's local/test implementation.

**Commit:** `feat(storage): wire two-step logo upload with async resize via outbox`

### Task 8.3: Integration test — branding endpoint

**Files:**
- Extend: `apps/server/test/trainers.e2e-spec.ts`

**Do:** Non-owning trainer → `403`; contrast-warning behavior confirmed non-blocking end-to-end.

**Commit:** `test(trainers): add branding endpoint integration coverage`

---

## Phase 9 — Backend Hardening & Definition-of-Done Verification

### Task 9.1: Custom ESLint rule + boot-assertion regression test

**Files:**
- Create: `packages/eslint-config/rules/require-capability-decorator.mjs` (flags a controller method with no `@Public()`/`@RequiresCapability()` at lint time — catches the gap before boot even runs)
- Modify: `packages/eslint-config/nestjs.mjs` (register the rule, remove the Task 0.3 TODO comment)

**Do:** This is the lint-time half of arch §9.2's "convert an easy-to-forget convention into a build failure" — Task 2.8 already built the boot-time half.

**Tests:** an ESLint rule unit test (or a fixture file + `eslint --no-eslintrc -c ... fixture.ts` assertion) confirming the rule flags a bare controller method and passes a correctly-annotated one.

**Commit:** `feat(eslint-config): add lint rule enforcing @RequiresCapability on controller methods`

### Task 9.2: Outbox end-to-end DoD sweep

**Files:**
- Extend: `apps/server/test/outbox.e2e-spec.ts` (created in Task 1.12, extend now that real feature flows exist to generate jobs)

**Do:** Confirm, using real feature endpoints (not synthetic `enqueue()` calls): a rolled-back registration transaction (e.g. force a failure inside `POST /share-links/:code/redeem`'s anonymous branch) leaves **no** `OutboxJob` row; a committed one is drained by the in-process nudge in normal operation, and by the cron alone if the nudge path is disabled in the test; a re-run of the drain query is idempotent (no double-send).

**Commit:** `test(server): add end-to-end outbox durability sweep using real feature flows`

### Task 9.3: `SCHEDULER_ENABLED` + single-replica documentation verification

**Files:**
- Verify: `apps/server/src/shared/config/env.schema.ts` (Task 0.8 — confirm `SCHEDULER_ENABLED` is present and gates `ScheduleModule` in `shared/jobs/jobs.module.ts`, Task 1.12)
- Verify: `README.md` (Task 0.12 — confirm the single-replica warning is present and prominent, not buried)

**Do:** This task is a verification pass, not new code — if either check fails, fix it here rather than assuming it was done correctly earlier.

**Tests:** setting `SCHEDULER_ENABLED=false` in a test boot and asserting no `@Cron` handlers fire during the test window.

**Commit:** `test(server): verify SCHEDULER_ENABLED gates the scheduler and README documents single-replica constraint`

### Task 9.4: Tenant-isolation checklist sweep

**Files:**
- Audit: every `*.e2e-spec.ts` file touching a tenant-owned model (`TrainerProfile`, `CoachProfile`, `PlayerTrainerAssociation`, `ShareLink`, `CoachAvailabilityOverride`)

**Do:** Per `arch §8` Layer 3, this is a Definition-of-Done item, not optional: confirm every controller touching a tenant-owned model has a "trainer B → 404" test. Build a small checklist in the PR description (or a `docs/` note if the team wants a durable artifact) enumerating each controller and its isolation test's location. Fill any gap found.

**Commit:** `test(server): close any remaining tenant-isolation test gaps`

### Task 9.5: Swagger/OpenAPI finalization

**Files:**
- Modify: every controller (`@ApiTags`, `@ApiOperation`, `@ApiResponse` sweep for completeness)
- Modify: `apps/server/src/main.ts` (Swagger document title/description/version)

**Do:** Add `@ApiHeader({ name: 'X-Trainer-Context', required: false, ... })` at the **method** level on every endpoint marked "Required" in `api §0.3`'s per-endpoint buckets (never at controller level — requiredness varies within a controller). **Do not** generate a Bruno collection — `api §7` explicitly defers it as a follow-up, not a blocker, to avoid throwaway work against shapes that might still move.

**Commit:** `docs(server): finalize Swagger/OpenAPI documentation across all controllers`

---

## Phase 10 — Frontend Scaffold & Core State

### Task 10.1: Fonts + global design tokens (complete)

**Files:**
- Create: `apps/client/src/assets/fonts/` (Clash Display + General Sans font files — source from Fontshare, OFL license, per `fe §1.1`; **flag for the implementing engineer:** binary font files are not included in the specs and must be downloaded before this task can be finished as described)
- Modify: `apps/client/src/styles/globals.css` (`@font-face` declarations via `next/font/local`)
- Modify: `apps/client/app/layout.tsx` (apply font CSS vars to `<html>`)

**Do:** Both self-hosted — no runtime dependency on a font CDN (matters for `/join/[code]` and `/login` per `fe §1.1`). Add the `tabular-nums` numeric variant class for availability grids/countdowns.

**Commit:** `feat(client): add self-hosted Clash Display and General Sans fonts`

### Task 10.2: Tailwind extension completion

**Files:**
- Modify: `apps/client/tailwind.config.ts`

**Do:** Confirm `boxShadow` extensions (`card-soft`, `card-strong`, `button-primary`, `button-primary-hover` — the latter two interpolate `--brand-primary-rgb`) and `fontSize` scale (`hero-title` 30/38/700 … `eyebrow` 11/16/600 uppercase) are complete per `fe §1.1`/`1.3` — Task 0.6 only did spacing/radius/base colors.

**Commit:** `feat(client): complete Tailwind shadow and typography-scale extensions`

### Task 10.3: `color-transform.ts`

**Files:**
- Create: `apps/client/src/lib/branding/color-transform.ts` (`lightenColor`, `darkenColor`, `hexToRgb` — must produce numerically identical output to whatever the server's `derivedPalette` computation uses, since `BrandingProvider`, Task 10.10, falls back to this client-side when only a raw hex is available)

**Tests:** `color-transform.spec.ts` — known input/output pairs for each function.

**Commit:** `feat(client): add client-side color transform utilities`

### Task 10.4: `apiClient`

**Files:**
- Create: `apps/client/src/lib/api/apiClient.ts`

**Do:** Reproduce the interceptor from `fe §6.2` closely:
```ts
async function apiRequest(path, options) {
  const { accessToken } = useAuthStore.getState();
  const { activeTrainerId } = useTrainerContextStore.getState();
  const headers = {
    ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    ...(activeTrainerId && { 'X-Trainer-Context': activeTrainerId }),
    ...options.headers,
  };
  const res = await fetch(path, { ...options, headers, credentials: 'include' });
  if (res.status === 401 && !options._isRetry) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest(path, { ...options, _isRetry: true });
    useAuthStore.getState().clear();
    redirectToLogin();
    throw new SessionExpiredError();
  }
  return res;
}
```
One retry only. `X-CSRF-Token` handled by a separate, narrower helper used only by `refreshSession()`/`logout()`. Impersonation-token 401s short-circuit to the impersonation-exit sequence instead of calling `/auth/refresh` (checked via `useAuthStore.getState().isImpersonating` — this store field is added in Task 10.5).

**Tests:** `apiClient.spec.ts` — 401 triggers exactly one retry then hard-fails; `X-Trainer-Context` auto-attaches when a context is active and is absent otherwise; impersonation-token 401 does not call `/auth/refresh`.

**Commit:** `feat(client): implement apiClient interceptor (auth header, trainer context, single-retry 401)`

### Task 10.5: `useAuthStore`

**Files:**
- Create: `apps/client/src/stores/useAuthStore.ts`

**Do:** Zustand, **not** React Context (re-render granularity, `fe §6.1`), **never persisted** (no `zustand/persist` — this is the store that must never touch `localStorage`/`sessionStorage`). Shape: `{ accessToken: string | null, user: UserSummaryDto | null, expiresAt: number | null, isImpersonating: boolean, clear(): void }`.

**Tests:** `useAuthStore.spec.ts` — `clear()` resets to initial state; nothing is ever written to `window.localStorage`/`sessionStorage` (spy-based assertion).

**Commit:** `feat(client): add useAuthStore (in-memory only, never persisted)`

### Task 10.6: `useTrainerContextStore`

**Files:**
- Create: `apps/client/src/stores/useTrainerContextStore.ts`

**Do:** `{ activeTrainerId: string | null }`, backed by a non-httpOnly cookie for SSR-readability (`fe §6.3`). Selecting a context invalidates every trainer-scoped TanStack Query key.

**Commit:** `feat(client): add useTrainerContextStore with cookie sync`

### Task 10.7: TanStack Query provider

**Files:**
- Create: `apps/client/src/providers/QueryProvider.tsx`
- Create: `apps/client/src/providers/AppProviders.tsx` (composes `QueryProvider` + any others)

**Commit:** `feat(client): add TanStack Query provider`

### Task 10.8: Root layout — providers + boot sequence

**Files:**
- Modify: `apps/client/app/layout.tsx`

**Do:** Client component running once on mount, per `fe §6.1`:
```
1. Call POST /auth/refresh (cookie-only, no body) immediately.
     200 → populate useAuthStore, render authenticated tree.
     401 → useAuthStore stays null, render anonymous tree.
2. Until resolved, render a full-screen brand-neutral loading state (platform default accent).
```
Mount `AppProviders`, leave an `<ImpersonationBanner />` slot (component built in Task 16.1, render nothing until then — a placeholder `null` is fine now).

**Tests:** a Playwright/RTL test confirming the loading→resolved transition on both the 200 and 401 paths (whatever `test-generator`'s stack ends up being — flag the exact tool choice for that skill).

**Commit:** `feat(client): implement root layout boot sequence (refresh-on-mount)`

### Task 10.9: `RoleGuard` + shared skeleton primitives

**Files:**
- Create: `apps/client/src/components/RoleGuard.tsx` (parametrized by allowed role(s); redirects to `/login` if unauthenticated, to the caller's own dashboard if wrong role)
- Create: `apps/client/src/components/shared/Skeleton.tsx` (base primitives: row, card, grid-cell — per `fe §9.5` policy, reused by every later route-specific skeleton)

**Commit:** `feat(client): add RoleGuard and shared skeleton primitives`

### Task 10.10: `BrandingProvider`

**Files:**
- Create: `apps/client/src/lib/branding/BrandingProvider.tsx`

**Do:** Per `fe §8`. Does not fetch independently — consumes whatever branding block is already on the current bootstrap/preview response. If `derivedPalette` present, use it directly (server-authoritative). Otherwise recompute client-side via Task 10.3. Writes `--brand-primary`/`-soft`/`-deep`/`-rgb` onto a `data-branding` wrapper element, **not** `:root` (this is what lets `ContextSwitcher`, Task 14.1, cross-fade between two palettes in flight). Falls back to `default_logo.svg` when `logoUrl` is null.

**Tests:** `BrandingProvider.spec.tsx` — server-provided `derivedPalette` is used as-is; a raw-hex-only input triggers the client-side transform; CSS vars land on the wrapper element, not `document.documentElement`.

**Commit:** `feat(client): implement BrandingProvider`

---

## Phase 11 — Frontend Public/Auth Routes

### Task 11.1: `/login`

**Files:**
- Create: `apps/client/app/(public)/login/page.tsx`
- Create: `apps/client/src/components/auth/LoginForm.tsx`
- Create: `apps/client/src/components/auth/RateLimitNotice.tsx`
- Create: `apps/client/src/lib/schemas/loginSchema.ts` (mirrors `LoginDto`: email valid/max255, password non-empty — no strength check at login time)

**Do:** On `mustChangePassword: true` in the response, redirect to `/change-password` before touching any role dashboard. `401 ACCOUNT_INACTIVE` renders FR-013's exact copy ("Account deactivated. Contact support.") — the one place the client is allowed to branch UI text on `errorCode` (`fe §4.1`).

**Tests:** component test — `mustChangePassword` redirect fires before dashboard render; `ACCOUNT_INACTIVE` renders the exact mandated copy, not the generic invalid-credentials text.

**Commit:** `feat(client): implement /login page`

### Task 11.2: `/forgot-password`

**Files:**
- Create: `apps/client/app/(public)/forgot-password/page.tsx`
- Create: `apps/client/src/components/auth/ForgotPasswordForm.tsx`

**Do:** Always renders the same success state regardless of response content — **must not** try to be "helpful" by differentiating (that reintroduces the server's just-closed enumeration leak, `fe §4.1`).

**Commit:** `feat(client): implement /forgot-password page`

### Task 11.3: `/reset-password`

**Files:**
- Create: `apps/client/app/(public)/reset-password/page.tsx`
- Create: `apps/client/src/components/auth/ResetPasswordForm.tsx`
- Create: `apps/client/src/lib/schemas/resetPasswordSchema.ts` (min 8, `PASSWORD_POLICY` regex)

**Do:** `?token=` query param. `404`/`410` → distinct copy ("This link is invalid or has expired") linking back to `/forgot-password`.

**Commit:** `feat(client): implement /reset-password page`

### Task 11.4: `/verify-email`

**Files:**
- Create: `apps/client/app/(public)/verify-email/page.tsx`
- Create: `apps/client/src/components/auth/VerifyEmailStatus.tsx`

**Do:** `?token=`. Landing confirmation only, never a gate. Resend action lives on the persistent banner (Task 18.2), not here.

**Commit:** `feat(client): implement /verify-email page`

### Task 11.5: `/register` (trainer setup completion)

**Files:**
- Create: `apps/client/app/(public)/register/page.tsx`
- Create: `apps/client/src/components/auth/TrainerSetupForm.tsx`
- Create: `apps/client/src/lib/schemas/completeTrainerSetupSchema.ts`

**Do:** `?token=`. **Not public self-registration** — single-purpose setup-link completion. Same `404`/`410` handling as reset-password. Success auto-logs-in (cookies already set by server, populate `useAuthStore` from the response).

**Commit:** `feat(client): implement /register (trainer setup) page`

### Task 11.6: `/change-password` (forced landing)

**Files:**
- Create: `apps/client/app/(force-password-change)/change-password/page.tsx`
- Create: `apps/client/src/components/auth/ChangePasswordForm.tsx`
- Create: `apps/client/src/lib/schemas/changePasswordSchema.ts`

**Do:** Dual-mode component (also reused from `/account/profile`, Task 18.1). `currentPassword` field rendered **only** when `mustChangePassword` is `false` — omitted entirely on the forced path, not shown-and-ignored.

**Commit:** `feat(client): implement /change-password page`

### Task 11.7: `/join/[code]` — stage 1 (preview + invalid states)

**Files:**
- Create: `apps/client/app/(public)/join/[code]/page.tsx`
- Create: `apps/client/src/components/share-link/ShareLinkDispatcher.tsx` (state machine shell: `pending → previewed → {branch} → submitting → {resolved|race-retry}`)
- Create: `apps/client/src/components/share-link/ShareLinkPreview.tsx`
- Create: `apps/client/src/components/share-link/ShareLinkInvalidCard.tsx`

**Do:** On mount: `GET /share-links/:code` (always `200`, **never** treat it as a Next.js not-found boundary — `fe §9.3`). `valid:false` → `ShareLinkInvalidCard` branching copy on `reason` (`NOT_FOUND`/`EXPIRED`/`EXHAUSTED`/`REVOKED`, exact copy from `fe §4.2`). `valid:true` → `ShareLinkPreview` (applies the trainer's accent via `BrandingProvider` to the join page itself, pre-auth).

**Tests:** each `reason` value renders its distinct copy; a network-level failure is treated as data, not thrown as an exception boundary.

**Commit:** `feat(client): implement /join/[code] stage 1 (preview and invalid states)`

### Task 11.8: `/join/[code]` — `AnonymousJoinForm`

**Files:**
- Create: `apps/client/src/components/share-link/AnonymousJoinForm.tsx`
- Create: `apps/client/src/lib/schemas/anonymousJoinSchema.ts` (`email, password (setup-strength), phone, playerName, dateOfBirth (age-derived 1–18), gender, isSelf`)

**Do:** Rendered for no-access-token + `type=PLAYER_STATIC|COACH_UNIQUE`. Builds the `ANONYMOUS_REGISTRATION`/anonymous-`COACH_ACCEPT` body on submit (submit wiring completed in Task 11.10).

**Commit:** `feat(client): implement AnonymousJoinForm`

### Task 11.9: `/join/[code]` — remaining branch components

**Files:**
- Create: `apps/client/src/components/share-link/FamilyPickerForm.tsx` ("Who will train with {trainerDisplayName}?" — Me + each child checklist, FR-021)
- Create: `apps/client/src/components/share-link/ChildBlockedNotice.tsx` (renders **without calling redeem** — the client pre-empts the known `403`, server still enforces it independently)
- Create: `apps/client/src/components/share-link/CoachAcceptForm.tsx` (no password field — already authenticated)
- Create: `apps/client/src/components/share-link/RoleCannotJoinNotice.tsx` (renders without calling redeem, same pre-emption pattern)

**Commit:** `feat(client): implement remaining /join/[code] branch components`

### Task 11.10: `/join/[code]` — submit wiring + race-condition handling

**Files:**
- Modify: `ShareLinkDispatcher.tsx`

**Do:** On submit, `POST /share-links/:code/redeem` with the branch-specific body. Route every response per `fe §4.2`'s table: auth-session responses → populate `useAuthStore`, redirect to `/dashboard`; `ASSOCIATE_EXISTING`/`COACH_ACCEPT` (authed) → toast + redirect; `409 SHARE_LINK_UNAVAILABLE` → **re-fetch stage 1's `GET`** to pick up the now-`EXHAUSTED` reason and re-render `ShareLinkInvalidCard`, not a raw error toast; pre-empted branches (`CHILD_SHARE_LINK_BLOCKED`, `ROLE_CANNOT_REDEEM_SHARE_LINK`) exist as server-is-source-of-truth fallbacks only.

**Tests:** the branch-matrix component test named in `fe §10` — auth-state × link-type × server-outcome — belongs here or as its own file referenced by this task; build the fixture matrix now even if the full assertion set is finished in Task 18.6.

**Commit:** `feat(client): wire /join/[code] submit handling and race-condition recovery`

---

## Phase 12 — Frontend Super Admin: User Management

### Task 12.1: `(super-admin)` layout

**Files:**
- Create: `apps/client/app/(super-admin)/layout.tsx`

**Do:** `RoleGuard(SUPER_ADMIN)`, SA nav shell (Users, Impersonation History links).

**Commit:** `feat(client): implement Super Admin layout shell`

### Task 12.2: `/dashboard` (Super Admin)

**Files:**
- Create: `apps/client/app/(super-admin)/dashboard/page.tsx`
- Create: `apps/client/src/components/super-admin/SuperAdminDashboardShell.tsx`

**Do:** Deliberately sparse — `GET /me/bootstrap`'s `SUPER_ADMIN` shape has no stats block in Epic-01 (api §5). Quick links into Users / Impersonation History only.

**Commit:** `feat(client): implement Super Admin /dashboard page`

### Task 12.3: `/users` directory

**Files:**
- Create: `apps/client/app/(super-admin)/users/page.tsx`
- Create: `apps/client/src/components/super-admin/UsersTable.tsx` (virtualized for the 10k-row NFR-002 target)
- Create: `apps/client/src/components/super-admin/UserFilters.tsx`

**Do:** `GET /users` via `useInfiniteQuery`, `getNextPageParam` reading `nextCursor`/`hasMore` directly — no client-side offset math anywhere.

**Commit:** `feat(client): implement /users directory page`

### Task 12.4: `CreateTrainerModal`

**Files:**
- Create: `apps/client/src/components/super-admin/CreateTrainerModal.tsx`
- Create: `apps/client/src/lib/schemas/createTrainerSchema.ts` (`businessName` max200, `firstName` max100, `lastName` max100, `email` valid, `phone` E.164-ish)

**Do:** Posts `CreateTrainerDto {businessName, firstName, lastName, email, phone}` — the resolved two-name-field shape (`fe §11.1`), not a single "Trainer Name" input.

**Commit:** `feat(client): implement CreateTrainerModal`

### Task 12.5: `/users/[id]` detail

**Files:**
- Create: `apps/client/app/(super-admin)/users/[id]/page.tsx`
- Create: `apps/client/src/components/super-admin/UserDetailForm.tsx`
- Create: `apps/client/src/components/super-admin/DeactivateConfirmModal.tsx`
- Create: `apps/client/src/components/super-admin/GdprDeleteConfirmModal.tsx` (two-step, typed-confirmation input — this is a destructive/irreversible action per `fe §9.4`, never optimistic, blocking spinner on confirm)

**Commit:** `feat(client): implement /users/[id] detail page`

### Task 12.6: `ImpersonateConfirmModal`

**Files:**
- Create: `apps/client/src/components/super-admin/ImpersonateConfirmModal.tsx`

**Do:** Entry point only — calls `POST /impersonation/start` and populates `useAuthStore`/`isImpersonating`. The visible banner and countdown are Task 16.1; wire the connection between them in Task 16.3.

**Commit:** `feat(client): implement ImpersonateConfirmModal`

---

## Phase 13 — Frontend ShareLink Invitations UI: Trainer Coaches & Share-Links Pages

### Task 13.1: `(trainer)` layout

**Files:**
- Create: `apps/client/app/(trainer)/layout.tsx`

**Do:** `RoleGuard(TRAINER)`, nav shell, `BrandingProvider` reads own `trainerProfile` from bootstrap.

**Commit:** `feat(client): implement Trainer layout shell`

### Task 13.2: `/coaches`

**Files:**
- Create: `apps/client/app/(trainer)/coaches/page.tsx`
- Create: `apps/client/src/components/trainer/CoachRosterTable.tsx`
- Create: `apps/client/src/components/trainer/InviteCoachModal.tsx`
- Create: `apps/client/src/components/trainer/CoachStatusBadge.tsx` (Pending/Accepted/Expired)

**Do:** `GET /trainers/:id/coaches` + invite form (`POST /coaches/invite`) + `PATCH /coaches/:id` (status) + resend-on-expiry action.

**Commit:** `feat(client): implement /coaches page`

### Task 13.3: `/share-links`

**Files:**
- Create: `apps/client/app/(trainer)/share-links/page.tsx`
- Create: `apps/client/src/components/trainer/ShareLinkTable.tsx`
- Create: `apps/client/src/components/trainer/GenerateShareLinkModal.tsx`
- Create: `apps/client/src/lib/schemas/createShareLinkSchema.ts` (type enum + conditionally-required `targetEmail` via `.superRefine`)
- Create: `apps/client/src/components/trainer/RevokeConfirmPopover.tsx`

**Do:** ShareLink revoke is a low-stakes, easily-reversible-in-effect (row fades, rolls back on failure) action — **optimistic** UI per `fe §9.4`.

**Commit:** `feat(client): implement /share-links page`

### Task 13.4: `/dashboard` (Trainer)

**Files:**
- Create: `apps/client/app/(trainer)/dashboard/page.tsx`
- Create: `apps/client/src/components/trainer/TrainerDashboardShell.tsx`

**Do:** `GET /me/bootstrap` `TRAINER` shape — branding preview, `coachCount`/`activePlayerCount` stat tiles, quick links.

**Commit:** `feat(client): implement Trainer /dashboard page`

---

## Phase 14 — Frontend Player/Parent Features

### Task 14.1: `(player)` layout + `ContextSwitcher`

**Files:**
- Create: `apps/client/app/(player)/layout.tsx`
- Create: `apps/client/src/components/player/ContextSwitcher.tsx`

**Do:** `RoleGuard(PLAYER_PARENT)`, mounts `ContextSwitcher`. Renders the exact three documented formats from `fe §5.2`/spec `§US-01.04` chosen by `accountType` + presence of an `isSelf: true` context. Selecting a context writes to `useTrainerContextStore` (Zustand + cookie), triggers the accent cross-fade (180ms, per `fe §1.3`), and re-validates server-side on the next request (`403 TENANT_CONTEXT_INVALID` → forced `/me/contexts` refetch + toast, not silent retry).

**Tests:** each of the three format variants renders correctly for its input shape; selecting a context invalidates every trainer-scoped query key.

**Commit:** `feat(client): implement Player/Parent layout and ContextSwitcher`

### Task 14.2: `/dashboard` (Player/Parent)

**Files:**
- Create: `apps/client/app/(player)/dashboard/page.tsx`
- Create: `apps/client/src/components/player/PlayerDashboardShell.tsx`

**Do:** Adult shape shows `pendingApprovalsCount` tile linking to `/approvals`; child shape has no such tile (deny-listed field).

**Commit:** `feat(client): implement Player/Parent /dashboard page`

### Task 14.3: `/profiles`

**Files:**
- Create: `apps/client/app/(player)/profiles/page.tsx`
- Create: `apps/client/src/components/player/ProfileCardGrid.tsx`
- Create: `apps/client/src/components/player/ChildProfileForm.tsx`
- Create: `apps/client/src/lib/schemas/createChildProfileSchema.ts` (name max100, dateOfBirth ISO + client age-derivation 1–18, non-blocking duplicate warning surfaced from the `200{warning}` response, not a zod rule)

**Commit:** `feat(client): implement /profiles page`

### Task 14.4: `/profiles/[id]`

**Files:**
- Create: `apps/client/app/(player)/profiles/[id]/page.tsx`
- Create: `apps/client/src/components/player/ProfileEditForm.tsx`
- Create: `apps/client/src/components/player/TrainerAssociationList.tsx`

**Commit:** `feat(client): implement /profiles/[id] page`

### Task 14.5: `AddTrainerModal` + `RemoveTrainerConfirmModal`

**Files:**
- Create: `apps/client/src/components/player/AddTrainerModal.tsx` (manual code entry vs. "My Trainers" picker, FR-032 option A/B)
- Create: `apps/client/src/components/player/RemoveTrainerConfirmModal.tsx` ("This will cancel all upcoming RSVPs" — destructive, never optimistic)

**Commit:** `feat(client): implement AddTrainerModal and RemoveTrainerConfirmModal`

### Task 14.6: `AvailabilityGrid` (shared component)

**Files:**
- Create: `apps/client/src/components/shared/AvailabilityGrid.tsx`
- Create: `apps/client/src/lib/formatting/availability-summary.formatter.ts` (**must produce identical output to the server's `RosterRowDto.availabilitySummary` formatter from Task 5.10** — port the same rule, don't reinvent it; `fe §5.4`/§11.7 flags this duplication explicitly as a drift risk to watch)

**Do:** One component, two subjects (`player`|`coach`), two modes (`view`|`edit`). `startTime`/`endTime` are minutes-from-midnight on the wire; the component converts to/from a human `HH:mm` picker **only at the edit boundary** — no timezone conversion anywhere (matches OQ-5's trainer-local-wall-clock design). Edit mode: add/remove per-day time-range rows, `startTime < endTime` validated client-side before submit.

**Tests:** `AvailabilityGrid.spec.tsx` — round-trips minutes-from-midnight through the `HH:mm` picker without drift; view mode's summary string matches `availability-summary.formatter.ts`'s output for a given slot array.

**Commit:** `feat(client): implement shared AvailabilityGrid component`

### Task 14.7: `/profiles/[id]/availability`

**Files:**
- Create: `apps/client/app/(player)/profiles/[id]/availability/page.tsx`

**Do:** `<AvailabilityGrid mode="edit" subject="player">`.

**Commit:** `feat(client): implement /profiles/[id]/availability page`

### Task 14.8: `/approvals`

**Files:**
- Create: `apps/client/app/(player)/approvals/page.tsx`
- Create: `apps/client/src/components/player/PendingApprovalsList.tsx`
- Create: `apps/client/src/components/player/ApprovalCard.tsx` (per-status rendering table from `fe §9.1`: `PENDING` live countdown with `--warning`/`--danger` thresholds at 6h/1h remaining; `APPROVED`/`DENIED` static; `EXPIRED` distinct muted treatment, not styled like an active denial)
- Create: `apps/client/src/components/player/ApprovalDecisionModal.tsx`

**Do:** Adult parent only — nav item hidden for `CHILD`, and the layout's `RoleGuard` redirects on the `403 CHILD_CAPABILITY_DENIED` fallback if hit directly. Empty state is not a bare "no results" (`fe §9.1`'s specific copy). A `409 CONFLICT` on approve/deny (expiry sweep won the race) re-fetches the single approval and re-renders as `EXPIRED` with a toast, not a raw conflict error.

**Commit:** `feat(client): implement /approvals page`

### Task 14.9: `/players` (Trainer-side Best Times viewing)

**Files:**
- Create: `apps/client/app/(trainer)/players/page.tsx`
- Create: `apps/client/src/components/trainer/PlayerRosterTable.tsx`
- Create: `apps/client/src/components/trainer/AvailabilityFilterBar.tsx`

**Do:** `GET /trainers/:id/players` (`?dayOfWeek&startTime&endTime`). Explicitly the FR-070 narrow slice — `{player, age, availabilitySummary}` only, **no notes/tags/pipeline**.

**Commit:** `feat(client): implement /players page (trainer roster viewing)`

---

## Phase 15 — Frontend Coach Features

### Task 15.1: `(coach)` layout

**Files:**
- Create: `apps/client/app/(coach)/layout.tsx`

**Do:** `RoleGuard(COACH)`.

**Commit:** `feat(client): implement Coach layout shell`

### Task 15.2: `/dashboard` (Coach)

**Files:**
- Create: `apps/client/app/(coach)/dashboard/page.tsx`
- Create: `apps/client/src/components/coach/CoachDashboardShell.tsx`

**Do:** Employing trainer card, `availabilitySet` prompt if `false`.

**Commit:** `feat(client): implement Coach /dashboard page`

### Task 15.3: `/my-times`

**Files:**
- Create: `apps/client/app/(coach)/my-times/page.tsx`

**Do:** `<AvailabilityGrid mode="edit" subject="coach">` (Task 14.6's component, second consumer).

**Commit:** `feat(client): implement /my-times page`

### Task 15.4: `/profile` (Coach)

**Files:**
- Create: `apps/client/app/(coach)/profile/page.tsx`
- Create: `apps/client/src/components/coach/CoachProfileForm.tsx` (bio, credentials, certifications, `publicProfile` toggle)

**Commit:** `feat(client): implement Coach /profile page`

---

## Phase 16 — Frontend Super Admin Tools: Impersonation

### Task 16.1: `ImpersonationBanner`

**Files:**
- Create: `apps/client/src/components/shared/ImpersonationBanner.tsx`
- Modify: `apps/client/app/layout.tsx` (mount it in the root layout slot left in Task 10.8)

**Do:** Mounted at the **root** layout, not a role layout — a Super Admin impersonating a Trainer renders inside the trainer's own role layout, so the banner must sit above the whole subtree (`fe §5.1`). State derived from the presence of an `act` claim in the decoded in-memory access token — **never** a separate fetch; decoding is a pure display-only read, never trusted for authorization. Always the fixed `--danger`/amber pairing, **never** tenant-colored. Three-state countdown: `>5min` normal, `≤5min` `--warning` pulse + "Session ending soon", `0` auto-triggers the exit sequence (discard token → best-effort `POST /impersonation/end` → `POST /auth/refresh` on the untouched admin cookie → re-render as admin) with no modal, no user action required.

**Tests:** `ImpersonationBanner.spec.tsx` — the three countdown states render correctly at their thresholds; auto-exit at `0` calls the three-step sequence in order even if `/impersonation/end` itself 401s (expected per api §2, client proceeds to refresh regardless).

**Commit:** `feat(client): implement ImpersonationBanner with 3-state countdown and auto-exit`

### Task 16.2: `/impersonation-history`

**Files:**
- Create: `apps/client/app/(super-admin)/impersonation-history/page.tsx`
- Create: `apps/client/src/components/super-admin/ImpersonationHistoryTable.tsx`
- Create: `apps/client/src/components/super-admin/HistoryFilters.tsx` (admin/target/date range)

**Commit:** `feat(client): implement /impersonation-history page`

### Task 16.3: Wire start → banner → exit end-to-end

**Files:**
- Modify: `ImpersonateConfirmModal.tsx` (Task 12.6), `ImpersonationBanner.tsx`

**Do:** Confirm the full loop: modal confirm → `POST /impersonation/start` → `useAuthStore` updated with `isImpersonating: true` → banner appears immediately (no extra fetch) → manual "Exit Impersonation" click runs the same 3-step sequence as the auto-exit path.

**Tests:** an integration-style RTL test covering the whole loop, not just the two halves in isolation.

**Commit:** `feat(client): wire impersonation start-to-exit flow end-to-end`

---

## Phase 17 — Frontend Portal Branding

### Task 17.1: `/branding` (Trainer)

**Files:**
- Create: `apps/client/app/(trainer)/branding/page.tsx`
- Create: `apps/client/src/components/trainer/LogoUploadField.tsx` (processing placeholder while `MEDIA_LOGO_RESIZE` runs, per NFR-001-compliant fast PATCH return)
- Create: `apps/client/src/components/trainer/ColorPicker.tsx` (native color input + hex text field kept in sync)
- Create: `apps/client/src/components/trainer/BrandingLivePreview.tsx` (miniature nav bar + primary button using the in-progress hex, pre-save)
- Create: `apps/client/src/lib/schemas/updateBrandingSchema.ts` (hex regex identical to server's `@Matches`)

**Commit:** `feat(client): implement /branding page`

### Task 17.2: `ContrastWarningBanner`

**Files:**
- Create: `apps/client/src/components/trainer/ContrastWarningBanner.tsx`

**Do:** Dismissible, non-blocking, rendered directly under the picker after a `PATCH` response carries `contrastWarning`. Save has already succeeded by the time this can appear — advisory only, matches the server's non-blocking design exactly (no added client-side pre-save gate, per resolved `fe §11.4`).

**Commit:** `feat(client): implement ContrastWarningBanner`

---

## Phase 18 — Frontend Shared Routes & Cross-Cutting Polish

### Task 18.1: `/account/profile`

**Files:**
- Create: `apps/client/app/(shared)/account/profile/page.tsx`
- Modify: `apps/client/src/components/player/ProfileEditForm.tsx` (reused here — confirm it's role-aware per `fe §7.2`, not player-specific despite living under `player/` — move to `src/components/shared/` if that's cleaner once both consumers exist)
- Create: `apps/client/src/components/shared/ChangePasswordLink.tsx`

**Do:** `ProfileEditForm` conditionally omits `firstName`/`lastName`/`phone` for a `CHILD` `accountType`, showing only `photoUrl`/`notificationPrefs` — rendering fewer fields, not rendering-all-and-rejecting-on-submit (`fe §7.2`).

**Commit:** `feat(client): implement /account/profile page`

### Task 18.2: `EmailVerifiedBanner`

**Files:**
- Create: `apps/client/src/components/shared/EmailVerifiedBanner.tsx`
- Modify: `apps/client/app/layout.tsx` (mount at root, every authenticated route)

**Do:** Persistent, dismissible, session-scoped dismissal (reappears next login if still unverified). Shown whenever `GET /me`'s `emailVerified: false`. Resend button disabled with a `Retry-After`-driven countdown after `429`. Never a modal, never blocks navigation.

**Commit:** `feat(client): implement EmailVerifiedBanner`

### Task 18.3: Global error boundary + toast system

**Files:**
- Create: `apps/client/src/components/shared/ErrorBoundary.tsx`
- Create: `apps/client/src/lib/toast/toast.ts` (thin wrapper — pick any lightweight toast lib, or hand-roll one; keep the API small: `toast.success/error/info`)

**Do:** Implement the cross-cutting state table from `fe §9.4` exactly: 401-mid-session handled inside `apiRequest` already (Task 10.4), UI never shows a raw 401; `429` → disable submit + `Retry-After` countdown; `403 TENANT_CONTEXT_INVALID` → forced context refetch + toast (wired already in Task 14.1, confirm here); `500 TENANT_SCOPE_VIOLATION` → generic "Something went wrong" boundary, deliberately not explained; `403 CHILD_CAPABILITY_DENIED`/`CHILD_FIELD_NOT_EDITABLE` reaching the client anyway → generic toast + client error-monitor log (should never happen in steady state — treat as a bug signal, not a normal path).

**Commit:** `feat(client): implement global error boundary and cross-cutting toast handling`

### Task 18.4: Route-specific skeleton states

**Files:**
- Create: skeleton variants per major route built in Phases 12–17 (table skeletons for `UsersTable`/`CoachRosterTable`/`ShareLinkTable`/`PlayerRosterTable`; grid-cell skeleton for `AvailabilityGrid`; card skeletons for `ProfileCardGrid`/`PendingApprovalsList`)

**Do:** Built once per route's actual shape (`fe §9.5`), reusing the primitives from Task 10.9 — not a single generic shimmer block reused everywhere.

**Commit:** `feat(client): add route-specific skeleton loading states`

### Task 18.5: Motion polish

**Files:**
- Modify: `ContextSwitcher.tsx` (confirm the 180ms cross-fade, spring-eased per `fe §1.3`)
- Modify: `ImpersonationBanner.tsx` (confirm 240ms slide in/out)
- Modify: shared `Button` component (confirm `-translate-y-1 scale-1.02` hover, spring `stiffness:400 damping:28`)
- Modify: `/login`, `/join/[code]` (confirm the one-time staggered boot reveal — logo → headline → form, 60ms stagger, 220ms ease-out — and confirm **no** such reveal exists on any authenticated dashboard route, which renders instantly with skeletons instead)

**Do:** This is a verification/completion pass on motion details that earlier tasks may have stubbed — not new functional surface.

**Commit:** `feat(client): finalize motion polish per design system §1.3`

### Task 18.6: Component & store test completion

**Files:**
- Extend: `ShareLinkDispatcher.spec.tsx` (Task 11.10's branch-matrix — confirm full coverage: auth-state × link-type × server-outcome)
- Create: `useAuthStore.boot.spec.ts` (refresh success/failure paths)
- Create: `apiClient.retry.spec.ts` (single-retry-then-hard-fail, extending Task 10.4's basic coverage)
- Extend: `ImpersonationBanner.spec.tsx` (Task 16.1 — confirm all 3 countdown-state transitions are covered, not just rendered snapshots)

**Do:** Per `fe §10`, these four are named as the highest-value frontend test targets in this app — this task is the final consolidation pass confirming none of them were left partially covered by their originating task.

**Commit:** `test(client): consolidate component and store test coverage`

---

## Total task count

| Phase | Tasks |
|---|---|
| 0 — Monorepo & Tooling Scaffold | 13 |
| 1 — Data Model Foundation | 12 |
| 2 — Core Authentication & Authorization | 23 |
| 3 — User Management Basics | 12 |
| 4 — ShareLink Invitation System | 15 |
| 5 — Player/Parent Features | 14 |
| 6 — Coach Features | 5 |
| 7 — Super Admin Tools: Impersonation | 6 |
| 8 — Portal Branding (backend) | 3 |
| 9 — Backend Hardening & DoD | 5 |
| 10 — Frontend Scaffold & Core State | 10 |
| 11 — Frontend Public/Auth Routes | 10 |
| 12 — Frontend Super Admin: User Mgmt | 6 |
| 13 — Frontend ShareLink UI (Trainer) | 4 |
| 14 — Frontend Player/Parent Features | 9 |
| 15 — Frontend Coach Features | 4 |
| 16 — Frontend Super Admin: Impersonation | 3 |
| 17 — Frontend Portal Branding | 2 |
| 18 — Frontend Shared & Polish | 6 |
| **Total** | **162** |

---

## Execution Handoff

**1. Execute Now** — Use `/coder` (backend phases) and `/coder-frontend` (frontend phases) to implement in the current workspace, one task per commit, in order.

**2. Isolated Workspace** — Use `/git-worktrees` to create an isolated workspace first, then implement.

**Which approach?**
