"use client";

import { Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  status: "idle" | "running" | "completed" | "failed";
  summary?: string;
  prospect: { companyName: string; websiteUrl: string };
}

export function ExecutiveSummary({ status, summary, prospect }: Props) {
  return (
    <section className="rounded-2xl border border-accent-cyan/30 bg-gradient-to-br from-bg-surface to-bg-elevated p-7 shadow-2xl shadow-accent-cyan/5">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-cyan/15 text-accent-cyan">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="font-mono text-section uppercase tracking-wider text-accent-cyan">
              Executive Summary
            </div>
            <h2 className="text-xl font-bold text-ink-primary">
              {prospect.companyName}{" "}
              <a
                href={prospect.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm font-normal text-ink-secondary hover:text-accent-cyan"
              >
                — {prospect.websiteUrl.replace(/^https?:\/\//, "")} ↗
              </a>
            </h2>
          </div>
        </div>
        {status === "running" && (
          <div className="flex items-center gap-2 font-mono text-xs text-accent-cyan">
            <Loader2 size={14} className="animate-spin" />
            synthesizing
          </div>
        )}
      </div>

      {status === "idle" && (
        <div className="font-mono text-sm text-ink-tertiary">
          waiting for dimensions to complete...
        </div>
      )}
      {status === "running" && (
        <div className="space-y-3">
          <div className="h-4 w-1/3 rounded shimmer bg-bg-input" />
          <div className="h-4 w-5/6 rounded shimmer bg-bg-input" />
          <div className="h-4 w-3/4 rounded shimmer bg-bg-input" />
          <div className="h-4 w-2/3 rounded shimmer bg-bg-input" />
        </div>
      )}
      {status === "completed" && summary && (
        <div className="prose-zap max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
        </div>
      )}
      {status === "failed" && (
        <div className="rounded-lg border border-accent-red/30 bg-accent-redMuted/30 p-3 font-mono text-sm text-accent-red">
          Executive summary failed. See dimension cards below for partial output.
        </div>
      )}
    </section>
  );
}
