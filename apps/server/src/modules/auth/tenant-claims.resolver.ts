import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface TenantClaims {
  accountType: 'ADULT' | 'CHILD';
  trainerId: string | null;
  guardianUserId: string | null;
}

// Task 7.1 extraction (previously AuthService's own private
// `resolveTenantClaims`, Task 2.13). Pulled out into a small standalone
// provider so ImpersonationService (Task 7.1) can derive the exact same
// `typ`/`tid`/`gid` claims for an impersonation TARGET that AuthService
// derives for a normal login `sub` — arch §6.2/§10 requires these be
// byte-identical ("every guard downstream reads sub/role/tid as-is...
// zero branching in feature code"), so this logic must live in exactly one
// place rather than being re-derived by two independent copies (unlike the
// smaller, genuinely-fine-to-duplicate checks elsewhere in this codebase,
// e.g. AvailabilityService/ConflictCheckService's own "employing trainer"
// copies — this one is the actual token-claims contract, not an incidental
// ownership check). AuthService still injects PrismaService directly for
// everything else it needs (session/token rows); this resolver owns only
// the TrainerProfile/CoachProfile/PlayerProfile lookups arch §6.2's three
// tenant-claim fields depend on.
@Injectable()
export class TenantClaimsResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: User): Promise<TenantClaims> {
    if (user.role === 'TRAINER') {
      const trainerProfile = await this.prisma.trainerProfile.findUnique({ where: { userId: user.id } });
      return { accountType: 'ADULT', trainerId: trainerProfile?.id ?? null, guardianUserId: null };
    }

    if (user.role === 'COACH') {
      const coachProfile = await this.prisma.coachProfile.findUnique({ where: { userId: user.id } });
      return { accountType: 'ADULT', trainerId: coachProfile?.trainerId ?? null, guardianUserId: null };
    }

    if (user.role === 'PLAYER_PARENT') {
      const childOf = await this.prisma.playerProfile.findUnique({
        where: { childUserId: user.id },
        select: { accountUserId: true },
      });
      if (childOf) {
        return { accountType: 'CHILD', trainerId: null, guardianUserId: childOf.accountUserId };
      }
      return { accountType: 'ADULT', trainerId: null, guardianUserId: null };
    }

    // SUPER_ADMIN
    return { accountType: 'ADULT', trainerId: null, guardianUserId: null };
  }
}
