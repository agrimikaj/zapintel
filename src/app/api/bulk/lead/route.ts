/**
 * Bulk outreach — single-lead endpoint.
 *
 * One request = one lead through the full multi-pass pipeline:
 *   signals (Sonar) → intel → outreach (doc-type-routed) → critique → rewrite.
 *
 * The client orchestrates concurrency, ZIP packaging, and the summary
 * PDF — keeping every Vercel function call under the 300s ceiling even
 * on a 100-row upload.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateLeadOutreach } from "@/agents/outreach";
import { Lead } from "@/lib/leads";

export const runtime = "nodejs";
// 5 LLM passes (intel + outreach + critique + rewrite, + Sonar signal
// calls in parallel) can run 120-240s on borderline leads. Pro tier
// supports up to 300s.
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
    const result = await generateLeadOutreach(parsed.data.lead as Lead, {
      deepMode: parsed.data.deepMode ?? false,
    });
    return NextResponse.json({
      data: {
        leadId: result.leadId,
        intelMarkdown: result.intelMarkdown,
        outreachMarkdown: result.outreachMarkdown,
        critiqueMarkdown: result.critiqueMarkdown,
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
      { error: { code: "GENERATION_FAILED", message } },
      { status: 500 },
    );
  }
}
