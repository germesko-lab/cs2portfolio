import { NextResponse } from 'next/server';
import { errorEnvelope, requireUser, syncInventory } from '@/lib/server/portfolio-service';
import type { ApiResult, SyncResponse } from '@/lib/contracts/api';

/**
 * POST /api/inventory/sync
 * Body: { input?: string } - SteamID64, profile URL, vanity URL or trade
 * offer URL. Empty input syncs the signed-in user's own Steam account.
 * The literal "demo" loads the bundled fixture into the signed-in user's
 * isolated portfolio.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = requireUser(request);
    let input: string | null = null;
    let forceDemo = false;
    try {
      const body: unknown = await request.json();
      if (typeof body === 'object' && body !== null) {
        for (const field of ['input', 'steamId'] as const) {
          const value = (body as Record<string, unknown>)[field];
          if (typeof value === 'string' && value.trim() !== '') {
            input = value.trim();
            break;
          }
        }
      }
    } catch {
      // Empty body is fine: default to the signed-in user's SteamID.
    }
    if (input !== null && input.toLowerCase() === 'demo') {
      input = null;
      forceDemo = true;
    }

    const data = await syncInventory(user, input, forceDemo);
    const result: ApiResult<SyncResponse> = { ok: true, data };
    return NextResponse.json(result);
  } catch (err) {
    const { status, body } = errorEnvelope(err, 502);
    return NextResponse.json(body, { status });
  }
}
