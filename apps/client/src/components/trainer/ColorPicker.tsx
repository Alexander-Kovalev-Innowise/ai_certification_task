'use client';

// fe §8 "`/trainer/branding` settings form specifics": "ColorPicker: native
// color input + hex text field kept in sync, live-previews against
// BrandingLivePreview (a miniature rendering of the nav bar + a primary
// button, using the in-progress hex before save)." Task 17.1.
//
// Fully controlled — no internal state — so the branding page/form owns the
// single source of truth for the in-progress hex and can feed the same
// value into BrandingLivePreview without the two ever disagreeing.
export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  error?: string;
  id?: string;
}

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

export function ColorPicker({ value, onChange, error, id = 'branding-primary-color' }: ColorPickerProps) {
  const swatchId = `${id}-swatch`;
  const hexId = `${id}-hex`;
  const errorId = `${id}-error`;

  // The native `<input type="color">` only ever accepts a well-formed
  // 7-char `#rrggbb` value, so an in-progress invalid hex (still being
  // typed in the text field) is passed through untouched here rather than
  // fed to the swatch, which would just reject/normalize it silently.
  const swatchValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000';

  return (
    <div className="flex flex-col gap-xxs">
      <div className="flex items-center gap-sm">
        <label htmlFor={swatchId} className="sr-only">
          Color swatch
        </label>
        <input
          id={swatchId}
          type="color"
          value={swatchValue}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-12 cursor-pointer rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)]"
        />
        <div className="flex flex-1 flex-col gap-xxs">
          <label htmlFor={hexId} className="text-body text-[var(--text-secondary)]">
            Hex color
          </label>
          <input
            id={hexId}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            placeholder="#6EE7B7"
            className={INPUT_CLASSNAME}
          />
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-caption text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
