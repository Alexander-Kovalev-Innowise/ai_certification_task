import { Module } from '@nestjs/common';

import { AccountProvisioningService } from './account-provisioning.service';
import { UsersRepository } from './users.repository';

// Task 2.9 skeleton, extended in Task 2.10 with AccountProvisioningService.
// UsersController/UsersService (GET /me, PATCH /me) land in Task 2.22.
@Module({
  providers: [UsersRepository, AccountProvisioningService],
  exports: [UsersRepository, AccountProvisioningService],
})
export class UsersModule {}
