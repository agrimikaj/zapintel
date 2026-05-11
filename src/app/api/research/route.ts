import { NextRequest } from "next/server";
import { ProspectInputSchema, researchProspect, SSEEvent } from "@/agents/orchestrator";

export const runtime = "nodejs";
// Vercel hobby caps Serverless Functions at 60s; pro/enterprise extend to 300s.
// Eight parallel LLM calls fit comfortably under 60s.
export const maxDuration = 60;

function sseEncode(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: { code: "BAD_REQUEST", message: "Request body must be valid JSON." } }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const parsed = ProspectInputSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid prospect input.",
          details: parsed.error.flatten(),
        },
      }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  const input = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of researchProspect(input)) {
          controller.enqueue(encoder.encode(sseEncode(event)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(sseEncode({ type: "error", message })),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  return new Response(
    JSON.stringify({
      service: "zapintel-research",
      method: "POST",
      contentType: "application/json",
      schema: {
        companyName: "string (required)",
        websiteUrl: "string (required, must be http(s) URL)",
        industry: "string (optional)",
        knownContext: "string (optional, anything the AE already knows)",
        zapsightOffering: "string (optional, bias the engagement strategy)",
      },
      response: "Server-Sent Events stream (text/event-stream)",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
