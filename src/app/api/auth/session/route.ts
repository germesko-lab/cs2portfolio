import { NextResponse } from 'next/server';
import { readSession } from '@/lib/server/steam-auth';
import type { ApiResult } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

export interface SessionResponse {
  steamId: string | null;
}

/** GET /api/auth/session — SteamID64 of the signed-in user, or null. */
export function GET(request: Request): NextResponse {
  const result: ApiResult<SessionResponse> = {
    ok: true,
    data: { steamId: readSession(request.headers.get('cookie')) },
  };
  return NextResponse.json(result);
}
