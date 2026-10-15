'use client';

import { useState, type ChangeEvent } from 'react';

import { ACCEPT_ATTRIBUTE, uploadLogo, validateImageFile } from '../../lib/upload/imageUpload';

// api §4.1 — logo upload is a two-step flow: `POST /storage/logo` (this
// component's job — `shared/storage`'s `StorageController.uploadLogo`)
// validates the image (PNG/JPEG/WebP/SVG, <=2MB), rasterises SVG, resizes to
// at most 200x200 and returns `{ logoUrl }` for the *final* PNG immediately;
// the caller then includes that URL in the follow-up
// `PATCH /trainers/:id/branding` (BrandingPage's job). This component never
// calls the PATCH itself and is controlled: the preview always shows
// `currentLogoUrl`, so the page can also clear it (Reset to default).
const GENERIC_ERROR_MESSAGE = 'Something went wrong uploading your logo. Please try again.';

export interface LogoUploadFieldProps {
  currentLogoUrl: string | null;
  onUploaded: (logoUrl: string) => void;
  id?: string;
}

export function LogoUploadField({ currentLogoUrl, onUploaded, id = 'branding-logo' }: LogoUploadFieldProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const result = await uploadLogo(file);
      onUploaded(result.logoUrl);
    } catch {
      setError(GENERIC_ERROR_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={id} className="field-label">
        Logo
      </label>

      {currentLogoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded logo, not an optimizable static asset
        <img src={currentLogoUrl} alt="Logo preview" className="h-16 w-16 rounded-sm border border-border-soft object-contain" />
      )}

      <input
        id={id}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        onChange={(event) => void handleFileChange(event)}
        disabled={isSubmitting}
        className="text-body text-ink"
      />
      <p className="text-caption text-ink-muted">PNG, JPEG, WebP or SVG, up to 2MB. Resized to fit 200x200.</p>

      {isSubmitting && (
        <p role="status" className="text-caption text-ink-muted">
          Uploading your logo…
        </p>
      )}

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
