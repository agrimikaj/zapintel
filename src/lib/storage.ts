/**
 * Saved-report storage (localStorage).
 *
 * History / why this is localStorage again:
 *   v1 (993f42b) stored reports in browser localStorage and worked fine.
 *   v2 (aeaa8bd) migrated this module to a Supabase-backed /api/reports
 *   endpoint guarded by per-user RLS. But Supabase was never provisioned
 *   for this deployment — zapintel.vercel.app is gated by the simple
 *   shared-password flow (APP_PASSWORD), which has no Supabase session and
 *   no Supabase env vars (see src/lib/simpleAuth.ts). So every save hit
 *   getServerSupabase() → requireEnv() throw → HTTP 500, or (with env set)
 *   supabase.auth.getUser() → null → HTTP 401. Reports never saved.
 *
 *   Under shared-password auth there is no per-user identity to scope rows
 *   to anyway, so server-side per-user storage buys nothing here. We return
 *   to localStorage — same model the bulk-run persistence already uses
 *   (see src/lib/bulkPersistence.ts) — which works with zero backend
 *   config. Trade-off: reports live in the browser that created them and
 *   don't sync across devices. Acceptable for a team-of-three internal
 *   tool; revisit if/when Supabase is actually wired up.
 *
 * The public API (listSavedReports / saveReport / deleteSavedReport) stays
 * async so callers (page.tsx, SavedReportsDrawer.tsx) need no changes.
 */

const STORAGE_KEY = "zapintel.reports.v1";
const SCHEMA_VERSION = 1;
/** Cap stored reports to stay comfortably under the ~5MB per-origin quota. */
const MAX_REPORTS = 50;

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
  /** Legacy field kept for compatibility with existing saved rows. New reports save "". */
  summary: string;
  dimensions: SavedReportDimension[];
}

interface StorageEnvelope {
  schemaVersion: number;
  reports: SavedReport[];
}

function isStorageAvailable(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const testKey = "__zapintel_reports_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/** Reasonably unique id without depending on crypto.randomUUID everywhere. */
function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `r-${new Date().toISOString().replace(/[:.]/g, "-")}-${rand}`;
}

function readAll(): SavedReport[] {
  if (!isStorageAvailable()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StorageEnvelope;
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return [];
    if (!Array.isArray(parsed.reports)) return [];
    // Defensive: keep only well-formed rows.
    return parsed.reports.filter(
      (r): r is SavedReport =>
        !!r &&
        typeof r.id === "string" &&
        typeof r.savedAt === "string" &&
        !!r.prospect &&
        typeof r.prospect.companyName === "string" &&
        Array.isArray(r.dimensions),
    );
  } catch {
    return [];
  }
}

/** Write the full set, evicting oldest rows if the browser refuses on quota. */
function writeAll(reports: SavedReport[]): { ok: boolean; reason?: string } {
  if (!isStorageAvailable()) return { ok: false, reason: "no_storage" };
  let working = reports.slice(0, MAX_REPORTS);
  for (let attempt = 0; attempt < MAX_REPORTS; attempt++) {
    try {
      const envelope: StorageEnvelope = {
        schemaVersion: SCHEMA_VERSION,
        reports: working,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      return { ok: true };
    } catch (err) {
      const name = err instanceof Error ? err.name : String(err);
      if (name !== "QuotaExceededError" || working.length <= 1) {
        return { ok: false, reason: name };
      }
      // Drop the oldest report and retry. (reports arrive newest-first.)
      working = working.slice(0, working.length - 1);
    }
  }
  return { ok: false, reason: "QuotaExceededError" };
}

/** List saved reports, newest first. */
export async function listSavedReports(): Promise<SavedReport[]> {
  const reports = readAll();
  return reports.sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
  );
}

export async function saveReport(
  report: Omit<SavedReport, "id" | "savedAt">,
): Promise<SavedReport> {
  if (!isStorageAvailable()) {
    throw new Error(
      "This browser blocks local storage, so reports can't be saved. Use the Download menu to export instead.",
    );
  }
  const saved: SavedReport = {
    ...report,
    id: newId(),
    savedAt: new Date().toISOString(),
  };
  // Prepend so newest is first; existing rows keep their order.
  const next = [saved, ...readAll()];
  const result = writeAll(next);
  if (!result.ok) {
    throw new Error(
      result.reason === "QuotaExceededError"
        ? "Local storage is full — delete some saved reports and try again."
        : `Couldn't save report (${result.reason ?? "unknown error"}).`,
    );
  }
  return saved;
}

export async function deleteSavedReport(id: string): Promise<void> {
  const next = readAll().filter((r) => r.id !== id);
  const result = writeAll(next);
  if (!result.ok) {
    throw new Error(`Couldn't delete report (${result.reason ?? "unknown error"}).`);
  }
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
