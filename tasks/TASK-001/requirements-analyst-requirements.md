# Epic-01: User Management & Authentication — Requirements

## Overview

Foundation epic for the platform (PracticePerfect): multi-role authentication (Super Admin, Trainer, Coach, Player/Parent), role-based access control, ShareLink-based invitation/onboarding, multi-trainer isolated contexts for players/parents, parent/child account hierarchy with purchase-approval workflow, coach availability + conflict-override management, Super Admin operational tools (impersonation, soft delete, GDPR delete), and per-trainer portal branding. This is the P0 foundation epic — it blocks Epics 02–08, which are explicitly **out of scope** for this task.

## Source

- `D:\_ALEX\INNOWISE_AI_CERTIFICATION_project\Task\Epics\Epic-01_User_Management_Authentication_SPEC.md` (14 user stories: US-01.01 → US-01.14)
- `D:\_ALEX\INNOWISE_AI_CERTIFICATION_project\specs\MANIFEST.md` (locked stack/scope decisions)

## Scope Boundary (enforced)

In scope: everything in Epic-01 SPEC sections 3, 7, 8, 9 except items that hard-depend on other epics' data models (see Gap Analysis G-08). Epics 02–08 are not decomposed, referenced as designable systems, or assumed to exist — only referenced as *future* nullable/opaque foreign keys where Epic-01 entities must point forward (e.g., `eventId` on `ChildPurchaseApproval`).

---

## Functional Requirements

### Authentication & Session (US-01.01 core, epic-level AC)

- **FR-001**: System supports email/password authentication for all 4 roles. Acceptance: valid credentials issue a session; invalid credentials return a generic error (no user-enumeration).
- **FR-002**: System supports password reset via emailed time-limited link (1 hour expiry per BR). Acceptance: requesting reset never reveals whether the email exists; token single-use; expired token shows clear error.
- **FR-003**: System supports email verification via emailed time-limited link (24 hour expiry per BR). Acceptance: link marks `emailVerifiedAt`; expired link offers resend.
- **FR-004**: System enforces session expiry and supports logout. Acceptance: expired/revoked session forces re-login; logout invalidates the session/refresh token server-side.
- **FR-005**: Login endpoint is rate-limited per IP + per email. Acceptance: exceeding threshold returns 429 with retry-after; does not lock account permanently.

### Super Admin — User Management (US-01.01, US-01.07, US-01.12, US-01.13)

- **FR-010**: Super Admin creates Trainer accounts (business name, trainer name, email, phone) — no self-registration path for trainers. Acceptance: duplicate email rejected with clear error; success sends invite email with temp password or setup link; forced password change on first login; new trainer appears in Users list as "Active"; action audit-logged.
- **FR-011**: Super Admin views a global, paginated, tool-specific-searchable Users directory (not global search). Acceptance: list loads <3s at 10,000 users (NFR-002).
- **FR-012**: Super Admin edits any user's account/profile fields.
- **FR-013**: Super Admin deactivates a user (soft delete). Acceptance: confirmation modal; user cannot log in ("Account deactivated. Contact support."); all historical records (attendance, payments, referrals, CRM rows) remain visible, marked inactive where displayed; reactivation available and restores login.
- **FR-014**: Super Admin permanently anonymizes a user (GDPR delete). Acceptance: confirmation modal with explicit warning; name → "Deleted User", email → `deleted_{userId}@example.com`, phone → null, photo → default avatar; historical records retained showing "Deleted User"; analytics totals unaffected; status → "Deleted"; irreversible (no reactivate path); deletion event logged with original id, email, deleter, reason, timestamp, and a backup snapshot of pre-anonymization data for legal retention.
- **FR-015**: Super Admin impersonates any user except another Super Admin. Acceptance: attempting to impersonate a Super Admin returns a validation error; confirmation modal before entry; sticky color-coded banner "Viewing as [Name] | Exit Impersonation" for the whole session; all impersonated navigation/permissions/data match the target user exactly; "Exit Impersonation" returns to admin view; session auto-expires after 1 hour; every impersonation logged (admin id, target id, start, end, duration) and reviewable via an "Impersonation History" report.

