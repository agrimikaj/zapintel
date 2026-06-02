/**
 * Bulk-run persistence (localStorage).
 *
 * Why this exists:
 *   The original bulk-outreach component stored everything in React state
 *   only. A browser tab refresh, an accidental close, or a Vercel function
 *   timeout that the user reacted to by reloading — any of these would
 *   wipe in-flight + completed work. On 2026-06-02 Sarah lost a 247-lead
 *   run that way mid-stride. This module exists so that "never happens
 *   again."
 *
 * What it stores:
 *   - One "current" run: the run the user is actively in or just finished.
 *     Auto-saved by BulkOutreach on every row completion (throttled).
 *     Restored automatically on component mount.
 *   - A bounded list of "archived" runs: older completed bulks kept for
 *     restore-anywhere convenience. Capped at MAX_ARCHIVED to stay
 *     comfortably under the browser's per-origin quota (~5MB in most
 *     modern browsers).
 *
 * What it does NOT store:
 *   - Rows in the "running" status — they're transient. We persist as
 *     "pending" so the resume path can re-queue them cleanly.
 *
 * Quota-safety:
 *   - Every save call is wrapped in try/catch; on QuotaExceededError we
 *     evict the oldest archived runs and retry. If even the current run
 *     alone can't fit, we surface an error to the caller (which warns
 *     the user and offers a JSON download).
 */

import type { Lead } from "@/lib/leads";

const CURRENT_KEY = "zapintel.bulk.current";
const ARCHIVE_PREFIX = "zapintel.bulk.archive.";
const MAX_ARCHIVED = 10;
const SCHEMA_VERSION = 1;

export type PersistedStatus = "pending" | "completed" | "failed";

export interface PersistedSignal {
  type: string;
  label: string;
  summary: string;
  date?: string;
  url?: string;
  sourceName?: string;
}

export interface PersistedRow {
  leadId: string;
  lead: Lead;
  status: PersistedStatus;
  intelMarkdown?: string;
  outreachMarkdown?: string;
  critiqueMarkdown?: string;
  verdict?: "Accepted" | "Rejected" | "Unknown";
  confidence?: "High" | "Medium" | "Low" | "Unknown";
  rejectionClass?: string;
  mainReason?: string;
  docType?:
    | "pitch_full"
    | "enrichment"
    | "park_warming"
    | "peer_referral"
    | "up_org_referral"
    | "skip";
  vertical?: string;
  signals?: PersistedSignal[];
  error?: string;
  durationMs?: number;
}

export interface PersistedBulkRun {
  /** Stable id; current run uses "current", archived runs use a timestamp slug. */
  id: string;
  schemaVersion: number;
  savedAt: string;
  /** Display label for the Sessions drawer — usually the CSV filename. */
  filename: string | null;
  deepMode: boolean;
  rows: PersistedRow[];
}

function isStorageAvailable(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const testKey = "__zapintel_quota_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function safeWrite(key: string, value: string): { ok: boolean; reason?: string } {
  try {
    window.localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    const name = err instanceof Error ? err.name : String(err);
    return { ok: false, reason: name };
  }
}

function listArchiveKeys(): string[] {
  if (!isStorageAvailable()) return [];
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(ARCHIVE_PREFIX)) keys.push(k);
  }
  // Sort by id (which is a timestamp slug) descending — newest first.
  return keys.sort().reverse();
}

function evictOldestArchive(): boolean {
  const keys = listArchiveKeys();
  if (keys.length === 0) return false;
  const oldest = keys[keys.length - 1];
  try {
    window.localStorage.removeItem(oldest);
    return true;
  } catch {
    return false;
  }
}

function freshRun(filename: string | null, deepMode: boolean): PersistedBulkRun {
  return {
    id: "current",
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    filename,
    deepMode,
    rows: [],
  };
}

