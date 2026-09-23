import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { AnonymizerRegistry } from '../../shared/prisma/anonymizer.registry';

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
@Module({
  imports: [DiscoveryModule],
  controllers: [UsersController],
  providers: [UsersRepository, AccountProvisioningService, UsersService, UsersAnonymizer, AnonymizerRegistry],
  exports: [UsersRepository, AccountProvisioningService],
})
export class UsersModule {}
