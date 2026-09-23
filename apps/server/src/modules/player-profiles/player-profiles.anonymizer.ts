import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { Anonymizer } from '../../shared/prisma/anonymizer.interface';

// Task 5.6 (arch §11.2 point 3, same registry AccountLifecycleService.gdprDelete
// (Task 3.7) already drives via AnonymizerRegistry/DiscoveryService — see
// that registry's own comment on why any module can register one with zero
// central wiring). Scrubs the PII a `PlayerProfile` row carries: `name`,
// `school`, `jerseyNumber`, `photoUrl`, `emergencyContact`. Covers BOTH
// relations a GDPR-deleted `userId` could hold on this model — the adult
// account owner (`accountUserId`, every child profile that account manages)
// and a profile's own separate child login (`childUserId`, arch's "optional
// child login" — a minor deleting their own account). `skillLevel`/
// `dateOfBirth`/`gender`/`isSelf`/associations are left untouched: not PII
// in the "identifies a specific person by name/contact" sense this registry
// exists for, and `dateOfBirth`/`gender` in particular remain meaningful
// even for an anonymized historical row (age-bracket reporting, etc.).
@Injectable()
export class PlayerProfilesAnonymizer implements Anonymizer {
  readonly model = 'PlayerProfile';

  async anonymize(userId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.playerProfile.updateMany({
      where: { OR: [{ accountUserId: userId }, { childUserId: userId }] },
      data: {
        name: 'Deleted Player',
        school: null,
        jerseyNumber: null,
        photoUrl: null,
        emergencyContact: Prisma.JsonNull,
      },
    });
  }
}
