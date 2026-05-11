import { NextRequest } from "next/server";

export const runtime = "nodejs";

interface ExportBody {
  companyName?: string;
  websiteUrl?: string;
  summary?: string;
  dimensions?: { label: string; findings: string; status: string }[];
}

export async function POST(req: NextRequest) {
  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const lines: string[] = [];
  lines.push(`# ZapIntel — Client Intelligence Brief`);
  lines.push("");
  lines.push(`**Prospect:** ${body.companyName ?? "Unknown"}`);
  if (body.websiteUrl) lines.push(`**Website:** ${body.websiteUrl}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**By:** Zapsight ZapIntel Agent`);
  lines.push("");
  lines.push("---");
  lines.push("");
  if (body.summary) {
    lines.push(body.summary);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  for (const d of body.dimensions ?? []) {
    lines.push(`## ${d.label}`);
    if (d.status !== "completed") lines.push(`_status: ${d.status}_`);
    lines.push("");
    lines.push(d.findings || "_no content_");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const markdown = lines.join("\n");
  const slug = (body.companyName ?? "prospect")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="zapintel-${slug || "report"}.md"`,
    },
  });
}
