import { Module } from '@nestjs/common';

import { env } from '../../shared/config/config.module';
import { JobsModule } from '../../shared/jobs/jobs.module';
import { AssociationsModule } from '../associations/associations.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

import { ShareLinkMaintenanceJob } from './share-link-maintenance.job';
import { ShareLinkRedemptionService } from './share-link-redemption.service';
import { ShareLinkService } from './share-link.service';
import { ShareLinksController } from './share-links.controller';
import { ShareLinksRepository } from './share-links.repository';

// Task 4.2, first providers/controller — extended in place by every later
// share-links task rather than re-created (Tasks 4.3-4.10, 4.14).
// `AssociationsModule`/`AuthModule`/`UsersModule`/`JobsModule` are Task 4.6's
// additions, for `ShareLinkRedemptionService`'s dependencies
// (`AssociationsRepository`, `AuthService.issueSession` + `PasswordService`
// via `AuthModule`'s own exports, `AccountProvisioningService` via
// `UsersModule`, `OutboxService` via `JobsModule`). `ShareLinkMaintenanceJob`
// (Task 4.14) is registered only when `SCHEDULER_ENABLED` — same
// single-replica-only gating convention `TokenMaintenanceJob`/`OutboxPump`
// already use (Task 1.12's pattern); `ScheduleModule.forRoot()` itself is
// registered once, by `JobsModule`, already imported here.
@Module({
  imports: [AssociationsModule, AuthModule, UsersModule, JobsModule],
  controllers: [ShareLinksController],
  providers: [
    ShareLinksRepository,
    ShareLinkService,
    ShareLinkRedemptionService,
    ...(env.SCHEDULER_ENABLED ? [ShareLinkMaintenanceJob] : []),
  ],
  exports: [ShareLinksRepository, ShareLinkService],
})
export class ShareLinksModule {}
