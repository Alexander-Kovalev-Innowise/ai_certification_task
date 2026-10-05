import { extname } from 'node:path';

import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Public } from '../security/decorators/public.decorator';

import { StorageService } from './storage.service';

// Only raster formats are ever stored (SVG is rasterised on upload), so this
// is the complete serve-able set. Anything else 404s.
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Serves objects written by the local storage adapter at `/uploads/:key`
 * (public — logos appear on the public share-link/join pages and photos are
 * plain <img> sources, which cannot send a bearer token). helmet's default
 * `Cross-Origin-Resource-Policy: same-origin` would stop the client origin
 * from embedding these, so this route relaxes it to `cross-origin`.
 */
@ApiTags('storage')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  @Public()
  @Get(':key')
  @ApiOperation({ summary: 'Serve a stored upload (local storage provider only)' })
  async serve(@Param('key') key: string, @Res() res: Response): Promise<void> {
    const contentType = CONTENT_TYPE_BY_EXTENSION[extname(key).toLowerCase()];
    if (!contentType || !SAFE_KEY.test(key)) {
      throw new NotFoundException({ message: 'File not found', errorCode: 'NOT_FOUND' });
    }

    let body: Buffer;
    try {
      body = await this.storageService.read(key);
    } catch {
      throw new NotFoundException({ message: 'File not found', errorCode: 'NOT_FOUND' });
    }

    res.set({
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'public, max-age=86400',
    });
    res.send(body);
  }
}
