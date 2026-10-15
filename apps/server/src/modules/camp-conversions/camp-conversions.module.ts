import { Module } from '@nestjs/common';

import { JobsModule } from '../../shared/jobs/jobs.module';

import { CampConversionsController } from './camp-conversions.controller';
import { CampConversionsRepository } from './camp-conversions.repository';
import { CampConversionsService } from './camp-conversions.service';

// Deliberately does NOT import ShareLinksModule (which imports this module for the redemption flow) - the few
// ShareLink reads it needs live in its own repository, so there is no module cycle.
@Module({
  imports: [JobsModule],
  controllers: [CampConversionsController],
  providers: [CampConversionsRepository, CampConversionsService],
  exports: [CampConversionsService],
})
export class CampConversionsModule {}
