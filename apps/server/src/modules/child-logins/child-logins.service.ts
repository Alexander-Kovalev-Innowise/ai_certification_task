import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PlayerProfile } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';
import { PlayerProfilesRepository } from '../player-profiles/player-profiles.repository';
import { AccountProvisioningService } from '../users/account-provisioning.service';
import { UsersRepository } from '../users/users.repository';

import type { ChildLoginResponseDto } from './dto/child-login-response.dto';
import type { CreateChildLoginDto } from './dto/create-child-login.dto';

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: '' };
  }
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1).trim() };
}

// The only code path that writes `PlayerProfile.childUserId` — i.e. the only
// way a `typ: CHILD` account comes to exist (the account type is derived from
// that link, TenantClaimsResolver). Guardian-only: CHILD tokens are rejected
// at the route by `MANAGE_CHILD_PROFILES` (a CHILD_DENIED capability).
@Injectable()
export class ChildLoginsService {
  constructor(
    private readonly playerProfilesRepository: PlayerProfilesRepository,
    private readonly accountProvisioningService: AccountProvisioningService,
    private readonly passwordService: PasswordService,
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly prisma: PrismaService,
  ) {}

  async createChildLogin(ctx: AuthContext, playerProfileId: string, dto: CreateChildLoginDto): Promise<ChildLoginResponseDto> {
    const profile = await this.findOwnedChildProfile(ctx, playerProfileId);
    if (profile.childUserId) {
      throw new ConflictException({ message: 'This child already has a login', errorCode: 'CONFLICT' });
    }

    if (await this.usersRepository.findByEmail(dto.email)) {
      throw new ConflictException({ message: 'A user with this email already exists', errorCode: 'CONFLICT' });
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const { firstName, lastName } = splitName(profile.name);

    try {
      const user = await this.accountProvisioningService.createUserWithProfile({
        role: 'PLAYER_PARENT',
        email: dto.email,
        passwordHash,
        firstName,
        lastName,
        status: 'ACTIVE',
        mustChangePassword: false,
        createProfile: async (tx, userId) => {
          // Conditional on `childUserId IS NULL` so two concurrent creates can
          // never both link; the loser rolls the whole transaction back.
          const linked = await tx.playerProfile.updateMany({
            where: { id: profile.id, childUserId: null },
            data: { childUserId: userId },
          });
          if (linked.count === 0) {
            throw new ConflictException({ message: 'This child already has a login', errorCode: 'CONFLICT' });
          }
        },
      });
      return { playerProfileId: profile.id, childUserId: user.id, email: user.email };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ message: 'A user with this email already exists', errorCode: 'CONFLICT' });
      }
      throw error;
    }
  }

  /** Guardian sets a new password for the child's login; the child's existing sessions are revoked. */
  async resetChildLoginPassword(ctx: AuthContext, playerProfileId: string, password: string): Promise<{ message: string }> {
    const profile = await this.findOwnedChildProfile(ctx, playerProfileId);
    if (!profile.childUserId) {
      throw new NotFoundException({ message: 'This child has no login', errorCode: 'NOT_FOUND' });
    }
    const childUserId = profile.childUserId;
    const passwordHash = await this.passwordService.hash(password);

    await this.prisma.$transaction(async (tx) => {
      await this.usersRepository.update(
        childUserId,
        { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 } },
        tx,
      );
      await this.refreshTokenRepository.revokeAllForUser(childUserId, tx);
    });

    return { message: 'Password reset.' };
  }

  /** Generic 404 for unknown/not-yours (family-ownership posture); 400 for a self profile. */
  private async findOwnedChildProfile(ctx: AuthContext, playerProfileId: string): Promise<PlayerProfile> {
    if (ctx.accountType === 'CHILD' || ctx.role !== 'PLAYER_PARENT') {
      throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
    }
    const profile = await this.playerProfilesRepository.findById(playerProfileId);
    if (!profile || profile.accountUserId !== ctx.userId) {
      throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
    }
    if (profile.isSelf) {
      throw new BadRequestException({
        message: 'A login can only be created for a child profile',
        errorCode: 'VALIDATION_ERROR',
        details: [{ field: 'playerProfileId', message: 'This is your own profile, not a child profile' }],
      });
    }
    return profile;
  }
}
