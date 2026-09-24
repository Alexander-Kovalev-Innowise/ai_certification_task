# Tenant-Isolation Test Checklist (Task 9.4)

Per `specs/architect-architecture.md` §8 Layer 3: every controller touching a
tenant-owned model (`TrainerProfile`, `CoachProfile`,
`PlayerTrainerAssociation`, `ShareLink`, `CoachAvailabilityOverride`) must be
covered by a test proving that a **different trainer** addressing another
trainer's resource by id gets `404` — never `403` — to avoid confirming a
resource's existence to someone outside the tenant.

This is a **verification pass**: the sweep audited every controller method
that reads or writes one of the five models above, cross-referenced it
against `apps/server/test/**/*.e2e-spec.ts`, and confirmed the actual
service-layer check exists (not just the test). **No code gap was found** —
every tenant-scoped `:id` route already has a cross-tenant isolation test,
using the `seedTrainerPair` (Task 3.12) fixture convention. One deliberate,
already-documented status-code nuance is called out below (not a gap).

## Checklist

| Controller.method | Route | Model | Isolation test | Service-layer check |
|---|---|---|---|---|
| TrainersController.getTrainer | `GET /trainers/:id` | TrainerProfile | `test/trainers.e2e-spec.ts:200`, `:328` | `assertOwnershipOrNotFound` → 404 |
| TrainersController.updateTrainer | `PATCH /trainers/:id` | TrainerProfile | `test/trainers.e2e-spec.ts:237`, `:340` | 404 |
| TrainersController.updateBranding | `PATCH /trainers/:id/branding` | TrainerProfile | `test/trainers.e2e-spec.ts:448` | 404 (see note 1) |
| CoachesController.listCoaches | `GET /trainers/:id/coaches` | CoachProfile, ShareLink | `test/coaches.e2e-spec.ts:226` | 404 |
| CoachesController.updateCoach | `PATCH /coaches/:id` | CoachProfile | `test/coaches.e2e-spec.ts:326` | 404 |
| AssociationsController.listRosterForTrainer | `GET /trainers/:id/players` | PlayerTrainerAssociation | `test/associations.e2e-spec.ts:395`, `:438` | 404 |
| CoachAvailabilityController.getCoachAvailability | `GET /coaches/:id/availability` | CoachProfile | `test/availability.e2e-spec.ts:549` (`getRes`) | 404 |
| CoachAvailabilityController.setCoachAvailability | `PUT /coaches/:id/availability` | CoachProfile | `test/availability.e2e-spec.ts:293`, `:307`, `:549` (`putRes`) | 403, deliberate (see note 2) |
| CoachAvailabilityController.checkConflict | `GET /coaches/:id/availability/check` | CoachProfile | `test/availability.e2e-spec.ts:415`, `:569` | 403, deliberate (see note 2) |
| CoachAvailabilityController.createOverride | `POST /coaches/:id/availability/override` | CoachProfile, CoachAvailabilityOverride | `test/availability.e2e-spec.ts:442`, `:569` | 403, deliberate (see note 2) |
| ShareLinksController.listShareLinks | `GET /trainers/:id/share-links` | ShareLink | `test/share-links.e2e-spec.ts:292` | 404 |
| ShareLinksController.revokeShareLink | `DELETE /share-links/:id` | ShareLink | `test/share-links.e2e-spec.ts:344` | 404 |

### Routes correctly excluded (no cross-tenant `:id` to probe)

| Controller.method | Route | Why no isolation test applies |
|---|---|---|
| TrainersController.createTrainer | `POST /trainers` | SUPER_ADMIN-only creation, no existing id to target |
| CoachesController.inviteCoach | `POST /coaches/invite` | Scoped to caller's own `ctx.trainerId`, no foreign `:id` |
| ShareLinksController.createShareLink | `POST /share-links` | Scoped to caller's own `ctx.trainerId` |
| ShareLinksController.previewShareLink | `GET /share-links/:code` | `@Public()`; arch §9.1 requires it never 404 (enumeration-safety) — returns `200 {valid:false}` instead, by design |
| ShareLinksController.redeemShareLink | `POST /share-links/:code/redeem` | Redemption is inherently cross-tenant (any caller redeems any trainer's link) by design |
| AssociationsController.listContexts | `GET /me/contexts` | Scoped to caller's own userId |
| AssociationsController.addTrainerAssociation / removeTrainerAssociation | `POST`/`DELETE /player-profiles/:id/trainers[/:trainerId]` | Ownership gate is **family** (does the caller own/guardian this `playerProfileId`), not trainer tenancy — a different, already-tested isolation axis (`test/associations.e2e-spec.ts` CHILD-capability and "unknown association" cases; family ownership covered in `test/player-profiles.e2e-spec.ts`) |
| PlayerProfilesController.listTrainersForProfile | `GET /player-profiles/:id/trainers` | Same family-ownership axis as above |

## Notes

1. **`PATCH /trainers/:id/branding`** — the plan's own Task 8.3 wording said
   "non-owning trainer -> 403", but the endpoint was implemented as `404` for
   consistency with `PATCH /trainers/:id` (same controller, same
   `TrainerProfile` resource) and arch §8 Layer 3's blanket rule. Already
   flagged in-code (`test/trainers.e2e-spec.ts:437-447`) for product/plan
   sign-off — re-confirmed correct by this sweep, no action taken.

2. **`PUT /coaches/:id/availability`, `GET /coaches/:id/availability/check`,
   `POST /coaches/:id/availability/override`** — these three return `403`,
   not `404`, for a *cross-tenant* trainer B probing trainer A's coach
   (`test/availability.e2e-spec.ts:549` and `:569`, using the same
   `seedTrainerPair` fixture as every other Layer 3 test in this checklist).
   This is a **deliberate, spec-documented exception**, not an oversight:
   `api-designer-spec.md` §4.5's own status-code table explicitly lists
   `403 FORBIDDEN (PUT by non-owner)` alongside `404 NOT_FOUND` for this
   controller, and `availability.service.ts` (`setCoachAvailability`,
   `resolveEmployedCoachOrThrow`) and `conflict-check.service.ts` both carry
   comments citing that table as the reason. The distinction the api spec
   draws is: these three are *ownership-restricted-to-one-specific-coach*
   writes/reads (even a coworker coach under the *same* trainer gets `403`,
   `test/availability.e2e-spec.ts:307`) — not a general cross-tenant
   existence-disclosure case, which is what arch §8 Layer 3's blanket rule
   targets and which the plain `GET` on the same resource still honors as
   `404`. Both status codes are exercised by real cross-tenant tests; nothing
   here is untested. No action taken — recorded for awareness, since the
   general rule's wording ("not optional") could otherwise read as covering
   these three without the api spec's own carve-out.

## Conclusion

Every tenant-owned-model controller has real, `seedTrainerPair`-driven
cross-tenant coverage at the correct layer (service check exists and is
tested), so **Task 9.4 found no gap to fix**. The two notes above are
pre-existing, already-documented, deliberate spec decisions re-confirmed
correct by this sweep, not new findings requiring a code change.
