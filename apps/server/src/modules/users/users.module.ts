import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { AnonymizerRegistry } from '../../shared/prisma/anonymizer.registry';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';

import { AccountLifecycleService } from './account-lifecycle.service';
import { AccountProvisioningService } from './account-provisioning.service';
import { UsersAnonymizer } from './users.anonymizer';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// Task 2.9 skeleton, extended in Task 2.10 with AccountProvisioningService,
// in Task 2.22 with UsersController/UsersService (GET/PATCH /me), and from
// Task 3.1 onward with the Super-Admin global-directory + lifecycle
// surface. DiscoveryModule (Task 3.4) is what lets AnonymizerRegistry find
// every registered Anonymizer app-wide, not just this module's own.
// RefreshTokenRepository (Task 3.5) is imported directly from the auth
// module, not via an AuthModule import — see account-lifecycle.service.ts's
// comment on why that would be circular.
@Module({
  imports: [DiscoveryModule],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    AccountProvisioningService,
    UsersService,
    UsersAnonymizer,
    AnonymizerRegistry,
    RefreshTokenRepository,
    AccountLifecycleService,
  ],
  exports: [UsersRepository, AccountProvisioningService],
})
export class UsersModule {}
