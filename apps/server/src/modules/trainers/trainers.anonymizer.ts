import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { Anonymizer } from '../../shared/prisma/anonymizer.interface';

// Task 3.10 (arch §11.2: "trainers (business details)"). Discovered
// automatically by AnonymizerRegistry (Task 3.4) — being a plain
// `@Injectable()` provider listed in TrainersModule's `providers` (and
// TrainersModule being imported by AppModule) is all that's needed; no
// other wiring changes when this is added.
//
// Keyed by `userId`, not `TrainerProfile.id` — AccountLifecycleService.
// gdprDelete() (Task 3.7) calls every registered Anonymizer with the
// *User's* id, since that's the only id it has for an arbitrary deleted
// account. Not every deleted user owns a TrainerProfile (most don't), so a
// missing row is a normal no-op, not an error.
@Injectable()
export class TrainersAnonymizer implements Anonymizer {
  readonly model = 'TrainerProfile';

  async anonymize(userId: string, tx: Prisma.TransactionClient): Promise<void> {
    const trainerProfile = await tx.trainerProfile.findUnique({ where: { userId } });
    if (!trainerProfile) {
      return;
    }

    await tx.trainerProfile.update({
      where: { userId },
      data: {
        businessName: 'Deleted Business',
        address: null,
        website: null,
        description: null,
      },
    });
  }
}
