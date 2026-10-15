import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Task 1.9. Shared Testcontainers harness: one ephemeral Postgres container
// per suite (test file), migrations applied once via `prisma migrate deploy`
// (including Task 1.2's hand-edited raw SQL), then a ready-to-use
// PrismaClient connected to it. Tasks 1.2/1.4/1.5/1.6 each hand-rolled this
// same container-start + migrate-deploy boilerplate inline, ahead of this
// task existing (the plan's own "build it now, formalize later" pattern);
// this is the formalized, reusable version every later integration test in
// the plan is meant to use instead.
export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  prisma: PrismaClient;
  connectionUri: string;
}

const SERVER_ROOT = resolve(__dirname, '../..');

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:16').start();
  const connectionUri = container.getConnectionUri();

  // Invoked via the local `prisma` CLI entry point directly (not `npx`) to
  // avoid a shell hop on Windows — same approach as Task 1.2's test.
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, DATABASE_URL: connectionUri },
    stdio: 'pipe',
  });

  const adapter = new PrismaPg({ connectionString: connectionUri });
  const prisma = new PrismaClient({ adapter });

  return { container, prisma, connectionUri };
}

export async function stopTestDatabase(db: TestDatabase): Promise<void> {
  await db.prisma.$disconnect();
  await db.container.stop();
}

/**
 * TRUNCATEs every application table (all public-schema tables except
 * Prisma's own migrations table) with RESTART IDENTITY CASCADE, so a suite
 * with many `it()`s can reset to a clean slate between tests without paying
 * for a fresh container each time — the plan's "each test wrapped in a
 * transaction that's rolled back — or a TRUNCATE between tests, whichever
 * this becomes in practice" (Task 1.9); TRUNCATE is the one implemented
 * here, since a manual per-test transaction wrapper would need every test to
 * route all its queries through a single shared `tx` client, which doesn't
 * compose well with tests that also want to open their own transactions.
 */
export async function resetTestDatabase(db: TestDatabase): Promise<void> {
  const tables = await db.prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;
  if (tables.length === 0) {
    return;
  }
  const quotedTables = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await db.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} RESTART IDENTITY CASCADE`);
}
