/**
 * Enrichment — contact LinkedIn URL + verified email.
 *
 * POST { firstName, lastName, fullName, company, title, haveLinkedin, haveEmail }
 *   → { data: { linkedinUrl, linkedinConfidence, linkedinSource, email, emailSource } }
 *
 * Fills the LinkedIn ID + email columns of the dashboard CSV. LinkedIn is
 * Sonar-found + citation-verified; email is Lusha-only (verified provider,
 * gated on LUSHA_API_KEY) — never LLM-guessed. Missing values come back as ""
 * so the cell stays blank rather than wrong.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enrichContact } from "@/agents/enrich";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  fullName: z.string().min(1),
  company: z.string().min(1),
  title: z.string().default(""),
  haveLinkedin: z.boolean().default(false),
  haveEmail: z.boolean().default(false),
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
          message: "fullName and company are required.",
        },
      },
      { status: 422 },
    );
  }
  try {
    const r = await enrichContact(parsed.data);
    return NextResponse.json({
      data: {
        linkedinUrl: r.linkedinUrl,
        linkedinConfidence: r.linkedinConfidence ?? null,
        linkedinSource: r.linkedinSource ?? null,
        email: r.email,
        emailSource: r.emailSource ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: { code: "ENRICH_FAILED", message } },
      { status: 500 },
    );
  }
}
