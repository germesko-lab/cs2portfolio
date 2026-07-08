import type { ApiResult } from '@/lib/contracts/api';

/** Client fetch wrapper: unwraps the ApiResult envelope, throws on ok:false. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  let body: ApiResult<T>;
  try {
    body = (await res.json()) as ApiResult<T>;
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}
