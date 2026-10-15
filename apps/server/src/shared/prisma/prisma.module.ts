import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

// @Global() per arch "Global Conventions": PrismaService is injected into
// repositories only (and shared/ infrastructure, the documented exception).
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
