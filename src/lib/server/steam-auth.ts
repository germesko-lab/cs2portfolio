/**
 * Steam OpenID 2.0 login + persistent DB-backed sessions.
 *
 * Steam OpenID proves identity only. It does not grant access to private
 * inventories, so inventory sync still uses the public inventory endpoint.
 * The browser cookie contains only an opaque random token; users and session
 * expiry live in SQLite so logout can invalidate the current session.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db';

const COMMUNITY_BASE = process.env.STEAM_COMMUNITY_BASE_URL ?? 'https://steamcommunity.com';
const OPENID_ENDPOINT = `${COMMUNITY_BASE}/openid/login`;
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
export const RETURN_PATH = '/api/auth/steam/return';

export type SteamAuthErrorCode =
  | 'BAD_ASSERTION'
  | 'REPLAYED'
  | 'INVALID_SIGNATURE'
  | 'NETWORK';

export class SteamAuthError extends Error {
  readonly code: SteamAuthErrorCode;
  constructor(code: SteamAuthErrorCode, message: string) {
    super(message);
    this.name = 'SteamAuthError';
    this.code = code;
  }
}

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const claimedIdPattern = new RegExp(
  `^${escapeRegExp(COMMUNITY_BASE).replace(/^https?/, 'https?')}/openid/id/(\\d{17})$`,
);

export async function verifyOpenIdReturn(query: URLSearchParams, baseUrl: string): Promise<string> {
  const get = (k: string) => query.get(`openid.${k}`);

  if (get('ns') !== OPENID_NS || get('mode') !== 'id_res') {
    throw new SteamAuthError('BAD_ASSERTION', 'Steam sign-in was cancelled or returned an unexpected response.');
  }
  if ((get('return_to') ?? '') !== `${baseUrl}${RETURN_PATH}`) {
    throw new SteamAuthError('BAD_ASSERTION', 'Sign-in return URL mismatch. Check APP_BASE_URL.');
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

export const SESSION_COOKIE = 'cs2_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface AuthenticatedUser {
  id: number;
  steamId: string;
}

interface UserRow {
  id: number;
  steam_id: string;
}

interface SessionRow {
  id: number;
  steam_id: string;
  expires_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresIso(): string {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function rawSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  return (
    cookieHeader
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1) ?? null
  );
}

function cleanupExpiredSessions(): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

export function upsertUserFromSteam(steamId64: string): AuthenticatedUser {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO users (steam_id, last_login_at, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(steam_id) DO UPDATE SET
       last_login_at = excluded.last_login_at,
       updated_at    = excluded.updated_at`,
  ).run(steamId64, ts, ts);
  const row = db.prepare('SELECT id, steam_id FROM users WHERE steam_id = ?').get(steamId64) as
    | UserRow
    | undefined;
  if (!row) throw new Error('Failed to load user after Steam sign-in.');
  return { id: row.id, steamId: row.steam_id };
}

function createSessionToken(userId: number): string {
  cleanupExpiredSessions();
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO sessions (session_hash, user_id, expires_at)
     VALUES (?, ?, ?)`,
  ).run(hashToken(token), userId, expiresIso());
  return token;
}

export function createSessionCookie(userId: number, secure: boolean): string {
  const value = createSessionToken(userId);
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

export function readSession(cookieHeader: string | null): AuthenticatedUser | null {
  const token = rawSessionToken(cookieHeader);
  if (!token) return null;
  const hash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.steam_id, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_hash = ?`,
    )
    .get(hash) as SessionRow | undefined;
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    db.prepare('DELETE FROM sessions WHERE session_hash = ?').run(hash);
    return null;
  }
  db.prepare(
    `UPDATE sessions
     SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE session_hash = ?`,
  ).run(hash);
  return { id: row.id, steamId: row.steam_id };
}

export function deleteSession(cookieHeader: string | null): void {
  const token = rawSessionToken(cookieHeader);
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE session_hash = ?').run(hashToken(token));
}
