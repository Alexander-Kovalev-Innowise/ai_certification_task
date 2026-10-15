/**
 * Validates a post-login `next` redirect target. Only a same-origin relative
 * path that starts with a single `/` is allowed — never an absolute URL, a
 * protocol-relative `//host` URL, a backslash trick (`/\host`) or anything
 * with control characters — so `?next=` can never become an open redirect.
 * Returns the path, or `null` when it is missing/unsafe.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (typeof next !== 'string' || next.length === 0) {
    return null;
  }
  if (!next.startsWith('/') || next.startsWith('//')) {
    return null;
  }
  // Backslashes (browsers treat `/\` like `//`) and control characters.
  for (const char of next) {
    const code = char.charCodeAt(0);
    if (code === 0x5c || code <= 0x1f || code === 0x7f) {
      return null;
    }
  }
  return next;
}
