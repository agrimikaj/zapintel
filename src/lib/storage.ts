/**
 * Browser-local storage for saved ZapIntel reports.
 *
 * No server backend — reports live in localStorage under a single
 * versioned key, keyed by a generated report id. Sufficient for the
 * single-user / single-machine workflow Sarah described
 * ("skip login and other addons").
 *
 * If the same machine generates ~hundreds of reports we'd hit the
 * ~5MB localStorage cap; that's a future problem worth a real DB.
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
  savedAt: string; // ISO timestamp
  prospect: {
    companyName: string;
    websiteUrl: string;
    industry?: string;
    knownContext?: string;
    zapsightOffering?: string;
  };
  summary: string;
  dimensions: SavedReportDimension[];
}

const KEY = "zapintel.reports.v1";

function readAll(): SavedReport[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(reports: SavedReport[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(reports));
}

export function listSavedReports(): SavedReport[] {
  return readAll().sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export function getSavedReport(id: string): SavedReport | undefined {
  return readAll().find((r) => r.id === id);
}

export function saveReport(report: Omit<SavedReport, "id" | "savedAt">): SavedReport {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const full: SavedReport = {
    ...report,
    id,
    savedAt: new Date().toISOString(),
  };
  const all = readAll();
  all.push(full);
  writeAll(all);
  return full;
}

export function deleteSavedReport(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
}

export function clearAllSavedReports(): void {
  writeAll([]);
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
  if (report.summary) {
    lines.push(report.summary);
    lines.push("");
    lines.push("---");
    lines.push("");
  }
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
