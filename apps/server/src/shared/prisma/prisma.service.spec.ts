import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Testcontainers-backed per Task 1.4 (never a mocked Prisma client, per the
// plan's testing convention). PrismaService reads `env.DATABASE_URL` at
// construction time, so the container's connection string is written into
// `process.env.DATABASE_URL` *before* the module (and its `shared/config`
// dependency) is imported — jest.resetModules() + a dynamic import forces a
// fresh module evaluation that picks it up, since dotenv (loaded inside
// shared/config/config.module.ts) never overrides an already-set env var.
describe('PrismaService', () => {
  jest.setTimeout(120_000);

  let container: StartedPostgreSqlContainer;
  let PrismaServiceCtor: typeof import('./prisma.service').PrismaService;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16').start();
    process.env.DATABASE_URL = container.getConnectionUri();

    jest.resetModules();
    // `require`, not a dynamic `import()` — ts-jest's default CommonJS
    // transpilation target can't emit a real dynamic import without
    // `--experimental-vm-modules`, so `require` is the reliable way to force
    // a fresh module evaluation after `resetModules()`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate, see comment above
    ({ PrismaService: PrismaServiceCtor } = require('./prisma.service') as typeof import('./prisma.service'));
  });

  afterAll(async () => {
    await container?.stop();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('connects and disconnects cleanly', async () => {
    const service = new PrismaServiceCtor();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    await expect(service.$queryRaw`SELECT 1 as one`).resolves.toEqual([{ one: 1 }]);
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
