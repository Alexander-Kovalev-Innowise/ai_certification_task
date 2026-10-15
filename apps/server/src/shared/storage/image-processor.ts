import sharp from 'sharp';

// Task 1.11. sharp-based resize helper. Used by the outbox's MEDIA_* jobs
// (shared/jobs, Task 1.12) and by the upload endpoints (StorageController) to
// keep every stored image in one of two safe raster formats. SVG input is
// always rasterised — a raw SVG is never stored or served, so no script in it
// can ever reach a browser.
export type OutputFormat = 'png' | 'webp';

export interface ResizeOptions {
  width: number;
  height: number;
  fit?: keyof sharp.FitEnum;
  format?: OutputFormat;
}

/** Thrown for input that is not a supported/safe image; callers map it to a 400. */
export class InvalidImageError extends Error {}

const ALLOWED_INPUT_FORMATS: ReadonlySet<string> = new Set(['png', 'jpeg', 'webp', 'svg']);
const MAX_INPUT_PIXELS = 40_000_000;

export const CONTENT_TYPE_BY_FORMAT: Record<OutputFormat, string> = { png: 'image/png', webp: 'image/webp' };
export const EXTENSION_BY_FORMAT: Record<OutputFormat, string> = { png: '.png', webp: '.webp' };

export async function resizeImage(input: Buffer, options: ResizeOptions): Promise<Buffer> {
  const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(options.width, options.height, { fit: options.fit ?? 'cover' });
  return (options.format === 'webp' ? pipeline.webp({ quality: 85 }) : pipeline.png()).toBuffer();
}

// Logo resize toward 200×200 (Task 0.6's design-token note references this
// target). `fit: 'inside'` preserves aspect ratio without cropping a logo.
// Always PNG so the stored key/extension/content type are predictable.
export async function resizeLogo(input: Buffer): Promise<Buffer> {
  return resizeImage(input, { width: 200, height: 200, fit: 'inside', format: 'png' });
}

export async function generateThumbnail(input: Buffer, size = 150): Promise<Buffer> {
  return resizeImage(input, { width: size, height: size, fit: 'cover', format: 'png' });
}

/**
 * Defence in depth for SVG input before librsvg renders it: no DTD/entities
 * (XXE / billion laughs) and no external references (local-file / SSRF via
 * <image href>, <use>, CSS url()). Only same-document `#id` and `data:` refs
 * are allowed. The result is rasterised anyway, so scripts are inert.
 */
function assertSafeSvg(input: Buffer): void {
  const text = input.toString('utf8');
  if (/<!ENTITY/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) {
    throw new InvalidImageError('SVG with entity declarations is not allowed');
  }
  for (const match of text.matchAll(/(?:xlink:)?href\s*=\s*["']\s*([^"']*)["']/gi)) {
    const ref = (match[1] ?? '').trim();
    if (!ref.startsWith('#') && !/^data:image\//i.test(ref)) {
      throw new InvalidImageError('SVG with external references is not allowed');
    }
  }
  for (const match of text.matchAll(/url\(\s*["']?\s*([^)"']*)/gi)) {
    const ref = (match[1] ?? '').trim();
    if (ref && !ref.startsWith('#') && !/^data:image\//i.test(ref)) {
      throw new InvalidImageError('SVG with external references is not allowed');
    }
  }
}

/**
 * Validates that `input` really is a PNG/JPEG/WebP/SVG (by content, not by the
 * client-declared mimetype) and returns the detected format. Throws
 * InvalidImageError otherwise.
 */
export async function assertSupportedImage(input: Buffer): Promise<void> {
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).format;
  } catch {
    throw new InvalidImageError('File is not a valid image');
  }
  if (!format || !ALLOWED_INPUT_FORMATS.has(format)) {
    throw new InvalidImageError('Unsupported image type — use PNG, JPEG, WebP or SVG');
  }
  if (format === 'svg') {
    assertSafeSvg(input);
  }
}

/** Validated + normalised portal logo: PNG, bounded to 200×200. */
export async function prepareLogo(input: Buffer): Promise<Buffer> {
  await assertSupportedImage(input);
  return resizeLogo(input);
}

/** Validated + normalised profile photo: 512×512 and 128×128 WebP square crops. */
export async function preparePhoto(input: Buffer): Promise<{ photo: Buffer; thumbnail: Buffer }> {
  await assertSupportedImage(input);
  const [photo, thumbnail] = await Promise.all([
    resizeImage(input, { width: 512, height: 512, fit: 'cover', format: 'webp' }),
    resizeImage(input, { width: 128, height: 128, fit: 'cover', format: 'webp' }),
  ]);
  return { photo, thumbnail };
}
