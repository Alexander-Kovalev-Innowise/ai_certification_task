import { Module } from '@nestjs/common';

import { AssociationsModule } from '../associations/associations.module';

import { PlayerProfileService } from './player-profile.service';
import { PlayerProfilesAnonymizer } from './player-profiles.anonymizer';
import { PlayerProfilesController } from './player-profiles.controller';
import { PlayerProfilesRepository } from './player-profiles.repository';

// Task 5.1, extended in place by Tasks 5.2-5.6. `AssociationsModule` is
// imported for `AssociationsRepository` (Task 5.1's `trainerIds` branch,
// Task 5.5's per-child trainer list) — same cross-module-without-cycle
// pattern share-links/coaches already use for it. `PlayerProfilesAnonymizer`
// (Task 5.6) needs no explicit wiring beyond being listed as a provider
// here — `AnonymizerRegistry` (users module) discovers it app-wide via
// Nest's `DiscoveryService`, same as `UsersAnonymizer`.
@Module({
  imports: [AssociationsModule],
  controllers: [PlayerProfilesController],
  providers: [PlayerProfilesRepository, PlayerProfileService, PlayerProfilesAnonymizer],
  exports: [PlayerProfilesRepository, PlayerProfileService],
})
export class PlayerProfilesModule {}
