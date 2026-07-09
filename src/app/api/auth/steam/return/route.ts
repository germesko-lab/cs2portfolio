import { NextResponse } from 'next/server';
import {
  createSessionCookie,
  resolveBaseUrl,
  SteamAuthError,
  upsertUserFromSteam,
  verifyOpenIdReturn,
} from '@/lib/server/steam-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/steam/return - verify Steam OpenID, upsert the user and create
 * a persistent 30-day session. Inventory sync is intentionally kicked off by
 * the dashboard after redirect so Steam login is not blocked by slow inventory
 * paging, rate limits, price history, or cost-basis backfill work.
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
  const target = `${base}/?login=ok&sync=pending`;
  const res = NextResponse.redirect(target, 302);
  res.headers.set('Set-Cookie', createSessionCookie(user.id, base.startsWith('https://')));
  return res;
}
