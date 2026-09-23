import sharp from 'sharp';

import { generateThumbnail, resizeImage, resizeLogo } from './image-processor';

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
});
