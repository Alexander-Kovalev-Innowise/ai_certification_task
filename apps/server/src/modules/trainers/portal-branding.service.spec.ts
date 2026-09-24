import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 8.1 (api §4.1 "PATCH /trainers/:id/branding", FR-071/OQ-7), extended
// in Task 8.2 (MEDIA_LOGO_RESIZE outbox enqueue). Testcontainers-backed, same
// pattern as trainer.service.spec.ts — proves the real DB writes (derived
// palette persistence, resetToDefault clearing) and the real atomic
// transaction (TrainerProfile update + OutboxJob row), not a mocked Prisma
// client. Full HTTP-level coverage (403/404, response shape) lives in
// test/trainers.e2e-spec.ts (Task 8.3).
describe('PortalBrandingService.updateBranding (Task 8.1/8.2)', () => {
  jest.setTimeout(120_000);

  let db: TestDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set, see beforeAll
  let prismaService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PortalBrandingService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let TrainersRepository: any;
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
    ({ TrainersRepository } = require('./trainers.repository') as typeof import('./trainers.repository'));
    ({ PortalBrandingService } = require('./portal-branding.service') as typeof import('./portal-branding.service'));
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

  function buildService() {
    const trainersRepository = new TrainersRepository(prismaService);
    const outboxRepository = new OutboxRepository(prismaService);
    // enqueue() only ever calls outboxRepository.enqueue(tx, ...) — never
    // mail/storage — so a real OutboxService can be built without those.
    const outboxService = new OutboxService(prismaService, outboxRepository, {} as never, {} as never);
    return new PortalBrandingService(trainersRepository, outboxService, prismaService);
  }

  async function insertTrainer(overrides: Record<string, unknown> = {}): Promise<{ userId: string; trainerId: string }> {
    const userId = randomUUID();
    await prismaService.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        passwordHash: 'unused',
        role: 'TRAINER',
        firstName: 'A',
        lastName: 'B',
        status: 'ACTIVE',
      },
    });
    const trainerId = randomUUID();
    await prismaService.trainerProfile.create({
      data: { id: trainerId, userId, businessName: 'Original Co', ...overrides },
    });
    return { userId, trainerId };
  }

  function ctxFor(trainerId: string): { role: 'TRAINER'; userId: string; trainerId: string; accountType: 'ADULT'; auditActorId: string } {
    return { role: 'TRAINER', userId: 'unused', trainerId, accountType: 'ADULT', auditActorId: 'unused' };
  }

  it('#FF0000 (fails AA against white, 4.0:1 < 4.5:1) still saves successfully and returns contrastWarning', async () => {
    const service = buildService();
    const trainer = await insertTrainer();

    const response = await service.updateBranding(ctxFor(trainer.trainerId), trainer.trainerId, { primaryColorHex: '#FF0000' });

    expect(response.primaryColorHex).toBe('#FF0000');
    expect(response.contrastWarning).toBeDefined();
    expect(response.derivedPalette.meetsAA).toBe(false);

    const row = await prismaService.trainerProfile.findUnique({ where: { id: trainer.trainerId } });
    expect(row.primaryColorHex).toBe('#FF0000');
    expect(row.derivedPaletteJson).toMatchObject({ primaryColorHex: '#FF0000', meetsAA: false });
  });

  it('#767676 (meets AA against both white and black) saves with no contrastWarning', async () => {
    const service = buildService();
    const trainer = await insertTrainer();

    const response = await service.updateBranding(ctxFor(trainer.trainerId), trainer.trainerId, { primaryColorHex: '#767676' });

    expect(response.primaryColorHex).toBe('#767676');
    expect(response.contrastWarning).toBeUndefined();
    expect(response.derivedPalette.meetsAA).toBe(true);
  });

  it('resetToDefault clears logoUrl, primaryColorHex, and derivedPaletteJson', async () => {
    const service = buildService();
    const trainer = await insertTrainer({
      logoUrl: 'https://example.com/logo.png',
      primaryColorHex: '#767676',
      derivedPaletteJson: { primaryColorHex: '#767676', meetsAA: true },
    });

    const response = await service.updateBranding(ctxFor(trainer.trainerId), trainer.trainerId, { resetToDefault: true });

    expect(response).toMatchObject({ logoUrl: null, primaryColorHex: null, derivedPalette: null });

    const row = await prismaService.trainerProfile.findUnique({ where: { id: trainer.trainerId } });
    expect(row.logoUrl).toBeNull();
    expect(row.primaryColorHex).toBeNull();
    expect(row.derivedPaletteJson).toBeNull();
  });

  it('setting logoUrl enqueues exactly one MEDIA_LOGO_RESIZE OutboxJob, atomically with the TrainerProfile write', async () => {
    const service = buildService();
    const trainer = await insertTrainer();

    await service.updateBranding(ctxFor(trainer.trainerId), trainer.trainerId, {
      logoUrl: 'https://example.com/logos/abc.png',
    });

    const row = await prismaService.trainerProfile.findUnique({ where: { id: trainer.trainerId } });
    expect(row.logoUrl).toBe('https://example.com/logos/abc.png');

    const jobs = await prismaService.outboxJob.findMany({ where: { type: 'MEDIA_LOGO_RESIZE' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ sourceUrl: 'https://example.com/logos/abc.png', targetKey: 'abc.png' });
  });

  it('a non-owning TRAINER -> NotFoundException (404 NOT_FOUND), never a hint the id exists', async () => {
    const service = buildService();
    const trainerA = await insertTrainer();
    const trainerB = await insertTrainer();

    await expect(
      service.updateBranding(ctxFor(trainerB.trainerId), trainerA.trainerId, { primaryColorHex: '#767676' }),
    ).rejects.toMatchObject({ response: { errorCode: 'NOT_FOUND' } });

    const untouched = await prismaService.trainerProfile.findUnique({ where: { id: trainerA.trainerId } });
    expect(untouched.primaryColorHex).toBeNull();
  });
});
