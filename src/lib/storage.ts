/**
 * Server-backed report storage.
 *
 * Previously this module used browser localStorage. Now it talks to
 * /api/reports, which is backed by Supabase Postgres with RLS so each
 * authenticated user only sees their own rows.
 *
 * The DB row shape uses snake_case columns (company_name, website_url,
 * ...); we translate to the camelCase shape the rest of the UI uses on
 * the way in and out, so nothing else in the codebase has to change.
 */

export interface SavedReportDimension {
  id: string;
  label: string;
  iconName: string;
  status: "pending" | "running" | "completed" | "failed";
  findings?: string;
  durationMs?: number;
  error?: string;
}

export interface SavedReport {
  id: string;
  savedAt: string; // ISO timestamp (created_at from DB)
  prospect: {
    companyName: string;
    websiteUrl: string;
    industry?: string;
    knownContext?: string;
    zapsightOffering?: string;
  };
  /** Legacy field kept for compatibility with existing saved rows. New reports save "". */
  summary: string;
  dimensions: SavedReportDimension[];
}

interface DbReport {
  id: string;
  created_at: string;
  company_name: string;
  website_url: string;
  industry: string | null;
  known_context: string | null;
  zapsight_offer: string | null;
  summary: string | null;
  dimensions: SavedReportDimension[];
}

function fromDb(row: DbReport): SavedReport {
  return {
    id: row.id,
    savedAt: row.created_at,
    prospect: {
      companyName: row.company_name,
      websiteUrl: row.website_url,
      industry: row.industry ?? undefined,
      knownContext: row.known_context ?? undefined,
      zapsightOffering: row.zapsight_offer ?? undefined,
    },
    summary: row.summary ?? "",
    dimensions: Array.isArray(row.dimensions) ? row.dimensions : [],
  };
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || detail;
    } catch {
      /* not json */
    }
    throw new Error(detail);
  }
  return JSON.parse(text) as T;
}

export async function listSavedReports(): Promise<SavedReport[]> {
  const res = await fetch("/api/reports", { credentials: "include" });
  const { data } = await readJson<{ data: DbReport[] }>(res);
  return data.map(fromDb);
}

export async function saveReport(
  report: Omit<SavedReport, "id" | "savedAt">,
): Promise<SavedReport> {
  const res = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(report),
  });
  const { data } = await readJson<{ data: DbReport }>(res);
  return fromDb(data);
}

export async function deleteSavedReport(id: string): Promise<void> {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  await readJson<{ ok: true }>(res);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function exportReportAsMarkdown(report: SavedReport): string {
  const lines: string[] = [];
  lines.push(`# ZapIntel Brief — ${report.prospect.companyName}`);
  lines.push("");
  lines.push(`**Prospect:** ${report.prospect.companyName}`);
  lines.push(`**Website:** ${report.prospect.websiteUrl}`);
  if (report.prospect.industry) lines.push(`**Industry:** ${report.prospect.industry}`);
  lines.push(`**Generated:** ${report.savedAt}`);
  lines.push(`**By:** Zapsight ZapIntel Agent`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const d of report.dimensions) {
    lines.push(`## ${d.label}`);
    if (d.status !== "completed") lines.push(`_status: ${d.status}_`);
    lines.push("");
    lines.push(d.findings || "_no content_");
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}
