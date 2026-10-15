'use client';

import examples from 'libphonenumber-js/examples.mobile.json';
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';
import { useState } from 'react';

const DEFAULT_COUNTRY: CountryCode = 'US';
const MAX_E164_DIGITS = 15;

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

const COUNTRY_OPTIONS = getCountries()
  .map((code) => ({ code, callingCode: getCountryCallingCode(code), name: regionNames?.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function countryFromValue(value: string): CountryCode {
  return (value && parsePhoneNumberFromString(value)?.country) || DEFAULT_COUNTRY;
}

export interface PhoneInputProps {
  id: string;
  // E.164 string ('+14155552671'), or '' when empty. Partial numbers
  // ('+1415') are emitted as typed so the zod schema can flag them.
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  autoComplete?: string;
}

// Country code is forced: a country selector always prefixes the number, the
// national part is digits-only and formatted as the user types, and pasting a
// full international number ('+44 20 7946 0958') switches the selector to
// match. Emits E.164 so it drops straight into the existing phone schemas.
export function PhoneInput({ id, value, onChange, onBlur, className, autoComplete = 'tel', ...aria }: PhoneInputProps) {
  const [country, setCountry] = useState<CountryCode>(() => countryFromValue(value));

  const callingCode = getCountryCallingCode(country);
  const prefix = `+${callingCode}`;

  // External value change (form reset / prefill) that belongs to another
  // country than the one selected: follow it instead of showing garbage.
  if (value && !value.startsWith(prefix)) {
    const next = countryFromValue(value);
    if (next !== country) {
      setCountry(next);
    }
  }

  const national = value.startsWith(prefix) ? value.slice(prefix.length) : '';
  const displayed = national ? new AsYouType(country).input(national) : '';
  const placeholder = getExampleNumber(country, examples)?.formatNational() ?? 'Phone number';

  function emit(nextCountry: CountryCode, nationalDigits: string) {
    const code = getCountryCallingCode(nextCountry);
    const trimmed = nationalDigits.slice(0, MAX_E164_DIGITS - code.length);
    onChange(trimmed ? `+${code}${trimmed}` : '');
  }

  function handleInput(raw: string) {
    if (raw.trimStart().startsWith('+')) {
      const parsed = parsePhoneNumberFromString(raw);
      if (parsed?.country) {
        setCountry(parsed.country);
        emit(parsed.country, parsed.nationalNumber);
        return;
      }
      const all = digitsOnly(raw);
      if (all.startsWith(callingCode)) {
        emit(country, all.slice(callingCode.length));
        return;
      }
    }
    emit(country, digitsOnly(raw));
  }

  return (
    <div className="flex min-w-0 gap-xs">
      <select
        aria-label="Country calling code"
        value={country}
        onChange={(event) => {
          const nextCountry = event.target.value as CountryCode;
          setCountry(nextCountry);
          emit(nextCountry, national);
        }}
        style={{ width: '9.5rem' }}
        className={`shrink-0 ${className ?? ''}`}
      >
        {COUNTRY_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            +{option.callingCode} {option.name}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={displayed}
        onChange={(event) => handleInput(event.target.value)}
        onBlur={onBlur}
        className={`min-w-0 flex-1 ${className ?? ''}`}
        {...aria}
      />
    </div>
  );
}
