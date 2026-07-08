import { NextResponse } from 'next/server';
import {
  createSessionCookie,
  resolveBaseUrl,
  SteamAuthError,
  upsertUserFromSteam,
  verifyOpenIdReturn,
} from '@/lib/server/steam-auth';
import { syncInventory, ApiError } from '@/lib/server/portfolio-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/steam/return - verify Steam OpenID, upsert the user, create a
 * persistent 30-day session, then try to sync that user's public inventory.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const base = resolveBaseUrl(request);
  const query = new URL(request.url).searchParams;

  let steamId: string;
  try {
    steamId = await verifyOpenIdReturn(query, base);
  } catch (err) {
    const message =
      err instanceof SteamAuthError ? err.message : 'Steam sign-in failed unexpectedly. Try again.';
    return NextResponse.redirect(`${base}/?authError=${encodeURIComponent(message)}`, 302);
  }

  const user = upsertUserFromSteam(steamId);
  let target = `${base}/?login=ok`;
  try {
    const sync = await syncInventory(user, steamId);
    target = `${base}/?login=ok&synced=${sync.itemCount}`;
  } catch (err) {
    const message =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : 'Could not sync the inventory after sign-in.';
    target = `${base}/?login=ok&syncError=${encodeURIComponent(message)}`;
  }

  const res = NextResponse.redirect(target, 302);
  res.headers.set('Set-Cookie', createSessionCookie(user.id, base.startsWith('https://')));
  return res;
}
