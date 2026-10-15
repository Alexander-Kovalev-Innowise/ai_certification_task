export const DEFAULT_LOGO_URL = '/default_logo.svg';

export interface PortalLogoProps {
  src?: string;
  alt?: string;
  className?: string;
}

// The portal mark. Only the platform's own white artwork flips to dark on the
// light theme; a tenant's uploaded logo is shown exactly as supplied.
export function PortalLogo({ src = DEFAULT_LOGO_URL, alt = 'PracticePerfect', className = '' }: PortalLogoProps) {
  const adaptive = src === DEFAULT_LOGO_URL ? 'logo-adaptive' : '';
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tenant logo URLs are arbitrary remote hosts
    <img src={src} alt={alt} className={`${adaptive} ${className}`.trim()} />
  );
}
