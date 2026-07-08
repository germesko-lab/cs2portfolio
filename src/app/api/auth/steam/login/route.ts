import { NextResponse } from 'next/server';
import { buildLoginRedirectUrl, resolveBaseUrl } from '@/lib/server/steam-auth';

export const dynamic = 'force-dynamic';

/** GET /api/auth/steam/login — kick off "Sign in through Steam" (OpenID 2.0). */
export function GET(request: Request): NextResponse {
  return NextResponse.redirect(buildLoginRedirectUrl(resolveBaseUrl(request)), 302);
}
