import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/simpleAuth";

export const runtime = "nodejs";

/**
 * Logout endpoint.
 *
 * Clears the simple-auth session cookie unconditionally. Also calls
 * supabase.signOut() best-effort when Supabase is configured, so we
 * don't leave a stale Supabase session behind on deployments that
 * use both paths.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Clear the simple-auth cookie regardless of which mode is active.
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });

  // Best-effort Supabase signout. Skipped silently when Supabase isn't
  // configured (the import is dynamic so the module doesn't blow up on
  // deployments that never set the Supabase env vars).
  try {
    const haveSupabase =
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    if (haveSupabase) {
      const { getServerSupabase } = await import("@/lib/supabase/server");
      const supabase = await getServerSupabase();
      await supabase.auth.signOut();
    }
  } catch {
    // ignore — logout still completes via the cookie clear above
  }

  return res;
}
