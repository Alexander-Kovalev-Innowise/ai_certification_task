import { Module } from '@nestjs/common';

import { AssociationsController } from './associations.controller';
import { AssociationsRepository } from './associations.repository';
import { AssociationsService } from './associations.service';

// Task 4.1's repository-only skeleton, extended in Task 5.7 with the real
// `AssociationsController`/`AssociationsService` (api §4.3, arch §2's "one
// resource surface, two owning modules" — `player-profiles` and
// `associations` both mount under `/player-profiles`). Still exports
// `AssociationsRepository` — `share-links` (Tasks 4.6/4.7/4.9) and
// `player-profiles` (Task 5.1) import this module for it without a
// circular dependency back onto either.
@Module({
  controllers: [AssociationsController],
  providers: [AssociationsRepository, AssociationsService],
  exports: [AssociationsRepository, AssociationsService],
})
export class AssociationsModule {}
