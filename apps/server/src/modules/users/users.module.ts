import { Module } from '@nestjs/common';

import { UsersRepository } from './users.repository';

// Task 2.9 — module skeleton + repository only. UsersController/UsersService
// (GET /me, PATCH /me) land in Task 2.22; AccountProvisioningService lands
// in Task 2.10.
@Module({
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
