"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileText, FileJson, Printer } from "lucide-react";

interface Props {
  onMarkdown: () => void;
  onJSON: () => void;
  onPrint: () => void;
  disabled?: boolean;
}

export function DownloadMenu({ onMarkdown, onJSON, onPrint, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 rounded-lg border border-edge-default bg-bg-surface px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-primary hover:border-accent-cyan hover:text-accent-cyan disabled:opacity-40"
      >
        <Download size={14} /> Download <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-lg border border-edge-default bg-bg-elevated shadow-xl">
          <button
            onClick={() => {
              setOpen(false);
              onMarkdown();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink-primary hover:bg-bg-surface"
          >
            <FileText size={14} className="text-accent-cyan" />
            <div>
              <div>Markdown</div>
              <div className="font-mono text-[10px] text-ink-tertiary">.md — readable, portable</div>
            </div>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onJSON();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink-primary hover:bg-bg-surface"
          >
            <FileJson size={14} className="text-accent-amber" />
            <div>
              <div>JSON</div>
              <div className="font-mono text-[10px] text-ink-tertiary">.json — machine-readable</div>
            </div>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onPrint();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink-primary hover:bg-bg-surface"
          >
            <Printer size={14} className="text-accent-emerald" />
            <div>
              <div>Print / PDF</div>
              <div className="font-mono text-[10px] text-ink-tertiary">browser print → save as PDF</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
