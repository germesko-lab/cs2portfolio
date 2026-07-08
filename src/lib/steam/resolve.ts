/**
 * Resolve arbitrary user input to a SteamID64.
 *
 * Accepted forms (parseSteamInput is pure and unit-testable):
 *   - raw SteamID64:            76561198023414915
 *   - profile URL:              steamcommunity.com/profiles/{steamid64}
 *   - vanity URL:               steamcommunity.com/id/{vanity}   (needs API key)
 *   - trade offer URL:          steamcommunity.com/tradeoffer/new/?partner={accountid}&token=…
 *   - bare vanity name:         gaben                            (needs API key)
 *
 * Trade-offer conversion: steamid64 = 76561197960265728n + BigInt(partner).
 */

export type SteamResolveErrorCode =
  | 'INVALID_INPUT' // unrecognized input format
  | 'VANITY_NEEDS_KEY' // vanity name given but no Steam Web API key configured
  | 'VANITY_NOT_FOUND' // API answered: no account with that vanity name
  | 'HTTP_ERROR' // ResolveVanityURL returned non-2xx (bad key = 403)
  | 'NETWORK'; // fetch failed (DNS, TLS, timeout)

export class SteamResolveError extends Error {
  readonly code: SteamResolveErrorCode;
  readonly status: number | null;

  constructor(code: SteamResolveErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'SteamResolveError';
    this.code = code;
    this.status = status;
  }
}

export type ParsedSteamInput =
  | { kind: 'steamid64'; steamId64: string }
  | { kind: 'vanity'; vanity: string };

/** Base of the lowest individual SteamID64; accountid offsets from here. */
const STEAMID64_BASE = 76561197960265728n;
const STEAMID64_RE = /^\d{17}$/;
const VANITY_RE = /^[A-Za-z0-9_-]{2,32}$/;

const INVALID_MSG =
  'Could not recognize that input. Paste a Steam profile URL (steamcommunity.com/profiles/… or /id/…), ' +
  'a 17-digit SteamID64, or a trade offer URL (…/tradeoffer/new/?partner=…).';

function assertValidSteamId64(candidate: string, origin: string): string {
  if (!STEAMID64_RE.test(candidate) || !candidate.startsWith('7656119')) {
    throw new SteamResolveError(
      'INVALID_INPUT',
      `${origin} did not yield a valid 17-digit SteamID64 (got "${candidate}").`,
    );
  }
  return candidate;
}

/** Pure input parser — no network. Throws SteamResolveError('INVALID_INPUT'). */
export function parseSteamInput(raw: string): ParsedSteamInput {
  const input = raw.trim();
  if (input.length === 0) throw new SteamResolveError('INVALID_INPUT', INVALID_MSG);

  // Raw 17-digit SteamID64.
  if (STEAMID64_RE.test(input)) {
    return { kind: 'steamid64', steamId64: assertValidSteamId64(input, 'The SteamID64') };
  }

  // Trade offer URL: extract ?partner={accountid} and convert.
  const trade = input.match(/steamcommunity\.com\/tradeoffer\/new\/?\?([^#\s]*)/i);
  if (trade) {
    const partner = new URLSearchParams(trade[1]).get('partner');
    if (!partner || !/^\d{1,10}$/.test(partner)) {
      throw new SteamResolveError(
        'INVALID_INPUT',
        'That trade offer URL has no numeric "partner" parameter to derive a SteamID64 from.',
      );
    }
    const steamId64 = (STEAMID64_BASE + BigInt(partner)).toString();
    return { kind: 'steamid64', steamId64: assertValidSteamId64(steamId64, 'The trade offer URL') };
  }

  // Profile URL with an explicit SteamID64.
  const profile = input.match(/steamcommunity\.com\/profiles\/(\d{17})(?:[/?#]|$)/i);
  if (profile) {
    return { kind: 'steamid64', steamId64: assertValidSteamId64(profile[1]!, 'The profile URL') };
  }

  // Vanity (custom) profile URL.
  const vanityUrl = input.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})(?:[/?#]|$)/i);
  if (vanityUrl) return { kind: 'vanity', vanity: vanityUrl[1]! };

  // Bare vanity name (UX nicety — same key requirement as /id/ URLs). Must
  // contain a non-digit: an all-digit token is far more likely a mistyped
  // SteamID64 (digit-only custom names still work via the full /id/ URL).
  // Anything steamcommunity-shaped that fell through the URL forms above is
  // NOT retried as a vanity name.
  if (VANITY_RE.test(input) && !input.includes('.') && !/^\d+$/.test(input)) {
    return { kind: 'vanity', vanity: input };
  }

  throw new SteamResolveError('INVALID_INPUT', INVALID_MSG);
}

/**
 * // REAL_KEY_REQUIRED — vanity resolution calls the official Steam Web API
 * // ISteamUser/ResolveVanityURL/v1 and requires STEAM_API_KEY (get one at
 * // steamcommunity.com/dev/apikey; governed by the Steam Web API Terms of
 * // Use — see LEGAL.md). Numeric / profile-URL / trade-URL inputs never
 * // need the key. STEAM_WEB_API_KEY is honored as a legacy alias.
 */
function apiKey(): string | null {
  return process.env.STEAM_API_KEY || process.env.STEAM_WEB_API_KEY || null;
}

/** Overridable for tests/proxies; defaults to the real Steam Web API host. */
const API_BASE = process.env.STEAM_API_BASE_URL ?? 'https://api.steampowered.com';

interface VanityResponse {
  response?: { success?: number; steamid?: string; message?: string };
}

async function resolveVanity(vanity: string): Promise<string> {
  const key = apiKey();
  if (!key) {
    throw new SteamResolveError(
      'VANITY_NEEDS_KEY',
      'Resolving a custom /id/ profile name requires a Steam Web API key (set STEAM_API_KEY). ' +
        'Profile URLs with /profiles/, raw SteamID64s and trade offer links work without one.',
    );
  }

  const url = `${API_BASE}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(vanity)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  } catch (cause) {
    throw new SteamResolveError(
      'NETWORK',
      `Could not reach the Steam Web API to resolve "${vanity}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!res.ok) {
    throw new SteamResolveError(
      'HTTP_ERROR',
      `Steam Web API rejected the vanity lookup with HTTP ${res.status}${res.status === 403 ? ' (is STEAM_API_KEY valid?)' : ''}.`,
      res.status,
    );
  }
  const body = (await res.json().catch(() => null)) as VanityResponse | null;
  const r = body?.response;
  if (r?.success === 1 && r.steamid) {
    return assertValidSteamId64(r.steamid, 'Steam vanity resolution');
  }
  throw new SteamResolveError(
    'VANITY_NOT_FOUND',
    `Steam has no account with the custom name "${vanity}". Check the /id/ part of the profile URL.`,
  );
}

/** Full resolution: parse, then hit the Web API only when a vanity is involved. */
export async function resolveSteamInput(raw: string): Promise<string> {
  const parsed = parseSteamInput(raw);
  return parsed.kind === 'steamid64' ? parsed.steamId64 : resolveVanity(parsed.vanity);
}
