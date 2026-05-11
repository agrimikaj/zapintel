"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Activity, Download, RefreshCw, Zap } from "lucide-react";
import { ProspectForm, ProspectFormValues } from "@/components/ProspectForm";
import { DimensionCard } from "@/components/DimensionCard";
import { ExecutiveSummary } from "@/components/ExecutiveSummary";
import { ProgressRail } from "@/components/ProgressRail";

type DimStatus = "pending" | "running" | "completed" | "failed";

interface DimState {
  id: string;
  label: string;
  iconName: string;
  status: DimStatus;
  findings?: string;
  durationMs?: number;
  error?: string;
}

const DIMENSION_TEMPLATE: DimState[] = [
  { id: "fundamentals",       label: "Company Fundamentals",           iconName: "Building2",     status: "pending" },
  { id: "digital_presence",   label: "Digital Presence & Maturity",    iconName: "Globe",         status: "pending" },
  { id: "products_services",  label: "Products & Services",            iconName: "Package",       status: "pending" },
  { id: "market_position",    label: "Market Position & Competitors",  iconName: "Target",        status: "pending" },
  { id: "pain_opportunities", label: "Pain Points & Opportunities",    iconName: "AlertTriangle", status: "pending" },
  { id: "decision_makers",    label: "Decision Makers & Buying Signals", iconName: "Users",       status: "pending" },
  { id: "tech_stack",         label: "Tech Stack & AI Readiness",      iconName: "Cpu",           status: "pending" },
  { id: "engagement_strategy", label: "Engagement Strategy",           iconName: "Send",          status: "pending" },
];

export default function HomePage() {
  const [prospect, setProspect] = useState<ProspectFormValues | null>(null);
  const [dimensions, setDimensions] = useState<DimState[]>(DIMENSION_TEMPLATE);
  const [summaryStatus, setSummaryStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [summary, setSummary] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalDone = useMemo(
    () => dimensions.filter((d) => d.status === "completed" || d.status === "failed").length,
    [dimensions],
  );

  const handleSubmit = useCallback(async (values: ProspectFormValues) => {
    setProspect(values);
    setDimensions(DIMENSION_TEMPLATE.map((d) => ({ ...d, status: "pending" })));
    setSummary("");
    setSummaryStatus("idle");
    setGlobalError(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let detail = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          detail = j?.error?.message || detail;
        } catch {
          /* not json */
        }
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const ev = JSON.parse(dataLine.slice(6));
            handleEvent(ev);
          } catch {
            /* malformed frame — ignore */
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== "The user aborted a request.") setGlobalError(message);
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, []);

  function handleEvent(ev: { type: string; [k: string]: unknown }) {
    if (ev.type === "dimension_started") {
      setDimensions((prev) =>
        prev.map((d) => (d.id === ev.dimension ? { ...d, status: "running" } : d)),
      );
    } else if (ev.type === "dimension_complete") {
      const r = ev.result as DimState & { dimension: string };
      setDimensions((prev) =>
        prev.map((d) =>
          d.id === r.dimension
            ? {
                ...d,
                status: r.status,
                findings: r.findings,
                durationMs: r.durationMs,
                error: r.error,
              }
            : d,
        ),
      );
    } else if (ev.type === "summary_started") {
      setSummaryStatus("running");
    } else if (ev.type === "summary_complete") {
      setSummary(String(ev.summary || ""));
      setSummaryStatus("completed");
    } else if (ev.type === "error") {
      setGlobalError(String(ev.message || "unknown error"));
      setSummaryStatus((s) => (s === "running" ? "failed" : s));
    }
  }

  const handleExport = useCallback(async () => {
    if (!prospect) return;
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: prospect.companyName,
        websiteUrl: prospect.websiteUrl,
        summary,
        dimensions: dimensions.map((d) => ({
          label: d.label,
          findings: d.findings || "",
          status: d.status,
        })),
      }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = prospect.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    a.download = `zapintel-${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [prospect, summary, dimensions]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setProspect(null);
    setDimensions(DIMENSION_TEMPLATE.map((d) => ({ ...d, status: "pending" })));
    setSummary("");
    setSummaryStatus("idle");
    setGlobalError(null);
    setIsRunning(false);
  }, []);

  const reportReady = summaryStatus === "completed" && totalDone === dimensions.length;

  return (
    <div className="min-h-screen">
      <Nav onReset={prospect ? reset : undefined} onExport={reportReady ? handleExport : undefined} />

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        {!prospect && <Hero />}

        <ProspectForm onSubmit={handleSubmit} isRunning={isRunning} />

        {globalError && (
          <div className="mt-6 rounded-xl border border-accent-red/40 bg-accent-redMuted/30 p-4 font-mono text-sm text-accent-red">
            {globalError}
          </div>
        )}

        {prospect && (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
            <div className="space-y-6">
              <ExecutiveSummary
                status={summaryStatus}
                summary={summary}
                prospect={{ companyName: prospect.companyName, websiteUrl: prospect.websiteUrl }}
              />
              <div className="space-y-5">
                {dimensions.map((d) => (
                  <DimensionCard
                    key={d.id}
                    id={d.id}
                    label={d.label}
                    iconName={d.iconName}
                    status={d.status}
                    findings={d.findings}
                    durationMs={d.durationMs}
                    error={d.error}
                  />
                ))}
              </div>
            </div>

            <div className="order-first lg:order-last">
              <ProgressRail
                dimensions={dimensions.map((d) => ({ id: d.id, label: d.label, status: d.status }))}
                summaryStatus={summaryStatus}
              />
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-edge-default py-8 text-center font-mono text-xs uppercase tracking-wider text-ink-tertiary">
        ZapIntel · powered by Zapsight · Claude Sonnet 4.5 via OpenRouter
      </footer>
    </div>
  );
}

function Nav({ onReset, onExport }: { onReset?: () => void; onExport?: () => void }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-edge-default bg-bg-primary/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-cyan text-bg-primary">
            <Zap size={18} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-bold">
              Zap<span className="text-accent-cyan">Intel</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-tertiary">
              client intelligence · by zapsight
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 rounded-lg border border-edge-default bg-bg-surface px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-primary hover:border-accent-cyan hover:text-accent-cyan"
            >
              <Download size={14} /> Export
            </button>
          )}
          {onReset && (
            <button
              onClick={onReset}
              className="flex items-center gap-1.5 rounded-lg border border-edge-default bg-bg-surface px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-primary hover:border-accent-cyan hover:text-accent-cyan"
            >
              <RefreshCw size={14} /> New
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <div className="mx-auto mb-10 max-w-3xl text-center">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-cyan/30 bg-accent-cyan/5 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-accent-cyan">
        <Activity size={12} /> CEO-grade prospect intelligence
      </div>
      <h1 className="mb-3 text-4xl font-bold leading-tight tracking-tight md:text-5xl">
        Walk into every first call <span className="text-accent-cyan">already informed.</span>
      </h1>
      <p className="text-lg text-ink-secondary">
        Drop a prospect URL. Get an 8-dimension brief: fundamentals, digital
        maturity, pain points, decision makers, the exact Zapsight wedge to
        pitch — and a 90-word opening email written for you.
      </p>
    </div>
  );
}
