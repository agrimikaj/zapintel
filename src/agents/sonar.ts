/**
 * Perplexity Sonar Pro client — routed through the existing OpenRouter key.
 *
 * Sarah's instruction is that the bulk feature uses only the OpenRouter
 * key. OpenRouter passes through Perplexity's Sonar models (model id
 * `perplexity/sonar-pro`), which gives us live web search + citations
 * without a second API key, second bill, or second env var. That keeps
 * the contract honest while still adding the search capability.
 *
 * What this client adds over `completeChat`:
 *   - returns the `citations` array verbatim alongside the answer text,
 *     so callers can drop URLs and dates straight into the intel brief
 *     without re-parsing the prose
 *   - supports `search_recency_filter` so we can enforce time windows at
 *     the provider level instead of trusting the model to honor "last 18
 *     months" in a prompt
 *
 * Failure mode: on any error, we throw with a useful message. The caller
 * (signal fetcher) is expected to catch + degrade gracefully — a missing
 * signal becomes "no public signal" in the brief, never fabricated.
 */

const BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

export const SONAR_MODEL =
  process.env.SONAR_MODEL || "perplexity/sonar-pro";

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set — the Sonar search client routes through it.",
    );
  }
  return key;
}

export type SonarRecency = "day" | "week" | "month" | "year";

export interface SonarCitation {
  url: string;
  title?: string;
  /** Some Sonar responses include a published date; many don't. We pass through what we get. */
  date?: string;
}

export interface SonarResult {
  answer: string;
  citations: SonarCitation[];
  rawCitationUrls: string[];
  /** wall-clock latency for the call, useful for budgeting. */
  durationMs: number;
}

interface SonarResponse {
  choices?: { message?: { content?: string } }[];
  citations?: (string | { url: string; title?: string; date?: string })[];
  error?: { message?: string; code?: string | number };
}

/** Map our internal "days" to Sonar's coarse recency bucket. */
export function recencyFromDays(days: number): SonarRecency {
  if (days <= 1) return "day";
  if (days <= 14) return "week";
  if (days <= 60) return "month";
  return "year";
}

export interface SearchOpts {
  /** Approximate recency in days; mapped to Sonar's recency bucket. */
  recencyDays?: number;
  /**
   * Soft domain whitelist — Sonar's API has `search_domain_filter` (10-domain
   * max). We pass it through when provided. Each domain is stripped of
   * protocol + path before being sent.
   */
  domainAllowlist?: string[];
  maxTokens?: number;
  /** Override the model if needed (e.g. cheap "sonar" instead of "sonar-pro"). */
  model?: string;
}

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
}

/**
 * Run a single Sonar search query. Returns the answer text and the list of
 * source citations. The caller is expected to apply guardrails (entity
 * match, date check, source-allowlist) on top of these results.
 */
export async function searchSonar(
  systemPrompt: string,
  userQuery: string,
  opts: SearchOpts = {},
): Promise<SonarResult> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: opts.model || SONAR_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userQuery },
    ],
    max_tokens: opts.maxTokens ?? 1100,
    temperature: 0.1,
    stream: false,
  };

  if (opts.recencyDays !== undefined) {
    body.search_recency_filter = recencyFromDays(opts.recencyDays);
  }
  if (opts.domainAllowlist && opts.domainAllowlist.length > 0) {
    body.search_domain_filter = opts.domainAllowlist
      .slice(0, 10)
      .map(normalizeDomain);
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://zapintel.vercel.app",
      "X-Title": "ZapIntel - Bulk Outreach (Sonar)",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (!res.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw) as SonarResponse;
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* not JSON */
    }
    throw new Error(`Sonar ${res.status}: ${detail.slice(0, 400)}`);
  }

  let parsed: SonarResponse;
  try {
    parsed = JSON.parse(raw) as SonarResponse;
  } catch {
    throw new Error(`Sonar returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (parsed.error?.message) {
    throw new Error(`Sonar error: ${parsed.error.message}`);
  }

  const answer = parsed.choices?.[0]?.message?.content?.trim() || "";
  const citations: SonarCitation[] = [];
  const rawCitationUrls: string[] = [];
  for (const c of parsed.citations || []) {
    if (typeof c === "string") {
      citations.push({ url: c });
      rawCitationUrls.push(c);
    } else if (c && typeof c === "object") {
      citations.push({ url: c.url, title: c.title, date: c.date });
      if (c.url) rawCitationUrls.push(c.url);
    }
  }

  return {
    answer,
    citations,
    rawCitationUrls,
    durationMs: Date.now() - t0,
  };
}
