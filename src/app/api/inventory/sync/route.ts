import { NextResponse } from 'next/server';
import { errorEnvelope, syncInventory } from '@/lib/server/portfolio-service';
import type { ApiResult, SyncResponse } from '@/lib/contracts/api';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    let steamId: string | null = null;
    try {
      const body: unknown = await request.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        'steamId' in body &&
        typeof (body as { steamId: unknown }).steamId === 'string'
      ) {
        const trimmed = (body as { steamId: string }).steamId.trim();
        if (trimmed !== '') steamId = trimmed;
      }
    } catch {
      // Empty or non-JSON body is fine — fall back to the environment.
    }
    if (steamId === null) steamId = process.env.STEAM_ID ?? null;

    const data = await syncInventory(steamId);
    const result: ApiResult<SyncResponse> = { ok: true, data };
    return NextResponse.json(result);
  } catch (err) {
    // Sync talks to the (possibly live) Steam upstream — failures are 502.
    const { status, body } = errorEnvelope(err, 502);
    return NextResponse.json(body, { status });
  }
}
