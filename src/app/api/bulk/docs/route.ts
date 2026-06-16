/**
 * Bulk outreach — phase 2 (doc-generation) endpoint.
 *
 * One request = one already-scored lead through the EXPENSIVE half of the
 * pipeline: outreach (doc-type-routed) → critique → rewrite.
 *
 * The caller passes back the phase-1 intel brief (`intelMarkdown`) and the
 * routed `docType` from /api/bulk/verdict. Those carry the cited signals and
 * the verdict decision, so nothing from phase 1 is recomputed here.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateLeadDocs } from "@/agents/outreach";
import { Lead } from "@/lib/leads";

export const runtime = "nodejs";
// 3 LLM passes (outreach + critique + rewrite). Skip docs are a single short
// pass. Keep the Pro-tier ceiling for borderline long rewrites.
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

const DocTypeSchema = z.enum([
  "pitch_full",
  "pe_portfolio",
  "enrichment",
  "park_warming",
  "peer_referral",
  "up_org_referral",
  "skip",
]);

const BodySchema = z.object({
  lead: LeadSchema,
  intelMarkdown: z.string().min(1),
  docType: DocTypeSchema,
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
          message: "Invalid docs payload (need lead + intelMarkdown + docType).",
          details: parsed.error.flatten(),
        },
      },
      { status: 422 },
    );
  }

  try {
    const result = await generateLeadDocs(
      parsed.data.lead as Lead,
      parsed.data.intelMarkdown,
      parsed.data.docType,
    );
    return NextResponse.json({
      data: {
        leadId: result.leadId,
        outreachMarkdown: result.outreachMarkdown,
        critiqueMarkdown: result.critiqueMarkdown,
        timings: result.timings,
        durationMs: result.timings.total,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "DOCS_FAILED", message } },
      { status: 500 },
    );
  }
}
