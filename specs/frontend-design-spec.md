# Frontend Design: PracticePerfect

Pages, components, and client-side state management for `apps/client`. Entry point is [MANIFEST.md](./MANIFEST.md).

**Depends on:** `architect-architecture.md`, `api-designer-spec.md`
**Consumed by:** `docs-generator-implementation.md`, `writing-plans`

> **Scope note:** this spec covers Epic-01 only (auth, RBAC, ShareLink onboarding, multi-trainer contexts, coach availability, Super Admin tools, portal branding). Epic-02+ surfaces (events, calendar, payments) are out of scope; the only Epic-02 awareness this UI needs is treating `eventId` as an opaque, non-navigable string wherever it appears (`ChildPurchaseApproval`, `CoachAvailabilityOverride`) — never render it as a link, per architecture §18.

---

### [TASK-001] Epic-01 — Frontend Design (2026-09-22)

**Inputs:** `architect-architecture.md` (lean/single-instance amendment, §6 auth, §8 tenancy, §10 impersonation), `api-designer-spec.md` (10 controllers, ~45 endpoints, §0 shared conventions, §8 open items), `tasks/TASK-001/requirements-analyst-requirements.md` (~20 route inventory, gap log), `Task/Epics/Epic-01_User_Management_Authentication_SPEC.md` §11 (mockup list) and §US-01.04 (context-selector formats), `Task/designs/DESIGN_TOKENS.md` + source SVGs (`buttons.svg`, `inputs.svg`, `text.svg`, `form_control_element.svg`, `event_builder.svg`, `default_logo.svg`, `color_transformation_example{1,2}.svg`).

**Stack:** Next.js (App Router) + React + TypeScript + Tailwind CSS, in `apps/client`. Per architecture §1: `apps/client` never talks to PostgreSQL; every read/write goes through the NestJS API over HTTP, and Next.js route handlers are used *only* as a thin BFF for the refresh-cookie handshake (§6.2 below) — never for business logic. All authorization is server-side (SEC-001); everything in this document is UX, not a security boundary.

---

## 1. Design System — Aesthetic Direction

**Chosen direction: "Court Glow" — dark performance surface with a tenant-driven accent glow.** PracticePerfect is a multi-tenant coaching operations tool used by trainers running a business, coaches checking a schedule, and parents managing a family from a phone between drop-offs. The interface needs to read as *athletic infrastructure* — precise, fast, slightly technical — not a generic SaaS admin panel, and it needs to visibly change identity per trainer without the layout ever feeling reskinned. The dark canvas observed in the source `text.svg` sample (`#1D2F1D`-family deep tone) is treated as the base cue: a near-black neutral ground that lets each trainer's brand color read as *light* — the whole UI behaves like a court under a single spotlight, and the spotlight is the trainer's color.

**Why this isn't a cliché SaaS dashboard:** the memorable element is that the entire product's color identity is data, not a stylesheet choice — `primaryColorHex` from `PATCH /trainers/:id/branding` literally becomes the light source. A Super Admin moving between impersonated trainer sessions visibly changes the "court" they're standing on; that transition is the thing a demo reviewer remembers.

### 1.1 Typography

Two distinctive, non-default families (never Inter/Roboto/Arial/system-ui as the primary voice):

| Role | Family | Fallback stack | Notes |
|---|---|---|---|
| Display / headings | **Clash Display** (Fontshare, OFL) | `'Clash Display', 'Archivo Black', sans-serif` | Bold geometric grotesk, condensed athletic character — used for `hero-title`/`section-title`/`block-title` only |
| Body / UI | **General Sans** (Fontshare, OFL) | `'General Sans', 'Segoe UI', sans-serif` | Clean humanist sans, high legibility at 14px in dense tables — used for `card-title`/`body-lg`/`body`/`caption`/`eyebrow` |
| Numeric (availability grids, countdowns, ids) | General Sans with `font-variant-numeric: tabular-nums` | — | Keeps the 48h-expiry countdowns and weekly-grid times from jittering as digits change |

Both are self-hosted (`next/font/local`) — no runtime dependency on a font CDN, which matters for the `@Public()` `/join/[code]` and `/login` routes that must render fast and offline-tolerant of third-party blocking.

Scale mapping (verbatim from `DESIGN_TOKENS.md`, family applied per role above):

| Token | Size / Line / Weight | Family | Tailwind utility |
|---|---|---|---|
| `hero-title` | 30/38/700 | Clash Display | `text-hero-title` |
| `section-title` | 22/28/700 | Clash Display | `text-section-title` |
| `block-title` | 18/24/700 | Clash Display | `text-block-title` |
| `card-title` | 16/22/600 | General Sans | `text-card-title` |
| `body-lg` | 16/26/400 | General Sans | `text-body-lg` |
| `body` | 14/22/400 | General Sans | `text-body` |
| `caption` | 12/18/400 | General Sans | `text-caption` |
| `eyebrow` | 11/16/600, uppercase, `letter-spacing: 0.06em` | General Sans | `text-eyebrow` |

### 1.2 Color

Base neutral scale (grayscale, from `DESIGN_TOKENS.md`) is used **inverted from its source order** — the darkest step is the app's ground, not its ink:

```
--surface-0: #0D0D0D   /* app background */
--surface-1: #171717   /* raised panel (derived, +1 step) */
--surface-2: #242424   /* card */
--surface-3: #363636   /* card hover / active row */
--border-soft: #5E5E5E
--border-strong: #868686
--ink-muted: #CFCFCF
--ink: #F3F3F3          /* primary text on dark */
```

Tenant accent — computed client-side from `primaryColorHex` using the same `lightenColor`/`darkenColor`/`hexToRgb` transforms named in `DESIGN_TOKENS.md`, mirroring the **server-computed** `derivedPalette` returned by `PATCH /trainers/:id/branding` (architecture OQ-7):

```css
--brand-primary:      var(--tenant-hex, #6EE7B7); /* platform default: mint, used pre-branding / Super Admin */
--brand-primary-soft:  /* lighten(brand-primary, 20%) */
--brand-primary-deep:  /* darken(brand-primary, 20%) */
--brand-primary-rgb:   /* r, g, b — for rgba() glow/shadow usage */
```

Semantic colors (fixed, never tenant-derived — these must stay legible against any accent):

| Token | Value | Usage |
|---|---|---|
| `--success` | `#4ADE80` | Approved, Active, connection-restored |
| `--warning` | `#FBBF24` | Pending, expiring countdown, non-blocking contrast warning |
| `--danger` | `#F87171` | Denied, destructive actions, impersonation banner base |
| `--info` | `#60A5FA` | Informational banners (email-verification reminder) |

**Impersonation banner is deliberately the one surface that ignores tenant branding** (see §5.1) — it always renders on the fixed `--danger`/amber pairing regardless of which trainer is being impersonated, because a color-coded warning that could itself be recolored by the thing it's warning about is a security-UX bug, not a design choice.

### 1.3 Spacing, Radius, Shadow, Motion

Spacing and radius scales are taken verbatim from `DESIGN_TOKENS.md` (`xxs`…`xxl`, `xs`…`pill`) and mapped 1:1 into `tailwind.config.ts` `spacing`/`borderRadius` extensions — no new scale invented.

