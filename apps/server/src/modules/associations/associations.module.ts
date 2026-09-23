import { Module } from '@nestjs/common';

import { AssociationsRepository } from './associations.repository';

// Task 4.1. Repository-only skeleton — no controller yet (that's
// `AssociationsController`, Phase 5, api §4.3). Exported so `share-links`
// (Tasks 4.6/4.7/4.9) can import this module and inject
// `AssociationsRepository` without a circular dependency back onto
// `player-profiles` (arch §2's stated reason `associations` is its own
// module in the first place).
@Module({
  providers: [AssociationsRepository],
  exports: [AssociationsRepository],
})
export class AssociationsModule {}
