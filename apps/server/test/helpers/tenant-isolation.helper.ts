import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// Task 3.12 (arch §8 Layer 3): "For every tenant-owned controller the
// integration suite includes a 'trainer B cannot read/modify trainer A's
// row -> 404 (not 403)' case. This is a Definition-of-Done item, not
// optional." This file is the reusable fixture that case is built on —
// established here (trainers.e2e-spec.ts, the first tenant-owned
// controller in the plan) so later phases' own isolation tests (Tasks
// 4.15, 5.14, 6.5, for coaches/associations/availability) import
// `seedTrainerPair` instead of re-deriving their own two-trainers-and-
// tokens setup.
//
// Deliberately DB-seeding only, not token-signing: every e2e spec file in
// this codebase resolves its own JwtService from its own compiled
// TestingModule (Test.createTestingModule({ imports: [AppModule] })) in
// its own beforeAll, so a shared helper cannot own that half without
// either taking a JwtService as a parameter (adds a parameter every call
// site would have to thread through) or constructing its own — both worse
// than just letting each spec file sign its own token the same one-line
// way it already does for its non-tenant-isolation tests.
export const TENANT_ISOLATION_FIXTURE_PASSWORD = 'CorrectHorseBattery1';

export interface SeededTrainer {
  userId: string;
  trainerId: string;
  email: string;
}

export interface TrainerPair {
  trainerA: SeededTrainer;
  trainerB: SeededTrainer;
}

export async function seedOneTrainer(
  prisma: PrismaClient,
  overrides: Record<string, unknown> = {},
): Promise<SeededTrainer> {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  await prisma.user.create({
    data: {
      id: userId,
      email,
      passwordHash: await argon2.hash(TENANT_ISOLATION_FIXTURE_PASSWORD),
      role: 'TRAINER',
      firstName: 'Trainer',
      lastName: userId.slice(0, 8),
      status: 'ACTIVE',
    },
  });

  const trainerId = randomUUID();
  await prisma.trainerProfile.create({
    data: { id: trainerId, userId, businessName: `Business ${userId.slice(0, 8)}`, ...overrides },
  });

  return { userId, trainerId, email };
}

/** Two independent TRAINER accounts (each with their own User + TrainerProfile), for a "B cannot touch A" assertion. */
export async function seedTrainerPair(
  prisma: PrismaClient,
  overrides: { a?: Record<string, unknown>; b?: Record<string, unknown> } = {},
): Promise<TrainerPair> {
  const [trainerA, trainerB] = await Promise.all([
    seedOneTrainer(prisma, overrides.a),
    seedOneTrainer(prisma, overrides.b),
  ]);
  return { trainerA, trainerB };
}
