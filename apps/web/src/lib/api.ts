import 'server-only';
import { headers } from 'next/headers';

/**
 * Server-side client for the ILACORE API. The browser never talks to the API directly: it talks to
 * this web app, which forwards the session token. That keeps the token in an HttpOnly cookie on one site.
 */
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3001';

export interface ApiReply<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T;
  /** Error code from the API (for example invalid_credentials), or api_unreachable. */
  readonly error?: string;
  readonly setCookies: string[];
}

export async function api<T = Record<string, unknown>>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; token?: string | undefined } = {},
): Promise<ApiReply<T>> {
  const incoming = await headers();
  const outgoing: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) outgoing['content-type'] = 'application/json';
  if (options.token) outgoing['authorization'] = `Bearer ${options.token}`;
  // Pass the person's address and browser on, so the API's rate limits and audit log see them, not this server.
  const forwardedFor = incoming.get('x-forwarded-for');
  if (forwardedFor) outgoing['x-forwarded-for'] = forwardedFor;
  const userAgent = incoming.get('user-agent');
  if (userAgent) outgoing['user-agent'] = userAgent;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: outgoing,
      cache: 'no-store',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    return { ok: false, status: 503, data: {} as T, error: 'api_unreachable', setCookies: [] };
  }
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T & { error?: string };
  return {
    ok: res.ok,
    status: res.status,
    data,
    ...(res.ok ? {} : { error: data.error ?? 'unknown' }),
    setCookies: res.headers.getSetCookie(),
  };
}