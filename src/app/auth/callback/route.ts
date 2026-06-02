/**
 * Magic-link callback.
 *
 * Supabase sends the user here after they click the link in their email.
 * We exchange the `code` query param for a session, then redirect to the
 * original destination (or `/` if none). If the email is no longer
 * whitelisted between request and click, we kick them back to /login.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, isEmailAllowed } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login?reason=bad_link", req.url));
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?reason=exchange_failed", req.url));
  }

  // Belt-and-braces: re-check allowlist before letting them through.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isEmailAllowed(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?reason=not_allowed", req.url));
  }

  return NextResponse.redirect(new URL(next, req.url));
}
