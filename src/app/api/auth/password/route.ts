/**
 * Password sign-in.
 *
 * POST /api/auth/password   { email, password }
 *
 * Pipeline:
 *  1. validate body
 *  2. enforce WHITELIST_EMAILS — same allowlist as the magic-link endpoint,
 *     so even with the right password a non-whitelisted email gets a 401
 *  3. call supabase.auth.signInWithPassword — on success the cookie-bound
 *     server client writes the session cookie via the cookie setter wired
 *     up in getServerSupabase()
 *  4. return ok=true; middleware will recognize the session on subsequent
 *     requests
 *
 * We deliberately do NOT mirror the magic-link endpoint's "always return
 * ok" posture for non-whitelisted emails. Password sign-in needs a hard
 * fail so the UI shows "wrong password / email not allowed" instead of
 * silently dropping the request.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, isEmailAllowed } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Bad JSON." } },
      { status: 400 },
    );
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: { code: "BAD_EMAIL", message: "Provide a valid email." } },
      { status: 422 },
    );
  }
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

  if (!isEmailAllowed(email)) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_ALLOWED",
          message: "This email is not on the Zapsight allowlist.",
        },
      },
      { status: 401 },
    );
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    // Don't leak whether the email exists vs. the password is wrong.
    return NextResponse.json(
      {
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Email or password is incorrect.",
        },
      },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true, email: data.user?.email });
}
