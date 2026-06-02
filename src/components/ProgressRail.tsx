"use client";

import { CheckCircle2, Loader2, Circle, XCircle } from "lucide-react";

export interface ProgressRailDimension {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface Props {
  dimensions: ProgressRailDimension[];
}

export function ProgressRail({ dimensions }: Props) {
  const total = dimensions.length;
  const done = dimensions.filter((d) => d.status === "completed").length;
  const failed = dimensions.filter((d) => d.status === "failed").length;
  const running = dimensions.filter((d) => d.status === "running").length;
  const pct = Math.round(((done + failed) / total) * 100);

  return (
    <aside className="sticky top-6 rounded-2xl border border-edge-default bg-bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="font-mono text-section uppercase tracking-wider text-ink-secondary">
          Research Pipeline
        </div>
        <div className="font-mono text-xs text-accent-cyan">
          {done}/{total} · {pct}%
        </div>
      </div>

      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-bg-input">
        <div
          className="h-full bg-gradient-to-r from-accent-cyan to-accent-emerald transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-2">
        {dimensions.map((d) => {
          const Icon =
            d.status === "completed"
              ? CheckCircle2
              : d.status === "running"
                ? Loader2
                : d.status === "failed"
                  ? XCircle
                  : Circle;
          const color =
            d.status === "completed"
              ? "text-accent-emerald"
              : d.status === "running"
                ? "text-accent-cyan"
                : d.status === "failed"
                  ? "text-accent-red"
                  : "text-ink-tertiary";
          return (
            <li
              key={d.id}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition ${
                d.status === "running" ? "bg-accent-cyan/5" : ""
              }`}
            >
              <Icon
                size={14}
                className={`${color} ${d.status === "running" ? "animate-spin" : ""}`}
              />
              <span
                className={`text-sm ${
                  d.status === "completed"
                    ? "text-ink-primary"
                    : d.status === "running"
                      ? "text-ink-primary"
                      : "text-ink-secondary"
                }`}
              >
                {d.label}
              </span>
            </li>
          );
        })}
      </ul>

      {(running > 0 || failed > 0) && (
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-edge-default pt-4 font-mono text-[10px] uppercase tracking-wider">
          <div>
            <div className="text-ink-tertiary">Running</div>
            <div className="text-accent-cyan">{running}</div>
          </div>
          <div>
            <div className="text-ink-tertiary">Done</div>
            <div className="text-accent-emerald">{done}</div>
          </div>
          <div>
            <div className="text-ink-tertiary">Failed</div>
            <div className={failed > 0 ? "text-accent-red" : "text-ink-tertiary"}>
              {failed}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
