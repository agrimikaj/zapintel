/**
 * Bulk outreach — phase 1 (verdict-only) endpoint.
 *
 * One request = one lead through the CHEAP half of the pipeline:
 *   signals (Sonar) → intel → verdict extraction → doc-type routing.
 *
 * No outreach / critique / rewrite passes run here. The client scores every
 * lead with this endpoint first, shows the user the accepted/rejected split,
 * and only then calls /api/bulk/docs for the subset the user chose to write
 * up. The intel brief returned here is passed straight back into that docs
 * call, so phase 2 never refetches signals or re-runs intel.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateLeadVerdict } from "@/agents/outreach";
import { Lead } from "@/lib/leads";

export const runtime = "nodejs";
// Signals (parallel Sonar) + a single intel pass. Comfortably faster than
// the full pipeline, but borderline leads with many signal calls can still
// run ~60-120s, so keep the Pro-tier ceiling.
export const maxDuration = 300;

const LeadSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  fullName: z.string().min(1),
  title: z.string().default(""),
  seniority: z.string().default(""),
  department: z.string().default(""),
  email: z.string().default(""),
  contactPhone: z.string().default(""),
  contactMobile: z.string().default(""),
  linkedinUrl: z.string().default(""),
  contactCity: z.string().default(""),
  contactState: z.string().default(""),
  contactCountry: z.string().default(""),
  companyName: z.string().min(1),
  companyWebsite: z.string().default(""),
  companyIndustry: z.string().default(""),
  companyDescription: z.string().default(""),
  companyRevenueRange: z.string().default(""),
  companyStaffCount: z.string().default(""),
  companyStaffRange: z.string().default(""),
  companyFoundedDate: z.string().default(""),
  companyCity: z.string().default(""),
  companyState: z.string().default(""),
  companyCountry: z.string().default(""),
  companyPhone: z.string().default(""),
  companyLinkedinUrl: z.string().default(""),
});

const BodySchema = z.object({
  lead: LeadSchema,
  deepMode: z.boolean().optional(),
});

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
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid lead payload.",
          details: parsed.error.flatten(),
        },
      },
      { status: 422 },
    );
  }

  try {
    const result = await generateLeadVerdict(parsed.data.lead as Lead, {
      deepMode: parsed.data.deepMode ?? false,
    });
    return NextResponse.json({
      data: {
        leadId: result.leadId,
        intelMarkdown: result.intelMarkdown,
        verdict: result.verdict,
        confidence: result.confidence,
        rejectionClass: result.rejectionClass,
        mainReason: result.mainReason,
        docType: result.docType,
        vertical: result.vertical,
        signals: result.signals,
        timings: result.timings,
        durationMs: result.timings.total,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "VERDICT_FAILED", message } },
      { status: 500 },
    );
  }
}
