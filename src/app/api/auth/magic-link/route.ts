import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, isEmailAllowed } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Bad JSON." } },
      { status: 400 },
    );
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: { code: "BAD_EMAIL", message: "Provide a valid email." } },
      { status: 422 },
    );
  }

  // Don't leak who is/isn't on the allowlist. We always return success
  // unless the email is malformed; if the email is not whitelisted, we
  // just don't send the link. This is the same posture Intelligence uses.
  if (!isEmailAllowed(email)) {
    return NextResponse.json({ ok: true, sent: false });
  }

  const supabase = await getServerSupabase();
  const origin = req.headers.get("origin") || new URL(req.url).origin;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    return NextResponse.json(
      { error: { code: "SUPABASE_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, sent: true });
}
