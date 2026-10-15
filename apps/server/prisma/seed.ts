import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { config as loadDotenv } from 'dotenv';

// Same root .env loading convention as `shared/config/config.module.ts`
// (Task 0.8) and `prisma.config.ts`: process.cwd() is `apps/server` for
// every workspace script (`prisma db seed` included), so this resolves to
// the project root regardless of ts-node/dist depth.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

// argon2id, OWASP baseline (arch §6.1) — inlined here because `PasswordService`
// doesn't exist until Task 2.11; that service will wrap the same parameters.
const ARGON2ID_OPTIONS: argon2.Options & { type: argon2.Options['type'] } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function main() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL;
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Seed aborted: SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD must both be set. ' +
        'BR-005: there is no self-registration path anywhere in this system — this seed is the ' +
        'only way a first Super Admin account is ever created.',
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Seed aborted: DATABASE_URL is not set.');
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Seed: a user with email ${email} already exists (id=${existing.id}); skipping.`);
      return;
    }

    const passwordHash = await argon2.hash(password, ARGON2ID_OPTIONS);

    const superAdmin = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'SUPER_ADMIN',
        firstName: 'Super',
        lastName: 'Admin',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    console.log(`Seed: created Super Admin ${superAdmin.email} (id=${superAdmin.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
