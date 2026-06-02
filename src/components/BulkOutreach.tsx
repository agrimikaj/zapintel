"use client";

/**
 * Bulk-outreach generator (multi-pass, doc-type-routed, web-search-grounded).
 *
 * The component:
 *  1. parses a CSV/XLSX client-side via src/lib/leads.ts
 *  2. POSTs each row to /api/bulk/lead — the server runs signal fetch
 *     (Sonar via OpenRouter), intel pass, doc-type-routed outreach pass,
 *     critique pass, rewrite pass — and returns a verdict + doc type
 *     + signal list + the rewritten Markdown
 *  3. shows per-row status with verdict + doc-type badges
 *  4. on download, bundles every result into a ZIP organized by doc type,
 *     plus a single-page founder-ready summary PDF
 *
 * Server side is single-lead-per-request — see route comment.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  Search,
  Trash2,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import JSZip from "jszip";
import { Lead, leadHeadline, parseLeadFile } from "@/lib/leads";
import {
  buildSummaryPdf,
  SummaryDocType,
  SummaryRow,
} from "@/lib/summaryPdf";

type RowStatus = "pending" | "running" | "completed" | "failed";
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

interface BulkLeadResponse {
  intelMarkdown: string;
  outreachMarkdown: string;
  critiqueMarkdown: string;
  verdict: Verdict;
  confidence: Confidence;
  rejectionClass: string;
  mainReason: string;
  docType: DocType;
  vertical: string;
  signals: ServerSignal[];
  durationMs: number;
}

async function generateOne(
  lead: Lead,
  deepMode: boolean,
  signal: AbortSignal,
): Promise<BulkLeadResponse> {
  const res = await fetch("/api/bulk/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ lead, deepMode }),
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
  const j = JSON.parse(text) as { data: BulkLeadResponse };
  return j.data;
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

export function BulkOutreach() {
  const [filename, setFilename] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [deepMode, setDeepMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const counts = useMemo(() => {
    const out = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      accepted: 0,
      rejected: 0,
      pitch_full: 0,
      enrichment: 0,
      park_warming: 0,
      peer_referral: 0,
      up_org_referral: 0,
      skip: 0,
    };
    for (const r of rows) {
      out[r.status]++;
      if (r.status === "completed") {
        if (r.verdict === "Accepted") out.accepted++;
        else if (r.verdict === "Rejected") out.rejected++;
        if (r.docType) out[r.docType]++;
      }
    }
    return out;
  }, [rows]);

  const allDone =
    rows.length > 0 && counts.pending === 0 && counts.running === 0;
  const anyCompleted = counts.completed > 0;

  const ingestFile = useCallback(async (file: File) => {
    setParseError(null);
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      const leads = parseLeadFile(buf, file.name);
      setRows(leads.map((l) => ({ lead: l, status: "pending" as const })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setParseError(msg);
      setRows([]);
    }
  }, []);

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
    setRows([]);
    setFilename(null);
    setParseError(null);
    setIsRunning(false);
  }, []);

  const updateRow = useCallback((id: string, patch: Partial<RowState>) => {
    setRows((prev) =>
      prev.map((r) => (r.lead.id === id ? { ...r, ...patch } : r)),
    );
  }, []);

  const runAll = useCallback(async () => {
    if (rows.length === 0 || isRunning) return;
    setIsRunning(true);
    setRows((prev) =>
      prev.map((r) =>
        r.status === "failed"
          ? { ...r, status: "pending", error: undefined }
          : r,
      ),
    );

    const controller = new AbortController();
    abortRef.current = controller;

    const queue = rows
      .filter((r) => r.status !== "completed")
      .map((r) => r.lead);

    let idx = 0;
    async function worker() {
      while (idx < queue.length && !controller.signal.aborted) {
        const myIdx = idx++;
        const lead = queue[myIdx];
        updateRow(lead.id, { status: "running" });
        const t0 = Date.now();
        try {
          const result = await generateOne(lead, deepMode, controller.signal);
          updateRow(lead.id, {
            status: "completed",
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
            durationMs: result.durationMs,
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          updateRow(lead.id, {
            status: "failed",
            error: msg,
            durationMs: Date.now() - t0,
          });
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
      worker(),
    );
    await Promise.all(workers);

    setIsRunning(false);
    abortRef.current = null;
  }, [rows, isRunning, updateRow, deepMode]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
    setRows((prev) =>
      prev.map((r) =>
        r.status === "running" ? { ...r, status: "pending" } : r,
      ),
    );
  }, []);

  const downloadZip = useCallback(async () => {
    if (!anyCompleted) return;
    const zip = new JSZip();

    const completed = rows.filter((r) => r.status === "completed");
    const failed = rows.filter((r) => r.status === "failed");
    const acceptedCount = completed.filter((r) => r.verdict === "Accepted").length;
    const rejectedCount = completed.filter((r) => r.verdict === "Rejected").length;
    const generatedAtISO = new Date().toISOString();
    const sourceLabel = filename || "uploaded file";

    const indexLines: string[] = [];
    indexLines.push(`# Zapsight Bulk Outreach — ${filename || "leads"}`);
    indexLines.push("");
    indexLines.push(`Generated: ${generatedAtISO}`);
    indexLines.push(
      `Completed: **${completed.length}** (Accepted **${acceptedCount}**, Rejected **${rejectedCount}**) · Failed: **${failed.length}** · Source: ${sourceLabel}`,
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
  }, [rows, anyCompleted, filename]);

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
            Drop a CSV / XLSX of leads. Each row gets a 4-pass treatment —
            web-search intel → doc-type-routed outreach → Pavan-style
            critique → rewrite — and a verdict (Accepted, or Rejected
            routed to Enrich / Park / Peer-Ref / Up-Org-Ref / Skip). ZIP
            includes a founder-ready summary PDF.
          </p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={clearAll}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-edge-default bg-bg-elevated px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-secondary hover:border-accent-red hover:text-accent-red"
            title="Discard the uploaded list"
          >
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>

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
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-wider">
              <span className="text-accent-cyan">{counts.running} running</span>
              <span className="text-accent-emerald">{counts.completed} done</span>
              {counts.completed > 0 && (
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
              {!isRunning && !allDone && (
                <button
                  onClick={runAll}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-cyan px-3 py-2 font-mono text-xs uppercase tracking-wider text-bg-primary hover:bg-accent-emerald"
                >
                  <Play size={14} /> {counts.completed > 0 ? "Resume" : "Generate all"}
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
              {anyCompleted && (
                <button
                  onClick={downloadZip}
                  className="flex items-center gap-1.5 rounded-lg border border-accent-emerald/40 bg-accent-emerald/10 px-3 py-2 font-mono text-xs uppercase tracking-wider text-accent-emerald hover:bg-accent-emerald/20"
                  title="Download all completed outreach docs + summary PDF as a ZIP"
                >
                  <Download size={14} /> ZIP ({counts.completed})
                </button>
              )}
            </div>
          </div>

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
                      {r.status === "completed" && (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {r.verdict && <VerdictBadge verdict={r.verdict} confidence={r.confidence} />}
                            {r.docType && <DocTypeBadge docType={r.docType} />}
                          </div>
                          {r.mainReason && (
                            <div className="text-ink-secondary">{r.mainReason}</div>
                          )}
                          {r.signals && r.signals.length > 0 && (
                            <div className="text-accent-cyan">
                              ↳ {topSignalLine(r.signals)}
                            </div>
                          )}
                          <div className="text-ink-tertiary">
                            {Math.round((r.durationMs ?? 0) / 100) / 10}s
                          </div>
                        </div>
                      )}
                      {r.status === "running" && <span>generating…</span>}
                      {r.status === "pending" && <span>queued</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
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
