import { NextResponse } from 'next/server';
import {
  createSessionCookie,
  resolveBaseUrl,
  SteamAuthError,
  verifyOpenIdReturn,
} from '@/lib/server/steam-auth';
import { syncInventory, ApiError } from '@/lib/server/portfolio-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/steam/return — Steam redirects here after sign-in. Verify the
 * OpenID assertion, establish the session, then immediately try to sync the
 * user's public inventory so the dashboard is populated on landing. A private
 * inventory is NOT a failed login: the session is still created and the exact
 * privacy-setting fix is surfaced as a banner (STEAM_INTEGRATION.md — OpenID
 * proves identity only, it cannot unlock a private inventory).
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

  let target = `${base}/?login=ok`;
  try {
    const sync = await syncInventory(steamId);
    target = `${base}/?login=ok&synced=${sync.itemCount}`;
  } catch (err) {
    const message =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : 'Could not sync the inventory after sign-in.';
    target = `${base}/?login=ok&syncError=${encodeURIComponent(message)}`;
  }

  const res = NextResponse.redirect(target, 302);
  res.headers.set('Set-Cookie', createSessionCookie(steamId, base.startsWith('https://')));
  return res;
}
