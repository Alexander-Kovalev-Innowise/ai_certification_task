import { Module } from '@nestjs/common';

import { ShareLinkService } from './share-link.service';
import { ShareLinksController } from './share-links.controller';
import { ShareLinksRepository } from './share-links.repository';

// Task 4.2, first providers/controller — extended in place by every later
// share-links task rather than re-created (Tasks 4.3-4.10, 4.14).
@Module({
  controllers: [ShareLinksController],
  providers: [ShareLinksRepository, ShareLinkService],
  exports: [ShareLinksRepository, ShareLinkService],
})
export class ShareLinksModule {}
