import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../shared/security/decorators/public.decorator';

import { CampConversionsService } from './camp-conversions.service';
import type { CampConversionCreatedDto, CampConversionPrefillDto } from './dto/camp-conversion-response.dto';
import { CreateCampConversionDto } from './dto/create-camp-conversion.dto';

// Public by design: the camp/evaluation form (Epic-08) is filled in by people who have no account yet.
// Authority comes from the ShareLink code (create) and from the unguessable token (read / email-link).
@ApiTags('camp-conversions')
@Controller('camp-conversions')
export class CampConversionsController {
  constructor(private readonly campConversionsService: CampConversionsService) {}

  @Public()
  @Throttle({ 'auth-ip': {} })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Store a camp/evaluation sign-up and get a conversion token to pre-fill account registration' })
  @ApiResponse({ status: 201, description: '{conversionToken, expiresAt, joinUrl}' })
  @ApiResponse({ status: 404, description: 'Unknown / non-PLAYER_STATIC ShareLink code' })
  @ApiResponse({ status: 409, description: 'ShareLink no longer available (SHARE_LINK_UNAVAILABLE)' })
  create(@Body() dto: CreateCampConversionDto): Promise<CampConversionCreatedDto> {
    return this.campConversionsService.create(dto);
  }

  @Public()
  @Throttle({ 'auth-ip': {} })
  @Get(':token')
  @ApiOperation({ summary: 'Prefill payload + trainer branding for a conversion token' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Unknown or already used token' })
  @ApiResponse({ status: 410, description: 'Expired token (TOKEN_EXPIRED)' })
  getPrefill(@Param('token') token: string): Promise<CampConversionPrefillDto> {
    return this.campConversionsService.getPrefill(token);
  }

  @Public()
  @Throttle({ 'auth-ip': {} })
  @Post(':token/email-link')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email the join link (carrying the token) so the person can register later' })
  @ApiResponse({ status: 202 })
  @ApiResponse({ status: 404, description: 'Unknown or already used token' })
  @ApiResponse({ status: 410, description: 'Expired token (TOKEN_EXPIRED)' })
  async emailLink(@Param('token') token: string): Promise<{ queued: true }> {
    await this.campConversionsService.emailLink(token);
    return { queued: true };
  }
}
