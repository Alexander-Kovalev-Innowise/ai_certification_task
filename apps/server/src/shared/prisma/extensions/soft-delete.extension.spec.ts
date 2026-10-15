import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { softDeleteExtension } from './soft-delete.extension';

describe('softDeleteExtension (Task 1.5)', () => {
  jest.setTimeout(180_000);

  const serverRoot = resolve(__dirname, '../../../..');
  let container: StartedPostgreSqlContainer;
  let prisma: ReturnType<PrismaClient['$extends']>;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();

    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      stdio: 'pipe',
    });

    const adapter = new PrismaPg({ connectionString: container.getConnectionUri() });
    prisma = new PrismaClient({ adapter }).$extends(softDeleteExtension);

    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        passwordHash: 'hash',
        role: 'PLAYER_PARENT',
        firstName: 'A',
        lastName: 'B',
        deletedAt: new Date(),
        status: 'DELETED',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await container?.stop();
  });

  it('excludes a soft-deleted User from findMany by default', async () => {
    const rows = await prisma.user.findMany({ where: { id: userId } });
    expect(rows).toHaveLength(0);
  });

  it('excludes a soft-deleted User from findFirst by default', async () => {
    const row = await prisma.user.findFirst({ where: { id: userId } });
    expect(row).toBeNull();
  });

  it('excludes a soft-deleted User from count by default', async () => {
    const count = await prisma.user.count({ where: { id: userId } });
    expect(count).toBe(0);
  });

  it('includes the soft-deleted User when withDeleted: true is passed', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- withDeleted is an extension-only arg, not part of Prisma's generated types
    const rows = await (prisma.user.findMany as any)({ where: { id: userId }, withDeleted: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(userId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- withDeleted is an extension-only arg, not part of Prisma's generated types
    const row = await (prisma.user.findFirst as any)({ where: { id: userId }, withDeleted: true });
    expect(row?.id).toBe(userId);
  });

  it('findUnique returns the soft-deleted row regardless (deliberately unfiltered)', async () => {
    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.id).toBe(userId);
    expect(row?.deletedAt).not.toBeNull();
  });
});
