'use client';

import { useState, type ChangeEvent } from 'react';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';

// api §4.1 — logo upload is a two-step flow: `POST /storage/logo` (this
// component's job — the pre-upload step, `shared/storage`'s
// `StorageController.uploadLogo`) returns `{ logoUrl }` for the *raw,
// pre-resize* bytes immediately; the caller then includes that URL in the
// follow-up `PATCH /trainers/:id/branding` (BrandingPage's job, Task 17.1),
// which is what actually enqueues the async `MEDIA_LOGO_RESIZE` outbox job.
// This component never calls the PATCH itself.
//
// "Processing placeholder while MEDIA_LOGO_RESIZE runs" (plan's Task 17.1
// file list): there is no status-polling endpoint for the resize job, so
// this optimistically renders the just-uploaded (pre-resize) image
// immediately via `currentLogoUrl`/`onUploaded` while labeling it as
// processing — the resized bytes land at the same URL once the outbox
// drains, confirmed on this page's next `GET /me/bootstrap` refetch, not by
// this component re-fetching anything itself.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const GENERIC_ERROR_MESSAGE = 'Something went wrong uploading your logo. Please try again.';

export interface LogoUploadFieldProps {
  currentLogoUrl: string | null;
  onUploaded: (logoUrl: string) => void;
  id?: string;
}

export function LogoUploadField({ currentLogoUrl, onUploaded, id = 'branding-logo' }: LogoUploadFieldProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Stays true for the rest of this mount once an upload succeeds — there is
  // no status-polling endpoint for MEDIA_LOGO_RESIZE, so "processing" can
  // only be cleared by the caller remounting this field (`key` prop, same
  // pattern as InviteCoachModal's prefill) once a later `GET /me/bootstrap`
  // refetch confirms the resize is done, not by an internal timer/effect.
  const [justUploaded, setJustUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setError(null);

    if (file.size > MAX_LOGO_BYTES) {
      setError('Logo exceeds the 2MB limit.');
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Unsupported file type. Use PNG, JPEG, or WebP.');
      return;
    }

    setIsSubmitting(true);

    const formData = new FormData();
    formData.append('file', file);

    const res = await apiRequest('/storage/logo', { method: 'POST', body: formData });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setError(GENERIC_ERROR_MESSAGE);
      setIsSubmitting(false);
      return;
    }

    const result = (await res.json()) as { logoUrl: string };
    setPreviewUrl(result.logoUrl);
    setIsSubmitting(false);
    setJustUploaded(true);
    onUploaded(result.logoUrl);
  }

  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={id} className="text-body text-[var(--text-secondary)]">
        Logo
      </label>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo, not an optimizable static asset
        <img src={previewUrl} alt="Logo preview" className="h-16 w-16 rounded-sm border border-[var(--border-soft)] object-contain" />
      )}

      <input
        id={id}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={(event) => void handleFileChange(event)}
        disabled={isSubmitting}
        className="text-body text-[var(--text-primary)]"
      />

      {(isSubmitting || justUploaded) && (
        <p role="status" className="text-caption text-[var(--text-secondary)]">
          Processing your logo…
        </p>
      )}

      {error && (
        <p role="alert" className="text-caption text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
