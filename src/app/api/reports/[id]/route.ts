/**
 * Single-report endpoint.
 *
 *   GET    /api/reports/:id  → fetch one of the user's reports
 *   DELETE /api/reports/:id  → delete one of the user's reports
 *
 * RLS guarantees a user can't read or delete someone else's row even
 * if they craft the id by hand.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Report not found." } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("reports").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
