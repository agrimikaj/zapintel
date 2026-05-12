"use client";

import { useEffect, useState } from "react";
import { FileText, Trash2, X, Calendar, ExternalLink, FolderOpen } from "lucide-react";
import {
  deleteSavedReport,
  listSavedReports,
  SavedReport,
} from "@/lib/storage";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenReport: (report: SavedReport) => void;
  /** Tick to force re-read (e.g. when a new report was just saved). */
  refreshKey?: number;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SavedReportsDrawer({ open, onClose, onOpenReport, refreshKey }: Props) {
  const [reports, setReports] = useState<SavedReport[]>([]);

  useEffect(() => {
    if (open) setReports(listSavedReports());
  }, [open, refreshKey]);

  function handleDelete(id: string) {
    deleteSavedReport(id);
    setReports(listSavedReports());
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-edge-default bg-bg-surface shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-edge-default bg-bg-surface px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-cyan/15 text-accent-cyan">
              <FolderOpen size={16} />
            </div>
            <div>
              <div className="font-bold text-ink-primary">Saved Reports</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
                {reports.length} stored locally
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-secondary hover:bg-bg-elevated hover:text-ink-primary"
            aria-label="Close drawer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {reports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-edge-default p-8 text-center">
              <FileText size={28} className="mx-auto mb-2 text-ink-tertiary" />
              <div className="font-mono text-xs uppercase tracking-wider text-ink-tertiary">
                No reports yet
              </div>
              <p className="mt-2 text-sm text-ink-secondary">
                Generate a report, then hit <span className="text-accent-cyan">Save</span> to keep
                it. Reports live in this browser.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {reports.map((r) => (
                <li
                  key={r.id}
                  className="group rounded-xl border border-edge-default bg-bg-elevated p-4 transition hover:border-accent-cyan/40"
                >
                  <button
                    onClick={() => {
                      onOpenReport(r);
                      onClose();
                    }}
                    className="block w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-ink-primary">
                          {r.prospect.companyName}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-xs text-ink-secondary">
                          {r.prospect.websiteUrl.replace(/^https?:\/\//, "")}
                        </div>
                      </div>
                      <ExternalLink
                        size={14}
                        className="mt-1 flex-shrink-0 text-ink-tertiary group-hover:text-accent-cyan"
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
                      <span className="flex items-center gap-1">
                        <Calendar size={10} />
                        {relativeTime(r.savedAt)}
                      </span>
                      <span>{r.dimensions.filter((d) => d.status === "completed").length}/{r.dimensions.length} dims</span>
                      {r.summary && <span className="text-accent-emerald">summary</span>}
                    </div>
                  </button>
                  <div className="mt-3 border-t border-edge-default pt-3">
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-tertiary hover:text-accent-red"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
