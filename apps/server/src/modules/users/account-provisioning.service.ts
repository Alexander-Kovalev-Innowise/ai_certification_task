import { Injectable } from '@nestjs/common';
import type { Prisma, Role, User, UserStatus } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { UsersRepository } from './users.repository';

export interface CreateUserWithProfileInput {
  role: Role;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  status?: UserStatus;
  mustChangePassword?: boolean;
  phone?: string;
  photoUrl?: string;
  /**
   * Creates whatever profile row(s) this role needs (TrainerProfile,
   * CoachProfile, PlayerProfile, ...) inside the SAME transaction as the
   * User row. Kept as an injected callback rather than a switch-over-role
   * here: Phase 2 doesn't own any of those profile shapes yet (Task 3.8
   * builds trainer creation, Task 4.6 builds anonymous ShareLink
   * registration) — this is the "minimal shape general enough" the plan
   * asks for, without guessing at fields those later tasks haven't defined.
   * Omitted entirely for a user with no profile row (none in Epic-01, but
   * the type allows it).
   */
  createProfile?: (tx: Prisma.TransactionClient, userId: string) => Promise<void>;
}

// Task 2.10 (arch §3.2 point 3). The ONLY code path in this codebase
// allowed to create a `User` row — always together with its profile (when
// it has one), always inside one `$transaction`. No other service may call
// `prisma.user.create` (or `UsersRepository.create`) directly; every flow
// that provisions a new account (Task 3.8's Super-Admin-created trainer,
// Task 4.6's anonymous ShareLink registration) must come through here so
// "User + profile committed atomically, or neither exists" is true by
// construction rather than by each caller remembering to wrap its own
// transaction.
@Injectable()
export class AccountProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
  ) {}

  async createUserWithProfile(input: CreateUserWithProfileInput): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await this.usersRepository.create(
        {
          role: input.role,
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          status: input.status ?? 'ACTIVE',
          mustChangePassword: input.mustChangePassword ?? false,
          phone: input.phone,
          photoUrl: input.photoUrl,
        },
        tx,
      );

      if (input.createProfile) {
        await input.createProfile(tx, user.id);
      }

      return user;
    });
  }
}
