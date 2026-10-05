/**
 * Bulk-seeds a throwaway PERF database with a realistic Epic-01 data set:
 * PERF_USER_COUNT users (default 10,000) plus the rows the list/dashboard/roster
 * endpoints join against (trainer profiles, coach profiles, player profiles,
 * trainer associations, availability, share links, impersonation history).
 *
 * Run by `npm run perf` (see scripts/perf/run.cjs) against the isolated
 * `practiceperfect_perf` database; can also be run on its own:
 *   DATABASE_URL=... ts-node scripts/perf/seed-users.ts
 *
 * Deterministic (seeded PRNG), idempotent (skips when the marker user exists),
 * and fast: a single argon2 hash is computed once and shared by every user, rows
 * go in with createMany in chunks.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });

// Same parameters as PasswordService (arch §6.1) so a seeded user logs in through the real verify path.
const ARGON2ID_OPTIONS: argon2.Options = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const USER_COUNT = Number(process.env.PERF_USER_COUNT ?? 10_000);
const PASSWORD = process.env.PERF_USER_PASSWORD ?? 'PerfLoad2026x';
const CHUNK = 2_000;

/** Marker user: its presence means this database was already seeded. */
export const BIG_TRAINER_EMAIL = 'perf.bigtrainer@example.com';
/** Reusable PLAYER_STATIC link of the big trainer — the load test registers new players through it. */
export const BIG_TRAINER_SHARE_CODE = 'PerfStaticBigTrainer';

