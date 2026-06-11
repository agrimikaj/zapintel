"use client";

/**
 * Bulk-outreach generator (multi-pass, doc-type-routed, web-search-grounded).
 *
 * The component runs a two-phase flow so the operator decides how much
 * (expensive) doc generation to spend before spending it:
 *
 *  1. parses a CSV/XLSX client-side via src/lib/leads.ts
 *  2. PHASE 1 — POSTs each row to /api/bulk/verdict (signal fetch + intel +
 *     verdict). Cheap. Every lead lands in the "verdicted" state with a
 *     verdict + routed doc type, but no outreach doc yet.
 *  3. shows the accepted/rejected split and a decision panel: write docs for
 *     ALL scored leads, or ACCEPTED ONLY.
 *  4. PHASE 2 — POSTs the chosen subset to /api/bulk/docs (outreach +
 *     critique + rewrite), passing back the cached phase-1 intel brief so
 *     nothing is recomputed. Those rows become "completed".
 *  5. on download, bundles written docs by doc type + verdict-only briefs +
 *     a single-page founder-ready summary PDF into one ZIP.
 *
 * Both server endpoints are single-lead-per-request — see route comments.
 * (/api/bulk/lead still runs the full pipeline in one shot for any caller
 * that wants it.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-react";
import JSZip from "jszip";
import { Lead, leadHeadline, parseLeadFile } from "@/lib/leads";
import {
  buildSummaryPdf,
  SummaryDocType,
  SummaryRow,
} from "@/lib/summaryPdf";
import {
  archiveCurrentBulkRun,
  BulkRunSummary,
  clearCurrentBulkRun,
  deleteArchivedBulkRun,
  listArchivedBulkRuns,
  loadArchivedBulkRun,
  loadCurrentBulkRun,
  newBulkRun,
  PersistedBulkRun,
  PersistedRow,
  saveCurrentBulkRun,
} from "@/lib/bulkPersistence";

// Two-phase lifecycle:
//   pending → running (phase 1: scoring) → verdicted → running (phase 2:
//   writing docs) → completed.  "verdicted" is a stable resting state — a
//   lead scored but not (yet, or ever) written up. "failed" can occur in
//   either phase.
type RowStatus = "pending" | "running" | "verdicted" | "completed" | "failed";
type Verdict = "Accepted" | "Rejected" | "Unknown";
type Confidence = "High" | "Medium" | "Low" | "Unknown";
type DocType =
  | "pitch_full"
  | "enrichment"
  | "park_warming"
  | "peer_referral"
  | "up_org_referral"
  | "skip";

interface ServerSignal {
  type: string;
  label: string;
  summary: string;
  date?: string;
  url?: string;
  sourceName?: string;
}

interface RowState {
  lead: Lead;
  status: RowStatus;
  intelMarkdown?: string;
  outreachMarkdown?: string;
  critiqueMarkdown?: string;
  verdict?: Verdict;
  confidence?: Confidence;
  rejectionClass?: string;
  mainReason?: string;
  docType?: DocType;
  vertical?: string;
  signals?: ServerSignal[];
  error?: string;
  durationMs?: number;
}

const CONCURRENCY = 3;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Phase 1 payload — cheap scoring pass (signals + intel + verdict).
interface VerdictResponse {
  intelMarkdown: string;
  verdict: Verdict;
  confidence: Confidence;
  rejectionClass: string;
  mainReason: string;
  docType: DocType;
  vertical: string;
  signals: ServerSignal[];
  durationMs: number;
}

// Phase 2 payload — expensive doc pass (outreach + critique + rewrite).
interface DocsResponse {
  outreachMarkdown: string;
  critiqueMarkdown: string;
  durationMs: number;
}

async function postJson<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  const j = JSON.parse(text) as { data: T };
  return j.data;
}

function fetchVerdict(
  lead: Lead,
  deepMode: boolean,
  signal: AbortSignal,
): Promise<VerdictResponse> {
  return postJson<VerdictResponse>("/api/bulk/verdict", { lead, deepMode }, signal);
}

function fetchDocs(
  lead: Lead,
  intelMarkdown: string,
  docType: DocType,
  signal: AbortSignal,
): Promise<DocsResponse> {
  return postJson<DocsResponse>(
    "/api/bulk/docs",
    { lead, intelMarkdown, docType },
    signal,
  );
}

function shortDocLabel(t?: DocType): string {
  switch (t) {
    case "pitch_full":
      return "Pitch";
    case "enrichment":
      return "Enrich";
    case "park_warming":
      return "Park";
    case "peer_referral":
      return "Peer Ref";
    case "up_org_referral":
      return "Up-Org Ref";
    case "skip":
      return "Skip";
    default:
      return "—";
  }
}

function docFolder(t: DocType): string {
  return t;
}

function topSignalLine(signals?: ServerSignal[]): string {
  if (!signals || signals.length === 0) return "";
  const s = signals[0];
  const date = s.date ? `${s.date} · ` : "";
  return `${date}${s.label.split(" (")[0]}${s.sourceName ? ` (${s.sourceName})` : ""}`;
}

// ----- Persistence helpers -----
function persistRowFromState(r: RowState): PersistedRow {
  // Anything "running" at save time is treated as "pending" — when restored,
  // the user can re-run those rows. A running row whose API call dies is
  // already indistinguishable from a pending row.
  const status: PersistedRow["status"] =
    r.status === "completed" || r.status === "failed" || r.status === "verdicted"
      ? r.status
      : "pending";
  return {
    leadId: r.lead.id,
    lead: r.lead,
    status,
    intelMarkdown: r.intelMarkdown,
    outreachMarkdown: r.outreachMarkdown,
    critiqueMarkdown: r.critiqueMarkdown,
    verdict: r.verdict,
    confidence: r.confidence,
    rejectionClass: r.rejectionClass,
    mainReason: r.mainReason,
    docType: r.docType,
    vertical: r.vertical,
    signals: r.signals,
    error: r.error,
    durationMs: r.durationMs,
  };
}

function rowStateFromPersisted(p: PersistedRow): RowState {
  return {
    lead: p.lead,
    status: p.status,
    intelMarkdown: p.intelMarkdown,
    outreachMarkdown: p.outreachMarkdown,
    critiqueMarkdown: p.critiqueMarkdown,
    verdict: p.verdict,
    confidence: p.confidence,
    rejectionClass: p.rejectionClass,
    mainReason: p.mainReason,
    docType: p.docType,
    vertical: p.vertical,
    signals: p.signals,
    error: p.error,
    durationMs: p.durationMs,
  };
}

export function BulkOutreach() {
  const [filename, setFilename] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  // Persistence state
  const [restorePrompt, setRestorePrompt] = useState<PersistedBulkRun | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<BulkRunSummary[]>([]);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(false);

  // --- 1. On mount: check for a saved run and offer to restore --------
  useEffect(() => {
    const saved = loadCurrentBulkRun();
    if (saved && saved.rows.length > 0) {
      // Only prompt if there are completed/failed rows worth restoring.
      const hasUseful = saved.rows.some(
        (r) =>
          r.status === "completed" ||
          r.status === "verdicted" ||
          r.status === "failed",
      );
      if (hasUseful) setRestorePrompt(saved);
    }
    setSessions(listArchivedBulkRuns());
  }, []);

  // --- 2. Throttled auto-save whenever rows / filename / deepMode change.
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (rows.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const run: PersistedBulkRun = {
        id: "current",
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        filename,
        deepMode,
        rows: rows.map(persistRowFromState),
      };
      const result = saveCurrentBulkRun(run);
      if (!result.ok) {
        setStorageWarning(
          result.reason === "no_storage"
            ? "Browser storage is unavailable — auto-save off. Export current JSON to preserve."
            : `Auto-save failed (${result.reason}). Export current JSON to preserve.`,
        );
      } else {
        setStorageWarning(null);
        setLastSavedAt(new Date().toISOString());
      }
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [rows, filename, deepMode]);

  const counts = useMemo(() => {
    const out = {
      pending: 0,
      running: 0,
      verdicted: 0,
      completed: 0,
      failed: 0,
      // Verdict tallies span BOTH verdicted and completed rows — a verdict
      // exists the moment phase 1 finishes, doc or no doc.
      accepted: 0,
      rejected: 0,
      // Accepted/Rejected leads still awaiting a phase-2 doc.
      acceptedPending: 0,
      rejectedPending: 0,
      pitch_full: 0,
      enrichment: 0,
      park_warming: 0,
      peer_referral: 0,
      up_org_referral: 0,
      skip: 0,
    };
    for (const r of rows) {
      out[r.status]++;
      if (r.status === "verdicted" || r.status === "completed") {
        if (r.verdict === "Accepted") out.accepted++;
        else if (r.verdict === "Rejected") out.rejected++;
      }
      if (r.status === "verdicted") {
        if (r.verdict === "Accepted") out.acceptedPending++;
        else if (r.verdict === "Rejected") out.rejectedPending++;
      }
      if (r.status === "completed" && r.docType) {
        out[r.docType]++;
      }
    }
    return out;
  }, [rows]);

  // Anything worth downloading: written docs OR verdict-only rows.
  const anyResult = counts.completed > 0 || counts.verdicted > 0;
  // Phase 1 has scored everything that could be scored — there are verdicts
  // waiting on a decision, and nothing is pending or mid-flight.
  const verdictsReady =
    rows.length > 0 &&
    counts.pending === 0 &&
    counts.running === 0 &&
    counts.verdicted > 0;
  // Show the big "all vs accepted-only" decision exactly once: after the first
  // full scoring pass, before any docs have been written.
  const showDecision = verdictsReady && counts.completed === 0;
  // After a partial (accepted-only) docs run, some scored rows still have no
  // doc — offer to write them up without re-showing the big panel.
  const remainingToWrite =
    counts.completed > 0 ? counts.verdicted : 0;

  const ingestFile = useCallback(async (file: File) => {
    // Archive any existing current run before starting fresh, so the user
    // doesn't lose prior work on a new upload.
    const cur = loadCurrentBulkRun();
    if (
      cur &&
      cur.rows.some(
        (r) =>
          r.status === "completed" ||
          r.status === "verdicted" ||
          r.status === "failed",
      )
    ) {
      archiveCurrentBulkRun();
      setSessions(listArchivedBulkRuns());
    } else {
      clearCurrentBulkRun();
    }
    setRestorePrompt(null);
    setParseError(null);
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      const leads = parseLeadFile(buf, file.name);
      // Reset the persisted run to a fresh shell before the auto-save tick
      // writes the new rows over.
      const fresh = newBulkRun(file.name, deepMode);
      saveCurrentBulkRun(fresh);
      setRows(leads.map((l) => ({ lead: l, status: "pending" as const })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setParseError(msg);
      setRows([]);
    }
  }, [deepMode]);

  // Restore from a previous run (current or archived).
  const restoreRun = useCallback((run: PersistedBulkRun) => {
    skipNextSaveRef.current = false;
    setFilename(run.filename);
    setDeepMode(run.deepMode);
    setRows(run.rows.map(rowStateFromPersisted));
    setRestorePrompt(null);
    setShowSessions(false);
    setStorageWarning(null);
  }, []);

  const discardRestorePrompt = useCallback(() => {
    setRestorePrompt(null);
    clearCurrentBulkRun();
  }, []);

  const openSession = useCallback((id: string) => {
    const archived = loadArchivedBulkRun(id);
    if (archived) restoreRun(archived);
  }, [restoreRun]);

  const removeSession = useCallback((id: string) => {
    deleteArchivedBulkRun(id);
    setSessions(listArchivedBulkRuns());
  }, []);

  const exportCurrentJson = useCallback(() => {
    const run: PersistedBulkRun = {
      id: "current",
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      filename,
      deepMode,
      rows: rows.map(persistRowFromState),
    };
    const blob = new Blob([JSON.stringify(run, null, 2)], {
      type: "application/json",
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(blob, `zapsight-bulk-state-${stamp}.json`);
  }, [filename, deepMode, rows]);

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) ingestFile(f);
      e.target.value = "";
    },
    [ingestFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const f = e.dataTransfer.files?.[0];
      if (f) ingestFile(f);
    },
    [ingestFile],
  );

  const clearAll = useCallback(() => {
    abortRef.current?.abort();
    skipNextSaveRef.current = true;
    setRows([]);
    setFilename(null);
    setParseError(null);
    setIsRunning(false);
    setLastSavedAt(null);
    clearCurrentBulkRun();
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) =>
      prev.map((r) => (r.lead.id === id ? { ...r, ...patch } : r)),
    );
  }, []);

  // Shared bounded-concurrency runner. `process` handles one lead (its own
  // status transitions + error handling); the pool just feeds it the queue.
  const runQueue = useCallback(
    async (
      queue: Lead[],
      process: (lead: Lead, signal: AbortSignal) => Promise<void>,
    ) => {
      if (queue.length === 0) return;
      setIsRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;

      let idx = 0;
      async function worker() {
        while (idx < queue.length && !controller.signal.aborted) {
          const lead = queue[idx++];
          await process(lead, controller.signal);
        }
      }
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, queue.length) },
        () => worker(),
      );
      await Promise.all(workers);

      setIsRunning(false);
      abortRef.current = null;
    },
    [],
  );

  // --- Phase 1: score every un-scored lead (signals + intel + verdict). ---
  const runVerdicts = useCallback(async () => {
    if (rows.length === 0 || isRunning) return;
    // Retry previously-failed rows on a fresh pass.
    setRows((prev) =>
      prev.map((r) =>
        r.status === "failed"
          ? { ...r, status: "pending", error: undefined }
          : r,
      ),
    );
    const queue = rows
      .filter((r) => r.status === "pending" || r.status === "failed")
      .map((r) => r.lead);

    await runQueue(queue, async (lead, signal) => {
      updateRow(lead.id, { status: "running" });
      const t0 = Date.now();
      try {
        const v = await fetchVerdict(lead, deepMode, signal);
        updateRow(lead.id, {
          status: "verdicted",
          intelMarkdown: v.intelMarkdown,
          verdict: v.verdict,
          confidence: v.confidence,
          rejectionClass: v.rejectionClass,
          mainReason: v.mainReason,
          docType: v.docType,
          vertical: v.vertical,
          signals: v.signals,
          durationMs: v.durationMs,
        });
      } catch (err) {
        if (signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        updateRow(lead.id, {
          status: "failed",
          error: msg,
          durationMs: Date.now() - t0,
        });
      }
    });
  }, [rows, isRunning, runQueue, updateRow, deepMode]);

  // --- Phase 2: write docs for the chosen scope of scored leads. ---
  const runDocs = useCallback(
    async (scope: "all" | "accepted") => {
      if (rows.length === 0 || isRunning) return;
      const queue = rows
        .filter(
          (r) =>
            r.status === "verdicted" &&
            r.intelMarkdown &&
            r.docType &&
            (scope === "all" || r.verdict === "Accepted"),
        )
        .map((r) => r.lead);

      await runQueue(queue, async (lead, signal) => {
        const row = rows.find((r) => r.lead.id === lead.id);
        const intel = row?.intelMarkdown;
        const docType = row?.docType;
        if (!intel || !docType) return; // shouldn't happen given the filter
        // Keep the phase-1 timing visible; track phase-2 time separately.
        const verdictMs = row?.durationMs ?? 0;
        updateRow(lead.id, { status: "running" });
        const t0 = Date.now();
        try {
          const d = await fetchDocs(lead, intel, docType, signal);
          updateRow(lead.id, {
            status: "completed",
            outreachMarkdown: d.outreachMarkdown,
            critiqueMarkdown: d.critiqueMarkdown,
            durationMs: verdictMs + d.durationMs,
          });
        } catch (err) {
          if (signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          // Drop back to "verdicted" (not "failed") so the verdict + intel
          // survive and the doc can be retried without rescoring.
          updateRow(lead.id, { status: "verdicted", error: msg });
        }
      });
    },
    [rows, isRunning, runQueue, updateRow],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
    setRows((prev) =>
      prev.map((r) =>
        r.status === "running"
          ? // A row mid-phase-2 already has its intel/verdict — fall back to
            // "verdicted" so it can resume into docs. A row mid-phase-1 has
            // nothing yet — back to "pending".
            { ...r, status: r.intelMarkdown ? "verdicted" : "pending" }
          : r,
      ),
    );
  }, []);

  const buildAndDownloadZip = useCallback(async () => {
    const zip = new JSZip();

    const completed = rows.filter((r) => r.status === "completed");
    const failed = rows.filter((r) => r.status === "failed");
    // Verdict tallies span every scored row (written or verdict-only).
    const scored = rows.filter(
      (r) => r.status === "completed" || r.status === "verdicted",
    );
    const acceptedCount = scored.filter((r) => r.verdict === "Accepted").length;
    const rejectedCount = scored.filter((r) => r.verdict === "Rejected").length;
    const generatedAtISO = new Date().toISOString();
    const sourceLabel = filename || "uploaded file";

    const indexLines: string[] = [];
    indexLines.push(`# Zapsight Bulk Outreach — ${filename || "leads"}`);
    indexLines.push("");
    indexLines.push(`Generated: ${generatedAtISO}`);
    indexLines.push(
      `Scored: **${scored.length}** (Accepted **${acceptedCount}**, Rejected **${rejectedCount}**) · Docs written: **${completed.length}** · Failed: **${failed.length}** · Source: ${sourceLabel}`,
    );
    indexLines.push("");
    indexLines.push("Routed by doc type:");
    const docTypes: DocType[] = [
      "pitch_full",
      "enrichment",
      "park_warming",
      "peer_referral",
      "up_org_referral",
      "skip",
    ];
    for (const t of docTypes) {
      const n = completed.filter((r) => r.docType === t).length;
      if (n > 0) indexLines.push(`- **${shortDocLabel(t)}** (\`${t}\`): ${n}`);
    }
    indexLines.push("");
    indexLines.push("> See `_summary.pdf` for the founders-ready verdict table.");
    indexLines.push("> All reasons mentioned in individual documents (`<doc-type>/<slug>/intel.md`).");
    indexLines.push("");
    indexLines.push("## Completed (grouped by doc type)");
    indexLines.push("");

    for (const t of docTypes) {
      const rowsOfType = completed.filter((r) => r.docType === t);
      if (rowsOfType.length === 0) continue;
      indexLines.push(`### ${shortDocLabel(t)} — \`${t}\``);
      indexLines.push("");
      for (const r of rowsOfType) {
        const folder = `${docFolder(t)}/${r.lead.id}`;
        zip.file(`${folder}/outreach.md`, r.outreachMarkdown || "");
        zip.file(`${folder}/intel.md`, r.intelMarkdown || "");
        if (r.critiqueMarkdown) {
          zip.file(`${folder}/critique.md`, r.critiqueMarkdown);
        }
        const tag = r.verdict ? `[${r.verdict}${r.confidence ? `·${r.confidence}` : ""}]` : "";
        const topSig = topSignalLine(r.signals);
        const sigBit = topSig ? ` — _signal: ${topSig}_` : "";
        indexLines.push(
          `- **${r.lead.companyName}** — ${r.lead.fullName} (${r.lead.title || "—"}) ${tag} → \`${folder}/outreach.md\`${sigBit}`,
        );
      }
      indexLines.push("");
    }

    // Scored-but-not-written rows (e.g. rejected leads in an accepted-only
    // run). They have a verdict + intel brief but no outreach doc — surface
    // the brief so the operator can still act on / override them.
    const verdictOnly = rows.filter((r) => r.status === "verdicted");
    if (verdictOnly.length > 0) {
      indexLines.push("");
      indexLines.push("## Verdict only (no outreach doc generated)");
      indexLines.push("");
      for (const r of verdictOnly) {
        const folder = `_verdict-only/${r.lead.id}`;
        zip.file(`${folder}/intel.md`, r.intelMarkdown || "");
        const tag = r.verdict ? `[${r.verdict}${r.confidence ? `·${r.confidence}` : ""}]` : "";
        const reason = r.mainReason ? ` — ${r.mainReason}` : "";
        indexLines.push(
          `- **${r.lead.companyName}** — ${r.lead.fullName} (${r.lead.title || "—"}) ${tag} → \`${folder}/intel.md\`${reason}`,
        );
      }
    }

    if (failed.length > 0) {
      indexLines.push("");
      indexLines.push("## Failed");
      indexLines.push("");
      for (const r of failed) {
        indexLines.push(
          `- ${r.lead.companyName} — ${r.lead.fullName}: ${r.error || "unknown error"}`,
        );
      }
    }

    zip.file("_index.md", indexLines.join("\n"));

    // Summary PDF — one row per lead (completed + failed), verdict + doc + main reason + top signal.
    const summaryRows: SummaryRow[] = rows.map((r, i) => ({
      index: i + 1,
      leadName: r.lead.fullName,
      company: r.lead.companyName,
      verdict:
        r.status === "failed"
          ? "Failed"
          : (r.verdict as SummaryRow["verdict"]) || "Unknown",
      docType: (r.status === "failed" ? "—" : r.docType || "—") as SummaryDocType,
      signalUsed: topSignalLine(r.signals),
      mainReason:
        r.status === "failed"
          ? r.error || "Generation failed."
          : r.mainReason || "—",
    }));

    const docTypeCounts: Partial<Record<SummaryDocType, number>> = {};
    for (const t of docTypes) {
      docTypeCounts[t] = completed.filter((r) => r.docType === t).length;
    }

    const pdfBytes = await buildSummaryPdf(summaryRows, {
      sourceLabel,
      generatedAtISO,
      totalLeads: rows.length,
      acceptedCount,
      rejectedCount,
      failedCount: failed.length,
      docTypeCounts,
    });
    zip.file("_summary.pdf", pdfBytes);

    const blob = await zip.generateAsync({ type: "blob" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadBlob(blob, `zapsight-outreach-${stamp}.zip`);
  }, [rows, filename]);

  const downloadZip = useCallback(async () => {
    if (!anyResult) return;
    setDownloadError(null);
    try {
      await buildAndDownloadZip();
    } catch (err) {
      // Never let the download die silently — surface it so the run isn't lost.
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadError(
        `Download failed while building the ZIP/PDF: ${msg}. Your results are safe — use "Export JSON" as a fallback.`,
      );
    }
  }, [anyResult, buildAndDownloadZip]);

  return (
    <section
      className="rounded-2xl border border-edge-default bg-bg-surface p-6 shadow-2xl shadow-black/40"
      aria-labelledby="bulk-heading"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2
            id="bulk-heading"
            className="flex items-center gap-2 text-xl font-bold text-ink-primary"
          >
            <Users size={18} className="text-accent-cyan" />
            Bulk outreach generator
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Drop a CSV / XLSX of leads. <b className="text-ink-primary">Step 1</b>{" "}
            scores every lead with a web-search intel pass — Accepted, or
            Rejected routed to Enrich / Park / Peer-Ref / Up-Org-Ref / Skip.
            You see the accepted/rejected split, then{" "}
            <b className="text-ink-primary">Step 2</b> writes the full
            outreach docs (outreach → Pavan-style critique → rewrite) for
            every lead or accepted only — your call. ZIP includes a
            founder-ready summary PDF.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setSessions(listArchivedBulkRuns());
              setShowSessions(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-edge-default bg-bg-elevated px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-secondary hover:border-accent-cyan hover:text-accent-cyan"
            title="Restore a previously saved bulk run"
          >
            <History size={12} /> Sessions
            {sessions.length > 0 && (
              <span className="ml-1 rounded-full bg-accent-cyan/20 px-1.5 text-[10px] text-accent-cyan">
                {sessions.length}
              </span>
            )}
          </button>
          {rows.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 rounded-lg border border-edge-default bg-bg-elevated px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-secondary hover:border-accent-red hover:text-accent-red"
              title="Discard the uploaded list (saved to Sessions automatically)"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {restorePrompt && (
        <RestoreBanner
          run={restorePrompt}
          onRestore={() => restoreRun(restorePrompt)}
          onDiscard={discardRestorePrompt}
        />
      )}

      {storageWarning && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent-amber/40 bg-accent-amber/10 p-3 font-mono text-xs text-accent-amber">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div>{storageWarning}</div>
            <button
              onClick={exportCurrentJson}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-accent-amber/40 bg-accent-amber/10 px-2 py-1 text-[11px] hover:bg-accent-amber/20"
            >
              <Download size={11} /> Export JSON now
            </button>
          </div>
        </div>
      )}

      {downloadError && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-3 font-mono text-xs text-accent-red">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div>{downloadError}</div>
            <button
              onClick={exportCurrentJson}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-accent-red/40 bg-accent-redMuted/30 px-2 py-1 text-[11px] hover:bg-accent-redMuted/50"
            >
              <Download size={11} /> Export JSON instead
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 transition ${
            dropping
              ? "border-accent-cyan bg-accent-cyan/5"
              : "border-edge-default hover:border-accent-cyan/60 hover:bg-bg-elevated/40"
          }`}
        >
          <Upload size={24} className="text-accent-cyan" />
          <div className="font-mono text-sm text-ink-primary">
            Drop CSV / XLSX or click to choose
          </div>
          <div className="font-mono text-[11px] text-ink-tertiary">
            recognized columns: company name, website, first/last name, title,
            email, LinkedIn, phone, industry
          </div>
          <input
            type="file"
            accept=".csv,.tsv,.xls,.xlsx,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFileInput}
            className="hidden"
          />
        </label>
      )}

      {parseError && (
        <div className="mt-4 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-3 font-mono text-sm text-accent-red">
          <AlertTriangle size={14} className="mr-1 inline" /> {parseError}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-edge-default bg-bg-elevated px-4 py-3">
            <div className="flex items-center gap-1.5 font-mono text-xs text-ink-secondary">
              <FileSpreadsheet size={14} className="text-accent-cyan" />
              {filename || "uploaded"} · <b className="text-ink-primary">{rows.length}</b> leads
              {lastSavedAt && (
                <span
                  className="ml-1 inline-flex items-center gap-1 text-accent-emerald"
                  title={`Auto-saved to browser at ${new Date(lastSavedAt).toLocaleTimeString()}. Survives tab refresh + close.`}
                >
                  <Save size={10} /> saved
                </span>
              )}
              <button
                onClick={exportCurrentJson}
                className="ml-1 rounded-md border border-edge-default bg-bg-surface px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-tertiary hover:border-accent-cyan hover:text-accent-cyan"
                title="Export current run as JSON (paranoia backup)"
              >
                Export JSON
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
              <span className="text-accent-cyan">{counts.running} running</span>
              {counts.verdicted > 0 && (
                <span className="text-accent-amber">{counts.verdicted} scored</span>
              )}
              <span className="text-accent-emerald">{counts.completed} done</span>
              {counts.accepted + counts.rejected > 0 && (
                <span className="text-ink-tertiary">
                  ({counts.accepted}<span className="text-accent-emerald">✓</span> · {counts.rejected}<span className="text-accent-red">✕</span>)
                </span>
              )}
              <span className={counts.failed ? "text-accent-red" : "text-ink-tertiary"}>
                {counts.failed} failed
              </span>
              <span className="text-ink-tertiary">{counts.pending} pending</span>
              {counts.completed > 0 && (
                <span className="text-ink-tertiary">
                  · routed:{" "}
                  {counts.pitch_full > 0 && <>P{counts.pitch_full} </>}
                  {counts.enrichment > 0 && <>E{counts.enrichment} </>}
                  {counts.park_warming > 0 && <>Pk{counts.park_warming} </>}
                  {counts.peer_referral > 0 && <>Pr{counts.peer_referral} </>}
                  {counts.up_org_referral > 0 && <>U{counts.up_org_referral} </>}
                  {counts.skip > 0 && <>S{counts.skip}</>}
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge-default bg-bg-surface px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-secondary hover:border-accent-cyan hover:text-accent-cyan"
                title="Deep mode = a few extra web-search signals per lead. Slower, sharper."
              >
                <Search size={12} />
                <input
                  type="checkbox"
                  checked={deepMode}
                  onChange={(e) => setDeepMode(e.target.checked)}
                  disabled={isRunning}
                  className="h-3 w-3 accent-accent-cyan"
                />
                Deep
              </label>
              {!isRunning && (counts.pending > 0 || counts.failed > 0) && (
                <button
                  onClick={runVerdicts}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-cyan px-3 py-2 font-mono text-xs uppercase tracking-wider text-bg-primary hover:bg-accent-emerald"
                  title="Phase 1: score every lead (Accepted / Rejected) — fast, no outreach docs yet"
                >
                  <Play size={14} />{" "}
                  {counts.verdicted + counts.completed > 0
                    ? "Score remaining"
                    : "Generate verdicts"}
                </button>
              )}
              {!isRunning && !showDecision && remainingToWrite > 0 && (
                <button
                  onClick={() => runDocs("all")}
                  className="flex items-center gap-1.5 rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 px-3 py-2 font-mono text-xs uppercase tracking-wider text-accent-emerald hover:bg-accent-emerald/20"
                  title="Write outreach docs for the scored leads that don't have one yet"
                >
                  <Play size={14} /> Write remaining ({remainingToWrite})
                </button>
              )}
              {isRunning && (
                <button
                  onClick={cancel}
                  className="flex items-center gap-1.5 rounded-lg border border-accent-red/40 bg-accent-redMuted/30 px-3 py-2 font-mono text-xs uppercase tracking-wider text-accent-red"
                >
                  <XCircle size={14} /> Cancel
                </button>
              )}
              {anyResult && (
                <button
                  onClick={downloadZip}
                  className="flex items-center gap-1.5 rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 px-3 py-2 font-mono text-xs uppercase tracking-wider text-accent-emerald hover:bg-accent-emerald/20"
                  title="Download outreach docs + verdict briefs + summary PDF as a ZIP"
                >
                  <Download size={14} /> ZIP ({counts.completed || counts.verdicted})
                </button>
              )}
            </div>
          </div>

          {showDecision && (
            <div className="mb-4 rounded-xl border border-accent-cyan/40 bg-accent-cyan/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent-cyan">
                    <CheckCircle2 size={14} /> Verdicts ready — choose what to write
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-ink-primary">
                    <span>
                      <b className="text-lg">{counts.verdicted}</b> leads scored
                    </span>
                    <span className="text-accent-emerald">
                      <b className="text-lg">{counts.accepted}</b> accepted
                    </span>
                    <span className="text-accent-red">
                      <b className="text-lg">{counts.rejected}</b> rejected
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-ink-tertiary">
                    Phase 2 writes the full outreach doc (outreach → critique →
                    rewrite) for the set you pick. Rejected leads keep their
                    verdict brief either way.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    onClick={() => runDocs("accepted")}
                    disabled={counts.accepted === 0}
                    className="flex items-center gap-1.5 rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 px-3 py-2 font-mono text-xs uppercase tracking-wider text-accent-emerald hover:bg-accent-emerald/20 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Generate outreach docs for accepted leads only"
                  >
                    <CheckCircle2 size={14} /> Accepted only ({counts.accepted})
                  </button>
                  <button
                    onClick={() => runDocs("all")}
                    className="flex items-center gap-1.5 rounded-lg bg-accent-cyan px-3 py-2 font-mono text-xs uppercase tracking-wider text-bg-primary hover:bg-accent-emerald"
                    title="Generate outreach docs for every scored lead (accepted + routed rejections)"
                  >
                    <Play size={14} /> Generate all reports ({counts.verdicted})
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="max-h-[480px] overflow-auto rounded-xl border border-edge-default">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-bg-elevated font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.lead.id}
                    className="border-t border-edge-default/50 align-top"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-ink-tertiary">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="text-ink-primary">
                        {leadHeadline(r.lead)}
                      </div>
                      <div className="font-mono text-[11px] text-ink-tertiary">
                        {r.lead.companyWebsite || "—"}
                        {r.vertical ? <> · {r.vertical}</> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-secondary">
                      {r.status === "failed" && (
                        <span className="text-accent-red">{r.error}</span>
                      )}
                      {(r.status === "completed" || r.status === "verdicted") && (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {r.verdict && <VerdictBadge verdict={r.verdict} confidence={r.confidence} />}
                            {r.docType && <DocTypeBadge docType={r.docType} />}
                            {r.status === "verdicted" && (
                              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
                                verdict only
                              </span>
                            )}
                          </div>
                          {r.mainReason && (
                            <div className="text-ink-secondary">{r.mainReason}</div>
                          )}
                          {r.signals && r.signals.length > 0 && (
                            <div className="text-accent-cyan">
                              ↳ {topSignalLine(r.signals)}
                            </div>
                          )}
                          {r.status === "verdicted" && r.error && (
                            <div className="text-accent-red">doc failed: {r.error}</div>
                          )}
                          <div className="text-ink-tertiary">
                            {Math.round((r.durationMs ?? 0) / 100) / 10}s
                          </div>
                        </div>
                      )}
                      {r.status === "running" && (
                        <span>{r.intelMarkdown ? "writing doc…" : "scoring…"}</span>
                      )}
                      {r.status === "pending" && <span>queued</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showSessions && (
        <SessionsDrawer
          sessions={sessions}
          onClose={() => setShowSessions(false)}
          onOpen={openSession}
          onDelete={removeSession}
        />
      )}
    </section>
  );
}

function RestoreBanner({
  run,
  onRestore,
  onDiscard,
}: {
  run: PersistedBulkRun;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  let completed = 0;
  let failed = 0;
  let accepted = 0;
  let rejected = 0;
  for (const r of run.rows) {
    if (r.status === "completed") {
      completed++;
      if (r.verdict === "Accepted") accepted++;
      else if (r.verdict === "Rejected") rejected++;
    } else if (r.status === "failed") failed++;
  }
  return (
    <div className="mt-4 rounded-xl border border-accent-emerald/40 bg-accent-emerald/5 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-accent-emerald">
            <RotateCcw size={14} /> Previous bulk run found
          </div>
          <div className="mt-1.5 text-sm text-ink-primary">
            <b>{run.filename || "uploaded file"}</b> · {run.rows.length} leads · {completed} completed (
            {accepted}<span className="text-accent-emerald">✓</span> ·{" "}
            {rejected}<span className="text-accent-red">✕</span>){failed > 0 ? `, ${failed} failed` : ""}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-tertiary">
            Saved {new Date(run.savedAt).toLocaleString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRestore}
            className="flex items-center gap-1.5 rounded-lg bg-accent-emerald px-3 py-2 font-mono text-xs uppercase tracking-wider text-bg-primary hover:bg-accent-cyan"
          >
            <RotateCcw size={14} /> Restore
          </button>
          <button
            onClick={onDiscard}
            className="flex items-center gap-1.5 rounded-lg border border-edge-default bg-bg-elevated px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-secondary hover:border-accent-red hover:text-accent-red"
          >
            <Trash2 size={12} /> Discard
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionsDrawer({
  sessions,
  onClose,
  onOpen,
  onDelete,
}: {
  sessions: BulkRunSummary[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-edge-default bg-bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold text-ink-primary">
              <History size={16} className="text-accent-cyan" /> Saved bulk runs
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-ink-tertiary">
              Up to 10 most recent runs kept in your browser. Tab refresh / close
              safe — always restorable.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-secondary hover:bg-bg-elevated hover:text-accent-red"
            aria-label="Close sessions drawer"
          >
            <X size={16} />
          </button>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-lg border border-edge-default bg-bg-elevated p-4 text-center font-mono text-xs text-ink-tertiary">
            No archived runs yet. The current run is saved automatically as it
            progresses.
          </div>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-edge-default bg-bg-elevated p-3 hover:border-accent-cyan/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-primary">
                      {s.filename || "untitled run"}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-ink-tertiary">
                      <Clock size={10} className="mr-1 inline" />
                      {new Date(s.savedAt).toLocaleString()}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
                      <span className="text-ink-tertiary">{s.total} leads</span>
                      <span className="text-accent-emerald">{s.completed} done</span>
                      {s.completed > 0 && (
                        <span className="text-ink-tertiary">
                          ({s.accepted}<span className="text-accent-emerald">✓</span> ·{" "}
                          {s.rejected}<span className="text-accent-red">✕</span>)
                        </span>
                      )}
                      {s.failed > 0 && (
                        <span className="text-accent-red">{s.failed} failed</span>
                      )}
                      {s.deepMode && (
                        <span className="rounded-full border border-accent-amber/40 bg-accent-amber/10 px-1.5 text-accent-amber">
                          deep
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button
                      onClick={() => onOpen(s.id)}
                      className="flex items-center gap-1 rounded-md bg-accent-cyan px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-bg-primary hover:bg-accent-emerald"
                    >
                      <RotateCcw size={11} /> Open
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Delete this saved run permanently?"))
                          onDelete(s.id);
                      }}
                      className="flex items-center gap-1 rounded-md border border-edge-default bg-bg-surface px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-ink-tertiary hover:border-accent-red hover:text-accent-red"
                    >
                      <Trash2 size={10} /> Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict, confidence }: { verdict: Verdict; confidence?: Confidence }) {
  const cls =
    verdict === "Accepted"
      ? "border-accent-emerald/30 bg-accent-emerald/10 text-accent-emerald"
      : verdict === "Rejected"
        ? "border-accent-red/30 bg-accent-redMuted/30 text-accent-red"
        : "border-edge-default bg-bg-elevated text-ink-tertiary";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
    >
      {verdict}
      {confidence && confidence !== "Unknown" ? (
        <span className="opacity-70">· {confidence}</span>
      ) : null}
    </span>
  );
}

function DocTypeBadge({ docType }: { docType: DocType }) {
  // We deliberately use accent-color names that exist in the tailwind palette.
  let cls = "border-edge-default bg-bg-elevated text-ink-tertiary";
  let label = shortDocLabel(docType);
  switch (docType) {
    case "pitch_full":
      cls = "border-accent-emerald/30 bg-accent-emerald/10 text-accent-emerald";
      break;
    case "enrichment":
      cls = "border-accent-amber/30 bg-accent-amber/10 text-accent-amber";
      break;
    case "park_warming":
      cls = "border-accent-cyan/30 bg-accent-cyan/5 text-accent-cyan";
      break;
    case "peer_referral":
      cls = "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300";
      break;
    case "up_org_referral":
      cls = "border-violet-400/30 bg-violet-400/10 text-violet-300";
      break;
    case "skip":
      cls = "border-ink-tertiary/30 bg-bg-elevated text-ink-tertiary";
      break;
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${cls}`}
      title={`Doc type: ${docType}`}
    >
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: RowStatus }) {
  if (status === "completed")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-emerald/30 bg-accent-emerald/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-emerald">
        <CheckCircle2 size={10} /> done
      </span>
    );
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-cyan">
        <Loader2 size={10} className="animate-spin" /> running
      </span>
    );
  if (status === "verdicted")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-amber/30 bg-accent-amber/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-amber">
        <CheckCircle2 size={10} /> scored
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-red/30 bg-accent-redMuted/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-red">
        <XCircle size={10} /> failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-edge-default bg-bg-elevated px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
      pending
    </span>
  );
}
