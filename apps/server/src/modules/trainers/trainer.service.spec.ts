import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 3.8. Testcontainers-backed (like account-provisioning.service.spec.ts)
// — proves the actual atomicity claim ("all in the same transaction... a
// forced failure after the User insert leaves nothing behind"), which a
// mocked Prisma client cannot meaningfully demonstrate. Full HTTP-level
// coverage (duplicate-email 409, response shape, real OutboxJob row) lives
// in test/trainers.e2e-spec.ts; this file is narrowly about the transaction
// boundary.
describe('TrainerService.createTrainer (Task 3.8)', () => {
  jest.setTimeout(120_000);

  let db: TestDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set, see beforeAll
  let prismaService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let TrainerService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AccountProvisioningService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let UsersRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let TrainersRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PasswordResetTokenRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PasswordService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OutboxService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OutboxRepository: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const prismaModule = require('../../shared/prisma/prisma.service') as typeof import('../../shared/prisma/prisma.service');
    ({ UsersRepository } = require('../users/users.repository') as typeof import('../users/users.repository'));
    ({ AccountProvisioningService } = require('../users/account-provisioning.service') as typeof import('../users/account-provisioning.service'));
    ({ TrainersRepository } = require('./trainers.repository') as typeof import('./trainers.repository'));
    ({ PasswordResetTokenRepository } = require('../auth/password-reset-token.repository') as typeof import('../auth/password-reset-token.repository'));
    ({ PasswordService } = require('../auth/password.service') as typeof import('../auth/password.service'));
    ({ TrainerService } = require('./trainer.service') as typeof import('./trainer.service'));
    ({ OutboxRepository } = require('../../shared/jobs/outbox.repository') as typeof import('../../shared/jobs/outbox.repository'));
    ({ OutboxService } = require('../../shared/jobs/outbox.service') as typeof import('../../shared/jobs/outbox.service'));
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new prismaModule.PrismaService();
    await prismaService.onModuleInit();
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  function baseDto(overrides: Record<string, unknown> = {}) {
    return {
      businessName: 'Acme Training',
      firstName: 'Trainer',
      lastName: 'One',
      email: `${randomUUID()}@example.com`,
      phone: '+14155552671',
      ...overrides,
    };
  }

  function buildService(outboxServiceOverride?: unknown) {
    const usersRepository = new UsersRepository(prismaService);
    const accountProvisioningService = new AccountProvisioningService(prismaService, usersRepository);
    const trainersRepository = new TrainersRepository(prismaService);
    const passwordResetTokenRepository = new PasswordResetTokenRepository(prismaService);
    const passwordService = new PasswordService();
    const outboxRepository = new OutboxRepository(prismaService);
    // enqueue() only ever calls outboxRepository.enqueue(tx, ...) — never
    // mail/storage — so a real OutboxService can be built without those.
    const outboxService = outboxServiceOverride ?? new OutboxService(prismaService, outboxRepository, {} as never, {} as never);

    return new TrainerService(
      accountProvisioningService,
      trainersRepository,
      passwordResetTokenRepository,
      passwordService,
      outboxService,
    );
  }

  it('creates exactly one User + TrainerProfile + PasswordResetToken(TRAINER_SETUP) + OutboxJob(EMAIL_TRAINER_INVITE), all committed together', async () => {
    const service = buildService();
    const dto = baseDto();

    const response = await service.createTrainer(dto);

    expect(response).toMatchObject({ businessName: dto.businessName, email: dto.email, status: 'Active' });

    const user = await prismaService.user.findUnique({ where: { email: dto.email } });
    expect(user).not.toBeNull();
    expect(user.role).toBe('TRAINER');
    expect(user.mustChangePassword).toBe(true);
    expect(user.status).toBe('ACTIVE');

    const trainerProfile = await prismaService.trainerProfile.findUnique({ where: { userId: user.id } });
    expect(trainerProfile).not.toBeNull();
    expect(trainerProfile.businessName).toBe(dto.businessName);

    const tokens = await prismaService.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].purpose).toBe('TRAINER_SETUP');

    const jobs = await prismaService.outboxJob.findMany({ where: { type: 'EMAIL_TRAINER_INVITE' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ to: dto.email });
  });

  it('duplicate email -> ConflictException (409 CONFLICT), no partial rows left behind', async () => {
    const service = buildService();
    const dto = baseDto();
    await service.createTrainer(dto);

    await expect(service.createTrainer(baseDto({ email: dto.email }))).rejects.toMatchObject({
      response: { errorCode: 'CONFLICT' },
    });

    const users = await prismaService.user.findMany({ where: { email: dto.email } });
    expect(users).toHaveLength(1);
  });

  it('leaves no User/TrainerProfile/token row when the afterCreate step (outbox enqueue) fails partway through', async () => {
    const failingOutboxService = { enqueue: async () => { throw new Error('simulated outbox failure'); } };
    const service = buildService(failingOutboxService);
    const dto = baseDto();

    await expect(service.createTrainer(dto)).rejects.toThrow('simulated outbox failure');

    const user = await prismaService.user.findUnique({ where: { email: dto.email } });
    expect(user).toBeNull();
    const tokens = await prismaService.passwordResetToken.findMany({});
    expect(tokens).toHaveLength(0);
  });
});
