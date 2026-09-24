import { Module } from '@nestjs/common';

import { AssociationsModule } from '../associations/associations.module';
import { CoachesModule } from '../coaches/coaches.module';
import { PlayerProfilesModule } from '../player-profiles/player-profiles.module';

import { AvailabilityController, CoachAvailabilityController } from './availability.controller';
import { AvailabilityRepository } from './availability.repository';
import { AvailabilityService } from './availability.service';
import { ConflictCheckService } from './conflict-check.service';

// Task 5.11, extended in Task 6.1 for the coach "My Times" pair and Task
// 6.2 for the conflict-check read. `PlayerProfilesModule` (profile lookup/
// ownership) and `AssociationsModule` (the roster-based read check for an
// associated TRAINER/COACH) were both imported for the player pair;
// `CoachesModule` (CoachesRepository, for the coach pair's + conflict-
// check's ownership resolution) is added for the coach pair. None of the
// three import this module back, so no cycle.
@Module({
  imports: [PlayerProfilesModule, AssociationsModule, CoachesModule],
  controllers: [AvailabilityController, CoachAvailabilityController],
  providers: [AvailabilityRepository, AvailabilityService, ConflictCheckService],
  exports: [AvailabilityRepository, AvailabilityService],
})
export class AvailabilityModule {}
