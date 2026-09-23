import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';

import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareLinkCreatedResponseDto } from './dto/share-link-response.dto';
import { ShareLinkService } from './share-link.service';

// Task 4.2, first endpoint — extended by every later share-links task
// (4.3-4.10) rather than re-created. Empty `@Controller()` prefix (matching
// UsersController's pattern) because this resource surface mixes
// `/share-links/...` and `/trainers/:id/share-links` paths under one module
// (api §4.4) — a single class-level prefix can't express both.
@ApiTags('share-links')
@ApiBearerAuth()
@Controller()
export class ShareLinksController {
  constructor(private readonly shareLinkService: ShareLinkService) {}

  // Task 4.2 (api §4.4 "POST /share-links", FR-023). TRAINER only — see
  // ShareLinkService.requireTrainerId's comment on why "or Super Admin"
  // (api §4.4's prose) isn't wired up here.
  @Roles(Role.TRAINER)
  @RequiresCapability(Capability.GENERATE_SHARE_LINK)
  @Post('share-links')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Generate a PLAYER_STATIC or COACH_UNIQUE ShareLink for the calling trainer' })
  @ApiResponse({ status: 201, type: ShareLinkCreatedResponseDto })
  @ApiResponse({ status: 400, description: 'Missing targetEmail for COACH_UNIQUE' })
  @ApiResponse({ status: 403 })
  async createShareLink(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: CreateShareLinkDto,
  ): Promise<ShareLinkCreatedResponseDto> {
    return this.shareLinkService.createShareLink(ctx, dto);
  }
}
