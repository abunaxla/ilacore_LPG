import 'server-only';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';

export interface Location {
  id: string;
  name: string;
  kind: string;
}

/** GET from the API with the caller's session. Empty on failure: the page still renders its own message. */
export async function load<T>(path: string, fallback: T): Promise<T> {
  const reply = await api<T>(path, { token: await getToken() });
  return reply.ok ? reply.data : fallback;
}