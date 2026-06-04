/**
 * Simple password auth — server-signed session cookie.
 *
 * This is the fast path Sarah uses to gate zapintel.vercel.app while the
 * Supabase auth stack isn't fully configured (no project URL/keys live
 * in Vercel for this project as of 2026-06-03). When `APP_PASSWORD` is
 * set on the server, the middleware enforces this auth on every request
 * and the Supabase flow is bypassed. When `APP_PASSWORD` is unset, the
 * middleware falls back to the Supabase magic-link flow.
 *
 * Mechanics:
 *  - One env var = one password the team shares (`APP_PASSWORD`).
 *  - Submitting that password to /api/auth/login mints a session cookie
 *    that's HMAC-signed with `APP_SESSION_SECRET`. The cookie carries an
 *    expiry timestamp and nothing else.
 *  - On every request, middleware verifies the cookie's signature + that
 *    it hasn't expired. Tampering invalidates the cookie.
 *  - No DB. No users. No per-user passwords. Good enough for a
 *    team-of-three internal tool; replace with Supabase when needed.
 *
 * Crypto: Web Crypto API (HMAC-SHA-256). Web Crypto is available on
 * BOTH the Node runtime (API routes) and the Edge runtime (middleware),
 * unlike `node:crypto` which only loads on Node. An earlier version of
 * this file used `node:crypto.createHmac`, which made middleware
 * silently reject every cookie — every login looked successful, every
 * subsequent request fell back to the redirect. Web Crypto is async so
 * verifySessionToken / mintSessionToken / verifyPassword return
 * Promises; callers await them.
 */

export const SESSION_COOKIE = "zapintel_session";
const DEFAULT_TTL_DAYS = 30;

export function isSimpleAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function getSecret(): string {
  const s = (process.env.APP_SESSION_SECRET || "").replace(/\s+$/, "");
  if (!s || s.length < 32) {
    throw new Error(
      "APP_SESSION_SECRET is missing or too short (need >= 32 chars).",
    );
  }
  return s;
}

interface TokenPayload {
  iat: number;
  exp: number;
  nonce: string;
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(sig);
}

/** Constant-time string compare. */
function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Validate a candidate password against APP_PASSWORD in constant time.
 *
 * Trailing whitespace on APP_PASSWORD is trimmed (Vercel's CLI added a
 * stray newline on one previous setting attempt). Candidates are NOT
 * trimmed — users don't accidentally type whitespace into a password.
 */
export function verifyPassword(candidate: string): boolean {
  const expected = (process.env.APP_PASSWORD || "").replace(/\s+$/, "");
  if (!expected) return false;
  return timingSafeEqualStrings(candidate, expected);
}

/** Mint a session token. Returns the token string for the cookie value. */
export async function mintSessionToken(
  ttlDays: number = DEFAULT_TTL_DAYS,
): Promise<{ token: string; expiresAt: Date }> {
  const now = Date.now();
  const expiresAt = new Date(now + ttlDays * 24 * 60 * 60 * 1000);
  const nonceBytes = new Uint8Array(8);
  crypto.getRandomValues(nonceBytes);
  const payload: TokenPayload = {
    iat: now,
    exp: expiresAt.getTime(),
    nonce: b64url(nonceBytes),
  };
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await sign(payloadB64, getSecret());
  return { token: `${payloadB64}.${sig}`, expiresAt };
}

/**
 * Verify a session token cookie. Returns true iff signature matches and
 * the token hasn't expired.
 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, providedSig] = parts;

  let expectedSig: string;
  try {
    expectedSig = await sign(payloadB64, getSecret());
  } catch {
    return false;
  }

  if (!timingSafeEqualStrings(providedSig, expectedSig)) return false;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(payloadB64)),
    ) as TokenPayload;
  } catch {
    return false;
  }
  if (typeof payload.exp !== "number") return false;
  if (Date.now() >= payload.exp) return false;
  return true;
}

/** Cookie options used everywhere — keep in one place. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
