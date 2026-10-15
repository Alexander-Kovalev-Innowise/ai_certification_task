import { Module } from '@nestjs/common';

import { JobsModule } from '../../shared/jobs/jobs.module';
import { AssociationsModule } from '../associations/associations.module';
import { CoachesModule } from '../coaches/coaches.module';
import { PlayerProfilesModule } from '../player-profiles/player-profiles.module';

import { AvailabilityController, CoachAvailabilityController } from './availability.controller';
import { AvailabilityRepository } from './availability.repository';
import { AvailabilityService } from './availability.service';
import { ConflictCheckService } from './conflict-check.service';

// Task 5.11, extended in Task 6.1 (coach "My Times" pair), Task 6.2
// (conflict-check read) and Task 6.3 (override write + notify).
// `PlayerProfilesModule` (profile lookup/ownership) and `AssociationsModule`
// (the roster-based read check for an associated TRAINER/COACH) were both
// imported for the player pair; `CoachesModule` (CoachesRepository, for the
// coach pair's/conflict-check's/override's ownership resolution) and
// `JobsModule` (OutboxService, for the override's
// `EMAIL_COACH_OVERRIDE_NOTIFY` enqueue) are added for the coach pair. None
// of the four import this module back, so no cycle.
@Module({
  imports: [PlayerProfilesModule, AssociationsModule, CoachesModule, JobsModule],
  controllers: [AvailabilityController, CoachAvailabilityController],
  providers: [AvailabilityRepository, AvailabilityService, ConflictCheckService],
  exports: [AvailabilityRepository, AvailabilityService],
})
export class AvailabilityModule {}
