import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

// Read-mostly derived feed; depends only on the @Global() PrismaModule.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsRepository, NotificationsService],
})
export class NotificationsModule {}
