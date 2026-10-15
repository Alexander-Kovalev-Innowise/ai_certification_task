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
import { UploadPhotoResponseDto } from './dto/upload-photo-response.dto';
import { InvalidImageError, prepareLogo, preparePhoto } from './image-processor';
import { StorageService } from './storage.service';

// api §4.1: "400 VALIDATION_ERROR bad hex / logo >2MB / wrong type".
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
// Hard cap handed to multer so an oversize body is never buffered in full;
// the precise 2MB limit is enforced in requireFile() so the error stays a 400.
const MULTER_HARD_LIMIT_BYTES = 3 * 1024 * 1024;

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

function toBadRequest(error: unknown): never {
  if (error instanceof InvalidImageError) {
    throw new BadRequestException({ message: error.message, errorCode: 'VALIDATION_ERROR' });
  }
  throw error;
}

/**
 * Task 8.2 (api §4.1 "PATCH /trainers/:id/branding": "Multipart or two-step
 * (POST logo to shared/storage first, then this PATCH with the resulting
 * URL — matches FileStorageService port design)"). This is the pre-upload
 * step: validates and normalises the image, stores it via StorageService and
 * hands back the URL to PATCH with. It does NOT enqueue MEDIA_LOGO_RESIZE
 * itself — that happens inside PortalBrandingService.updateBranding (Task
 * 8.1, `modules/trainers`) when the PATCH actually sets `logoUrl`,
 * atomically with the TrainerProfile write. Keeping the resize-job trigger
 * out of this controller is what lets `shared/storage` stay a
 * one-directional dependency of `shared/jobs` (JobsModule already imports
 * StorageModule for StorageService) instead of a circular one.
 *
 * Same `@RequiresCapability(MANAGE_PORTAL_BRANDING)` gate as the PATCH this
 * feeds. US-01.11 adds POST /storage/photo for profile photos, gated by
 * EDIT_OWN_PROFILE instead.
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT_BYTES } }))
  @ApiOperation({
    summary:
      'Pre-upload step for PATCH /trainers/:id/branding — accepts PNG/JPEG/WebP/SVG (<=2MB), stores a 200x200-bounded PNG, returns its URL',
  })
  @ApiResponse({ status: 201, type: UploadLogoResponseDto })
  @ApiResponse({ status: 400 })
  @ApiResponse({ status: 403 })
  async uploadLogo(@UploadedFile() file?: UploadedImage): Promise<UploadLogoResponseDto> {
    const input = this.requireFile(file, MAX_LOGO_BYTES, 'Logo');

    // The image is validated (by content, not declared mimetype), SVG is
    // rasterised, and everything is normalised to a 200x200-bounded PNG right
    // here — the stored key, extension and content type always agree
    // (.png / image/png). The later MEDIA_LOGO_RESIZE job is then an
    // idempotent safety net, never the thing that fixes up a bad extension.
    const body = await prepareLogo(input).catch(toBadRequest);

    // Flat key, no "/" — LocalStorageAdapter only writes into one directory.
    const key = `logo-${randomUUID()}.png`;
    const result = await this.storageService.upload({ key, contentType: 'image/png', body });

    return plainToInstance(UploadLogoResponseDto, { logoUrl: result.url }, { excludeExtraneousValues: true });
  }

  // US-01.11. Any authenticated user (incl. CHILD logins — EDIT_OWN_PROFILE is
  // not in CHILD_DENIED) can upload a profile photo; the URL is then PATCHed
  // onto /me, /player-profiles/:id or a new child profile.
  @RequiresCapability(Capability.EDIT_OWN_PROFILE)
  @Post('photo')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT_BYTES } }))
  @ApiOperation({
    summary: 'Upload a profile photo (PNG/JPEG/WebP/SVG, <=2MB) — stores a 512px photo and a 128px thumbnail, returns both URLs',
  })
  @ApiResponse({ status: 201, type: UploadPhotoResponseDto })
  @ApiResponse({ status: 400 })
  async uploadPhoto(@UploadedFile() file?: UploadedImage): Promise<UploadPhotoResponseDto> {
    const input = this.requireFile(file, MAX_PHOTO_BYTES, 'Photo');
    const { photo, thumbnail } = await preparePhoto(input).catch(toBadRequest);

    const id = randomUUID();
    const [full, thumb] = await Promise.all([
      this.storageService.upload({ key: `photo-${id}.webp`, contentType: 'image/webp', body: photo }),
      this.storageService.upload({ key: `photo-${id}-thumb.webp`, contentType: 'image/webp', body: thumbnail }),
    ]);

    return plainToInstance(UploadPhotoResponseDto, { url: full.url, thumbnailUrl: thumb.url }, { excludeExtraneousValues: true });
  }

  private requireFile(file: UploadedImage | undefined, maxBytes: number, label: string): Buffer {
    if (!file) {
      throw new BadRequestException({ message: 'A "file" field is required', errorCode: 'VALIDATION_ERROR' });
    }
    if (file.size > maxBytes) {
      throw new BadRequestException({ message: `${label} exceeds the 2MB limit`, errorCode: 'VALIDATION_ERROR' });
    }
    return file.buffer;
  }
}
