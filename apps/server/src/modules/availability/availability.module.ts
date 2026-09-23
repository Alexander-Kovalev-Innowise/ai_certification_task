import { Module } from '@nestjs/common';

import { AssociationsModule } from '../associations/associations.module';
import { PlayerProfilesModule } from '../player-profiles/player-profiles.module';

import { AvailabilityController } from './availability.controller';
import { AvailabilityRepository } from './availability.repository';
import { AvailabilityService } from './availability.service';

// Task 5.11. `PlayerProfilesModule` (profile lookup/ownership) and
// `AssociationsModule` (the roster-based read check for an associated
// TRAINER/COACH) are both imported — neither imports this module back, so
// no cycle.
@Module({
  imports: [PlayerProfilesModule, AssociationsModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityRepository, AvailabilityService],
  exports: [AvailabilityRepository, AvailabilityService],
})
export class AvailabilityModule {}
