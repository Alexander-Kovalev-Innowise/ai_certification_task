import { z } from 'zod';

// Spec US-01.11 "Profile photo (upload or URL)". Mirrors the server's
// `isPhotoUrl` (shared/http/asset-url.decorator.ts): an external image link
// must be https; an uploaded platform asset (`<API>/uploads/...`, plain http on
// a dev machine) is also fine. The server re-validates the exact platform host.
export const MAX_PHOTO_URL_LENGTH = 2048;
export const INVALID_PHOTO_URL_MESSAGE = 'Enter a valid image link starting with https://.';

function parse(value: string): URL | null {
  try {
    const url = new URL(value);
    return value.length <= MAX_PHOTO_URL_LENGTH && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** A link a user may type in: https only. */
export function isHttpsImageUrl(value: string): boolean {
  return parse(value)?.protocol === 'https:';
}

/** A stored photo URL: an https link, or an uploaded platform asset. */
export function isValidPhotoUrl(value: string): boolean {
  const url = parse(value);
  if (!url) {
    return false;
  }
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.pathname.startsWith('/uploads/'));
}

/** Optional photo field: '' means "no photo". */
export function optionalPhotoUrlSchema() {
  return z
    .string()
    .trim()
    .max(MAX_PHOTO_URL_LENGTH, `Photo URL must be ${MAX_PHOTO_URL_LENGTH} characters or fewer.`)
    .refine((value) => value === '' || isValidPhotoUrl(value), INVALID_PHOTO_URL_MESSAGE);
}