// ---------------------------------------------------------------------------
// deterministic helpers
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261005);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara',
  'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa',
  'Anthony', 'Betty', 'Mark', 'Margaret', 'Steven', 'Sandra', 'Paul', 'Ashley', 'Andrew', 'Emily', 'Joshua', 'Donna',
  'Kenneth', 'Michelle', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa', 'Timothy', 'Deborah', 'Ronald', 'Laura',
  'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Mia', 'Lucas',
] as const;
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
  'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott',
  'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Kowalski', 'Novak', 'Petrov', 'Silva', 'Costa', 'Rossi', 'Muller', 'Schmidt',
] as const;
const CITIES = ['Austin', 'Denver', 'Seattle', 'Atlanta', 'Boston', 'Phoenix', 'Portland', 'Miami', 'Dallas', 'Chicago'] as const;
const SPORTS = ['Tennis', 'Soccer', 'Basketball', 'Swimming', 'Hockey', 'Baseball', 'Volleyball', 'Golf'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
const SKILLS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ELITE'] as const;

const DAY_MS = 86_400_000;

type UserRow = Prisma.UserCreateManyInput & { id: string };

async function insertChunks<T>(label: string, rows: T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await insert(rows.slice(i, i + CHUNK));
  }
  console.log(`  ${label}: ${rows.length}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('Seed aborted: DATABASE_URL is not set.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const started = Date.now();

  try {
    if (await prisma.user.findUnique({ where: { email: BIG_TRAINER_EMAIL }, select: { id: true } })) {
      console.log(`[perf:seed] already seeded (${BIG_TRAINER_EMAIL} exists); skipping.`);
      return;
    }

    console.log(`[perf:seed] seeding ${USER_COUNT} users ...`);
    const passwordHash = await argon2.hash(PASSWORD, ARGON2ID_OPTIONS); // computed once, shared by every user
    const now = Date.now();

    // ---- role plan: 4 admins, 2% trainers, 8% coaches, the rest players/parents ------------------
    const adminCount = 4;
    const trainerCount = Math.max(1, Math.round(USER_COUNT * 0.02));
    const coachCount = Math.round(USER_COUNT * 0.08);
    const parentCount = USER_COUNT - adminCount - trainerCount - coachCount;

    const users: UserRow[] = [];
    const trainers: UserRow[] = [];
    const coaches: UserRow[] = [];
    const parents: UserRow[] = [];
    const admins: UserRow[] = [];

    const makeUser = (role: UserRow['role'], index: number, forceActive: boolean, emailOverride?: string): UserRow => {
      const id = randomUUID();
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      const statusRoll = rand();
      const status: UserRow['status'] = forceActive || statusRoll < 0.9 ? 'ACTIVE' : statusRoll < 0.97 ? 'INACTIVE' : 'DELETED';
      // Signups skew recent: ~45% in the last 90 days, the rest spread over ~18 months.
      const ageDays = Math.floor(Math.pow(rand(), 1.6) * 540);
      const createdAt = new Date(now - ageDays * DAY_MS - int(0, DAY_MS - 1));
      const deleted = status === 'DELETED';
      const row: UserRow = {
        id,
        email: deleted ? `deleted_${id}@example.com` : (emailOverride ?? `${firstName}.${lastName}.${users.length}@example.com`.toLowerCase()), // users.length: unique across roles
        passwordHash,
        role,
        status,
        firstName: deleted ? 'Deleted' : firstName,
        lastName: deleted ? 'User' : lastName,
        phone: deleted || rand() < 0.35 ? null : `+1415555${String(int(0, 9999)).padStart(4, '0')}`,
        emailVerifiedAt: rand() < 0.85 ? createdAt : null,
        lastLoginAt: status === 'ACTIVE' && rand() < 0.7 ? new Date(now - int(0, 30) * DAY_MS) : null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: deleted ? new Date(createdAt.getTime() + int(1, 60) * DAY_MS) : null,
      };
      users.push(row);
      return row;
    };

    for (let i = 0; i < adminCount; i += 1) admins.push(makeUser('SUPER_ADMIN', i, true));
    for (let i = 0; i < trainerCount; i += 1) {
      // trainer #0 is the "big trainer" (large roster); the first 25 always stay ACTIVE so the load test can log in as them
      trainers.push(makeUser('TRAINER', i, i < 25, i === 0 ? BIG_TRAINER_EMAIL : undefined));
    }
    for (let i = 0; i < coachCount; i += 1) coaches.push(makeUser('COACH', i, i < 50));
    for (let i = 0; i < parentCount; i += 1) parents.push(makeUser('PLAYER_PARENT', i, i < 300));

    // ---- related rows ---------------------------------------------------------------------------
    const trainerProfiles = trainers.map((u, i) => ({
      id: randomUUID(),
      userId: u.id,
      businessName: i === 0 ? 'Perf Big Academy' : `${pick(CITIES)} ${pick(SPORTS)} Academy ${i}`,
      address: `${int(1, 9999)} Main St, ${pick(CITIES)}`,
      createdAt: u.createdAt as Date,
      updatedAt: u.createdAt as Date,
    }));

    const coachProfiles = coaches.map((u, i) => {
      const roll = rand();
      const status = i < 50 || roll < 0.8 ? 'ACTIVE' : roll < 0.9 ? 'PENDING' : 'INACTIVE';
      return {
        id: randomUUID(),
        userId: u.id,
        trainerId: pick(trainerProfiles).id,
        bio: rand() < 0.5 ? 'Certified coach with several years of youth coaching experience.' : null,
        status: status as 'ACTIVE' | 'PENDING' | 'INACTIVE',
        joinedAt: u.createdAt as Date,
      };
    });

    const bigTrainerProfileId = trainerProfiles[0].id;
    const playerProfiles: Prisma.PlayerProfileCreateManyInput[] = [];
    for (const parent of parents) {
      const wantsSelf = rand() < 0.5;
      const children = wantsSelf ? int(0, 2) : int(1, 3);
      const count = (wantsSelf ? 1 : 0) + children;
      for (let k = 0; k < count; k += 1) {
        const isSelf = wantsSelf && k === 0;
        const born = new Date(now - (isSelf ? int(18, 45) : int(6, 17)) * 365 * DAY_MS - int(0, 364) * DAY_MS);
        const deleted = parent.status === 'DELETED';
        playerProfiles.push({
          id: randomUUID(),
          accountUserId: parent.id,
          name: deleted ? 'Deleted User' : isSelf ? `${parent.firstName} ${parent.lastName}` : `${pick(FIRST_NAMES)} ${parent.lastName}`,
          dateOfBirth: born,
          gender: pick(GENDERS),
          skillLevel: pick(SKILLS),
          isSelf,
          createdAt: parent.createdAt as Date,
          updatedAt: parent.createdAt as Date,
          deletedAt: deleted ? (parent.deletedAt as Date) : null,
        });
      }
    }

    // ~35% of profiles train with the big trainer, the rest are spread over the others; ~20% have a 2nd trainer.
    const associations: Prisma.PlayerTrainerAssociationCreateManyInput[] = [];
    for (const profile of playerProfiles) {
      const primary = rand() < 0.35 ? bigTrainerProfileId : pick(trainerProfiles).id;
      const chosen = new Set<string>([primary]);
      if (rand() < 0.2) chosen.add(pick(trainerProfiles).id);
      for (const trainerId of chosen) {
        const active = rand() < 0.92;
        const connectedAt = new Date((profile.createdAt as Date).getTime() + int(0, 30) * DAY_MS);
        associations.push({
          id: randomUUID(),
          trainerId,
          playerProfileId: profile.id as string,
          status: active ? 'ACTIVE' : 'INACTIVE',
          connectedAt,
          disconnectedAt: active ? null : new Date(connectedAt.getTime() + int(1, 90) * DAY_MS),
        });
      }
    }

    const availability: Prisma.AvailabilityCreateManyInput[] = [];
    const slot = (): { dayOfWeek: number; startTime: number; endTime: number } => {
      const startTime = int(6, 19) * 60;
      return { dayOfWeek: int(0, 6), startTime, endTime: startTime + int(1, 3) * 60 };
    };
    for (const profile of playerProfiles) {
      if (rand() >= 0.4) continue;
      for (let s = int(2, 4); s > 0; s -= 1) {
        availability.push({ id: randomUUID(), subjectType: 'PLAYER', playerProfileId: profile.id as string, ...slot() });
      }
    }
    for (const coach of coachProfiles) {
      if (coach.status !== 'ACTIVE') continue;
      for (let s = int(3, 5); s > 0; s -= 1) {
        availability.push({ id: randomUUID(), subjectType: 'COACH', coachProfileId: coach.id, ...slot() });
      }
    }

    const shareLinks: Prisma.ShareLinkCreateManyInput[] = [];
    trainerProfiles.forEach((tp, i) => {
      shareLinks.push({
        id: randomUUID(),
        code: i === 0 ? BIG_TRAINER_SHARE_CODE : `perf-static-${String(i).padStart(4, '0')}`,
        type: 'PLAYER_STATIC',
        trainerId: tp.id,
        createdByUserId: tp.userId,
      });
      for (let c = int(0, 2); c > 0; c -= 1) {
        shareLinks.push({
          id: randomUUID(),
          code: `perf-coach-${String(i).padStart(4, '0')}-${c}`,
          type: 'COACH_UNIQUE',
          trainerId: tp.id,
          createdByUserId: tp.userId,
          targetEmail: `invite.${i}.${c}@example.com`,
          expiresAt: new Date(now + 7 * DAY_MS),
        });
      }
    });

    const impersonations: Prisma.ImpersonationLogCreateManyInput[] = [];
    for (let i = 0; i < 300; i += 1) {
      const startedAt = new Date(now - Math.floor(rand() * 21 * DAY_MS));
      const seconds = int(30, 3600);
      impersonations.push({
        id: randomUUID(),
        adminUserId: pick(admins).id,
        targetUserId: pick(users).id,
        startedAt,
        endedAt: new Date(startedAt.getTime() + seconds * 1000),
        durationSeconds: seconds,
      });
    }

    // ---- insert (parents before children, FK order) -----------------------------------------------
    console.log('[perf:seed] inserting ...');
    await insertChunks('users', users, (data) => prisma.user.createMany({ data }));
    await insertChunks('trainer profiles', trainerProfiles, (data) => prisma.trainerProfile.createMany({ data }));
    await insertChunks('coach profiles', coachProfiles, (data) => prisma.coachProfile.createMany({ data }));
    await insertChunks('player profiles', playerProfiles, (data) => prisma.playerProfile.createMany({ data }));
    await insertChunks('trainer associations', associations, (data) => prisma.playerTrainerAssociation.createMany({ data }));
    await insertChunks('availability slots', availability, (data) => prisma.availability.createMany({ data }));
    await insertChunks('share links', shareLinks, (data) => prisma.shareLink.createMany({ data }));
    await insertChunks('impersonation logs', impersonations, (data) => prisma.impersonationLog.createMany({ data }));

    // Fresh planner statistics, as autovacuum would produce on a long-lived database.
    await prisma.$executeRawUnsafe('ANALYZE');

    const byRole = users.reduce<Record<string, number>>((acc, u) => ({ ...acc, [u.role]: (acc[u.role] ?? 0) + 1 }), {});
    const byStatus = users.reduce<Record<string, number>>((acc, u) => ({ ...acc, [u.status as string]: (acc[u.status as string] ?? 0) + 1 }), {});
    console.log(`[perf:seed] roles ${JSON.stringify(byRole)} statuses ${JSON.stringify(byStatus)}`);
    console.log(`[perf:seed] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
