import { Body, Controller, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import type { AuthContext } from '../../shared/security/auth-context.interface';
import { Capability } from '../../shared/security/capability.enum';
import { CurrentUser } from '../../shared/security/decorators/current-user.decorator';
import { Public } from '../../shared/security/decorators/public.decorator';
import { RequiresCapability } from '../../shared/security/decorators/requires-capability.decorator';

import { AuthService } from './auth.service';
import { AuthSessionResponseDto } from './dto/auth-session-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CompleteTrainerSetupDto } from './dto/complete-trainer-setup.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

// Task 2.13, first endpoint — extended by every later auth task
// (2.14–2.20) rather than re-created.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ 'auth-ip': {}, 'auth-identity': {} })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email + password' })
  @ApiResponse({ status: 200, type: AuthSessionResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials or inactive account' })
  @ApiResponse({ status: 429, description: 'Too many attempts', headers: { 'Retry-After': { schema: { type: 'integer' } } } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<AuthSessionResponseDto> {
    return this.authService.login(dto, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token cookie, issuing a fresh access token' })
  @ApiResponse({ status: 200, type: AuthSessionResponseDto })
  @ApiResponse({ status: 401, description: 'Missing/expired/reused refresh token' })
  @ApiResponse({ status: 403, description: 'CSRF token missing or mismatched', schema: { example: { errorCode: 'CSRF_MISMATCH' } } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthSessionResponseDto> {
    return this.authService.refresh(req, res);
  }

  // api §1 footnote: logout needs no fine-grained capability of its own
  // (every authenticated identity may log itself out) — annotated with the
  // closest existing capability rather than left bare, to satisfy the
  // boot-time "every non-@Public route must carry @RequiresCapability"
  // assertion (Task 2.8). Flagged there as a slightly awkward fit, not
  // worth a dedicated @AlwaysAllowed() decorator for Epic-01.
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session (and, with ?everywhere=true, every session)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 403, description: 'CSRF token missing or mismatched', schema: { example: { errorCode: 'CSRF_MISMATCH' } } })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() ctx: AuthContext,
    @Query('everywhere') everywhere?: string,
  ): Promise<void> {
    return this.authService.logout(req, res, ctx.userId, everywhere === 'true');
  }

  @Public()
  @Throttle({ 'auth-ip': {}, 'auth-identity': {} })
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a password reset link (always 202, anti-enumeration)' })
  @ApiResponse({ status: 202 })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ 'token-consume': {} })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume a password reset token, setting a new password' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Invalid/unknown/already-used token' })
  @ApiResponse({ status: 410, description: 'Expired token', schema: { example: { errorCode: 'TOKEN_EXPIRED' } } })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Throttle({ 'token-consume': {} })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume an email-verification token (non-blocking, informational only)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Invalid/unknown/already-used token' })
  @ApiResponse({ status: 410, description: 'Expired token', schema: { example: { errorCode: 'TOKEN_EXPIRED' } } })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ emailVerified: true }> {
    return this.authService.verifyEmail(dto);
  }

  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Throttle({ 'token-consume': {} })
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-issue a fresh email-verification token, invalidating the previous one' })
  @ApiResponse({ status: 202 })
  @ApiResponse({ status: 409, description: 'Already verified', schema: { example: { errorCode: 'CONFLICT' } } })
  async resendVerificationEmail(@CurrentUser() ctx: AuthContext): Promise<{ message: string }> {
    return this.authService.resendVerificationEmail(ctx.userId);
  }

  // One of the three routes exempt from PASSWORD_CHANGE_REQUIRED (Task 2.6).
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change password (currentPassword optional only on the forced-first-change path)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 401, description: 'currentPassword is incorrect' })
  async changePassword(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    return this.authService.changePassword(ctx.userId, dto);
  }

  @Public()
  @Throttle({ 'auth-ip': {} })
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Complete a Super-Admin-provisioned trainer's setup link (NOT public self-registration, BR-005)" })
  @ApiResponse({ status: 200, type: AuthSessionResponseDto })
  @ApiResponse({ status: 404, description: 'Unknown setup token' })
  @ApiResponse({ status: 409, description: 'Setup token already used', schema: { example: { errorCode: 'CONFLICT' } } })
  @ApiResponse({ status: 410, description: 'Setup token expired', schema: { example: { errorCode: 'TOKEN_EXPIRED' } } })
  async register(
    @Body() dto: CompleteTrainerSetupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    return this.authService.completeTrainerSetup(dto, res);
  }
}
