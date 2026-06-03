/**
 * Set / change password for the currently signed-in user.
 *
 * POST /api/auth/set-password   { password }
 *
 * Pipeline:
 *  1. require an active Supabase session (otherwise 401)
 *  2. validate the new password
 *  3. call supabase.auth.updateUser({ password }) — Supabase Auth handles
 *     the hash + rotation
 *  4. return ok=true; existing session stays valid
 *
 * Intended use:
 *  - First-time setup: Sarah signs in via the existing magic-link flow,
 *    sets a password here, and uses /api/auth/password thereafter.
 *  - Rotation: any signed-in user can change their password.
 *
 * We re-check the whitelist on the request — defense-in-depth in case an
 * email was removed from WHITELIST_EMAILS between the original sign-in
 * and the password set.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, isEmailAllowed } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
  if (!password || password.length < 8) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_PASSWORD",
          message: "Password must be at least 8 characters.",
        },
      },
      { status: 422 },
    );
  }

  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "No session." } },
      { status: 401 },
    );
  }
  if (!user.email || !isEmailAllowed(user.email)) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_ALLOWED",
          message: "Email not on the Zapsight allowlist.",
        },
      },
      { status: 403 },
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json(
      { error: { code: "SUPABASE_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
