import { NextResponse } from 'next/server';
import { errorEnvelope, syncInventory } from '@/lib/server/portfolio-service';
import type { ApiResult, SyncResponse } from '@/lib/contracts/api';

/**
 * POST /api/inventory/sync
 * Body: { input?: string } — anything resolve.ts accepts (SteamID64, profile
 * URL, vanity URL, trade offer URL). The literal "demo" (or an omitted/empty
 * input) loads the bundled fixture so the app runs with zero external calls.
 * { steamId } is honored as a legacy alias; STEAM_ID env is the last resort.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let input: string | null = null;
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
      // Empty or non-JSON body is fine — fall back to the environment.
    }
    if (input === null && process.env.STEAM_ID) input = process.env.STEAM_ID;
    if (input !== null && input.toLowerCase() === 'demo') input = null;

    const data = await syncInventory(input);
    const result: ApiResult<SyncResponse> = { ok: true, data };
    return NextResponse.json(result);
  } catch (err) {
    // Sync talks to the (possibly live) Steam upstream — failures are 502
    // unless the service mapped a more specific ApiError (400/403/404/429).
    const { status, body } = errorEnvelope(err, 502);
    return NextResponse.json(body, { status });
  }
}
