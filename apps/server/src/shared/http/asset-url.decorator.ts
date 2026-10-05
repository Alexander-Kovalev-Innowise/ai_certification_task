import { IsUrl } from 'class-validator';

/**
 * URL validator for uploaded-asset fields (logoUrl, photoUrl). http(s) only —
 * `javascript:`, `data:` and `file:` URLs are rejected — but, unlike a bare
 * `@IsUrl()`, a TLD is NOT required so the dev storage URLs
 * (`http://localhost:3000/uploads/...`) validate.
 */
export const IsAssetUrl = () =>
  IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, allow_underscores: true });
