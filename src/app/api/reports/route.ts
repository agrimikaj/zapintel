/**
 * Reports collection endpoint.
 *
 *   GET  /api/reports     → list current user's reports (newest first)
 *   POST /api/reports     → save a new report
 *
 * Auth is enforced upstream by middleware.ts (401 if no session). RLS
 * on the `reports` table is the second line of defense: even with a
 * stolen anon key, the user can only see their own rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DimensionSchema = z.object({
  id: z.string(),
  label: z.string(),
  iconName: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  findings: z.string().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
});

const SaveBodySchema = z.object({
  prospect: z.object({
    companyName: z.string().min(1).max(200),
    websiteUrl: z.string().url(),
    industry: z.string().max(200).optional(),
    knownContext: z.string().max(4000).optional(),
    zapsightOffering: z.string().max(500).optional(),
  }),
  summary: z.string().default(""),
  dimensions: z.array(DimensionSchema),
});

export async function GET() {
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

  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Bad JSON." } },
      { status: 400 },
    );
  }

  const parsed = SaveBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid report payload.",
          details: parsed.error.flatten(),
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

  const row = {
    user_id: user.id,
    company_name: parsed.data.prospect.companyName,
    website_url: parsed.data.prospect.websiteUrl,
    industry: parsed.data.prospect.industry ?? null,
    known_context: parsed.data.prospect.knownContext ?? null,
    zapsight_offer: parsed.data.prospect.zapsightOffering ?? null,
    summary: parsed.data.summary,
    dimensions: parsed.data.dimensions,
  };

  const { data, error } = await supabase
    .from("reports")
    .insert(row)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
}
