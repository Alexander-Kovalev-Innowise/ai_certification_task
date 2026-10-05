import sharp from 'sharp';

import { generateThumbnail, InvalidImageError, prepareLogo, preparePhoto, resizeImage, resizeLogo } from './image-processor';

async function makeFixtureImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

describe('image-processor (Task 1.11)', () => {
  it('resizeImage produces the requested exact dimensions with fit: cover', async () => {
    const fixture = await makeFixtureImage(800, 600);

    const resized = await resizeImage(fixture, { width: 100, height: 50, fit: 'cover' });

    const metadata = await sharp(resized).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(50);
  });

  it('resizeLogo resizes toward 200x200, preserving aspect ratio (fit: inside)', async () => {
    const fixture = await makeFixtureImage(400, 200); // 2:1 landscape

    const resized = await resizeLogo(fixture);

    const metadata = await sharp(resized).metadata();
    // fit: 'inside' bounds both dimensions by 200 without cropping —
    // the larger side (width) hits 200 exactly, height scales down to 100.
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });

  it('generateThumbnail defaults to a 150x150 square crop', async () => {
    const fixture = await makeFixtureImage(300, 900);

    const thumbnail = await generateThumbnail(fixture);

    const metadata = await sharp(thumbnail).metadata();
    expect(metadata.width).toBe(150);
    expect(metadata.height).toBe(150);
  });

  it('generateThumbnail honors a custom size', async () => {
    const fixture = await makeFixtureImage(300, 300);

    const thumbnail = await generateThumbnail(fixture, 64);

    const metadata = await sharp(thumbnail).metadata();
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
  });

  it('resizeLogo/generateThumbnail always output PNG, even for JPEG input', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .jpeg()
      .toBuffer();

    expect((await sharp(await resizeLogo(jpeg)).metadata()).format).toBe('png');
    expect((await sharp(await generateThumbnail(jpeg)).metadata()).format).toBe('png');
  });

  describe('SVG handling', () => {
    const svg = (body = '') =>
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="200"><rect width="400" height="200" fill="red"/>${body}</svg>`,
      );

    it('prepareLogo rasterises an SVG to a PNG bounded by 200x200', async () => {
      const out = await prepareLogo(svg('<script>alert(1)</script>'));
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
      expect(out.toString('latin1')).not.toContain('<script');
    });

    it('rejects SVGs with external references or entities', async () => {
      await expect(prepareLogo(svg('<image href="file:///etc/passwd"/>'))).rejects.toBeInstanceOf(InvalidImageError);
      await expect(prepareLogo(svg('<image xlink:href="http://evil.example/x.png"/>'))).rejects.toBeInstanceOf(InvalidImageError);
      await expect(prepareLogo(svg('<rect style="fill:url(http://evil.example/x)"/>'))).rejects.toBeInstanceOf(InvalidImageError);
      await expect(
        prepareLogo(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')),
      ).rejects.toBeInstanceOf(InvalidImageError);
    });

    it('rejects non-image bytes', async () => {
      await expect(prepareLogo(Buffer.from('not an image'))).rejects.toBeInstanceOf(InvalidImageError);
    });
  });

  it('preparePhoto returns a 512px photo and a 128px thumbnail as WebP', async () => {
    const fixture = await makeFixtureImage(900, 600);

    const { photo, thumbnail } = await preparePhoto(fixture);

    const photoMeta = await sharp(photo).metadata();
    const thumbMeta = await sharp(thumbnail).metadata();
    expect([photoMeta.format, photoMeta.width, photoMeta.height]).toEqual(['webp', 512, 512]);
    expect([thumbMeta.format, thumbMeta.width, thumbMeta.height]).toEqual(['webp', 128, 128]);
  });
});
