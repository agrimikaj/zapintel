"use client";

import {
  Building2,
  Globe,
  Package,
  Target,
  AlertTriangle,
  Users,
  Cpu,
  Send,
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Building2,
  Globe,
  Package,
  Target,
  AlertTriangle,
  Users,
  Cpu,
  Send,
};

export interface DimensionCardProps {
  id: string;
  label: string;
  iconName: string;
  status: "pending" | "running" | "completed" | "failed";
  findings?: string;
  durationMs?: number;
  error?: string;
}

export function DimensionCard({
  label,
  iconName,
  status,
  findings,
  durationMs,
  error,
}: DimensionCardProps) {
  const Icon = ICONS[iconName] ?? Globe;

  const statusBadge = {
    pending:   { color: "text-ink-tertiary", bg: "bg-bg-elevated",      icon: Clock,         text: "queued" },
    running:   { color: "text-accent-cyan",  bg: "bg-accent-cyan/10",   icon: Loader2,       text: "running" },
    completed: { color: "text-accent-emerald", bg: "bg-accent-emerald/10", icon: CheckCircle2, text: "done" },
    failed:    { color: "text-accent-red",   bg: "bg-accent-red/10",    icon: XCircle,       text: "failed" },
  }[status];

  const StatusIcon = statusBadge.icon;

  return (
    <section
      className={`rounded-2xl border bg-bg-surface transition ${
        status === "running"
          ? "border-accent-cyan/40 shadow-[0_0_30px_-10px_rgba(0,212,255,0.4)]"
          : status === "completed"
            ? "border-edge-default"
            : status === "failed"
              ? "border-accent-red/30"
              : "border-edge-default opacity-70"
      }`}
    >
      <header className="flex items-center justify-between border-b border-edge-default px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              status === "completed"
                ? "bg-accent-emerald/10 text-accent-emerald"
                : status === "running"
                  ? "bg-accent-cyan/10 text-accent-cyan"
                  : status === "failed"
                    ? "bg-accent-red/10 text-accent-red"
                    : "bg-bg-elevated text-ink-tertiary"
            }`}
          >
            <Icon size={18} />
          </div>
          <h3 className="font-bold text-ink-primary">{label}</h3>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${statusBadge.color} ${statusBadge.bg}`}
        >
          <StatusIcon size={12} className={status === "running" ? "animate-spin" : ""} />
          {statusBadge.text}
          {durationMs ? <span className="opacity-60"> · {(durationMs / 1000).toFixed(1)}s</span> : null}
        </div>
      </header>

      <div className="px-5 py-5">
        {status === "pending" && (
          <div className="font-mono text-xs text-ink-tertiary">awaiting dispatch...</div>
        )}
        {status === "running" && (
          <div className="space-y-2">
            <div className="h-3 w-1/2 rounded shimmer bg-bg-input" />
            <div className="h-3 w-5/6 rounded shimmer bg-bg-input" />
            <div className="h-3 w-2/3 rounded shimmer bg-bg-input" />
          </div>
        )}
        {status === "failed" && (
          <div className="rounded-lg border border-accent-red/30 bg-accent-redMuted/30 p-3 font-mono text-xs text-accent-red">
            {error || "Unknown failure"}
          </div>
        )}
        {status === "completed" && findings && (
          <div className="prose-zap max-w-none text-[14px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{findings}</ReactMarkdown>
          </div>
        )}
      </div>
    </section>
  );
}
