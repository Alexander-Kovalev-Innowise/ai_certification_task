import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { env } from '../config/config.module';

// Deviation from the plan (Prisma 7.10.0, pinned in Phase 0): Prisma 7
// requires a driver adapter at runtime — `new PrismaClient()` with no
// arguments throws ("A driver adapter is required to connect to your
// database"). `PrismaPg` from `@prisma/adapter-pg` replaces the implicit
// `datasource.url` wiring that worked in Prisma ≤6.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
