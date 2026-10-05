import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { hashOpaqueToken } from '../auth/opaque-token.util';

import { CampConversionsService } from './camp-conversions.service';
import type { CreateCampConversionDto } from './dto/create-camp-conversion.dto';

const trainer = { businessName: 'Camp Co', logoUrl: null, primaryColorHex: '#112233' };
const activeLink = { id: 'link-1', code: 'CODE', type: 'PLAYER_STATIC', status: 'ACTIVE', expiresAt: null, maxUses: null, useCount: 0, trainer };
const payload = {
  parentFirstName: 'Pat',
  parentLastName: 'Camper',
  email: 'pat@example.com',
  phone: '+14155552671',
  playerName: 'Kid',
  playerAge: 10,
  playerGender: 'FEMALE',
  source: 'CAMP',
};
const dto: CreateCampConversionDto = { shareLinkCode: 'CODE', ...payload, source: 'CAMP' } as CreateCampConversionDto;

function build(overrides: { link?: unknown; conversion?: unknown } = {}) {
  const repository = {
    findShareLinkByCode: jest.fn().mockResolvedValue('link' in overrides ? overrides.link : activeLink),
    create: jest.fn().mockResolvedValue({}),
    findByTokenHash: jest.fn().mockResolvedValue('conversion' in overrides ? overrides.conversion : null),
    markUsed: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const outbox = { enqueue: jest.fn(), nudge: jest.fn() };
  const prisma = { $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})) };
  const service = new CampConversionsService(repository as never, outbox as never, prisma as never);
  return { service, repository, outbox };
}

function conversionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    shareLinkId: 'link-1',
    payload,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    shareLink: activeLink,
    ...overrides,
  };
}

describe('CampConversionsService', () => {
  describe('create', () => {
    it('stores only the token hash with a 7-day expiry and returns the raw token + join url', async () => {
      const { service, repository } = build();

      const result = await service.create(dto);

      const stored = repository.create.mock.calls[0][0];
      expect(stored.tokenHash).toBe(hashOpaqueToken(result.conversionToken));
      expect(stored.tokenHash).not.toBe(result.conversionToken);
      expect(JSON.stringify(stored.payload)).not.toContain(result.conversionToken);
      expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.99 * 24 * 3600_000);
      expect(result.joinUrl).toBe(`/join/CODE?camp=${result.conversionToken}`);
    });

    it('unknown code and non-PLAYER_STATIC links -> 404', async () => {
      await expect(build({ link: null }).service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
      await expect(build({ link: { ...activeLink, type: 'COACH_UNIQUE' } }).service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revoked / expired link -> 409', async () => {
      await expect(build({ link: { ...activeLink, status: 'REVOKED' } }).service.create(dto)).rejects.toBeInstanceOf(ConflictException);
      await expect(
        build({ link: { ...activeLink, expiresAt: new Date(Date.now() - 1000) } }).service.create(dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getPrefill / resolveForRedemption', () => {
    it('unknown or used token -> 404, expired -> 410', async () => {
      await expect(build({ conversion: null }).service.getPrefill('t')).rejects.toBeInstanceOf(NotFoundException);
      await expect(build({ conversion: conversionRow({ usedAt: new Date() }) }).service.getPrefill('t')).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        build({ conversion: conversionRow({ expiresAt: new Date(Date.now() - 1) }) }).service.getPrefill('t'),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('returns prefill + trainer branding', async () => {
      const result = await build({ conversion: conversionRow() }).service.getPrefill('t');
      expect(result.trainer).toEqual({ displayName: 'Camp Co', logoUrl: null, primaryColorHex: '#112233' });
      expect(result.prefill).toMatchObject({ email: 'pat@example.com', playerAge: 10, isSelf: false });
    });

    it('a token that belongs to another ShareLink is reported as unknown', async () => {
      const { service } = build({ conversion: conversionRow() });
      await expect(service.resolveForRedemption('t', 'other-link')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.resolveForRedemption('t', 'link-1')).resolves.toMatchObject({ id: 'conv-1' });
    });
  });

  describe('markUsed', () => {
    it('losing the conditional claim -> 404', async () => {
      const { service, repository } = build();
      repository.markUsed.mockResolvedValueOnce({ count: 0 });
      await expect(service.markUsed('conv-1', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('emailLink', () => {
    it('queues the join-link mail to the form address with the token', async () => {
      const { service, outbox } = build({ conversion: conversionRow() });

      await service.emailLink('raw-token');

      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        JOB_TYPES.EMAIL_CAMP_CONVERSION_LINK,
        expect.objectContaining({
          to: 'pat@example.com',
          templateData: expect.objectContaining({ shareLinkCode: 'CODE', conversionToken: 'raw-token', trainerBusinessName: 'Camp Co' }),
        }),
      );
      expect(outbox.nudge).toHaveBeenCalled();
    });

    it('expired token -> 410 and nothing queued', async () => {
      const { service, outbox } = build({ conversion: conversionRow({ expiresAt: new Date(Date.now() - 1) }) });
      await expect(service.emailLink('t')).rejects.toBeInstanceOf(GoneException);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });
});
