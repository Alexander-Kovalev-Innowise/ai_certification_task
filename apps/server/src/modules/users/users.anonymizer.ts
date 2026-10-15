import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { Anonymizer } from '../../shared/prisma/anonymizer.interface';

// Task 3.4 (arch §11.2 point 3). Anonymizes the User row's own PII:
// name -> "Deleted User" (split sensibly: firstName "Deleted", lastName
// "User"), email -> deleted_{id}@example.com, phone/photoUrl -> null.
// Deliberately does NOT touch status/deletedAt/tokenVersion/passwordHash —
// those are AccountLifecycleService.gdprDelete()'s own direct writes (Task
// 3.7, arch §11.2 points 3-4), not delegated to the anonymizer registry:
// every module's Anonymizer only knows its own PII columns, and
// status/deletedAt/tokenVersion/passwordHash aren't "PII a module owns" so
// much as the account-lifecycle state machine itself.
@Injectable()
export class UsersAnonymizer implements Anonymizer {
  readonly model = 'User';

  async anonymize(userId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: {
        firstName: 'Deleted',
        lastName: 'User',
        email: `deleted_${userId}@example.com`,
        phone: null,
        photoUrl: null,
      },
    });
  }
}
