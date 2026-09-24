import { Injectable } from '@nestjs/common';
import type { Availability, CoachAvailabilityOverride, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface AvailabilitySlotInput {
  dayOfWeek: number;
  startTime: number;
  endTime: number;
  isAvailable: boolean;
}

// Task 6.3 (api §4.5 "POST /coaches/:id/availability/override"). Mirrors
// `Prisma.CoachAvailabilityOverrideCreateInput`'s scalar shape without the
// relation-object form — the caller (AvailabilityService.createOverride)
// already has plain ids for both, not loaded `CoachProfile`/`TrainerProfile`
// instances.
export interface CreateOverrideInput {
  eventId: string;
  coachId: string;
  trainerId: string;
  reason: string;
}

// Task 5.11 (api §4.5), extended in Task 6.1 (coach slots) and Task 6.3
// (`CoachAvailabilityOverride`). `Availability` is not one of the five
// tenant-owned models (tenant-guard.extension.ts) and carries no
// `deletedAt` either (soft-delete.extension.ts) — every `Availability`
// query here uses the base client. `CoachAvailabilityOverride` IS
// tenant-owned, but `createOverride` still uses the base client too
// (`create`'s args have no `where` for the extension to check — see that
// method's own comment).
@Injectable()
export class AvailabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSlotsForPlayer(playerProfileId: string): Promise<Availability[]> {
    return this.prisma.availability.findMany({
      where: { subjectType: 'PLAYER', playerProfileId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  /**
   * Task 5.11 (FR-090 "full replace" — weekly grid semantics). Delete +
   * recreate inside one transaction, not a diff/upsert — a `PUT` body is
   * the caller's complete desired state, and a slot has no natural business
   * key to upsert against beyond the full `(dayOfWeek, startTime, endTime)`
   * tuple, which changes on every edit anyway.
   */
  async replaceSlotsForPlayer(playerProfileId: string, slots: AvailabilitySlotInput[]): Promise<Availability[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({ where: { subjectType: 'PLAYER', playerProfileId } });

      if (slots.length > 0) {
        await tx.availability.createMany({
          data: slots.map((slot) => ({ subjectType: 'PLAYER' as const, playerProfileId, ...slot })),
        });
      }

      return tx.availability.findMany({
        where: { subjectType: 'PLAYER', playerProfileId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  }

  /**
   * Task 6.1 (api §4.5 "GET /coaches/:id/availability", FR-062 "My Times")
   * / Task 6.2 (conflict-check's own slot lookup). `dayOfWeek` is optional —
   * the GET endpoint wants the full weekly grid, ConflictCheckService only
   * ever needs one day's slots.
   */
  async findSlotsForCoach(coachProfileId: string, dayOfWeek?: number): Promise<Availability[]> {
    return this.prisma.availability.findMany({
      where: { subjectType: 'COACH', coachProfileId, ...(dayOfWeek !== undefined ? { dayOfWeek } : {}) },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  /** Task 6.1 (FR-062). Same delete + recreate full-replace semantics as `replaceSlotsForPlayer` above — see that method's comment. */
  async replaceSlotsForCoach(coachProfileId: string, slots: AvailabilitySlotInput[]): Promise<Availability[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.availability.deleteMany({ where: { subjectType: 'COACH', coachProfileId } });

      if (slots.length > 0) {
        await tx.availability.createMany({
          data: slots.map((slot) => ({ subjectType: 'COACH' as const, coachProfileId, ...slot })),
        });
      }

      return tx.availability.findMany({
        where: { subjectType: 'COACH', coachProfileId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
    });
  }

  /**
   * Task 6.3 (api §4.5 "POST /coaches/:id/availability/override", FR-063/
   * BR-012). Base client, not `.extended` — `create`'s args have no `where`
   * for the tenant-guard extension to check (same reason
   * `ShareLinksRepository.create` uses the base client, see that file's
   * comment); `AvailabilityService.createOverride` has already proven the
   * caller is the employing trainer before this is called. Must be called
   * INSIDE the caller's own `$transaction` alongside the
   * `OutboxJob(EMAIL_COACH_OVERRIDE_NOTIFY)` enqueue (arch §13.2) — the audit
   * row and the notification commit together or not at all.
   */
  async createOverride(data: CreateOverrideInput, tx: Prisma.TransactionClient): Promise<CoachAvailabilityOverride> {
    return tx.coachAvailabilityOverride.create({ data });
  }
}
