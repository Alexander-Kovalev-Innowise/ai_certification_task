'use client';

import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';

import { INVALID_PHOTO_URL_MESSAGE, isHttpsImageUrl } from '../../lib/schemas/photoUrl';
import { ACCEPT_ATTRIBUTE, thumbnailUrlFor, uploadPhoto, validateImageFile } from '../../lib/upload/imageUpload';

export interface PhotoUploadFieldProps {
  /** Current photo URL, or '' when there is none. */
  value: string;
  /** Called with the uploaded (or typed-in https) URL, or '' when the photo is removed. */
  onChange: (url: string) => void;
  id?: string;
  label?: string;
  /** Fallback initials shown in the avatar when there is no photo. */
  initials?: string;
  disabled?: boolean;
}

const UPLOAD_ERROR_MESSAGE = 'Something went wrong uploading your photo. Please try again.';

// US-01.11 — reusable profile-photo picker: click or drag & drop, client-side
// type/size validation (the server re-validates), avatar preview and remove.
// The upload happens immediately (`POST /storage/photo`) and the resulting
// URL is handed to the surrounding form via `onChange`, so the form's own
// submit payload stays a plain `photoUrl` string. "Upload or URL" (spec
// US-01.11): an external https image link can be entered instead - it is
// stored as typed, never downloaded.
export function PhotoUploadField({ value, onChange, id = 'photo-upload', label = 'Photo', initials = '', disabled = false }: PhotoUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }
    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsUploading(true);
    try {
      const uploaded = await uploadPhoto(file);
      onChange(uploaded.url);
    } catch {
      setError(UPLOAD_ERROR_MESSAGE);
    } finally {
      setIsUploading(false);
    }
  }

  function applyUrl() {
    const url = urlDraft.trim();
    if (!url) {
      return;
    }
    if (!isHttpsImageUrl(url)) {
      setError(INVALID_PHOTO_URL_MESSAGE);
      return;
    }
    setError(null);
    onChange(url);
    setUrlDraft('');
  }

  // Enter inside the URL box applies the URL; it must never submit the surrounding form.
  function handleUrlKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyUrl();
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    void handleFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled || isUploading) {
      return;
    }
    void handleFile(event.dataTransfer.files?.[0]);
  }

  const busy = disabled || isUploading;

  return (
    <div className="flex flex-col gap-xxs">
      <label htmlFor={id} className="field-label">
        {label}
      </label>

      <div
        data-testid="photo-dropzone"
        data-dragging={isDragging}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) {
            setIsDragging(true);
          }
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-wrap items-center gap-md rounded-md border border-dashed p-sm transition-colors ${
          isDragging ? 'border-brand-primary bg-surface-2' : 'border-border-soft'
        }`}
      >
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-pill border border-border-soft bg-surface-2 text-body font-semibold text-ink-muted">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded photo served by the API, not an optimizable static asset
            <img src={thumbnailUrlFor(value)} alt="Photo preview" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true">{initials || '?'}</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-xs">
          <p className="text-caption text-ink-muted">Drag an image here or choose a file. PNG, JPEG, WebP or SVG, up to 2MB.</p>
          <div className="flex flex-wrap gap-sm">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="btn btn-secondary btn-sm">
              {isUploading ? 'Uploading…' : value ? 'Change photo' : 'Upload photo'}
            </button>
            {value && (
              <button type="button" onClick={() => onChange('')} disabled={busy} className="btn btn-ghost btn-sm">
                Remove photo
              </button>
            )}
          </div>
        </div>

        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          disabled={busy}
          className="sr-only"
        />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor={`${id}-url`} className="field-label">
          Or use an image URL
        </label>
        <div className="flex flex-wrap gap-sm">
          <input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            placeholder="https://example.com/photo.jpg"
            autoComplete="off"
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={handleUrlKeyDown}
            disabled={busy}
            className="min-w-0 flex-1"
          />
          <button type="button" onClick={applyUrl} disabled={busy || !urlDraft.trim()} className="btn btn-secondary btn-sm">
            Use image URL
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
