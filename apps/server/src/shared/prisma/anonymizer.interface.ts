import type { Prisma } from '@prisma/client';

// Task 3.4 (arch §11.2, verbatim shape). Every module that stores PII
// provides one of these; AccountLifecycleService.gdprDelete() (Task 3.7)
// invokes every registered Anonymizer inside its one transaction.
export const ANONYMIZER = Symbol('ANONYMIZER');

export interface Anonymizer {
  readonly model: string;
  anonymize(userId: string, tx: Prisma.TransactionClient): Promise<void>;
}

/**
 * Duck-typed guard used by AnonymizerRegistry (anonymizer.registry.ts) to
 * pick a provider instance out of Nest's DiscoveryService results — see that
 * file's comment for why discovery, not a literal multi-provider token, is
 * how this codebase implements "every module registers one."
 */
export function isAnonymizer(value: unknown): value is Anonymizer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Anonymizer).model === 'string' &&
    typeof (value as Anonymizer).anonymize === 'function'
  );
}
