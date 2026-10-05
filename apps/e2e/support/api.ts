import { API_URL, SEED } from './seed';

export type Role = 'SUPER_ADMIN' | 'TRAINER' | 'COACH' | 'PLAYER_PARENT';

export interface UserSummary {
  id: string;
  email: string;
  role: Role;
  accountType: 'ADULT' | 'CHILD';
  firstName: string;
  lastName: string;
  mustChangePassword: boolean;
}

/**
 * What POST /auth/login (and /auth/refresh) return.
 * Deviation from api section 1: `csrfToken` is ALSO in the body, because the
 * client and API are on different origins and JS cannot read the API's cookie.
 */
export interface Session {
  accessToken: string;
  expiresIn: number;
  csrfToken: string;
  user: UserSummary;
}

/** A logged-in API identity. `cookie` is the raw Cookie header value holding the refresh token. */
export interface ApiSession extends Session {
  /** `refreshToken=...; csrf=...` - refresh is COOKIE-ONLY, so it must be replayed manually. */
  cookie: string;
  obtainedAt: number;
}

export interface ApiResult<T = unknown> {
  status: number;
  ok: boolean;
  body: T;
  headers: Headers;
}

export interface RequestOptions {
  /** Bearer access token, or an ApiSession. */
  auth?: string | ApiSession;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

function tokenOf(auth: RequestOptions['auth']): string | undefined {
  return typeof auth === 'string' ? auth : auth?.accessToken;
}

function cookieHeaderFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

/** Minimal typed fetch client for the isolated e2e API (default http://localhost:3100). */
export class ApiClient {
  private superAdminCache?: ApiSession;

  constructor(readonly baseUrl: string = API_URL) {}

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const token = tokenOf(opts.auth);
    const res = await fetch(url, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* non-JSON body: keep the text */
    }
    return { status: res.status, ok: res.ok, body: body as T, headers: res.headers };
  }

  get = <T = unknown>(path: string, opts?: RequestOptions) => this.request<T>('GET', path, opts);
  post = <T = unknown>(path: string, opts?: RequestOptions) => this.request<T>('POST', path, opts);
  patch = <T = unknown>(path: string, opts?: RequestOptions) => this.request<T>('PATCH', path, opts);
  put = <T = unknown>(path: string, opts?: RequestOptions) => this.request<T>('PUT', path, opts);
  delete = <T = unknown>(path: string, opts?: RequestOptions) => this.request<T>('DELETE', path, opts);

  /** POST /auth/login; throws on non-2xx. Returns the session plus the refresh cookie for manual refresh. */
  async login(email: string, password: string): Promise<ApiSession> {
    const res = await this.post<Session>('/auth/login', { body: { email, password } });
    if (!res.ok) throw new Error(`login(${email}) failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { ...res.body, cookie: cookieHeaderFrom(res.headers), obtainedAt: Date.now() };
  }

  /** POST /auth/refresh - cookie-only; needs the csrf double-submit header. Rotates the cookie. */
  async refresh(session: ApiSession): Promise<ApiSession> {
    const res = await this.post<Session>('/auth/refresh', {
      headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken },
    });
    if (!res.ok) throw new Error(`refresh failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { ...res.body, cookie: cookieHeaderFrom(res.headers) || session.cookie, obtainedAt: Date.now() };
  }

  /** POST /auth/logout for a session (cookie + csrf header + bearer). */
  async logout(session: ApiSession): Promise<ApiResult> {
    return this.post('/auth/logout', { auth: session, headers: { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } });
  }

  /** Seeded Super Admin session, cached until shortly before its access token expires. */
  async superAdmin(): Promise<ApiSession> {
    const s = this.superAdminCache;
    if (s && Date.now() - s.obtainedAt < (s.expiresIn - 30) * 1000) return s;
    this.superAdminCache = await this.login(SEED.superAdmin.email, SEED.superAdmin.password);
    return this.superAdminCache;
  }

  /** Is the API up? (Swagger UI is served at /docs.) */
  async isUp(): Promise<boolean> {
    try {
      return (await fetch(new URL('/docs', this.baseUrl))).ok;
    } catch {
      return false;
    }
  }
}
