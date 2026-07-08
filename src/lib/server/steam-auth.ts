/**
 * Steam OpenID 2.0 "Sign in through Steam" + lightweight signed sessions.
 *
 * Flow (partner.steamgames.com/doc/features/auth, OpenID 2.0 spec):
 *   1. buildLoginRedirectUrl(): send the user to
 *      https://steamcommunity.com/openid/login with checkid_setup params.
 *   2. Steam redirects back to {base}/api/auth/steam/return with a signed
 *      positive assertion (mode=id_res).
 *   3. verifyOpenIdReturn(): validate shape (ns / mode / return_to /
 *      claimed_id pattern / signed fields / one-time nonce), then perform
 *      OpenID §11.4.2 direct verification — POST the assertion back with
 *      openid.mode=check_authentication; Steam answers is_valid:true.
 *
 * Steam OpenID authenticates IDENTITY ONLY — it never grants access to a
 * private inventory (STEAM_INTEGRATION.md). The session is a signed cookie
 * value "steamid.expiry.hmac" — no server-side session store needed.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Same override the inventory client uses — lets tests replay Steam locally. */
const COMMUNITY_BASE = process.env.STEAM_COMMUNITY_BASE_URL ?? 'https://steamcommunity.com';
const OPENID_ENDPOINT = `${COMMUNITY_BASE}/openid/login`;
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
export const RETURN_PATH = '/api/auth/steam/return';

export type SteamAuthErrorCode =
  | 'BAD_ASSERTION' // malformed/incomplete OpenID response
  | 'REPLAYED' // response_nonce seen before
  | 'INVALID_SIGNATURE' // Steam's check_authentication said is_valid:false
  | 'NETWORK'; // verification round-trip failed

export class SteamAuthError extends Error {
  readonly code: SteamAuthErrorCode;
  constructor(code: SteamAuthErrorCode, message: string) {
    super(message);
    this.name = 'SteamAuthError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Base URL — the OpenID realm/return_to must be the site's public URL */
/* ------------------------------------------------------------------ */

/**
 * Priority: APP_BASE_URL env (canonical) → RAILWAY_PUBLIC_DOMAIN (injected by
 * Railway automatically) → the request's own forwarded origin (fine for a
 * personal deployment; set APP_BASE_URL to pin it down hard).
 */
export function resolveBaseUrl(req: Request): string {
  const fromEnv = process.env.APP_BASE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway) return `https://${railway}`;
  const url = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

/* ------------------------------------------------------------------ */
/* OpenID login redirect                                               */
/* ------------------------------------------------------------------ */

export function buildLoginRedirectUrl(baseUrl: string): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': IDENTIFIER_SELECT,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.return_to': `${baseUrl}${RETURN_PATH}`,
    'openid.realm': baseUrl,
  });
  return `${OPENID_ENDPOINT}?${params}`;
}

/* ------------------------------------------------------------------ */
/* Assertion verification                                              */
/* ------------------------------------------------------------------ */

/** One-time nonce cache (10 min window) to block assertion replays. */
declare global {
  var __cs2SeenNonces: Map<string, number> | undefined;
}
const seenNonces: Map<string, number> =
  globalThis.__cs2SeenNonces ?? (globalThis.__cs2SeenNonces = new Map());
const NONCE_TTL_MS = 10 * 60_000;

function nonceIsFresh(nonce: string): boolean {
  const now = Date.now();
  for (const [key, ts] of seenNonces) if (now - ts > NONCE_TTL_MS) seenNonces.delete(key);
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, now);
  return true;
}

const claimedIdPattern = new RegExp(
  `^${COMMUNITY_BASE.replace(/^https?/, 'https?').replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '?' ? ch : `\\${ch}`))}/openid/id/(\\d{17})$`,
);

/**
 * Verify a positive assertion from Steam and return the SteamID64.
 * `query` is the full query string of the return request.
 */
export async function verifyOpenIdReturn(query: URLSearchParams, baseUrl: string): Promise<string> {
  const get = (k: string) => query.get(`openid.${k}`);

  if (get('ns') !== OPENID_NS || get('mode') !== 'id_res') {
    throw new SteamAuthError('BAD_ASSERTION', 'Steam sign-in was cancelled or returned an unexpected response.');
  }
  const returnTo = get('return_to') ?? '';
  if (returnTo !== `${baseUrl}${RETURN_PATH}`) {
    throw new SteamAuthError('BAD_ASSERTION', 'Sign-in return URL mismatch — is APP_BASE_URL configured correctly?');
  }
  const claimed = get('claimed_id') ?? '';
  const match = claimed.match(claimedIdPattern);
  if (!match) {
    throw new SteamAuthError('BAD_ASSERTION', 'Steam sign-in returned an unrecognized identity URL.');
  }
  const signedFields = (get('signed') ?? '').split(',');
  for (const required of ['claimed_id', 'identity', 'return_to', 'response_nonce']) {
    if (!signedFields.includes(required)) {
      throw new SteamAuthError('BAD_ASSERTION', `Steam sign-in assertion does not sign "${required}".`);
    }
  }
  const nonce = get('response_nonce') ?? '';
  if (nonce === '' || !nonceIsFresh(nonce)) {
    throw new SteamAuthError('REPLAYED', 'This Steam sign-in response was already used. Try signing in again.');
  }

  // OpenID 2.0 §11.4.2 direct verification: echo every openid.* param back
  // with mode=check_authentication; Steam validates its own signature.
  const body = new URLSearchParams();
  for (const [key, value] of query) if (key.startsWith('openid.')) body.set(key, value);
  body.set('openid.mode', 'check_authentication');

  let text: string;
  try {
    const res = await fetch(OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (cause) {
    throw new SteamAuthError(
      'NETWORK',
      `Could not verify the sign-in with Steam: ${cause instanceof Error ? cause.message : String(cause)}. Try again.`,
    );
  }
  if (!/is_valid\s*:\s*true/.test(text)) {
    throw new SteamAuthError('INVALID_SIGNATURE', 'Steam rejected the sign-in signature. Try signing in again.');
  }

  return match[1]!;
}

/* ------------------------------------------------------------------ */
/* Session cookie (HMAC-signed, stateless)                             */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'cs2_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

declare global {
  var __cs2SessionSecret: string | undefined;
}

function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Ephemeral fallback so the app runs with zero config; sessions then die on
  // restart/redeploy. Set SESSION_SECRET for persistent sign-ins.
  if (!globalThis.__cs2SessionSecret) {
    globalThis.__cs2SessionSecret = randomBytes(32).toString('hex');
    console.warn('[steam-auth] SESSION_SECRET is not set — using an ephemeral secret; sign-ins reset on restart.');
  }
  return globalThis.__cs2SessionSecret;
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

/** Serialized Set-Cookie value establishing the session. */
export function createSessionCookie(steamId64: string, secure: boolean): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${steamId64}.${expires}`;
  const value = `${payload}.${sign(payload)}`;
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** SteamID64 from a valid, unexpired session cookie — else null. */
export function readSession(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [steamId, expiresStr, mac] = parts as [string, string, string];
  if (!/^\d{17}$/.test(steamId)) return null;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const expected = sign(`${steamId}.${expiresStr}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return steamId;
}
