import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { Public } from '../../shared/security/decorators/public.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';
import { Roles } from '../../shared/security/decorators/roles.decorator';
import { AuthSessionResponseDto } from '../auth/dto/auth-session-response.dto';

import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ListShareLinksQueryDto } from './dto/list-share-links-query.dto';
import { RedeemShareLinkDto } from './dto/redeem-share-link.dto';
import { ShareLinkCreatedResponseDto, ShareLinkPreviewResponseDto, ShareLinkRowDto } from './dto/share-link-response.dto';
import { ShareLinkRedemptionService } from './share-link-redemption.service';
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
  constructor(
    private readonly shareLinkService: ShareLinkService,
    private readonly shareLinkRedemptionService: ShareLinkRedemptionService,
  ) {}

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

  // Task 4.3 (api §4.4 "GET /share-links/:code"). Never 404s — even an
  // unknown code returns 200 {valid:false, reason:'NOT_FOUND'} (arch §9.1
  // enumeration-safety posture).
  @Public()
  @Get('share-links/:code')
  @ApiOperation({ summary: 'Public ShareLink preview — branding only, never PII, never 404s' })
  @ApiResponse({ status: 200, type: ShareLinkPreviewResponseDto })
  async previewShareLink(@Param('code') code: string): Promise<ShareLinkPreviewResponseDto> {
    return this.shareLinkService.previewShareLink(code);
  }

  // Task 4.4 (api §4.4 "GET /trainers/:id/share-links", added — §8.9 gap).
  // Own tenant for TRAINER, any for SUPER_ADMIN — same ownership pattern as
  // TrainersController.getTrainer (api §4.1 footnote).
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.GENERATE_SHARE_LINK)
  @Get('trainers/:id/share-links')
  @ApiOperation({ summary: "List a trainer's own generated ShareLinks and their usage counts" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Cross-tenant (never 403, arch §8 Layer 3)' })
  async listShareLinks(
    @CurrentUser() ctx: AuthContext,
    @Param('id') id: string,
    @Query() query: ListShareLinksQueryDto,
  ): Promise<PaginatedResponseDto<ShareLinkRowDto>> {
    return this.shareLinkService.listShareLinks(ctx, id, query);
  }

  // Task 4.5 (api §4.4 "DELETE /share-links/:id"). Soft revoke, not a row
  // delete — usage history survives for the Epic-06 analytics stub.
  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.GENERATE_SHARE_LINK)
  @Delete('share-links/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a ShareLink (soft — status becomes REVOKED)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  async revokeShareLink(@CurrentUser() ctx: AuthContext, @Param('id') id: string): Promise<void> {
    await this.shareLinkService.revokeShareLink(ctx, id);
  }

  // Task 4.6, extended in Task 4.7 (ASSOCIATE_EXISTING), Task 4.8
  // (CHILD_SHARE_LINK_BLOCKED), Task 4.9 (COACH_ACCEPT) and Task 4.10
  // (ROLE_CANNOT_REDEEM_SHARE_LINK + final Swagger pass over every response
  // shape). `@Public()` at the guard level — auth is read manually inside
  // ShareLinkRedemptionService.redeem (api §4.4's "auth optional" posture;
  // see that method's own comment on why `@RequiresCapability` would be
  // inert here even if added). `@Res()` WITHOUT `passthrough` — each branch
  // returns a different status code (`201`/`200`/...), which
  // `ShareLinkRedemptionService.RedeemResult`'s own comment explains a
  // passthrough return value can't express (Nest re-applies the
  // reflected/default status on top regardless of anything set on `res`
  // beforehand). Currently implements ANONYMOUS_REGISTRATION and
  // ASSOCIATE_EXISTING; the remaining branches land in the tasks named
  // above.
  @Public()
  @Throttle({ 'auth-ip': {} })
  @Post('share-links/:code/redeem')
  @ApiOperation({ summary: 'Redeem a ShareLink — dispatches by auth state x typ x link type (arch §9.1)' })
  @ApiResponse({ status: 201, description: 'ANONYMOUS_REGISTRATION — auto-login session', type: AuthSessionResponseDto })
  @ApiResponse({ status: 200, description: 'ASSOCIATE_EXISTING — one row per subjectProfileIds entry' })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 404, description: 'Unknown code, or a subjectProfileIds entry not owned by the caller' })
  @ApiResponse({ status: 409, description: 'Expired/exhausted/revoked link', schema: { example: { errorCode: 'SHARE_LINK_UNAVAILABLE' } } })
  @ApiResponse({ status: 429, description: 'Too many attempts', headers: { 'Retry-After': { schema: { type: 'integer' } } } })
  async redeemShareLink(
    @Param('code') code: string,
    @Body() dto: RedeemShareLinkDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.shareLinkRedemptionService.redeem(code, dto, req, res);
    res.status(result.statusCode).json(result.body);
  }
}
