import { Module } from '@nestjs/common';

import { JobsModule } from '../../shared/jobs/jobs.module';
import { ShareLinksModule } from '../share-links/share-links.module';

import { CoachService } from './coach.service';
import { CoachesAnonymizer } from './coaches.anonymizer';
import { CoachesController } from './coaches.controller';
import { CoachesRepository } from './coaches.repository';

// Task 4.11, first providers/controller — extended in place by Tasks
// 4.12/4.13. `ShareLinksModule` is imported (not just `ShareLinkService`
// re-provided here) for `CoachService.inviteCoach`'s delegation to
// `ShareLinkService.generateCoachLink`; `JobsModule` brings in
// `OutboxService` for the invite email enqueue. `CoachesAnonymizer` (Task
// 6.4) needs no import of its own — AnonymizerRegistry discovers it via
// Nest's DiscoveryService purely from being listed as a provider here (see
// that provider's own comment).
@Module({
  imports: [ShareLinksModule, JobsModule],
  controllers: [CoachesController],
  providers: [CoachesRepository, CoachService, CoachesAnonymizer],
  exports: [CoachesRepository, CoachService],
})
export class CoachesModule {}
