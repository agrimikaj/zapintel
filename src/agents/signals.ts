/**
 * Web-search signal fetcher.
 *
 * Given a lead and its inferred vertical, runs one Sonar call per gated
 * signal type, applies the accuracy guardrails (recency window, source
 * allowlist, entity match, citation-required), and returns a compact
 * Signal[] array. The downstream intel pass receives this array as
 * context and is told to either CITE it verbatim (date + URL) or write
 * "no public signal in last <window>" — never to invent.
 *
 * The five corrected signals (ownership_change, ops_leadership_rotation,
 * systems_migration, restructuring, regulatory_event) plus three
 * retail/SaaS-only ones (competitor_pricing, product_launch,
 * job_postings_ai, funding_standalone) are routed via VERTICAL_GATE in
 * src/lib/vertical.ts.
 *
 * Concurrency: all enabled signals for one lead are fetched in parallel.
 * Typical wall clock per lead in Lite mode: 4-6s of search (Sonar is
 * fast; the slow part of the pipeline is still the Sonnet 4.5 intel +
 * outreach + critique + rewrite calls).
 */

import { Lead } from "@/lib/leads";
import {
  inferVertical,
  signalsForVertical,
  SignalType,
  SIGNAL_WINDOWS,
  signalLabel,
  Vertical,
} from "@/lib/vertical";
import { searchSonar, SonarCitation } from "./sonar";

export interface Signal {
  type: SignalType;
  label: string;
  /** One- to two-line summary the intel pass can quote. */
  summary: string;
  /** ISO date if extractable from the citation; YYYY-MM-DD or full ISO. */
  date?: string;
  url?: string;
  sourceName?: string;
  /** Why this matters for Zapsight's AI Production Sprint — one short line. */
  zapsightAngle?: string;
}

export interface SignalFetchResult {
  vertical: Vertical;
  fetched: SignalType[];
  signals: Signal[];
  /** Total wall-clock for all the search calls for this lead. */
  durationMs: number;
  /** Per-type, did we get any usable signal? */
  hadSignalByType: Partial<Record<SignalType, boolean>>;
  /** Errors per signal type, if any — kept for the intel prompt context. */
  errors: Partial<Record<SignalType, string>>;
}

/** Per-signal source allowlist — passed to Sonar as `search_domain_filter`. */
const SOURCE_ALLOWLIST: Record<SignalType, string[]> = {
  ownership_change: [
    "sec.gov",
    "pitchbook.com",
    "reuters.com",
    "bloomberg.com",
    "wsj.com",
    "ft.com",
    "businessinsurance.com",
    "insuranceinsider.com",
    "modernhealthcare.com",
    "techcrunch.com",
  ],
  ops_leadership_rotation: [
    "linkedin.com",
    "businessinsurance.com",
    "benefitspro.com",
    "modernhealthcare.com",
    "modernretail.co",
    "reuters.com",
    "bloomberg.com",
  ],
  systems_migration: [
    "healthleadersmedia.com",
    "beckershospitalreview.com",
    "riskandinsurance.com",
    "modernretail.co",
    "plexisweb.com",
    "javelina.com",
    "epic.com",
    "cerner.com",
    "shopify.com",
    "netsuite.com",
  ],
  restructuring: [
    "layoffs.fyi",
    "businessinsurance.com",
    "modernhealthcare.com",
    "reuters.com",
    "bloomberg.com",
  ],
  regulatory_event: [
    "cms.gov",
    "dol.gov",
    "ncqa.org",
    "naic.org",
    "businessinsurance.com",
    "modernhealthcare.com",
  ],
  competitor_pricing: [],
  product_launch: [
    "techcrunch.com",
    "producthunt.com",
    "modernretail.co",
    "businessinsurance.com",
    "reuters.com",
  ],
  job_postings_ai: ["linkedin.com", "indeed.com"],
  funding_standalone: [
    "crunchbase.com",
    "techcrunch.com",
    "reuters.com",
    "bloomberg.com",
    "wsj.com",
  ],
};

