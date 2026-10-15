import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { runWithTenantScope } from '../../tenancy/tenant-context.store';
import { TenantScopeViolationError } from '../../tenancy/tenant-scope-violation.error';

import { tenantGuardExtension } from './tenant-guard.extension';

describe('tenantGuardExtension (Task 1.6)', () => {
  jest.setTimeout(180_000);

  const serverRoot = resolve(__dirname, '../../../..');
  let container: StartedPostgreSqlContainer;
  let prisma: ReturnType<PrismaClient['$extends']>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();

    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: 'pipe',
    });

    const adapter = new PrismaPg({ connectionString: container.getConnectionUri() });
    prisma = new PrismaClient({ adapter }).$extends(tenantGuardExtension);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container?.stop();
  });

  it('throws TenantScopeViolationError for an unscoped tenant-owned query under a TRAINER scope', async () => {
    await expect(
      runWithTenantScope({ kind: 'TRAINER', trainerId: 'A' }, () => prisma.coachProfile.findMany({ where: {} })),
    ).rejects.toThrow(TenantScopeViolationError);
  });

  it('succeeds when where.trainerId matches the TRAINER scope', async () => {
    await expect(
      runWithTenantScope({ kind: 'TRAINER', trainerId: 'A' }, () =>
        prisma.coachProfile.findMany({ where: { trainerId: 'A' } }),
      ),
    ).resolves.toEqual([]);
  });

  it('does not throw when no scope is published to ALS at all', async () => {
    await expect(prisma.coachProfile.findMany({ where: {} })).resolves.toEqual([]);
  });

  it('does not throw under a PLATFORM scope', async () => {
    await expect(
      runWithTenantScope({ kind: 'PLATFORM' }, () => prisma.coachProfile.findMany({ where: {} })),
    ).resolves.toEqual([]);
  });

  it('scopes TrainerProfile by its own id, not a trainerId column', async () => {
    await expect(
      runWithTenantScope({ kind: 'TRAINER', trainerId: 'A' }, () => prisma.trainerProfile.findMany({ where: {} })),
    ).rejects.toThrow(TenantScopeViolationError);

    await expect(
      runWithTenantScope({ kind: 'TRAINER', trainerId: 'A' }, () =>
        prisma.trainerProfile.findMany({ where: { id: 'A' } }),
      ),
    ).resolves.toEqual([]);
  });

  it('does not throw for a model outside the tenant-owned set (e.g. User)', async () => {
    await expect(
      runWithTenantScope({ kind: 'TRAINER', trainerId: 'A' }, () => prisma.user.findMany({ where: {} })),
    ).resolves.toEqual([]);
  });
});
