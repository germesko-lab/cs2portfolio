import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/server/steam-auth';
import type { ApiResult } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout — clear the session cookie. */
export function POST(): NextResponse {
  const result: ApiResult<{ signedOut: true }> = { ok: true, data: { signedOut: true } };
  const res = NextResponse.json(result);
  res.headers.set('Set-Cookie', clearSessionCookie());
  return res;
}
