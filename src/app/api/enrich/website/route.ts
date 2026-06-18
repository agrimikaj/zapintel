/**
 * Enrichment — company website finder.
 *
 * POST { company } → { data: { website, source } }
 *
 * Implements the "zapintel finds websites" step that used to be a terminal
 * script run before upload. Sonar-backed; returns an empty website when no
 * cited domain is found (blank beats wrong).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { findCompanyWebsite } from "@/agents/enrich";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({ company: z.string().min(1) });

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
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "company is required." } },
      { status: 422 },
    );
  }
  try {
    const r = await findCompanyWebsite(parsed.data.company);
    return NextResponse.json({
      data: { website: r?.website ?? "", source: r?.source ?? null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "ENRICH_FAILED", message } },
      { status: 500 },
    );
  }
}
