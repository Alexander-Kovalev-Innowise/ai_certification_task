import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { Anonymizer } from '../../shared/prisma/anonymizer.interface';

// Task 6.4 (arch §11.2: "coaches (bio/credentials)"). Discovered
// automatically by AnonymizerRegistry (Task 3.4) — being a plain
// `@Injectable()` provider listed in CoachesModule's `providers` (and
// CoachesModule being imported by AppModule) is all that's needed; no other
// wiring changes when this is added. Mirrors TrainersAnonymizer's own
// keyed-by-userId, find-then-no-op-if-absent shape (trainers.anonymizer.ts)
// — most deleted users never had a `CoachProfile` either.
//
// Scoped to exactly `bio`/`credentials` per the architecture doc's literal
// scope note, not `certifications`/`publicProfile` — narrower than it might
// look at first glance, but that's the documented boundary for this
// anonymizer, same "don't scrub more than the spec says" posture
// TrainersAnonymizer/PlayerProfilesAnonymizer already establish for their
// own models.
@Injectable()
export class CoachesAnonymizer implements Anonymizer {
  readonly model = 'CoachProfile';

  async anonymize(userId: string, tx: Prisma.TransactionClient): Promise<void> {
    const coachProfile = await tx.coachProfile.findUnique({ where: { userId } });
    if (!coachProfile) {
      return;
    }

    await tx.coachProfile.update({
      where: { userId },
      data: { bio: null, credentials: null },
    });
  }
}
