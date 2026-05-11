"use client";

import { useState } from "react";
import { Building2, Globe, Briefcase, Send, Sparkles, Loader2 } from "lucide-react";

export interface ProspectFormValues {
  companyName: string;
  websiteUrl: string;
  industry: string;
  knownContext: string;
  zapsightOffering: string;
}

interface Props {
  onSubmit: (v: ProspectFormValues) => void;
  isRunning: boolean;
}

export function ProspectForm({ onSubmit, isRunning }: Props) {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [knownContext, setKnownContext] = useState("");
  const [zapsightOffering, setZapsightOffering] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName.trim() || !websiteUrl.trim()) return;
    onSubmit({
      companyName: companyName.trim(),
      websiteUrl: websiteUrl.trim(),
      industry: industry.trim(),
      knownContext: knownContext.trim(),
      zapsightOffering: zapsightOffering.trim(),
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-edge-default bg-bg-surface p-6 shadow-2xl shadow-black/40"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
            Company Name
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge-default bg-bg-input px-3 focus-within:border-accent-cyan">
            <Building2 size={16} className="text-ink-tertiary" />
            <input
              required
              disabled={isRunning}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Robotics Ltd."
              className="w-full bg-transparent py-3 text-ink-primary outline-none placeholder:text-ink-tertiary disabled:opacity-50"
            />
          </div>
        </div>

        <div>
          <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
            Website URL
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge-default bg-bg-input px-3 focus-within:border-accent-cyan">
            <Globe size={16} className="text-ink-tertiary" />
            <input
              required
              disabled={isRunning}
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://acme-robotics.com"
              className="w-full bg-transparent py-3 text-ink-primary outline-none placeholder:text-ink-tertiary disabled:opacity-50"
            />
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
            Industry (optional)
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge-default bg-bg-input px-3 focus-within:border-accent-cyan">
            <Briefcase size={16} className="text-ink-tertiary" />
            <input
              disabled={isRunning}
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Industrial robotics, mid-market B2B SaaS, Shopify DTC apparel..."
              className="w-full bg-transparent py-3 text-ink-primary outline-none placeholder:text-ink-tertiary disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-4 font-mono text-xs uppercase tracking-wider text-accent-cyan hover:text-accent-emerald"
      >
        {showAdvanced ? "− hide" : "+ add"} sales context (optional)
      </button>

      {showAdvanced && (
        <div className="mt-4 grid grid-cols-1 gap-4">
          <div>
            <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
              What you already know about them
            </label>
            <textarea
              disabled={isRunning}
              value={knownContext}
              onChange={(e) => setKnownContext(e.target.value)}
              rows={3}
              placeholder="Met their COO at SaaStock. They said content is a bottleneck. Just raised Series B last quarter."
              className="mt-2 w-full resize-none rounded-lg border border-edge-default bg-bg-input px-3 py-3 text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-accent-cyan disabled:opacity-50"
            />
          </div>
          <div>
            <label className="font-mono text-section uppercase tracking-wider text-ink-secondary">
              Zapsight offer to lean into (optional)
            </label>
            <input
              disabled={isRunning}
              value={zapsightOffering}
              onChange={(e) => setZapsightOffering(e.target.value)}
              placeholder="AI content engine, sales research agent, Shopify intelligence dashboard..."
              className="mt-2 w-full rounded-lg border border-edge-default bg-bg-input px-3 py-3 text-ink-primary outline-none placeholder:text-ink-tertiary focus:border-accent-cyan disabled:opacity-50"
            />
          </div>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-xs text-ink-secondary">
          <Sparkles size={14} className="text-accent-amber" />
          8-dimension brief · Claude Sonnet 4.5 via OpenRouter · ~30-50s
        </div>
        <button
          type="submit"
          disabled={isRunning || !companyName.trim() || !websiteUrl.trim()}
          className="flex items-center gap-2 rounded-lg bg-accent-cyan px-5 py-3 font-bold text-bg-primary transition hover:bg-accent-emerald disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isRunning ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Send size={18} />
          )}
          {isRunning ? "Researching..." : "Run Intelligence"}
        </button>
      </div>
    </form>
  );
}