/** Read the current (active) run, or null if none. */
export function loadCurrentBulkRun(): PersistedBulkRun | null {
  if (!isStorageAvailable()) return null;
  const raw = window.localStorage.getItem(CURRENT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedBulkRun;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save the current run state. Returns ok=true on success, ok=false +
 * reason if the browser refused (e.g. QuotaExceededError after we've
 * already evicted everything we can).
 */
export function saveCurrentBulkRun(run: PersistedBulkRun): {
  ok: boolean;
  reason?: string;
} {
  if (!isStorageAvailable()) return { ok: false, reason: "no_storage" };
  const payload = JSON.stringify({ ...run, id: "current", savedAt: new Date().toISOString() });
  let result = safeWrite(CURRENT_KEY, payload);
  if (result.ok) return result;

  // Try evicting archived runs one at a time, then retrying.
  for (let i = 0; i < MAX_ARCHIVED; i++) {
    const evicted = evictOldestArchive();
    if (!evicted) break;
    result = safeWrite(CURRENT_KEY, payload);
    if (result.ok) return result;
  }
  return result;
}

/** Wipe the current run only (does not touch the archive). */
export function clearCurrentBulkRun(): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Move the current run into the archive (under a timestamp-keyed id) and
 * clear the current slot. Used when the user uploads a new CSV — we don't
 * want to drop their old work, but the new run needs to start fresh.
 */
export function archiveCurrentBulkRun(): { ok: boolean; archivedId?: string } {
  const cur = loadCurrentBulkRun();
  if (!cur) return { ok: false };
  if (cur.rows.length === 0) {
    // Nothing worth archiving.
    clearCurrentBulkRun();
    return { ok: false };
  }
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const archived: PersistedBulkRun = { ...cur, id, savedAt: new Date().toISOString() };
  const key = `${ARCHIVE_PREFIX}${id}`;
  const payload = JSON.stringify(archived);
  let result = safeWrite(key, payload);
  if (!result.ok) {
    // Make room and retry.
    for (let i = 0; i < MAX_ARCHIVED; i++) {
      const evicted = evictOldestArchive();
      if (!evicted) break;
      result = safeWrite(key, payload);
      if (result.ok) break;
    }
  }
  if (result.ok) {
    // Enforce the cap.
    const keys = listArchiveKeys();
    for (let i = MAX_ARCHIVED; i < keys.length; i++) {
      try {
        window.localStorage.removeItem(keys[i]);
      } catch {
        /* ignore */
      }
    }
    clearCurrentBulkRun();
    return { ok: true, archivedId: id };
  }
  return { ok: false };
}

export interface BulkRunSummary {
  id: string;
  savedAt: string;
  filename: string | null;
  deepMode: boolean;
  total: number;
  completed: number;
  failed: number;
  accepted: number;
  rejected: number;
}

function summarizeRun(run: PersistedBulkRun): BulkRunSummary {
  let completed = 0;
  let failed = 0;
  let accepted = 0;
  let rejected = 0;
  for (const r of run.rows) {
    if (r.status === "completed") {
      completed++;
      if (r.verdict === "Accepted") accepted++;
      else if (r.verdict === "Rejected") rejected++;
    } else if (r.status === "failed") {
      failed++;
    }
  }
  return {
    id: run.id,
    savedAt: run.savedAt,
    filename: run.filename,
    deepMode: run.deepMode,
    total: run.rows.length,
    completed,
    failed,
    accepted,
    rejected,
  };
}

/** List archived runs, newest first. Returns lightweight summaries (no row bodies). */
export function listArchivedBulkRuns(): BulkRunSummary[] {
  if (!isStorageAvailable()) return [];
  const out: BulkRunSummary[] = [];
  for (const key of listArchiveKeys()) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as PersistedBulkRun;
      if (parsed?.schemaVersion === SCHEMA_VERSION) out.push(summarizeRun(parsed));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Load a single archived run by id. */
export function loadArchivedBulkRun(id: string): PersistedBulkRun | null {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(`${ARCHIVE_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBulkRun;
    if (parsed?.schemaVersion !== SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deleteArchivedBulkRun(id: string): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.removeItem(`${ARCHIVE_PREFIX}${id}`);
  } catch {
    /* ignore */
  }
}

/**
 * Build a fresh PersistedBulkRun for a brand-new upload. Caller writes it
 * via saveCurrentBulkRun() when ready.
 */
export function newBulkRun(filename: string | null, deepMode: boolean): PersistedBulkRun {
  return freshRun(filename, deepMode);
}

/** True if a row is interesting enough to persist (has any state past pending). */
export function rowIsPersistable(r: PersistedRow): boolean {
  return r.status === "completed" || r.status === "failed";
}
