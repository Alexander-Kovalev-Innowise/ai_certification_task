import { randomUUID } from 'node:crypto';

import { BadRequestException, Controller, HttpCode, HttpStatus, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';

import { Capability } from '../security/capability.enum';
import { RequiresCapability } from '../security/decorators/requires-capability.decorator';
import { Roles } from '../security/decorators/roles.decorator';

import { UploadLogoResponseDto } from './dto/upload-logo-response.dto';
import { StorageService } from './storage.service';

// api §4.1: "400 VALIDATION_ERROR bad hex / logo >2MB / wrong type".
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * Task 8.2 (api §4.1 "PATCH /trainers/:id/branding": "Multipart or two-step
 * (POST logo to shared/storage first, then this PATCH with the resulting
 * URL — matches FileStorageService port design)"). This is the pre-upload
 * step: stores the raw bytes via StorageService and hands back the URL to
 * PATCH with. It does NOT enqueue MEDIA_LOGO_RESIZE itself — that happens
 * inside PortalBrandingService.updateBranding (Task 8.1, `modules/trainers`)
 * when the PATCH actually sets `logoUrl`, atomically with the TrainerProfile
 * write. Keeping the resize-job trigger out of this controller is what lets
 * `shared/storage` stay a one-directional dependency of `shared/jobs`
 * (JobsModule already imports StorageModule for StorageService) instead of a
 * circular one.
 *
 * Same `@RequiresCapability(MANAGE_PORTAL_BRANDING)` gate as the PATCH this
 * feeds — uploading a logo has no purpose outside that flow in Epic-01
 * scope, so it gets the same authorization as the endpoint that consumes it
 * rather than a broader "any authenticated user can upload files" capability
 * that doesn't exist yet.
 */
@ApiTags('storage')
@ApiBearerAuth()
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Roles(Role.TRAINER, Role.SUPER_ADMIN)
  @RequiresCapability(Capability.MANAGE_PORTAL_BRANDING)
  @Post('logo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Pre-upload step for PATCH /trainers/:id/branding — uploads raw logo bytes, returns a URL to PATCH with' })
  @ApiResponse({ status: 201, type: UploadLogoResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  async uploadLogo(@UploadedFile() file?: { buffer: Buffer; mimetype: string; size: number }): Promise<UploadLogoResponseDto> {
    if (!file) {
      throw new BadRequestException({ message: 'A "file" field is required', errorCode: 'VALIDATION_ERROR' });
    }
    if (file.size > MAX_LOGO_BYTES) {
      throw new BadRequestException({ message: 'Logo exceeds the 2MB limit', errorCode: 'VALIDATION_ERROR' });
    }
    const extension = EXTENSION_BY_MIME_TYPE[file.mimetype];
    if (!extension) {
      throw new BadRequestException({ message: `Unsupported logo type: ${file.mimetype}`, errorCode: 'VALIDATION_ERROR' });
    }

    // Flat key, no "/" — LocalStorageAdapter (Task 1.11) only mkdir's its
    // single UPLOAD_DIR, not arbitrary nested subdirectories a slash in the
    // key would imply, so a nested key would fail dev/test uploads.
    const key = `logo-${randomUUID()}${extension}`;
    const result = await this.storageService.upload({ key, contentType: file.mimetype, body: file.buffer });

    return plainToInstance(UploadLogoResponseDto, { logoUrl: result.url }, { excludeExtraneousValues: true });
  }
}