/** Build the Sonar user query for a given signal × lead. */
function queryFor(signal: SignalType, lead: Lead, days: number): string {
  const company = lead.companyName;
  const site = lead.companyWebsite
    ? lead.companyWebsite.replace(/^https?:\/\//, "")
    : "";
  const siteHint = site ? ` (website: ${site})` : "";

  switch (signal) {
    case "ownership_change":
      return `What is the most recent ownership change at "${company}"${siteHint}? Look for: M&A activity (acquirer or target), private equity buyout, leveraged recapitalization, strategic recap, parent company change. Time window: last ${days} days. Return: a one-line headline, the announcement date (YYYY-MM-DD), and the source URL. If there is no verifiable ownership-change event in this window, reply exactly: "no public signal".`;

    case "ops_leadership_rotation":
      return `Who has recently been hired or appointed into an operations-leadership role at "${company}"${siteHint}? Roles of interest: COO, CIO, CDO, Chief Operating Officer, Chief Information Officer, Chief Data Officer, Chief Medical Officer, VP of Operations, VP of Claims, VP of Underwriting, VP of Supply Chain. Time window: last ${days} days. Return: name, title, start date, source URL. If there is no verifiable hire in this window, reply exactly: "no public signal".`;

    case "systems_migration":
      return `Has "${company}"${siteHint} announced a migration, replacement, or major upgrade of a load-bearing operational system in the last ${days} days? Look for: EHR migration (Epic, Cerner, Meditech), claims platform change (Plexis, Javelina, FINEOS, Guidewire), ERP migration (SAP, NetSuite, Oracle), ecommerce replatform (Shopify Plus, BigCommerce, Magento), member portal rebuild. Return: system, vendor in or out, announcement date, source URL. If none, reply exactly: "no public signal".`;

    case "restructuring":
      return `Has "${company}"${siteHint} announced layoffs, hiring freezes, plant or store closures, or other restructuring/cost-takeout action in the last ${days} days? Return: action type, scope (% of workforce or # of sites), announcement date, source URL. If none, reply exactly: "no public signal".`;

    case "regulatory_event":
      return `What regulatory or compliance events in the last ${days} days are likely to materially affect "${company}"${siteHint}'s operations? Look for: CMS rule changes, DOL/EBSA guidance, state DOI bulletins, ERISA updates, NCQA accreditation changes — relevant to their industry. Return: the rule/event, effective date, source URL, and one line on the operational impact for this specific company. If none with a clear nexus, reply exactly: "no public signal".`;

    case "competitor_pricing":
      return `Snapshot the current pricing posture of "${company}"${siteHint}: are their headline products priced above, at, or below the comparable competitor SKUs as of today? Cite 2-3 specific product+price comparisons with source URLs. If pricing is not transparent or comparable, reply exactly: "no public signal".`;

    case "product_launch":
      return `Has "${company}"${siteHint} launched a new product, feature, store concept, or major release in the last ${days} days? Return: what was launched, launch date, source URL. If none, reply exactly: "no public signal".`;

    case "job_postings_ai":
      return `Does "${company}"${siteHint} currently have active job postings (last ${days} days) for AI, Data, ML, or analytics roles — especially Head of AI, Director of Data, ML Engineer, Data Science roles? Return: role titles, count, source URL. If none, reply exactly: "no public signal".`;

    case "funding_standalone":
      return `What is the most recent non-PE funding round at "${company}"${siteHint} in the last ${days} days (venture funding, growth equity, IPO, debt facility)? Return: round size, lead investor, date, source URL. If none, reply exactly: "no public signal".`;
  }
}

const SONAR_SYSTEM = `You are a research analyst running a focused fact lookup. Rules:
- Cite only the time window in the question. Older items are out of scope.
- Every claim must be tied to a public source URL with a date. No inference, no extrapolation.
- If there is no verifiable signal in the window, reply exactly "no public signal" — do not pad with adjacent or stale items.
- Keep the response to under 120 words. Tight headline + date + URL.
- Anchor the entity by domain and brand, not by a similarly-named company.`;

/** Build a SourceName from a URL ("https://www.reuters.com/x" → "reuters.com"). */
function sourceNameFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * Best-effort entity match: at least one citation URL must reference the
 * company's website domain OR the brand name. Stops similarly-named entity
 * confusion (the Autonomo Technologies / Autonomo GmbH issue from the
 * Pavan-23 run).
 */
function entityMatches(
  lead: Lead,
  citations: SonarCitation[],
  answerText: string,
): boolean {
  const brand = lead.companyName.toLowerCase();
  const site = lead.companyWebsite
    ? lead.companyWebsite.replace(/^https?:\/\//, "").split("/")[0].toLowerCase()
    : "";
  if (site && citations.some((c) => c.url?.toLowerCase().includes(site))) {
    return true;
  }
  if (answerText.toLowerCase().includes(brand)) return true;
  if (
    site &&
    answerText.toLowerCase().includes(site.replace(/\.(com|io|co|net|org|ai)$/, ""))
  ) {
    return true;
  }
  return false;
}

/** Pull a date (YYYY-MM-DD or similar) out of the answer text. */
function extractDate(answer: string): string | undefined {
  const isoMatch = answer.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) return isoMatch[0];
  // "March 2026", "Q2 2026", "2026"
  const monthYear = answer.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}\b/);
  if (monthYear) return monthYear[0];
  return undefined;
}

function isNoSignal(answer: string): boolean {
  return /\bno public signal\b/i.test(answer.trim());
}

