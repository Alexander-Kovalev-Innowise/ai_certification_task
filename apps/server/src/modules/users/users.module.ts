import { Module } from '@nestjs/common';

import { AccountProvisioningService } from './account-provisioning.service';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// Task 2.9 skeleton, extended in Task 2.10 with AccountProvisioningService,
// and in Task 2.22 with UsersController/UsersService (GET/PATCH /me). The
// Super-Admin global-directory endpoints (GET/PATCH /users, deactivate/
// reactivate/GDPR-delete) are Phase 3 territory, not built here.
@Module({
  controllers: [UsersController],
  providers: [UsersRepository, AccountProvisioningService, UsersService],
  exports: [UsersRepository, AccountProvisioningService],
})
export class UsersModule {}
