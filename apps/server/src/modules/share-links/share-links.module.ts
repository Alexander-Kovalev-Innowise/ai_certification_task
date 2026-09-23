import { Module } from '@nestjs/common';

import { JobsModule } from '../../shared/jobs/jobs.module';
import { AssociationsModule } from '../associations/associations.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

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
// `UsersModule`, `OutboxService` via `JobsModule`).
@Module({
  imports: [AssociationsModule, AuthModule, UsersModule, JobsModule],
  controllers: [ShareLinksController],
  providers: [ShareLinksRepository, ShareLinkService, ShareLinkRedemptionService],
  exports: [ShareLinksRepository, ShareLinkService],
})
export class ShareLinksModule {}
