import { isURL, IsUrl, ValidateBy, buildMessage } from 'class-validator';

/**
 * URL validator for uploaded-asset fields (logoUrl, photoUrl). http(s) only —
 * `javascript:`, `data:` and `file:` URLs are rejected — but, unlike a bare
 * `@IsUrl()`, a TLD is NOT required so the dev storage URLs
 * (`http://localhost:3000/uploads/...`) validate.
 */
export const IsAssetUrl = () =>
  IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, allow_underscores: true });

// Spec US-01.11 "Profile photo (upload or URL)": a typed-in link is stored as
// given (never downloaded), so it is capped to keep rows small.
export const MAX_PHOTO_URL_LENGTH = 2048;

function isPlatformAssetUrl(value: string): boolean {
  // Same default as env.schema.ts (read lazily so this file stays free of the env-validating import).
  const base = (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`).replace(/\/+$/, '');
  return value.startsWith(`${base}/uploads/`) && isURL(value, { protocols: ['http', 'https'], require_protocol: true, require_tld: false, allow_underscores: true });
}

/**
 * True for an uploaded platform asset (`<PUBLIC_API_URL>/uploads/...`, which
 * is plain http on a dev machine) or any external `https://` image link.
 * External `http:`, `javascript:`, `data:` and credentialed URLs are rejected.
 */
export function isPhotoUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PHOTO_URL_LENGTH) {
    return false;
  }
  if (isPlatformAssetUrl(value)) {
    return true;
  }
  return isURL(value, { protocols: ['https'], require_protocol: true, require_tld: true, allow_underscores: true, disallow_auth: true });
}

/** Profile-photo URL: a platform asset URL (from `POST /storage/photo`) or any valid `https://` image URL. */
export const IsPhotoUrl = () =>
  ValidateBy(
    {
      name: 'isPhotoUrl',
      validator: { validate: (value: unknown) => isPhotoUrl(value), defaultMessage: buildMessage((each) => `${each}$property must be an uploaded photo URL or a valid https URL`) },
    },
  );
