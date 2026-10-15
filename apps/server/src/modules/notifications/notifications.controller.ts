import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { NotificationsResponseDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

// In-app notification feed for every authenticated role (the effective role
// decides what is derived). Same self-service `EDIT_OWN_PROFILE` capability the
// other `/me/*` endpoints use. `read-all` is declared before `:id/read` so the
// literal segment is never captured as an id.
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Get()
  @ApiOperation({ summary: "The caller's derived in-app notifications with their unread count" })
  @ApiResponse({ status: 200, type: NotificationsResponseDto })
  async list(@CurrentUser() ctx: AuthContext): Promise<NotificationsResponseDto> {
    return this.notificationsService.list(ctx);
  }

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark every current notification as read' })
  @ApiResponse({ status: 204 })
  async readAll(@CurrentUser() ctx: AuthContext): Promise<void> {
    await this.notificationsService.markAllRead(ctx);
  }

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, description: "Not one of the caller's current notifications" })
  async read(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<void> {
    await this.notificationsService.markRead(ctx, id);
  }
}