### Player/Parent — Registration & ShareLink (US-01.02)

- **FR-020**: Anonymous user can register via a trainer ShareLink (`/join/{code}`). Acceptance: unauthenticated → redirected to registration prefilled with nothing extra beyond the link's trainer context; form collects name, email, password, phone (parent), player name/age/gender; on submit, account + player profile are created and auto-associated with the link's trainer; confirmation email sent; player can immediately see that trainer's events/content.
- **FR-021**: Authenticated user clicking a *different* trainer's ShareLink gets a new trainer association without creating a duplicate account. Acceptance: if the account is a parent with children, show a checklist ("Who will train with [Trainer]?": Me + each child) and associate only the selected members.
- **FR-022**: Multi-trainer players/parents get fully separated per-trainer contexts (calendar, tokens, content, reservations) with a context switcher in navigation; the active context persists across the session; no combined/unified cross-trainer view exists anywhere in the product.
- **FR-023**: ShareLinks are typed: static player links (unlimited uses, no expiry) vs. unique coach links (single use, 7-day expiry, targeted to an email). Usage (who, when, count) is tracked on every link for future analytics (Epic-06 stub only — no dashboard built here).

### Player/Parent — Child Profiles (US-01.03, US-01.04)

- **FR-030**: Parent creates a child profile (name, age, gender, optional school/photo), explicitly marked "Child" vs. "Self". Validation: name/age/gender required; age 1–18; duplicate-name/age warning (non-blocking).
- **FR-031**: On child creation, trainer association flow: if parent has exactly one trainer, prompt Yes/No "Will [Child] also train with [Trainer]?"; if parent has multiple trainers, show a selection checklist; if none selected, child profile exists unassociated until the parent links it later.
- **FR-032**: Parent can view all children with their trainer associations (name, age, associated trainers + dates), add a trainer to a child (via manual ShareLink entry or picking from "My Trainers"), and remove a child from a trainer. Removal requires confirmation ("This will cancel all upcoming RSVPs"), soft-deletes that child's data with that trainer (history preserved), and immediately hides the child from that trainer's roster.
- **FR-033**: Each child profile has independent, per-trainer training calendar, RSVP status, attendance, and availability preferences.
- **FR-034**: Child may optionally get its own login (shares the parent's contact info on file; still requires parent approval for purchases). Context selector for a child-with-login shows only that child's own trainer contexts, no "Me"/parent section.

### Player/Parent — Purchase Approval (US-01.05)

- **FR-040**: Any USD-denominated purchase initiated by a logged-in child always requires parent approval. Acceptance: checkout by a child sets status "Pending Parent Approval"; parent notified by email + in-app; parent can Approve (payment proceeds — actual payment processing is Epic-05, out of scope; this epic only owns the approval state machine and hand-off), Deny (child notified, no charge), or add notes; child UI reflects Pending → Confirmed/Denied.
- **FR-041**: Token-spending approval is governed by a per-child setting "Allow token spending without approval" (default OFF). When OFF, behaves identically to FR-040. When ON, the child's token spend proceeds immediately and the parent gets an informational (non-blocking) notification only. Parent can change this setting anytime.
- **FR-042**: Pending approval requests auto-expire 48 hours after creation with an auto-deny + notification to both parties.

### Player/Parent — Child Login Constraints (US-01.06)

- **FR-050**: A child-account session is restricted to: browse/RSVP/cancel-RSVP (approval-gated), view purchased content, view own progress, submit feedback requests, edit basic profile fields, view (not purchase) tokens, and switch between its own trainer contexts.
- **FR-051**: A child account is blocked from: registering via a new ShareLink, managing payment methods, purchasing tokens, completing unapproved purchases, deleting its account, changing trainer associations, and viewing the parent's own training data.
- **FR-052**: When a logged-in child clicks a trainer ShareLink, registration is blocked with an explanatory message, and the parent is emailed the link with a "Review Registration" CTA; the child is **not** associated with the new trainer until the parent completes it.

### Coach (US-01.08, US-01.10, US-01.11 subset)

- **FR-060**: Trainer invites a coach by email (+ optional name/message) via a unique, single-use, 7-day-expiry ShareLink; invite email sent; trainer can see invite status (Pending/Accepted/Expired) and resend on expiry.
- **FR-061**: A coach can be active under exactly one trainer at a time; attempting to accept an invite while already active elsewhere is rejected with a clear error.
- **FR-062**: Coach sets recurring weekly availability ("My Times") with multiple time ranges per day.
- **FR-063**: When a trainer assigns a coach to a conflicting time slot, the system warns ("not available per their schedule — continue anyway?"); trainer may override by supplying a required text reason; the override is logged (event id, coach id, trainer id, reason, timestamp); the coach is not blocked from being assigned and can accept/request a change afterward.
- **FR-064**: Coach edits own public profile (bio, credentials, certifications, public-profile visibility toggle).

### Trainer (US-01.09 trainer-view, US-01.14)

- **FR-070**: Trainer views player availability ("Best Times") as a scheduling aid: per-player summary ("Mon 5–8pm, Wed 6–9pm"), and a filter for "players available at [day/time]" usable during event planning/CRM browsing (minimal roster view only — full CRM is Epic-03, out of scope).
- **FR-071**: Trainer uploads a portal logo (PNG/JPG/SVG, max 2MB, auto-resized toward 200×200 recommendation) and picks a primary brand color (hex) with live preview and reset-to-default; changes apply immediately to all of that trainer's players/coaches/parents.

### Any Role — Profile (US-01.11)

- **FR-080**: Every user edits their own common profile fields (first/last name, phone, photo) plus role-specific fields (Player: school/jersey/photo; Parent: emergency contact; Coach: bio/credentials/certifications/public toggle; Trainer: business name/org details; Super Admin: notification prefs). Email, role, skill level (player), and created-date remain read-only from this surface.

### Availability (US-01.09, US-01.10 — shared)

- **FR-090**: Player/Parent sets availability per player profile (own or per-child) via a weekly grid (available/not-available or explicit time ranges per day); saved availability is immediately visible to trainers.

---

## Non-Functional Requirements

- **NFR-001**: Dashboard load < 2s; profile save < 1s; ShareLink registration < 2s.
- **NFR-002**: Users list with 10,000 rows paginates and loads < 3s.
- **NFR-003**: Platform sustains 1,000 concurrent users (epic-level target; drives pooling/caching decisions at `/architect`, not enforced by this decomposition alone).
- **NFR-004**: WCAG 2.1 AA on all Epic-01 frontend surfaces: full keyboard navigation, screen-reader support, visible focus states, sufficient color contrast (including trainer-custom brand colors — see Gap G-11).
- **NFR-005**: Responsive/touch-friendly on all screen sizes for every screen in section "Mockups" of the spec.
- **NFR-006**: Passwords hashed with an industry-standard slow hash (bcrypt/argon2) — never plaintext, never reversible.
- **NFR-007**: CSRF protection on all state-changing endpoints; secure, httpOnly session/refresh tokens; mitigations against XSS/token theft.

---

## Business Rules

- **BR-001**: Every user has exactly one role (Super Admin | Trainer | Coach | Player/Parent); role determines default dashboard and is enforced on both frontend and backend.
- **BR-002**: Trainers see/manage only their own organization's data (strict multi-tenancy).
- **BR-003**: Coaches are associated with exactly one trainer at a time — enforced at invite-acceptance time.
- **BR-004**: Players/Parents may associate with multiple trainers; each association is isolated (no merged view).
- **BR-005**: Only Super Admin can create Trainer accounts; no trainer self-registration.
- **BR-006**: Static player ShareLinks: unlimited uses, never expire. Unique coach ShareLinks: single use, 7-day expiry.
- **BR-007**: All players under 18 require a parent-managed account — no independent accounts for minors under 18 (this is stated as a firm rule in SPEC §9 "Parent/Child Relationships", which **resolves** the question posed inline in US-01.06 as "Open Question Q-01.05" — see Gap G-01 on the numbering/contradiction).
- **BR-008**: USD child purchases always require parent approval; token purchases require it unless the parent has explicitly opted a specific child out (per-child setting, default OFF = approval required).
- **BR-009**: Pending child-purchase approvals auto-expire and auto-deny after 48 hours.
- **BR-010**: Super Admin cannot impersonate another Super Admin; impersonation sessions hard-expire at 1 hour.
- **BR-011**: Deactivation (soft delete) preserves 100% of historical data and is reversible; deletion (GDPR) anonymizes PII irreversibly while preserving anonymized historical aggregates.
- **BR-012**: Coach availability conflicts never hard-block a trainer's assignment — only warn, and require a logged reason to override.
- **BR-013**: Email must be globally unique across all users regardless of role.

---

## Integration Requirements

- **INT-001**: Email service (transactional) — trainer invite, coach invite, password reset, email verification, ShareLink registration confirmation, child-purchase-approval request/decision, child-blocked-ShareLink parent notification, approval auto-expiry notice. Treated as a pluggable provider interface (e.g., an `EmailService` port) so the concrete provider (SES/SendGrid/etc.) is an infrastructure decision for `/architect`, not fixed here.
- **INT-002**: File storage — profile photos, trainer logos; needs thumbnail/resize generation for photos and logo auto-resize toward 200×200. Treated as a pluggable `FileStorageService` port.
- **INT-003 (forward reference, not built here)**: `ChildPurchaseApproval.eventId` and `CoachAvailabilityOverride.eventId` point at Epic-02 Event records that do not exist yet in this scope — stored as opaque UUID columns without a DB-level FK constraint until Epic-02 lands. No payment processing (Epic-05) is implemented; approval only manages the approve/deny state machine and hands off a boolean/status.

---

## Security Requirements

- **SEC-001**: RBAC enforced server-side on every endpoint (never trust client-side role checks alone).
- **SEC-002**: Multi-tenant data isolation enforced at the query layer (every trainer-scoped query filtered by the caller's trainer context; guards/interceptors, not app-layer convention alone).
- **SEC-003**: Impersonation: block targeting Super Admin accounts; stamp every write made during an impersonated session with both the acting admin id and the impersonated user id; auto-expire at 1 hour.
- **SEC-004**: Rate-limit authentication endpoints (login, password-reset request, registration) to blunt brute force / enumeration.
- **SEC-005**: GDPR delete must produce a verifiably irreversible anonymization (no code path can "undo" it) while a legally-retained backup snapshot exists in a separate, access-controlled audit store.
- **SEC-006**: Child accounts are permission-constrained at the API layer, not just hidden in the UI (FR-051 must hold even against direct API calls).

---

## Task Breakdown

### Entities (Prisma models, `apps/server`)

| Entity | Key Properties | Relations |
|---|---|---|
| `User` | id, email (unique), passwordHash, role (enum: SUPER_ADMIN, TRAINER, COACH, PLAYER_PARENT), status (enum: ACTIVE, INACTIVE, DELETED), emailVerifiedAt, lastLoginAt, createdAt, updatedAt, deletedAt | 1:1 TrainerProfile / CoachProfile; 1:N PlayerProfile (as account owner); 1:1 PlayerProfile (as child's own login, optional) |
| `TrainerProfile` | id, userId (FK, unique), businessName, address, website, description, logoUrl, primaryColorHex, stripeCustomerId (nullable, Epic-05 stub), subscriptionStatus (nullable stub), platformFeePercent (nullable stub) | belongs to User; 1:N CoachProfile, PlayerTrainerAssociation, ShareLink |
| `CoachProfile` | id, userId (FK, unique), trainerId (FK), bio, credentials, certifications, publicProfile (bool), status (enum: PENDING, ACTIVE), joinedAt | belongs to User; belongs to TrainerProfile (exactly one) |
| `PlayerProfile` | id, accountUserId (FK, the responsible/owning User — parent or self), childUserId (FK, nullable unique — set only if the child has its own login), name, dateOfBirth, gender, skillLevel (enum, MVP default set — see Gap G-02), school, jerseyNumber, photoUrl, isSelf (bool), allowChildTokenSpendWithoutApproval (bool, default false), emergencyContact (json/nullable), createdAt, updatedAt, deletedAt | belongs to User (accountUserId); optionally belongs to User (childUserId); 1:N PlayerTrainerAssociation, Availability |
| `PlayerTrainerAssociation` | id, trainerId (FK), playerProfileId (FK), shareLinkId (FK, nullable), status (enum: ACTIVE, INACTIVE), connectedAt, disconnectedAt | join table Trainer ↔ PlayerProfile |
| `ShareLink` | id, code (unique, URL-safe), type (enum: PLAYER_STATIC, COACH_UNIQUE), trainerId (FK), createdByUserId (FK), targetEmail (nullable, coach type only), expiresAt (nullable), maxUses (nullable), useCount (default 0), status (enum: ACTIVE, EXPIRED, REVOKED), createdAt | belongs to TrainerProfile |
| `Availability` | id, subjectType (enum: PLAYER, COACH), playerProfileId (FK, nullable), coachProfileId (FK, nullable), dayOfWeek, startTime, endTime, isAvailable (bool), createdAt, updatedAt | belongs to PlayerProfile OR CoachProfile (exclusive) |
| `CoachAvailabilityOverride` | id, eventId (opaque UUID, no FK — Epic-02 forward ref), coachId (FK), trainerId (FK, who overrode), reason (required text), createdAt | belongs to CoachProfile, TrainerProfile |
| `ImpersonationLog` | id, adminUserId (FK), targetUserId (FK), startedAt, endedAt (nullable), durationSeconds (computed/nullable until end), createdAt | belongs to User (x2) |
| `ChildPurchaseApproval` | id, playerProfileId (FK, child), parentUserId (FK), eventId (opaque UUID, no FK — Epic-02 forward ref), amount, paymentType (enum: USD, TOKEN), status (enum: PENDING, APPROVED, DENIED, EXPIRED), parentNotes, requestedAt, respondedAt (nullable), expiresAt | belongs to PlayerProfile, User |
| `UserDeletionLog` | id, originalUserId, originalEmail, deletedByUserId (FK), reason, deletedAt, dataBackupJson | belongs to User (deletedBy) |
| `EmailVerificationToken` | id, userId (FK), token (hashed), expiresAt, usedAt | belongs to User |
| `PasswordResetToken` | id, userId (FK), token (hashed), expiresAt, usedAt | belongs to User |
| `RefreshToken` | id, userId (FK), tokenHash, expiresAt, createdAt, revokedAt | belongs to User (session/JWT refresh persistence — see Gap G-07) |

*Note: Portal branding fields (`logoUrl`, `primaryColorHex`) are folded into `TrainerProfile` rather than a separate table — MVP scope is exactly logo + one color, not worth a separate entity.*

### Services (`apps/server`)

| Service | Purpose | Key Methods |
|---|---|---|
| `AuthService` | Credential auth, tokens, verification, reset | register, login, logout, refreshSession, verifyEmail, requestPasswordReset, resetPassword, validateUser |
| `UserService` | Cross-role user CRUD, admin directory, lifecycle | createTrainer, findAllPaginated, findById, updateProfile, deactivate, reactivate, gdprDelete |
| `CoachService` | Coach invite/accept lifecycle, profile | inviteCoach, acceptInvite, listByTrainer, updateProfile, checkSingleTrainerConstraint |
| `PlayerProfileService` | Self/child profile CRUD, trainer-selection prompts | createSelfProfile, createChildProfile, listChildrenWithTrainers, updateProfile |
| `PlayerTrainerAssociationService` | Associate/disassociate, multi-trainer context data | associate, disassociate (soft), listContextsForUser, listRosterForTrainer |
| `ShareLinkService` | Generate/validate/redeem/revoke links | generatePlayerLink, generateCoachLink, redeem, revoke, listByTrainer, incrementUsage |
| `AvailabilityService` | Player + coach availability CRUD, conflict check | setPlayerAvailability, setCoachAvailability, getSummaryForPlayer, checkCoachConflict |
| `ChildPurchaseApprovalService` | Approval state machine + expiry | createRequest, approve, deny, expireStale (scheduled job) |
| `ImpersonationService` | Start/end/log impersonation, admin-target guard | start, end, assertNotTargetingSuperAdmin, getHistory |
| `PortalBrandingService` | Logo/color update on TrainerProfile | updateLogo, updateColor, resetToDefault |
| `EmailService` | Provider-agnostic transactional email port | sendTrainerInvite, sendCoachInvite, sendVerification, sendPasswordReset, sendShareLinkConfirmation, sendChildApprovalRequest, sendChildApprovalDecision, sendChildBlockedShareLink |
| `FileStorageService` | Provider-agnostic upload/resize port | uploadPhoto, uploadLogo, generateThumbnail |

### Controllers (`apps/server`)

| Controller | Endpoints (indicative) | Purpose |
|---|---|---|
| `AuthController` | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password` | Authentication flows |
| `UsersController` | `GET/POST/PATCH /users`, `POST /users/:id/deactivate`, `POST /users/:id/reactivate`, `DELETE /users/:id` (GDPR) | Super Admin user directory + lifecycle |
| `TrainersController` | `POST /trainers` (Super Admin create), `GET/PATCH /trainers/:id`, `PATCH /trainers/:id/branding` | Trainer account + branding |
| `CoachesController` | `POST /coaches/invite`, `POST /coaches/accept/:shareLinkCode`, `GET /trainers/:id/coaches`, `PATCH /coaches/:id` | Coach invite + roster |
| `PlayerProfilesController` | `GET/POST/PATCH /player-profiles`, `GET /player-profiles/:id/trainers` | Player/child profile CRUD |
| `ShareLinksController` | `POST /share-links`, `GET /share-links/:code`, `POST /share-links/:code/redeem`, `DELETE /share-links/:id` | ShareLink lifecycle |
| `AvailabilityController` | `GET/PUT /player-profiles/:id/availability`, `GET/PUT /coaches/:id/availability`, `POST /coaches/:id/availability/override` | Best Times / My Times / overrides |
| `ChildApprovalsController` | `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/deny` | Parent approval queue |
| `ImpersonationController` | `POST /impersonation/start`, `POST /impersonation/end`, `GET /impersonation/history` | Super Admin impersonation |

### Frontend (`apps/client`, Next.js App Router)

| Route / Component | Purpose |
|---|---|
| `/login`, `/forgot-password`, `/reset-password`, `/verify-email` | Auth screens |
| `/join/[code]` (`ShareLinkJoinPage`) | Registration landing from a ShareLink, handles logged-in vs. anonymous branches |
| `(super-admin)/users`, `UsersTable`, `UserCreateModal` | Global user directory + trainer creation |
| `(super-admin)/impersonation-history` | Audit report |
| `ImpersonationBanner` (global layout component) | Sticky "Viewing as X" banner |
| `(trainer)/dashboard`, `(trainer)/coaches`, `CoachInviteForm` | Trainer coach management |
| `(trainer)/players`, minimal roster view w/ availability filter | Scheduling aid (not full CRM) |
| `(trainer)/share-links`, `ShareLinkGenerator`, `ShareLinkList` | ShareLink management |
| `(trainer)/branding`, `BrandingSettingsForm` | Logo + color picker |
| `(coach)/dashboard`, `(coach)/my-times`, `AvailabilityGrid` (shared component) | Coach availability |
| `(coach)/profile` | Coach public profile edit |
| `(player)/dashboard`, `ContextSwitcher` (global layout component) | Multi-trainer / parent-child context switching |
| `(player)/profiles`, `PlayerProfileCard`, `ChildProfileForm` | Family/player profile management |
| `(player)/availability` (reuses `AvailabilityGrid`) | Best Times |
| `(player)/approvals`, `PendingApprovalsList` | Parent purchase approvals |
| `(shared)/account/profile`, `ProfileEditForm` | Universal profile edit, role-aware fields |

### Testing Tasks

- **Unit**: every Service above (state machines: impersonation start/end/expiry, approval approve/deny/expiry, ShareLink redeem/expiry/usage-limit, soft-delete vs. GDPR-delete field transforms, coach single-trainer constraint).
- **Integration**: every Controller (RBAC guard enforcement per endpoint, multi-tenant isolation — trainer A cannot read trainer B's players/coaches/ShareLinks, child-account permission boundary at the API layer, rate limiting on `/auth/*`).
- **E2E**: the 7 user flows in SPEC §10 (ShareLink registration incl. multi-trainer prompt; child profile creation; child purchase approval end-to-end; Super Admin create-trainer → impersonate → exit; trainer invites coach incl. expiry/single-use; coach sets availability → trainer overrides with reason; GDPR delete anonymization correctness).
- **Security**: role-boundary tests (each role attempting every other role's actions), impersonation-of-Super-Admin rejection, deleted-user data confirmed anonymized and non-reversible, password hashing/complexity, brute-force rate limiting.
- **Performance**: 10k-user paginated list <3s; dashboard <2s; ShareLink registration under concurrent load.

---

## Gap Analysis

Genuinely ambiguous items were resolved with an explicit MVP default below rather than blocking. All defaults should be confirmed with the client before/alongside `/architect`.

| ID | Gap | MVP Default Applied | Needs Your Decision? |
|---|---|---|---|
| G-01 | Spec's open-questions table (§12) lists `Q-01.05` = "email verification required?" but a *different* inline "Open Question (Q-01.05)" inside US-01.06 asks about minor account policy — a duplicate ID for two different questions. The minor-policy question is actually **already answered** by SPEC §9 business rule ("ALL players under 18 require parent-managed accounts") — treated as resolved (BR-007), not open. | Used BR-007 as the binding rule; treated the inline US-01.06 question as stale/superseded text. | Recommend confirming with client that BR-007 is final and the inline question can be deleted from the spec. |
| G-02 | Q-01.01: skill level definitions undefined. | Default enum `BEGINNER \| INTERMEDIATE \| ADVANCED \| ELITE`, trainer-settable per player, no further tiers. | Yes — confirm labels/count before UI copy is finalized. |
| G-03 | Q-01.02: age group definitions undefined. | Not modeled as a separate concept for Epic-01 — store `dateOfBirth` on `PlayerProfile`, derive age on read; no age-tier/grade grouping built (nothing in the 14 user stories requires it). | Only if a later epic needs cohort/grade grouping. |
| G-04 | Q-01.04: which automated emails are required is unspecified beyond scattered mentions. | Built exactly the 8 transactional emails enumerated in INT-001 (derived from what the 14 user stories explicitly call for) — no marketing/digest emails. | Confirm no email was missed (e.g., is a "welcome" email wanted for ShareLink self-registration on top of the "confirmation email" already required by US-01.02?). |
| G-05 | Q-01.05 (table version): is email verification required before login? | MVP default: **not** blocking — matches the "<5 minutes onboarding" and "95% self-service" success metrics in §2. Unverified accounts see a persistent reminder banner and re-send option; verification is not gated on any Epic-01 action. | Yes — this is P1 in the spec; needs explicit client sign-off since it affects security posture. |
| G-06 | Q-01.06: should a coach be notified when a trainer overrides their availability? | Default: yes — in-app + email notification on override (cheap, avoids silent surprise assignment). | Low priority (P2 per spec) but confirm before building notification. |
| G-07 | Q-01.07: session/token duration unspecified. | Default: short-lived access token (15 min) + sliding refresh token (7 days), httpOnly secure cookie storage. Also decided (not asked by spec, but required to build anything): JWT access + opaque refresh token persisted in `RefreshToken` table for revocation support, rather than server-side session store — flagged for `/architect` to ratify or override. | Yes — both the duration (P2) and the underlying session mechanism (architecture decision) need sign-off. |
| G-08 | "Camp-to-User Conversion" is listed under Player/Parent features "In Scope (MVP)" in SPEC §3, but its own bullet says "Integration with Epic-08" — Epic-08 is out of scope for this pass and doesn't exist yet. | **Excluded** from this task's decomposition entirely; no entity/service/controller/route above implements it. | Confirm exclusion is acceptable, or tell us if a stubbed/no-op version is wanted now. |
| G-09 | `ChildPurchaseApproval` and `CoachAvailabilityOverride` must reference an `eventId` that belongs to Epic-02 (Event Management), which doesn't exist in this codebase yet. | Modeled `eventId` as an opaque UUID column with no DB foreign-key constraint (to be wired with a real FK migration once Epic-02 lands). Similarly, `ChildPurchaseApproval.amount`/`paymentType` capture only the approval state machine — no real payment processing (Epic-05) is implemented; "Approve" only flips status, it does not charge anything. | Recommend `/architect` explicitly documents this as a deliberate forward-reference seam. |
| G-10 | Spec document itself has structural defects: section numbering restarts at "10" twice (§10 "User Flows" then later another §10 "Acceptance Criteria (Epic-Level)"), `Q-01.03` is skipped entirely in the open-questions table, and the footer states "User Stories: 12" while the document actually contains 14 (US-01.01–US-01.14, including the two open-question / numbering issues above). | Treated the document as having 14 real user stories; ignored the stale "12" count; no content assumed to be missing at `Q-01.03`. | Informational only — recommend fixing the source spec file's numbering for future epics' consistency. |
| G-11 | NFR-004 (WCAG AA) versus FR-071 (trainer-chosen arbitrary brand color used for UI accents) can conflict — a trainer could pick a color that fails contrast requirements against text/background. | Not resolved by spec. MVP default proposed: validate a minimum contrast ratio against white/black text at color-picker time and warn (non-blocking) if it fails AA; full enforcement is a UI/design decision for `/architect` or `frontend-design`. | Yes — needs a UX/architecture decision, not purely a requirements one. |
| G-12 | "Trainer views player availability" / minimal roster (FR-070) borders on Epic-03 (CRM & Player Management), which is out of scope. | Built the narrowest slice explicitly required by US-01.09's "Trainer View" AC (list + availability summary + day/time filter) and nothing else — no notes, tags, pipeline stages, or other CRM concepts. | Confirm this narrow slice is sufficient for the Epic-01 demo, given full CRM lands in Epic-03. |

---

## Next Steps (Suggested)

**Next by flow:** `/brainstorm TASK-001: Epic-01 requirements analyzed — 14 user stories decomposed into 14 entities, 11 services, 9 controllers, and ~20 frontend routes/components across auth, RBAC, ShareLink invitations, parent/child multi-trainer contexts, coach availability, and Super Admin tools (impersonation/soft-delete/GDPR-delete/branding). 12 gap-analysis items logged with MVP defaults (see table above), several needing your sign-off (G-01, G-02, G-04, G-05, G-07, G-08, G-11 are the ones most likely to change the build).` — Refine into a concrete design through collaborative dialogue, especially to settle G-05 (email verification enforcement) and G-07 (session/token strategy) before architecture is locked.

**Alternatives:**
- `/architect TASK-001: [same context]` — Skip brainstorming if you're comfortable with the MVP defaults above and want to jump straight to system design (module boundaries, guard/interceptor strategy for multi-tenancy, JWT vs. session mechanism for G-07).
- `/writing-plans TASK-001: [same context]` — Only if you consider the design already settled and want an implementation plan directly.
