import { apiRequest } from '../api/apiClient';
import { parseApiErrorBody } from '../api/apiError';

// Mirrors the server's POST /storage/logo and /storage/photo limits (2MB;
// PNG/JPEG/WebP/SVG — the server rasterises SVG and never stores it raw).
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const ACCEPT_ATTRIBUTE = `${ACCEPTED_IMAGE_TYPES.join(',')},.svg`;

export const UNSUPPORTED_TYPE_MESSAGE = 'Unsupported file type. Use PNG, JPEG, WebP or SVG.';
export const TOO_LARGE_MESSAGE = 'The image is larger than 2MB. Choose a smaller file.';

/** Returns a human-readable error, or null when the file is acceptable. */
export function validateImageFile(file: File): string | null {
  const isSvgByName = file.name.toLowerCase().endsWith('.svg');
  const typeOk = (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type) || (file.type === '' && isSvgByName);
  if (!typeOk) {
    return UNSUPPORTED_TYPE_MESSAGE;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return TOO_LARGE_MESSAGE;
  }
  return null;
}

async function postImage<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await apiRequest(path, { method: 'POST', body: formData });
  if (!res.ok) {
    await parseApiErrorBody(res);
    throw new Error(`POST ${path} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface UploadedPhoto {
  url: string;
  thumbnailUrl: string;
}

/** `POST /storage/photo` — 512px photo + 128px thumbnail (US-01.11). */
export function uploadPhoto(file: File): Promise<UploadedPhoto> {
  return postImage<UploadedPhoto>('/storage/photo', file);
}

/** `POST /storage/logo` — 200x200-bounded PNG (US-01.14). */
export function uploadLogo(file: File): Promise<{ logoUrl: string }> {
  return postImage<{ logoUrl: string }>('/storage/logo', file);
}

/**
 * The server stores `photo-<id>.webp` next to `photo-<id>-thumb.webp`, so a
 * small avatar can use the thumbnail without a second field on the profile.
 * Any other URL (e.g. one typed in by older data) is returned unchanged.
 */
export function thumbnailUrlFor(photoUrl: string): string {
  return photoUrl.replace(/(\/photo-[0-9a-f-]+)\.webp$/i, '$1-thumb.webp');
}
