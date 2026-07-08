import { NextResponse } from 'next/server';
import { readSession } from '@/lib/server/steam-auth';
import type { ApiResult } from '@/lib/contracts/api';

export const dynamic = 'force-dynamic';

export interface SessionResponse {
  userId: number | null;
  steamId: string | null;
}

export function GET(request: Request): NextResponse {
  const user = readSession(request.headers.get('cookie'));
  const result: ApiResult<SessionResponse> = {
    ok: true,
    data: { userId: user?.id ?? null, steamId: user?.steamId ?? null },
  };
  return NextResponse.json(result);
}
