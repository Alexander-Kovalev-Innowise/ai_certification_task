import sharp from 'sharp';

// Task 1.11. sharp-based resize helper. Used by the outbox's MEDIA_* jobs
// (shared/jobs, Task 1.12) to keep CPU-bound image work off the request path
// (arch §13.2) — thumbnail generation and logo resize toward 200×200.
export interface ResizeOptions {
  width: number;
  height: number;
  fit?: keyof sharp.FitEnum;
}

export async function resizeImage(input: Buffer, options: ResizeOptions): Promise<Buffer> {
  return sharp(input)
    .resize(options.width, options.height, { fit: options.fit ?? 'cover' })
    .toBuffer();
}

// Logo resize toward 200×200 (Task 0.6's design-token note references this
// target). `fit: 'inside'` preserves aspect ratio without cropping a logo.
export async function resizeLogo(input: Buffer): Promise<Buffer> {
  return resizeImage(input, { width: 200, height: 200, fit: 'inside' });
}

export async function generateThumbnail(input: Buffer, size = 150): Promise<Buffer> {
  return resizeImage(input, { width: size, height: size, fit: 'cover' });
}
