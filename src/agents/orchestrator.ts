/**
 * Research orchestrator.
 *
 * Mirrors backend/agents/orchestrator.py from the Intelligence project, but
 * adapted to Next.js streaming + a single LLM call per dimension via
 * OpenRouter (no local web-scraper service — the prospect URL is given to
 * the model as the anchor, and the model uses its training/world knowledge
 * + URL inference to produce findings).
 *
 * Pipeline:
 *   1. validate input
 *   2. dispatch all 8 dimension agents in parallel (one OpenRouter call each)
 *   3. as each one completes, emit a `dimension_complete` SSE event
 *   4. once all dimensions are in, run the synthesis pass to produce the
 *      Executive Summary, and emit a `summary_complete` event
 *   5. emit a final `report_complete` event with the full assembled report
 */

import { z } from "zod";
import {
  DIMENSIONS,
  Dimension,
  ProspectInput,
  SUMMARY_SYSTEM_PROMPT,
} from "./dimensions";
import { completeChat } from "./openrouter";

export const ProspectInputSchema = z.object({
  companyName: z.string().min(1).max(200),
  websiteUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Must start with http:// or https://"),
  industry: z.string().max(200).optional(),
  knownContext: z.string().max(4000).optional(),
  zapsightOffering: z.string().max(500).optional(),
});

export type DimensionResult = {
  dimension: Dimension["id"];
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  findings: string;
  durationMs?: number;
  error?: string;
};

export type SSEEvent =
  | { type: "research_started"; total: number; prospect: ProspectInput }
  | { type: "dimension_started"; dimension: Dimension["id"]; label: string }
  | { type: "dimension_complete"; dimension: Dimension["id"]; result: DimensionResult }
  | { type: "summary_started" }
  | { type: "summary_complete"; summary: string }
  | { type: "report_complete"; report: { summary: string; dimensions: DimensionResult[] } }
  | { type: "error"; message: string };

async function runDimension(
  dim: Dimension,
  input: ProspectInput,
): Promise<DimensionResult> {
  const t0 = Date.now();
  try {
    const findings = await completeChat(
      [
        { role: "system", content: dim.systemPrompt },
        { role: "user", content: dim.question(input) },
      ],
      { maxTokens: 2200, temperature: 0.4 },
    );

    if (!findings.trim()) {
      return {
        dimension: dim.id,
        label: dim.label,
        status: "failed",
        findings: "",
        error: "Empty response from model.",
        durationMs: Date.now() - t0,
      };
    }

    return {
      dimension: dim.id,
      label: dim.label,
      status: "completed",
      findings,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      dimension: dim.id,
      label: dim.label,
      status: "failed",
      findings: "",
      error: message,
      durationMs: Date.now() - t0,
    };
  }
}

async function runSummary(
  input: ProspectInput,
  dimResults: DimensionResult[],
): Promise<string> {
  const dimensionsBlock = dimResults
    .map(
      (r) => `### ${r.label} (status=${r.status})\n${r.findings || `_error: ${r.error}_`}`,
    )
    .join("\n\n---\n\n");

  const userPrompt = `Prospect: **${input.companyName}** (${input.websiteUrl})${
    input.industry ? ` — ${input.industry}` : ""
  }
${input.knownContext ? `\nContext the AE provided:\n${input.knownContext}\n` : ""}
${input.zapsightOffering ? `\nZapsight offering bias: ${input.zapsightOffering}\n` : ""}

Below are the 8 dimension briefs. Synthesize them into the Executive Summary as specified.

${dimensionsBlock}`;

  return completeChat(
    [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { maxTokens: 1800, temperature: 0.35 },
  );
}

/**
 * Run the full pipeline as an async generator of SSE-shaped events.
 * The caller (the API route) serializes each event to text/event-stream.
 */
export async function* researchProspect(
  input: ProspectInput,
): AsyncGenerator<SSEEvent, void, unknown> {
  yield { type: "research_started", total: DIMENSIONS.length, prospect: input };

  // Kick off all dimensions in parallel, but stream completions as they finish.
  const pending = new Map<Dimension["id"], Promise<DimensionResult>>();
  for (const dim of DIMENSIONS) {
    yield { type: "dimension_started", dimension: dim.id, label: dim.label };
    pending.set(dim.id, runDimension(dim, input));
  }

  const completed: DimensionResult[] = [];
  while (pending.size > 0) {
    const winner = await Promise.race(
      Array.from(pending.entries()).map(async ([id, p]) => ({
        id,
        result: await p,
      })),
    );
    pending.delete(winner.id);
    completed.push(winner.result);
    yield { type: "dimension_complete", dimension: winner.id, result: winner.result };
  }

  // Restore canonical order for the synthesis pass (Promise.race order is
  // wall-clock; the summary should always read them in dimension order).
  const ordered = DIMENSIONS.map((d) => completed.find((r) => r.dimension === d.id)!);

  yield { type: "summary_started" };
  let summary = "";
  try {
    summary = await runSummary(input, ordered);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: "error", message: `Summary failed: ${message}` };
    summary = `_Executive Summary failed to generate: ${message}_`;
  }
  yield { type: "summary_complete", summary };

  yield {
    type: "report_complete",
    report: { summary, dimensions: ordered },
  };
}
