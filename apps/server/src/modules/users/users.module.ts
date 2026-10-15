import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { AnonymizerRegistry } from '../../shared/prisma/anonymizer.registry';
import { AssociationsModule } from '../associations/associations.module';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';
import { AvailabilityRepository } from '../availability/availability.repository';
import { ChildApprovalsRepository } from '../child-approvals/child-approvals.repository';
import { CoachesRepository } from '../coaches/coaches.repository';
import { PlayerProfilesModule } from '../player-profiles/player-profiles.module';
import { TrainersRepository } from '../trainers/trainers.repository';

import { AccountLifecycleService } from './account-lifecycle.service';
import { AccountProvisioningService } from './account-provisioning.service';
import { UserDeletionLogRepository } from './user-deletion-log.repository';
import { UsersAnonymizer } from './users.anonymizer';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// Task 2.9 skeleton, extended in Task 2.10 with AccountProvisioningService,
// in Task 2.22 with UsersController/UsersService (GET/PATCH /me), from
// Task 3.1 onward with the Super-Admin global-directory + lifecycle
// surface, and with the `GET /me/bootstrap` gap-fill (api §5/arch §14) —
// Phase 9's DoD sweep found it had been referenced as existing
// infrastructure by every prior phase without ever being implemented.
// DiscoveryModule (Task 3.4) is what lets AnonymizerRegistry find every
// registered Anonymizer app-wide, not just this module's own.
// `RefreshTokenRepository` (Task 3.5) is imported directly from the auth
// module, not via an `AuthModule` import — see account-lifecycle.service.ts's
// comment on why that would be circular. `TrainersRepository`/
// `CoachesRepository`/`AvailabilityRepository`/`ChildApprovalsRepository`
// (the bootstrap gap-fill) follow the exact same direct-provider workaround,
// for the same reason: `TrainersModule` imports `UsersModule` directly, and
// `CoachesModule`/`AvailabilityModule` both reach `UsersModule` transitively
// via `ShareLinksModule` — importing any of those four modules back here
// would be circular. All four repositories depend on nothing but the
// `@Global()` `PrismaService`, so a second DI instance alongside their own
// module's is safe (same trade-off `RefreshTokenRepository` already makes).
// `AssociationsModule`/`PlayerProfilesModule` genuinely have no path back to
// `UsersModule`, so those two are imported normally, for
// `AssociationsService`/`AssociationsRepository`/`PlayerProfileService` —
// bootstrap's PLAYER_PARENT branch delegates to those services' own
// per-accountType scoping rather than re-deriving it. DomainEventsEmitter
// (Task 3.7) is NOT listed as a provider here — EventsModule is @Global()
// and imported once in AppModule, so it's already available for injection
// everywhere.
@Module({
  imports: [DiscoveryModule, AssociationsModule, PlayerProfilesModule],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    AccountProvisioningService,
    UsersService,
    UsersAnonymizer,
    AnonymizerRegistry,
    RefreshTokenRepository,
    UserDeletionLogRepository,
    AccountLifecycleService,
    TrainersRepository,
    CoachesRepository,
    AvailabilityRepository,
    ChildApprovalsRepository,
  ],
  exports: [UsersRepository, AccountProvisioningService],
})
export class UsersModule {}
