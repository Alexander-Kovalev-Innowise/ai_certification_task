import { Module } from '@nestjs/common';

import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

// Read-only aggregate endpoint; depends only on the @Global() PrismaModule.
@Module({
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService],
})
export class DashboardModule {}
