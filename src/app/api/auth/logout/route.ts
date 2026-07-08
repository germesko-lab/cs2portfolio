import { NextResponse } from 'next/server';
import { clearSessionCookie, deleteSession } from '@/lib/server/steam-auth';
import type { ApiResult } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

export function POST(request: Request): NextResponse {
  deleteSession(request.headers.get('cookie'));
  const result: ApiResult<{ signedOut: true }> = { ok: true, data: { signedOut: true } };
  const res = NextResponse.json(result);
  res.headers.set('Set-Cookie', clearSessionCookie());
  return res;
}