Shadows (`card-soft`, `card-strong`, `button-primary`, `button-primary-hover`) are implemented as Tailwind `boxShadow` extensions, with `button-primary`/`button-primary-hover` interpolating `--brand-primary-rgb` so the glow is always the active tenant's color:

```css
--shadow-button-primary: 0 10px 30px rgba(var(--brand-primary-rgb), 0.55);
--shadow-button-primary-hover: 0 12px 34px rgba(var(--brand-primary-rgb), 0.7);
```

**Motion strategy** (Motion library — formerly Framer Motion — for React, CSS-only where it's a hover-only affordance):

- **Orchestrated boot:** `/login` and `/join/[code]` reveal in one staggered pass (logo → headline → form, 60ms stagger, 220ms ease-out) — the only place a "page load" animation exists; every authenticated dashboard route renders instantly with skeletons instead (see §9.5), because staggered reveals on a screen someone hits 40×/day become friction, not delight.
- **Buttons:** `-translate-y-1 scale-1.02` on hover per `DESIGN_TOKENS.md`, spring-eased (`stiffness: 400, damping: 28`), glow shadow cross-fades from `button-primary` to `button-primary-hover`.
- **Context switch:** when `ContextSwitcher` changes the active trainer, the accent-color CSS variables cross-fade over 180ms rather than snapping — this is the "spotlight moves" moment referenced in the aesthetic rationale above, and it is the single animation every player/parent user will see repeatedly, so it is tuned more carefully than anything else in the system.
- **Impersonation entry/exit:** banner slides down from `translateY(-100%)` on entry, up on exit, 240ms — deliberately slower/heavier than the context-switch fade, so entering an admin-override state *feels* different from a routine context change.
- **Never:** decorative background particle/gradient animation on data-dense screens (roster tables, users directory, availability grids) — motion on those surfaces is reserved for state transitions (row added/removed, save success) only.

### 1.4 Components (visual states, from `buttons.svg` / `inputs.svg` / `form_control_element.svg`)

| Component | Spec |
|---|---|
| **Button — primary** | Gradient `brand-primary → brand-primary-deep`, `shadow-button-primary`, radius `sm` (10px), sizes `sm`/`md` per token padding. Hover: `-translate-y-1 scale-1.02` + `shadow-button-primary-hover`. Disabled: 40% opacity, no hover transform, shadow removed. |
| **Button — secondary/ghost** | Transparent fill, `1px solid border-soft`, text `ink`. Hover: border becomes `brand-primary`, text becomes `brand-primary`. Used for all "Cancel"/"Exit Impersonation"-adjacent-but-not-destructive actions. |
| **Button — destructive** | Same shape as primary, `--danger`-based gradient instead of brand accent — reserved for Deactivate/GDPR-Delete/Remove-child-from-trainer/Deny-approval. Never tenant-colored, for the same legibility-of-danger reason as the impersonation banner. |
| **Input** | Height 40px, `1px solid border-soft`, radius `sm`. Focus: border → `brand-primary`, `0 0 0 3px rgba(brand-primary-rgb, 0.18)` glow ring. Error: border → `--danger`, helper text below in `--danger` at `caption` size. Disabled: `surface-2` fill, `ink-muted` text. |
| **Checkbox** | 14×14px, radius `xs` (per `form_control_element.svg`). Checked: `brand-primary` fill, white check glyph. |
| **Radio** | 22×22px circle. Checked: `brand-primary` ring + filled center dot. |
| **Toggle** | 39×24px capsule (e.g., `allowChildTokenSpendWithoutApproval`, publicProfile). On: `brand-primary` track. |
| **Card** | radius `md` (16px), `surface-2` fill, `shadow-card-soft`; hover (interactive cards only, e.g. child-profile cards) → `shadow-card-strong` + `surface-3`. |
| **Badge/pill** | radius `pill`, `eyebrow` type, background = semantic color at 16% opacity, text = full-opacity semantic color. Used for `status` everywhere (`Active`/`Pending`/`Expired`/`Deleted`/`PENDING`/`APPROVED`/`DENIED`). |

---

## 2. Design Tokens → Implementation Map

```
apps/client/
├── src/
│   ├── styles/
│   │   └── globals.css          # :root tokens (§1.2/§1.3), font-face declarations
│   ├── lib/
│   │   └── branding/
│   │       ├── BrandingProvider.tsx     # §8
│   │       └── color-transform.ts       # lightenColor/darkenColor/hexToRgb (client mirror of server derivedPalette)
│   └── ...
├── tailwind.config.ts            # extends theme.spacing/borderRadius/boxShadow/fontSize from tokens above, does not redefine them ad hoc per component
```

No component may hardcode a hex value or px spacing outside this token set — this is the enforceable rule `code-reviewer` checks against for this app, mirroring the architecture doc's "no service injects PrismaService" style of hard constraint.

---

## 3. Route Map (`apps/client/app/`)

Route groups mirror role boundaries so each group can carry its own layout (nav shell + `RoleGuard`) without leaking role-specific chrome into shared routes. All groups sit under a root layout that mounts `BrandingProvider`, `ImpersonationBanner` (renders nothing when not impersonating), and the TanStack Query / Zustand providers (§6).

```
app/
├── layout.tsx                          # root: providers, ImpersonationBanner slot, <html> font vars
├── globals.css
│
├── (public)/                           # @Public() routes — no auth required, no shell chrome
│   ├── login/page.tsx
│   ├── forgot-password/page.tsx
│   ├── reset-password/page.tsx         # ?token= query param
│   ├── verify-email/page.tsx           # ?token= query param
│   ├── register/page.tsx               # ?token= — trainer setup-link completion ONLY, see §4.1
│   └── join/[code]/page.tsx            # ShareLink landing — see §4.2 (deep dive)
│
├── (force-password-change)/
│   └── change-password/page.tsx        # forced landing when mustChangePassword=true; excluded from RoleGuard's normal redirect table
│
├── dashboard/page.tsx                  # SINGLE unified route for all 4 roles (see 2026-09-24 note below) — reads
│                                        # GET /me/bootstrap, dispatches on the response's `role` discriminant to
│                                        # SuperAdminDashboardShell / TrainerDashboardShell / CoachDashboardShell /
│                                        # PlayerDashboardShell. Not inside any (role) route group — see note.
│
├── (super-admin)/
│   ├── layout.tsx                      # RoleGuard(SUPER_ADMIN), SA nav shell
│   ├── users/
│   │   ├── page.tsx                    # directory, GET /users
│   │   └── [id]/page.tsx               # detail/edit, GET+PATCH /users/:id, deactivate/reactivate/GDPR-delete actions
│   └── impersonation-history/page.tsx  # GET /impersonation/history
│
├── (trainer)/
│   ├── layout.tsx                      # RoleGuard(TRAINER), trainer nav shell, BrandingProvider reads own trainerProfile
│   ├── coaches/page.tsx                # GET /trainers/:id/coaches + invite form + PATCH /coaches/:id (status)
│   ├── players/page.tsx                # GET /trainers/:id/players, day/time filter
│   ├── share-links/page.tsx            # GET /trainers/:id/share-links + generator modal (POST /share-links) + revoke (DELETE)
│   └── branding/page.tsx               # PATCH /trainers/:id/branding
│
├── (coach)/
│   ├── layout.tsx                      # RoleGuard(COACH), coach nav shell
│   ├── my-times/page.tsx               # GET+PUT /coaches/:id/availability — reuses <AvailabilityGrid>
│   └── profile/page.tsx                # PATCH /coaches/:id (self-fields branch, FR-064)
│
├── (player)/
│   ├── layout.tsx                      # RoleGuard(PLAYER_PARENT), player/parent nav shell, mounts <ContextSwitcher>
│   ├── profiles/
│   │   ├── page.tsx                    # GET /player-profiles — list, +Add Child
│   │   └── [id]/
│   │       ├── page.tsx                # GET/PATCH /player-profiles/:id, trainer associations (GET .../trainers, POST/DELETE)
│   │       └── availability/page.tsx   # GET+PUT /player-profiles/:id/availability — reuses <AvailabilityGrid>
│   └── approvals/page.tsx              # GET /approvals, approve/deny actions — adult parent only (CHILD denied, §9.4)
│
└── (shared)/
    └── account/
        └── profile/page.tsx            # GET/PATCH /me — role-aware fields, every authenticated role
```

**Route count: 20 pages** (6 public + 1 forced-password-change + 1 unified dashboard + 2 Super Admin + 4 trainer + 2 coach + 3 player/parent + 1 shared), plus the always-mounted layout-level components (`ImpersonationBanner`, `ContextSwitcher`, `BrandingProvider`, 4× `RoleGuard` shells) — reconciling to "~20" from the requirements doc's estimate. (Prior to the 2026-09-24 correction below, this line read "23 pages," counting `dashboard/page.tsx` once per role group; merging the four into one shared `dashboard/page.tsx` nets −3.) The three routes the API spec surfaced that the requirements doc didn't separately enumerate: `/register` (trainer-setup, not public signup — §8.4 of the api spec), `/change-password` (forced landing for `mustChangePassword`, api-spec §6.6/§1's `PASSWORD_CHANGE_REQUIRED`), and `/verify-email` as its own route rather than folded into login (non-blocking per architecture §6.5, but still needs a link target).

**Deliberately not routes:** `/coaches/accept/[code]` — api-spec §8.6 confirms this was dropped; coach acceptance is one branch of `/join/[code]`'s dispatch, not a separate page (§4.2). `POST /users` create-any-role UI — api-spec §8.5 confirms this endpoint doesn't exist; the Super Admin create flow is `/users` page's "Create Trainer" modal calling `POST /trainers` only, there is no generic "create user" affordance.

---

**2026-09-24 correction — why `/dashboard` is a single unified route, not four route-grouped pages:** the route map above originally documented each role's dashboard as a `dashboard/page.tsx` leaf inside that role's own route group — `(super-admin)/dashboard/page.tsx`, `(trainer)/dashboard/page.tsx`, `(coach)/dashboard/page.tsx`, `(player)/dashboard/page.tsx`. Next.js App Router route groups (`(name)`) are purely organizational and never add a URL segment (see [Next.js route-groups docs](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)'s own "Conflicting paths" caveat), so all four leaves resolved to the identical URL `/dashboard` — Next.js rejects this at build time once more than one of the four page files exists ("duplicate page" error), not merely at runtime. `RoleGuard` (`apps/client/src/components/RoleGuard.tsx`, Phase 10) already documented this exact collision in a code comment and deliberately redirects to the literal string `/dashboard` for every role, which only makes sense for a single shared route.

The fix: **one route**, `app/dashboard/page.tsx`, living outside every `(role)` group. It authenticates via `RoleGuard` (allowing all four roles — i.e. "any signed-in user", since there is no longer a single role to gate on at this leaf), reads `GET /me/bootstrap` (the discriminated-union payload api-spec §5 already defines, keyed on `role`), and renders `SuperAdminDashboardShell` / `TrainerDashboardShell` / `CoachDashboardShell` / `PlayerDashboardShell` based on that `role` field — the same per-role shell components §4.3–§4.6 below already named, just dispatched from one physical file instead of four. Each role group's own route group (`(super-admin)`, `(trainer)`, `(coach)`, `(player)`) keeps every *other* route it owns (`/users`, `/coaches`, `/my-times`, `/profiles`, etc.) — only the colliding `dashboard/page.tsx` leaf moved out. This is a routing/structure fix only; the four shells' actual content (stat tiles, quick links, per-role data) remains each later phase's job per §4.3–§4.6.

---

## 4. Route-by-Route Detail

### 4.1 Public / Auth group

| Route | API calls | Key components | Notes |
|---|---|---|---|
| `/login` | `POST /auth/login` | `LoginForm`, `RateLimitNotice` | On `mustChangePassword: true` in response, redirect to `/change-password` before touching any role dashboard. On `401 ACCOUNT_INACTIVE`, show the exact copy FR-013 mandates ("Account deactivated. Contact support.") rather than the generic invalid-credentials copy — this is the one place the client is allowed to branch UI text on `errorCode`, since the two 401s are both intentionally generic at the network level but the *UI* is allowed to be specific once it has the code. |
| `/forgot-password` | `POST /auth/forgot-password` | `ForgotPasswordForm` | Always renders the same success state regardless of response content (server always `202`s identically per FR-002) — this is a case where the client must resist the urge to be "helpful" by differentiating; differentiating here would reintroduce the enumeration leak the server just closed. |
| `/reset-password?token=` | `POST /auth/reset-password` | `ResetPasswordForm` | `404/410` → distinct copy ("This link is invalid or has expired") with a link back to `/forgot-password`, not a generic error page. |
| `/verify-email?token=` | `POST /auth/verify-email` | `VerifyEmailStatus` | Success/failure only — this route is never a gate, just a landing confirmation. Resend lives on the persistent banner (§9.2), not here. |
| `/register?token=` | `POST /auth/register` (`CompleteTrainerSetupDto`) | `TrainerSetupForm` | **Not public self-registration** (api-spec §8.4, confirmed resolved). Single-purpose: a Super-Admin-provisioned trainer sets a password and is auto-logged-in (response sets cookies + returns `AuthSessionResponseDto`). `404`/`410` handled like reset-password. |
| `/join/[code]` | `GET /share-links/:code`, `POST /share-links/:code/redeem` | `ShareLinkPreview`, `ShareLinkDispatcher` (+ 4 branch components, see §4.2) | Deep dive below — the single most branchy route in the app. |

### 4.2 `/join/[code]` — ShareLink dispatch (deep dive)

This route cannot be a single form; it is a **state machine driven by two sequential server calls**, and the UI must render a different thing at each stage without ever guessing what the second call will do before the first call tells it.

```
1. On mount: GET /share-links/:code  (always 200, never errors)
     └─ valid: false → render ShareLinkInvalidCard, branch copy on `reason`:
          NOT_FOUND   → "This invitation link doesn't exist."
          EXPIRED     → "This invitation link has expired. Ask your trainer for a new one."
          EXHAUSTED   → "This invitation link has already been used."
          REVOKED     → "This invitation link is no longer active."
        (never a generic 404 page — api-spec §4.4 designed the public preview
         specifically so the client can be this precise)
     └─ valid: true → render ShareLinkPreview (trainerDisplayName, logoUrl,
        primaryColorHex — BrandingProvider applies this trainer's accent to
        the join page itself, so an anonymous visitor already sees the
        trainer's identity before any account exists) + branch on client auth
        state × link `type`:

          ┌─ no access token, type=PLAYER_STATIC or COACH_UNIQUE
          │    → render <AnonymousJoinForm> (registration fields), submit
          │      builds ANONYMOUS_REGISTRATION or anonymous-COACH_ACCEPT body
          │
          ├─ access token present, role=PLAYER_PARENT, accountType=ADULT
          │    → render <FamilyPickerForm> ("Who will train with
          │      {trainerDisplayName}?" — Me + each child, FR-021) → submits
          │      ASSOCIATE_EXISTING { subjectProfileIds }
          │
          ├─ access token present, accountType=CHILD
          │    → render <ChildBlockedNotice> WITHOUT calling redeem at all —
          │      the client already knows this will 403; pre-empting the call
          │      is a UX nicety, not a security control (server still
          │      enforces CHILD_SHARE_LINK_BLOCKED independently). Copy:
          │      "Ask your parent to register you with this trainer." State
          │      that the parent has already been emailed.
          │
          ├─ access token present, role=COACH, type=COACH_UNIQUE
          │    → render <CoachAcceptForm> (no password field — already
          │      authenticated) → submits COACH_ACCEPT
          │
          └─ access token present, role=TRAINER|SUPER_ADMIN
               → render <RoleCannotJoinNotice> WITHOUT calling redeem
                 (pre-empts the 409 ROLE_CANNOT_REDEEM_SHARE_LINK for the
                 same UX-nicety-not-security reason as the CHILD branch)

2. On submit: POST /share-links/:code/redeem  with the branch-specific body
     └─ 201/200 ANONYMOUS_REGISTRATION or anonymous COACH_ACCEPT
          → response IS an AuthSessionResponseDto → client stores access
            token in memory (§6.1), cookies already set by server →
            redirect straight into the new role's /dashboard, no separate
            login step
     └─ 200 ASSOCIATE_EXISTING → toast "Connected with {trainerDisplayName}"
          → redirect to /dashboard (context switcher now includes the new
            trainer, §5.2)
     └─ 200/201 COACH_ACCEPT (authed) → toast → redirect to /dashboard
     └─ 403 CHILD_SHARE_LINK_BLOCKED → (should be pre-empted per above; this
          branch exists as the server-is-source-of-truth fallback, §9.4)
     └─ 409 SHARE_LINK_UNAVAILABLE → race condition (another tab/device beat
          this one to a single-use link) → re-fetch step 1's GET to pick up
          the now-EXHAUSTED reason and re-render ShareLinkInvalidCard, rather
          than showing a raw error toast
     └─ 409 ROLE_CANNOT_REDEEM_SHARE_LINK → (pre-empted per above; fallback
          notice)
```

**Components:** `ShareLinkPreview`, `ShareLinkInvalidCard`, `AnonymousJoinForm`, `FamilyPickerForm`, `ChildBlockedNotice`, `CoachAcceptForm`, `RoleCannotJoinNotice`, `ShareLinkDispatcher` (the orchestrating client component holding the two-stage state machine above — `pending → previewed → { branch } → submitting → { resolved | race-retry }`).

### 4.3 Super Admin group

| Route | API calls | Key components |
|---|---|---|
| `/dashboard` | `GET /me/bootstrap` | `SuperAdminDashboardShell` — deliberately sparse (api-spec §5: no stats block in Epic-01), quick links into Users / Impersonation History only |
| `/users` | `GET /users` (keyset, `?search&role&status`), `POST /trainers` (create modal) | `UsersTable` (virtualized for the 10k-row NFR-002 target), `UserFilters`, `CreateTrainerModal`, `UserRowActions` (Impersonate / Deactivate / Delete entry points, actual mutation happens on `[id]`) |
| `/users/[id]` | `GET /users/:id`, `PATCH /users/:id`, `POST /users/:id/deactivate`\|`/reactivate`, `DELETE /users/:id`, `POST /impersonation/start` | `UserDetailForm`, `DeactivateConfirmModal`, `GdprDeleteConfirmModal` (two-step, typed-confirmation input per the "cannot be undone" warning), `ImpersonateConfirmModal` |
| `/impersonation-history` | `GET /impersonation/history` (keyset, filterable) | `ImpersonationHistoryTable`, `HistoryFilters` (admin/target/date range) |

`CreateTrainerModal` posts `CreateTrainerDto { businessName, firstName, lastName, email, phone }` (§11.1 — resolved, two name inputs not one).

### 4.4 Trainer group

| Route | API calls | Key components |
|---|---|---|
| `/dashboard` | `GET /me/bootstrap` (TRAINER shape) | `TrainerDashboardShell` — branding preview, `coachCount`/`activePlayerCount` stat tiles, quick links |
| `/coaches` | `GET /trainers/:id/coaches`, `POST /coaches/invite`, `PATCH /coaches/:id` | `CoachRosterTable`, `InviteCoachModal`, `CoachStatusBadge` (Pending/Accepted/Expired), resend-on-expiry action |
| `/players` | `GET /trainers/:id/players` (`?dayOfWeek&startTime&endTime`) | `PlayerRosterTable`, `AvailabilityFilterBar` — explicitly the FR-070 narrow slice: `{player, age, availabilitySummary}` only, **no notes/tags/pipeline** (architecture §18) |
| `/share-links` | `GET /trainers/:id/share-links`, `POST /share-links`, `DELETE /share-links/:id` | `ShareLinkTable` (code, type, usage, expiry, status), `GenerateShareLinkModal` (type toggle Player-Static/Coach-Unique, conditional `targetEmail` field), `RevokeConfirmPopover` |
| `/branding` | `PATCH /trainers/:id/branding` | `LogoUploadField`, `ColorPicker`, `BrandingLivePreview`, `ContrastWarningBanner` (non-blocking, §8.4) |

### 4.5 Coach group

| Route | API calls | Key components |
|---|---|---|
| `/dashboard` | `GET /me/bootstrap` (COACH shape) | `CoachDashboardShell` — employing trainer card, `availabilitySet` prompt if false |
| `/my-times` | `GET /coaches/:id/availability`, `PUT /coaches/:id/availability` | `<AvailabilityGrid mode="edit" subject="coach">` (shared component, §5.4) |
| `/profile` | `PATCH /coaches/:id` (self-fields branch) | `CoachProfileForm` (bio, credentials, certifications, `publicProfile` toggle) |

### 4.6 Player/Parent group

| Route | API calls | Key components |
|---|---|---|
| `/dashboard` | `GET /me/bootstrap` (adult or child shape) | `PlayerDashboardShell` — adult sees `pendingApprovalsCount` tile linking to `/approvals`; child shape has no such tile (deny-listed field, §9.4) |
| `/profiles` | `GET /player-profiles`, `POST /player-profiles` | `ProfileCardGrid` (self + children), `ChildProfileForm` (create/edit modal — name/dateOfBirth/gender/school/photo/trainerIds checklist per FR-031) |
| `/profiles/[id]` | `GET/PATCH /player-profiles/:id`, `GET .../trainers`, `POST/DELETE .../trainers/:trainerId` | `ProfileEditForm`, `TrainerAssociationList`, `AddTrainerModal` (manual code entry vs. "My Trainers" picker, FR-032 option A/B), `RemoveTrainerConfirmModal` ("This will cancel all upcoming RSVPs") |
| `/profiles/[id]/availability` | `GET/PUT /player-profiles/:id/availability` | `<AvailabilityGrid mode="edit" subject="player">` |
| `/approvals` | `GET /approvals`, `POST /approvals/:id/approve`\|`/deny` | `PendingApprovalsList`, `ApprovalCard` (countdown-to-expiry, §9.1), `ApprovalDecisionModal` (notes field) — **adult parent only**; a `CHILD` session never reaches this route (nav item hidden, and the layout's `RoleGuard` redirects on the `403 CHILD_CAPABILITY_DENIED` fallback if hit directly) |

### 4.7 Shared

| Route | API calls | Key components |
|---|---|---|
| `/account/profile` | `GET/PATCH /me` | `ProfileEditForm` (role-aware field set, §7.2), `EmailVerifiedBanner` (dismissible, resend action), `ChangePasswordLink` |

`/change-password` (forced group): `POST /auth/change-password`. `ChangePasswordForm` — `currentPassword` field is rendered only when `mustChangePassword` is `false` (i.e., this same page/component is reused for the voluntary path from `/account/profile`); on the forced path the field is omitted entirely rather than shown-and-ignored, matching the DTO's `currentPassword?` optionality (api-spec §1).

---

## 5. Global Shared Components

These mount at the root layout or role-group layout level, not per-page, specifically so their state survives client-side navigation (Next.js App Router preserves layout component state across route transitions within the same layout tree — this is *why* they're layout-level, not a stylistic choice).

### 5.1 `ImpersonationBanner`

Mounted in the **root** layout (not a role layout), because a Super Admin impersonating a Trainer is, for the rest of the tree, rendering *inside the trainer's own role layout* — the banner must sit above that entire subtree as a fixed, sticky element that no role layout can accidentally clip or restyle.

**State source:** derived from the presence of an `act` claim in the decoded in-memory access token (§6.1) — never a separate fetch. Decoding is a pure client-side read of the JWT payload for *display* purposes only (whose name to show, when it expires); it is never trusted for authorization.

**Visual:** fixed top bar, always the fixed `--danger`/amber pairing (§1.2 — never tenant-colored), `"Viewing as {target.firstName} {target.lastName} ({target.role}) · Exit Impersonation"` + a live countdown (`mm:ss` to the token's `exp`). Slides in/out per §1.3.

**Countdown behavior (three states, since there is no refresh path for this token — architecture §10, ADR-03):**

| Time remaining | Banner state |
|---|---|
| > 5 min | Normal — countdown ticks quietly |
| ≤ 5 min | `--warning`-tinted pulse + inline text "Session ending soon" — proactive warning, since expiry here is *not* recoverable by a silent refresh the way a normal 401 is |
| 0 (expired) | Banner auto-triggers the exit sequence: discard the impersonation token, call `POST /impersonation/end` best-effort (may itself 401 if already past the cap — api-spec §2 documents this as expected, client proceeds regardless), then `POST /auth/refresh` on the untouched admin cookie, then re-render as the admin's own session. No modal, no user action required — the whole point of "no refresh token issued" is that the client cannot pretend otherwise, so it degrades gracefully instead of showing a dead-end error. |

**Exit button:** same three-step sequence as the auto-exit above, triggered manually, before the countdown reaches zero.

### 5.2 `ContextSwitcher`

Mounted in the `(player)` group layout only (Super Admin/Trainer/Coach have no multi-context concept in Epic-01). Sourced from `GET /me/bootstrap`'s `contexts`/`activeContext` (or `GET /me/contexts` for a refetch after an association change, api-spec §4.3) — never invents context data client-side.

Renders one of the **three documented formats from Epic-01 spec §US-01.04**, chosen by `accountType` and whether any context has `isSelf: true`:

```
Parent who also trains:
  [Current: Sarah (Me) → Coach Lisa ▼]
  Your Training:            Sarah (Me) → Coach Lisa / Coach Mike
  Your Children's Training: Alex → Coach Bob · Maya → Coach Bob, Coach Lisa · Emma → Coach Bob

Parent who doesn't train:
  [Current: Alex → Coach Bob ▼]
  Your Children's Training: Alex → Coach Bob · Maya → Coach Bob, Coach Lisa · Emma → Coach Bob

Child with own login:
  [Current: Coach Bob ▼]
  Your Training: Coach Bob (Basketball) · Coach Lisa (Volleyball)
  (no "Me"/parent section — FR-034)
```

**Selecting a context:**
1. Writes the chosen `trainerId` to the active-context Zustand store (§6.3) *and* a non-httpOnly cookie (so the choice survives a hard refresh / is readable by a server component that wants to pre-set the header on the initial request).
2. Every subsequent API call attaches `X-Trainer-Context: <trainerId>` via the central client interceptor (§6.2) — the switcher itself never manually threads the header through props.
3. **The selection is UX-only.** Per architecture §8's closing paragraph, the server re-validates the header against an `ACTIVE` `PlayerTrainerAssociation` on every request regardless of what the client last selected; a `403 TENANT_CONTEXT_INVALID` (e.g., the association was removed in another tab) triggers a forced re-fetch of `/me/contexts` and a "This connection is no longer active" toast, not a silent retry.
4. Brand accent cross-fades to the newly selected trainer's `primaryColorHex` (§1.3), reinforcing FR-022's "no combined view" rule visually — the UI never shows two trainers' colors/data at once, by construction of the layout, not just by convention.

### 5.3 `BrandingProvider`

See §8 (dedicated section — theming touches routing, SSR, and the branding-settings form, so it's documented once there rather than split).

### 5.4 `AvailabilityGrid` (shared, not global-mounted — imported by 2 routes)

One component, two subjects (`player` | `coach`), two modes (`view` | `edit`), reused by `/my-times` and `/profiles/[id]/availability`:

- **Grid:** 7 columns (Mon–Sun) × time-range rows; `startTime`/`endTime` stored/transmitted as minutes-from-midnight per architecture §3.4 — the component converts to/from a human `HH:mm` picker at the edit boundary only, so no timezone-shaped bug can leak into the number the API receives (there is deliberately no timezone conversion anywhere in this component, matching OQ-5's "trainer-local wall-clock, no TZ handling in Epic-01").
- **Edit mode:** add/remove time-range rows per day, `startTime < endTime` validated client-side before submit (mirrors the server's `0–1440` + ordering check, §7).
- **View mode** (trainer viewing a player's grid via the roster, or a player viewing read-only): renders the same grid non-interactively plus the `"Best Times: Mon 5-8pm, Wed 6-9pm"` summary string format from FR-070/US-01.09 — this summary is computed client-side from the slot array for display; the server's `RosterRowDto.availabilitySummary` (api-spec §4.3) is the same string precomputed server-side for the roster **list**, so the two must use the same formatting rule (documented once here to avoid drift — flagged if `coder-frontend` needs to duplicate the formatter, see §11).
- **Conflict check surface (trainer-side, FR-063):** not part of this component — `GET /coaches/:id/availability/check` is consumed by whatever Epic-02 event-assignment UI eventually calls it; Epic-01 only builds `POST /coaches/:id/availability/override`'s logging form as a standalone `OverrideReasonModal`, unattached to any Epic-01 route (forward-reference seam, architecture §18).

---

## 6. State Management Architecture

### 6.1 In-memory access token + boot sequence

**Library: a small hand-rolled Zustand store (`useAuthStore`), not React Context.** Context re-renders every consumer on every token refresh (every 15 min at minimum); Zustand's selector-based subscription lets components that only need `isAuthenticated`/`role` skip re-rendering when only the raw token string changes. This store holds exactly: `{ accessToken: string | null, user: UserSummaryDto | null, expiresAt: number | null }`. **Never persisted** (no `zustand/persist`) — persistence to any browser storage is exactly the `localStorage`/`sessionStorage` XSS exposure architecture §6.1 rules out.

**Boot sequence** (root layout client component, runs once on app mount):

```
1. Call POST /auth/refresh (cookie-only, no body) immediately.
     └─ 200 → populate useAuthStore from AuthSessionResponseDto, app renders
        the authenticated tree for the resolved role.
     └─ 401 → no valid session → useAuthStore stays null → app renders as
        anonymous → RoleGuard on any protected route redirects to /login.
2. Until step 1 resolves, render a full-screen brand-neutral loading state
   (platform default accent, not a tenant color — no trainer is known yet).
```

This is the client-side mirror of architecture §6.4's "Next.js client obtains its in-memory access token by calling `/auth/refresh` on boot."

### 6.2 Central API client (interceptor pattern)

One `apiClient` (thin `fetch` wrapper, not a full library — the API surface is ~45 endpoints, not thousands, and a hand-rolled wrapper keeps the 401-retry/CSRF/header logic auditable in one file rather than spread across an interceptor-plugin config):

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
    const refreshed = await refreshSession();       // POST /auth/refresh
    if (refreshed) return apiRequest(path, { ...options, _isRetry: true });
    useAuthStore.getState().clear();
    redirectToLogin();
    throw new SessionExpiredError();
  }
  return res;
}
```

**Key properties:**
- `X-Trainer-Context` is attached **automatically from the store** whenever one is active — no call site manually passes the header, which is what keeps api-spec §0.3's per-endpoint Required/N-A bucketing from becoming 45 places where a developer might forget it. Endpoints where the header is `N/A` simply ignore an extra header the server doesn't read for that route; this is safe because the header is validated, not blindly trusted, server-side.
- **One retry only** — a second 401 after a successful-looking refresh is treated as a hard session failure, not an infinite loop.
- `X-CSRF-Token` is attached by a *separate*, narrower helper used only by the two calls that need it (`refreshSession()`, `logout()`) — reading the non-httpOnly `csrf` cookie and echoing it, per architecture §6.4's double-submit design. It is deliberately not part of the generic `apiRequest` header set, since attaching a CSRF header to routes that don't check it is harmless but attaching it *inconsistently* would be a signal something's wrong, so it stays scoped to the two routes that actually require it.
- Impersonation-token 401s are **not** retried through this path — `refreshSession()` itself checks `useAuthStore.getState().isImpersonating` first and short-circuits straight to the impersonation-exit sequence (§5.1) instead of calling `/auth/refresh` with what would be a doomed assumption (an impersonation session has no refresh token to rotate).

### 6.3 Server-state caching: TanStack Query

**TanStack (React) Query** for every read against the ~45-endpoint surface; Zustand is reserved for genuinely client-only state (auth token, active trainer context, impersonation banner countdown, form-in-progress UI state) — this split (server cache vs. client state) is deliberate rather than putting everything in one store, because the two have different invalidation semantics: query results go stale and need refetching on mutation, client UI state does not.

| Concern | Tool |
|---|---|
| `GET /me/bootstrap`, `/users`, `/trainers/:id/coaches`, `/player-profiles`, `/approvals`, availability GETs, etc. | TanStack Query, keyed `[resource, params]` |
| Mutations (`POST/PATCH/PUT/DELETE`) | TanStack `useMutation`, with `queryClient.invalidateQueries` scoped to the affected resource key on success — e.g. approving a request invalidates `['approvals']` and `['me', 'bootstrap']` (for `pendingApprovalsCount`) |
| Keyset pagination (`GET /users`, `/impersonation/history`, roster/share-link lists) | `useInfiniteQuery`, `getNextPageParam` reads `nextCursor`/`hasMore` directly from `PaginatedResponseDto` — no client-side offset math anywhere, matching the server's keyset-only design (architecture §3.3) |
| Auth token, active trainer context, impersonation display state | Zustand (`useAuthStore`, `useTrainerContextStore`) |

**Active trainer context store** (`useTrainerContextStore`): `{ activeTrainerId: string | null }`, backed by a non-httpOnly cookie for SSR-readability (architecture §8 explicitly names "cookie + Zustand store" for this — this spec follows that naming directly). Writing to it is always followed by invalidating every trainer-scoped query key so stale data from the previous context can't flash before the new context's data loads.

### 6.4 Why not Redux / plain Context

Redux's boilerplate doesn't pay for itself at this app's size (one auth store, one context store, everything else is server cache); plain Context was rejected in §6.1 for its re-render granularity. TanStack Query is chosen over hand-rolled `useEffect`+`useState` fetching specifically because the app has real cache-invalidation needs (bootstrap's `pendingApprovalsCount` must update the moment an approval is decided, roster views must reflect a just-removed child) that a manual fetch layer would reimplement badly.

---

## 7. Form Validation Approach

**Zod schemas mirror `class-validator` DTOs one-to-one, paired with React Hook Form (`@hookform/resolvers/zod`).** Client validation is UX-only — instant feedback, no round trip for obviously-wrong input — and every schema's error copy is written to *not contradict* the server's `details[]` messages (api-spec §0.4), so a validation error that somehow only triggers server-side (a race, a stale client bundle) still reads coherently rather than looking like two different apps disagreed.

### 7.1 Schema-to-DTO mirror table

| Client schema | Mirrors DTO | Key rules |
|---|---|---|
| `loginSchema` | `LoginDto` | `email`: valid email, max 255. `password`: non-empty. (No password-strength check on login — that's a reset/setup-time rule, not a login-time one.) |
| `resetPasswordSchema` | `ResetPasswordDto` | `newPassword`: min **8**, matches `PASSWORD_POLICY` — at least one lowercase, one uppercase, one digit (api-spec §0.10, resolved) |
| `completeTrainerSetupSchema` | `CompleteTrainerSetupDto` | Same password rule as above |
| `changePasswordSchema` | (inline `/auth/change-password` body) | `currentPassword`: required unless `mustChangePassword` (conditional field, mirrors the DTO's `currentPassword?`) |
| `createTrainerSchema` | `CreateTrainerDto` | `businessName` max 200, `firstName` max 100, `lastName` max 100, `email` valid, `phone`: E.164-ish pattern matching `@IsPhoneNumber()` |
| `createChildProfileSchema` | `CreateChildProfileDto` | `name` max 100, `dateOfBirth`: valid ISO date **and** client-computes age from it, rejects outside 1–18 client-side (mirrors the server's post-derivation 1–18 check even though the wire field is a date, not an age number) — non-blocking duplicate-name/age warning is *not* a zod rule, it's a soft inline `warning` surfaced from the `200 { warning }` response shape (api-spec §4.3), never a form-blocking error |
| `updateBrandingSchema` | `UpdateBrandingDto` | `primaryColorHex`: `/^#[0-9A-Fa-f]{6}$/`, identical to the server's `@Matches` pattern; `logoUrl`: valid URL (set post-upload, not typed by the user) |
| `createShareLinkSchema` | `CreateShareLinkDto` | `type`: enum `PLAYER_STATIC \| COACH_UNIQUE`; `targetEmail`: conditionally required (zod `.superRefine`) mirroring the DTO's `@ValidateIf(o => o.type === 'COACH_UNIQUE')` |
| `availabilitySlotSchema` | `PUT .../availability` body | Per-slot `startTime < endTime`, both in `0–1440`; array-level check for no two `isAvailable` slots overlapping on the same day (server doesn't document overlap rejection explicitly — flagged §11) |
| `createOverrideSchema` | `CreateOverrideDto` | `reason`: required, non-empty, max 500 |
| `updateMeSchema` / `updateChildProfileSchema` | `UpdateMeDto` / `PATCH /player-profiles/:id` body | Field set is **role-and-accountType-conditional at the form level**, not just at validation — see §7.2 |
| `anonymousJoinSchema` | `/share-links/:code/redeem` `ANONYMOUS_REGISTRATION` body | `email`, `password` (setup-strength rule), `phone`, `playerName`, `dateOfBirth` (age-derived, same 1–18 rule as child profile), `gender`, `isSelf` |

### 7.2 Child-field restriction is a UI concern, not just a validation rule

`PATCH /me` and `PATCH /player-profiles/:id` both have a server-enforced **narrower field whitelist for `typ: CHILD`** (`403 CHILD_FIELD_NOT_EDITABLE`, api-spec §3/§4.3). The client mirrors this by **rendering fewer fields**, not by rendering all fields and letting validation reject some on submit:

- `ProfileEditForm` reads `accountType` from the bootstrap/`GET /me` response and conditionally omits `firstName`/`lastName`/`phone` inputs entirely for a `CHILD` session, showing only `photoUrl`/`notificationPrefs`.
- Same pattern for `allowChildTokenSpendWithoutApproval` on `PATCH /player-profiles/:id` — never rendered in a child's own view of their profile, only in the parent's.
- **This is a UX optimization, not the security boundary** — if a stale client bundle or a direct API call sends a disallowed field anyway, the server's `403 CHILD_FIELD_NOT_EDITABLE` is caught by the mutation's error handler and surfaced as a generic "Some changes couldn't be saved" toast with the offending field names from `details[]`, never a silent drop (§9.4).

---

## 8. Branding & Theming System

**`BrandingProvider`** (`src/lib/branding/BrandingProvider.tsx`) is the single place tenant branding becomes CSS. It does not fetch independently — it consumes whatever branding block is already present on the current role's `GET /me/bootstrap` response (`TRAINER.branding`, `COACH.employingTrainer`, `PLAYER_PARENT.activeContext`) or the public `GET /share-links/:code` preview (`/join/[code]`, pre-auth) or `GET /trainers/:id` (Super Admin viewing/impersonating a specific trainer). Super Admin's own un-impersonated session renders the **platform default accent** (`#6EE7B7` mint, §1.2) — there is no trainer to derive from.

**Application mechanism:** on receiving `{ logoUrl, primaryColorHex, derivedPalette? }`, the provider:

1. If `derivedPalette` is present (i.e., this came from the trainer's own `PATCH /trainers/:id/branding` response, freshly saved), use the **server-computed** shades directly — this is the authoritative palette the server already validated for WCAG contrast (OQ-7).
2. Otherwise (bootstrap/preview responses carry only the raw `primaryColorHex`), compute the same `lightenColor`/`darkenColor`/`hexToRgb` transforms client-side (`color-transform.ts`, §2) to derive `-soft`/`-deep`/`-rgb` on the fly — this is a **display-only** recomputation; it never gets written back or treated as authoritative, and it uses the identical transform names/percentages as the server so the two never visibly disagree at the boundary where a freshly-saved palette (server-derived) hands off to a bootstrap-derived one on the next page load.
3. Writes `--brand-primary`/`-soft`/`-deep`/`-rgb` onto a `data-branding` wrapper element, not `:root` directly — this is what lets `ContextSwitcher` (§5.2) cross-fade between two trainers' palettes simultaneously in flight without a flash of unstyled/wrong-colored content, and what keeps the Super Admin's own chrome (Users table, Impersonation History) on the fixed platform accent even while a trainer's branding is being *previewed* in a nested panel.
4. Logo: rendered from `logoUrl`, falling back to the platform default mark (`default_logo.svg`) when null — every trainer starts branding-less and the fallback must not look broken or placeholder-y, since a brand-new trainer's players see it on day one.

**`/trainer/branding` settings form specifics:**

- `ColorPicker`: native color input + hex text field kept in sync, live-previews against `BrandingLivePreview` (a miniature rendering of the nav bar + a primary button, using the in-progress hex before save).
- On `PATCH` response, `contrastWarning?: string` (present only when the server's AA check against white/black text fails, OQ-7) renders as a **dismissible, non-blocking** `ContrastWarningBanner` directly under the picker — save has already succeeded by the time this banner can appear; it is advisory ("This color may be hard to read for some users — consider a darker shade") not a gate. This matches the server's own explicit non-blocking design (api-spec §4.1: "never rejects the PATCH outright").
- Logo upload: two-step per api-spec §4.1 (`shared/storage` upload first, then this PATCH with the resulting URL) — `LogoUploadField` shows a processing placeholder while the `MEDIA_LOGO_RESIZE` outbox job runs server-side (NFR-001-compliant fast PATCH return), polling or optimistically showing the just-uploaded (pre-resize) image until the resized `logoUrl` is confirmed on next fetch.

---

## 9. Loading & Error States

### 9.1 Child purchase approval lifecycle

`ApprovalCard` (used in `PendingApprovalsList`) renders differently per `status`:

| Status | Rendering |
|---|---|
| `PENDING` | Live countdown to `expiresAt` (48h window, api-spec §4.6/architecture §9.3) — `caption`-size, `--warning` color once under 6 hours remaining, `--danger` once under 1 hour. Approve/Deny buttons active. |
| `APPROVED` | `--success` badge, decision timestamp, notes if present. No actions. |
| `DENIED` | `--danger` badge, decision timestamp, notes if present. No actions. |
| `EXPIRED` | Distinct muted/greyed treatment (not the same visual weight as an active denial) with copy "Expired — no response within 48 hours" — this state is system-generated (`ApprovalExpiryJob`, architecture §13.1), not a parent decision, and should not read as if the parent actively denied it. |

**Empty state** (`PendingApprovalsList` with zero `PENDING` rows): not a bare "no results" — copy reflects that this is good news ("No pending approvals — you're all caught up") plus a secondary, collapsed section for recently-resolved requests (last 7 days), so the page isn't a dead end the one time a parent has nothing to do.

**Race with the expiry sweep:** approve/deny submit uses the same conditional-update semantics as the server (§9.3 of architecture) — a `409 CONFLICT` on `POST /approvals/:id/approve`\|`/deny` means the 5-minute cron beat the parent's click; the client re-fetches the single approval and re-renders it as `EXPIRED` with a toast ("This request expired before your response was received") rather than surfacing a raw conflict error.

### 9.2 Email verification (non-blocking)

Persistent, dismissible banner (session-scoped dismissal — reappears next login if still unverified, per-tab dismissal is not persisted) shown whenever `GET /me`'s `emailVerified: false`, on every authenticated route via the root layout (not per-page). "Verify your email" + resend button (`POST /auth/verify-email/resend`, disabled with countdown after a `429 RATE_LIMITED` `Retry-After`). Never a modal, never blocks navigation — architecture §6.5 is explicit that no guard checks this value.

### 9.3 ShareLink invalid/expired states

Covered in full in §4.2's dispatcher table — the key design constraint restated here: **`GET /share-links/:code` never 404s**, so `/join/[code]` must never render a generic Next.js not-found boundary for a bad code. The route's `page.tsx` treats every response (including network-level failure) as data to branch on, not an exception to catch.

### 9.4 Generic cross-cutting states

| Situation | Handling |
|---|---|
| 401 mid-session (access token expired between renders) | Handled entirely inside `apiRequest` (§6.2) — silent refresh + one retry. UI never shows a raw 401; if the retry also fails, the user lands on `/login` with a "Your session expired, please sign in again" toast (not silently redirected with no explanation). |
| `403 CHILD_CAPABILITY_DENIED` / `403 CHILD_FIELD_NOT_EDITABLE` reaching the client anyway | Should be pre-empted by hiding the triggering UI (nav items, form fields, per §7.2/§4.6) in the overwhelming majority of cases. Fallback: generic toast "This action isn't available on this account," logged to the client error monitor as a signal that a hide-rule is missing somewhere — this should never happen in steady state, so it's treated as a bug report trigger, not a normal UX path. |
| `429 RATE_LIMITED` | `login`, `forgot-password`, `verify-email/resend` forms disable their submit button and show a `Retry-After`-driven countdown ("Try again in 47s") read from the response header — never a bare "too many requests" with no indication of when to retry. |
| `403 TENANT_CONTEXT_INVALID` | Covered in §5.2 point 3 — forced context re-fetch + toast, not a silent failure. |
| `500 TENANT_SCOPE_VIOLATION` (should never reach the client per architecture §8 Layer 2, but must degrade safely if it does) | Generic "Something went wrong, please try again" error boundary — this errorCode is explicitly documented server-side as "alerted, not user-facing copy" (api-spec §0.5), so the client deliberately does not attempt to explain it. |
| Optimistic UI vs. skeleton loading | **Optimistic** for low-stakes, easily-reversible, high-frequency actions only: toggling `publicProfile`, dismissing the email-verification banner, ShareLink revoke (row fades immediately, rolls back + toast on failure). **Skeleton loading** (never a spinner-only state) for everything else — tables, dashboards, profile forms, the availability grid — matched to the actual layout shape (skeleton rows for tables, skeleton grid cells for `AvailabilityGrid`) so layout doesn't shift on data arrival. Destructive/irreversible actions (deactivate, GDPR delete, remove-child-from-trainer, deny-approval) are **never** optimistic — they wait for the server response and show a blocking (but brief) inline spinner on the confirm button itself. |

### 9.5 Skeleton policy detail

Every route's initial TanStack Query loading state renders a skeleton matched to that route's actual grid/table/card shape (built once per route, not a single generic shimmer block reused everywhere) — this is the "restraint" half of the §1.3 motion strategy: the visual interest budget in this app goes to the context-switch and impersonation-entry moments, not to loading chrome that users see dozens of times a day.

---

## 10. Testing Hooks (brief — full test plan is `test-generator`'s scope)

- **Component tests:** `ShareLinkDispatcher`'s branch matrix (§4.2) — auth-state × link-type × server-outcome is the single highest-value test target in this app, given how many decision points collapse into one route.
- **Store tests:** `useAuthStore`'s boot sequence (refresh success/failure), `apiRequest`'s single-retry-then-hard-fail behavior, impersonation countdown's three-state transition (§5.1).
- **Visual/E2E:** the 7 user flows named in requirements-analyst-requirements.md's Testing Tasks section map directly to routes above; no new flows introduced by this design.

---

## 11. Open Questions & Inconsistencies Found (need your sign-off before `writing-plans`)

| # | Item | What this spec did | Needs your decision |
|---|---|---|---|
| 11.1 | `CreateTrainerDto.trainerName` was a single server-side field, but `UserSummaryDto`/`MeResponseDto` elsewhere expose `firstName`/`lastName` separately. | **RESOLVED (2026-09-22, project owner confirmed):** `CreateTrainerDto` split to `{ businessName, firstName, lastName, email, phone }` in `api-designer-spec.md` §1. `CreateTrainerModal` now has two "First name"/"Last name" inputs instead of one "Trainer Name" input. | — |
| 11.2 | OQ-6 (architecture §19): `CHILD_SHARE_LINK_BLOCKED` produces an email only, no in-app "pending registration review" entity. | `ChildBlockedNotice` (§4.2) tells the child that the parent was emailed and stops there; no in-app notification list/badge was designed for the parent side, since no such endpoint or entity exists to back one. | Confirm email-only is sufficient for the Epic-01 demo, or flag that an in-app queue is wanted (this would need a new architecture/API entity first — out of this spec's power to add unilaterally). |
| 11.3 | G-02 (requirements gap): skill-level enum values still unconfirmed. | No Epic-01 screen in this spec displays or filters by skill level — the trainer roster view (`/trainers/:id/players`) was deliberately kept to the narrow `{player, age, availabilitySummary}` slice per architecture §18, which has no skill-level field. | No UI impact currently; confirm this stays true, or flag if a specific screen needs skill level added before `writing-plans` locks scope. |
| 11.4 | G-11/OQ-7: WCAG AA vs. trainer-arbitrary brand color. | Implemented as a purely non-blocking inline warning after save (§8), matching the server's own non-blocking design exactly — no client-side pre-save gate was added on top. | Confirm the non-blocking warning is sufficient for NFR-004 sign-off, or specify whether a stricter pre-save client check (e.g., disabling Save until acknowledged) is wanted despite the server never rejecting the value. |
| 11.5 | Password policy regex (`PASSWORD_POLICY`) had no concrete pattern documented anywhere upstream. | **RESOLVED (2026-09-22, project owner confirmed):** defined in `api-designer-spec.md` §0.10 — min **8** chars (not 12), at least one lowercase, one uppercase, one digit, no special-character requirement. `resetPasswordSchema`/`completeTrainerSetupSchema` (§7.1) updated to `min(8)` + the same character-class regex. | — |
| 11.6 | Availability slot overlap validation: the server's documented checks are `0–1440` range + `startTime < endTime` per slot; no explicit statement about rejecting two overlapping `isAvailable` ranges on the same day. | Client-side `availabilitySlotSchema` (§7.1) added an overlap check defensively, since submitting overlapping ranges seems like an obvious UX error to prevent — but this may be stricter than the server actually enforces. | Confirm whether overlapping same-day ranges should be client-blocked, silently merged, or allowed through to the server as-is. |
| 11.7 | `AvailabilityGrid`'s "Best Times" summary string format (e.g., `"Mon 5-8pm, Wed 6-9pm"`) is generated in two places — client-side for the individual player's own grid view, server-side (`RosterRowDto.availabilitySummary`) for the trainer's roster list. | Documented the duplication explicitly (§5.4) rather than silently accepting drift risk; no shared-package formatter exists yet since `apps/client` and `apps/server` don't currently share a code package for this. | Confirm whether a tiny shared formatting util (in a new `packages/` workspace, or just two independently-tested implementations kept manually in sync) is worth setting up, or whether the minor risk of copy drift is acceptable for Epic-01's scope. |

---

*This spec is updated incrementally by the `frontend-design` skill. Entries carry a `[TASK-N]` tag so future tasks can append without renumbering existing sections.*