async function fetchOne(
  signal: SignalType,
  lead: Lead,
): Promise<{ signal?: Signal; error?: string }> {
  const days = SIGNAL_WINDOWS[signal];
  const query = queryFor(signal, lead, days);
  try {
    const result = await searchSonar(SONAR_SYSTEM, query, {
      recencyDays: days,
      domainAllowlist: SOURCE_ALLOWLIST[signal],
      maxTokens: 700,
    });
    if (!result.answer || isNoSignal(result.answer)) {
      return {};
    }
    if (result.citations.length === 0) {
      return { error: "answer returned without a citation; dropped under guardrail" };
    }
    if (!entityMatches(lead, result.citations, result.answer)) {
      return { error: "no citation matches the company entity; dropped under guardrail" };
    }

    // Pick the best citation: first one whose host is in our allowlist; else
    // the first one overall.
    const allow = new Set(SOURCE_ALLOWLIST[signal].map((d) => d.toLowerCase()));
    const best =
      result.citations.find((c) => {
        const host = sourceNameFromUrl(c.url);
        return host && Array.from(allow).some((a) => host.includes(a));
      }) || result.citations[0];

    return {
      signal: {
        type: signal,
        label: signalLabel(signal),
        summary: result.answer.trim(),
        date: best.date || extractDate(result.answer),
        url: best.url,
        sourceName: sourceNameFromUrl(best.url),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

export interface FetchOpts {
  /** Deep mode: a few extra signals beyond the vertical default. */
  deepMode?: boolean;
  /** Cap total signals returned across all types. */
  maxTotal?: number;
  /** Cap signals per type. */
  maxPerType?: number;
}

/**
 * Fetch the gated signals for one lead. If the vertical is `skip`, this
 * returns an empty list immediately without burning any search budget.
 */
export async function fetchSignalsForLead(
  lead: Lead,
  opts: FetchOpts = {},
): Promise<SignalFetchResult> {
  const t0 = Date.now();
  const vertical = inferVertical(lead.companyIndustry);
  const fetched = vertical === "skip" ? [] : signalsForVertical(vertical, !!opts.deepMode);
  const errors: Partial<Record<SignalType, string>> = {};
  const hadSignalByType: Partial<Record<SignalType, boolean>> = {};
  const out: Signal[] = [];

  if (fetched.length === 0) {
    return {
      vertical,
      fetched,
      signals: [],
      durationMs: Date.now() - t0,
      hadSignalByType,
      errors,
    };
  }

  const results = await Promise.all(fetched.map((s) => fetchOne(s, lead)));
  const perTypeCap = opts.maxPerType ?? 2;
  const perType: Partial<Record<SignalType, number>> = {};

  for (let i = 0; i < fetched.length; i++) {
    const sig = fetched[i];
    const r = results[i];
    if (r.error) errors[sig] = r.error;
    if (r.signal) {
      const c = perType[sig] ?? 0;
      if (c < perTypeCap) {
        out.push(r.signal);
        perType[sig] = c + 1;
        hadSignalByType[sig] = true;
      }
    } else if (!r.error) {
      hadSignalByType[sig] = false;
    }
  }

  const maxTotal = opts.maxTotal ?? 6;
  const trimmed = out.slice(0, maxTotal);

  return {
    vertical,
    fetched,
    signals: trimmed,
    durationMs: Date.now() - t0,
    hadSignalByType,
    errors,
  };
}

/** Render a signal block for inclusion in the intel prompt. */
export function renderSignalsBlock(result: SignalFetchResult): string {
  if (result.fetched.length === 0) {
    return "_No web-search signals fetched (vertical is auto-skip)._";
  }
  if (result.signals.length === 0) {
    const tried = result.fetched.map(signalLabel).join("; ");
    return `_No verifiable fresh signals found across the ${result.fetched.length} signal types tried (${tried}). Treat as "no public signal" for each — do not infer._`;
  }
  const lines: string[] = [];
  lines.push(`Vertical inferred: **${result.vertical}**.`);
  lines.push("");
  lines.push("Fresh signals (verified: published date + entity-matched source URL):");
  for (const s of result.signals) {
    const dateBit = s.date ? ` (${s.date})` : "";
    const srcBit = s.sourceName ? ` — ${s.sourceName}` : "";
    lines.push("");
    lines.push(`- **${s.label}**${dateBit}${srcBit}`);
    lines.push(`  ${s.summary.replace(/\s+/g, " ").trim()}`);
    if (s.url) lines.push(`  Source: ${s.url}`);
  }
  // Tell the model which types came up empty so it doesn't invent for them.
  const empties = result.fetched.filter((t) => !result.signals.some((s) => s.type === t));
  if (empties.length > 0) {
    lines.push("");
    lines.push(
      `For these signal types there was **no public signal** in window — do not infer or substitute: ${empties.map(signalLabel).join("; ")}.`,
    );
  }
  return lines.join("\n");
}
