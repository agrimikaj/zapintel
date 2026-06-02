import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
