/**
 * Simple-auth login.
 *
 * POST /api/auth/login   { password }
 *
 * If the password matches APP_PASSWORD, mints an HMAC-signed session
 * cookie that the middleware will accept on every subsequent request.
 *
 * Returns 503 if simple auth isn't configured on this deployment
 * (caller should fall back to the Supabase magic-link flow).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isSimpleAuthConfigured,
  mintSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/simpleAuth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isSimpleAuthConfigured()) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message: "Simple auth is not configured on this deployment.",
        },
      },
      { status: 503 },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Bad JSON." } },
      { status: 400 },
    );
  }

  const password = body.password || "";
  if (!password) {
    return NextResponse.json(
      { error: { code: "MISSING_PASSWORD", message: "Provide a password." } },
      { status: 422 },
    );
  }

  if (!verifyPassword(password)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Incorrect password.",
        },
      },
      { status: 401 },
    );
  }

  const { token, expiresAt } = await mintSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  return res;
}
