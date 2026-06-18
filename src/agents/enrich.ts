/**
 * Lead enrichment — company website + LinkedIn URL + (verified) email.
 *
 * Turns three previously-manual steps into pipeline functionality:
 *   - website   : was a terminal script run before upload. Now found in-app.
 *   - linkedin  : was a manual web-search-and-verify pass. Now automated.
 *   - email     : verified only. Sonar/LLM are NOT used for email (they
 *                 pattern-guess, which is banned — a wrong address burns
 *                 sender reputation). Email comes ONLY from Lusha (a verified
 *                 data provider), gated behind LUSHA_API_KEY. No key → email
 *                 stays blank. Never assumed.
 *
 * Website + LinkedIn run through Sonar (Perplexity, via the existing
 * OpenRouter key — no new key). The HARD RULE everywhere: a value is written
 * only when a real source backs it (a citation / a verified provider). When
 * unsure we return nothing and the cell stays blank. Blank beats wrong.
 */

import { searchSonar } from "./sonar";

const LUSHA_BASE = "https://api.lusha.com";

// Hosts that are never a company's own marketing site.
const GENERIC_HOSTS = new Set([
  "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "youtube.com", "crunchbase.com", "bloomberg.com", "wikipedia.org",
  "google.com", "zoominfo.com", "pitchbook.com", "glassdoor.com",
  "rocketreach.co", "apollo.io", "dnb.com",
]);

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function extractDomain(s: string): string | null {
  const m = s.match(
    /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+)\b/i,
  );
  return m ? m[1].toLowerCase().replace(/^www\./, "") : null;
}

// ── Website ────────────────────────────────────────────────────────────────

export interface WebsiteResult {
  website: string; // normalized https URL
  source: string | null; // citation that backed it
}

/**
 * Find a company's official website. Prefers a domain that appears in Sonar's
 * citations; falls back to a single clean domain the model states. Returns null
 * (→ blank) when it cannot find one.
 */
export async function findCompanyWebsite(
  company: string,
): Promise<WebsiteResult | null> {
  if (!company.trim()) return null;
  const sys =
    "You identify the official corporate website of a company. Reply with ONLY the root domain (e.g. example.com) on a single line, or the word NONE if you cannot find it with confidence. Never guess.";
  const q = `What is the official company website domain for "${company}"?`;
  let r;
  try {
    r = await searchSonar(sys, q, { maxTokens: 120 });
  } catch {
    return null;
  }
  if (/^\s*none\b/i.test(r.answer)) return null;

  const citationDomains = r.rawCitationUrls
    .map(hostOf)
    .filter((d) => d && !GENERIC_HOSTS.has(d));
  const answerDomain = extractDomain(r.answer);

  let chosen = "";
  if (
    answerDomain &&
    citationDomains.some(
      (d) =>
        d === answerDomain ||
        d.endsWith("." + answerDomain) ||
        answerDomain.endsWith("." + d),
    )
  ) {
    chosen = answerDomain; // model + a citation agree → strongest
  } else if (answerDomain && !GENERIC_HOSTS.has(answerDomain)) {
    chosen = answerDomain; // model stated a clean, non-generic domain
  } else if (citationDomains.length) {
    chosen = citationDomains[0];
  }
  if (!chosen) return null;
  return { website: `https://${chosen}`, source: r.rawCitationUrls[0] ?? null };
}

// ── LinkedIn ─────────────────────────────────────────────────────────────────

export interface LinkedInResult {
  url: string; // normalized https://www.linkedin.com/in/<slug>/
  confidence: "high" | "medium";
  source: string;
}

function extractInUrls(s: string): string[] {
  const out: string[] = [];
  const re =
    /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%\-.]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[0]);
  return out;
}

function normInUrl(u: string): string {
  const m = u.match(/linkedin\.com\/in\/([A-Za-z0-9_%\-.]+)/i);
  return m ? `https://www.linkedin.com/in/${m[1].replace(/\/$/, "")}/` : u;
}

/**
 * Find a person's LinkedIn profile URL. A URL is returned ONLY when a real
 * linkedin.com/in/ profile is backed by a citation (Sonar actually surfaced
 * it) — never a model-invented slug. Confidence "high" = the model's chosen
 * URL is itself a citation; "medium" = a LinkedIn profile was cited but the
 * model didn't echo that exact URL. Returns null → blank.
 */
export async function findLinkedInUrl(
  fullName: string,
  company: string,
  title: string,
): Promise<LinkedInResult | null> {
  if (!fullName.trim() || !company.trim()) return null;
  const sys =
    "You find the LinkedIn profile URL of a specific business person. Return a URL ONLY when a real linkedin.com/in/ profile clearly belongs to the named person at the named company (or their distinctive role). If you are not confident it is the right person, reply with exactly NONE. Never invent, guess, or pattern-construct a profile slug. Reply with a single line: the full https://www.linkedin.com/in/... URL, or NONE.";
  const q = `LinkedIn profile URL for ${fullName}${
    title ? ", " + title : ""
  } at ${company}.`;
  let r;
  try {
    r = await searchSonar(sys, q, { maxTokens: 160 });
  } catch {
    return null;
  }
  if (/^\s*none\b/i.test(r.answer)) return null;

  const answerUrls = extractInUrls(r.answer);
  const citationProfileUrls = r.rawCitationUrls.flatMap(extractInUrls);
  const citedSet = new Set(citationProfileUrls.map(normInUrl));

  // Strongest: the model's URL is itself one of the cited profile URLs.
  for (const u of answerUrls) {
    if (citedSet.has(normInUrl(u)))
      return { url: normInUrl(u), confidence: "high", source: u };
  }
  // Model returned a profile and Sonar browsed LinkedIn (a LI citation exists).
  const liCited = r.rawCitationUrls.some((u) => /linkedin\.com/i.test(u));
  if (answerUrls.length && liCited)
    return {
      url: normInUrl(answerUrls[0]),
      confidence: "medium",
      source: answerUrls[0],
    };
  // Only the citations carry a profile URL (model didn't echo it).
  if (citationProfileUrls.length)
    return {
      url: normInUrl(citationProfileUrls[0]),
      confidence: "medium",
      source: citationProfileUrls[0],
    };
  return null; // nothing citation-backed → blank
}

// ── Email (Lusha, verified, gated) ───────────────────────────────────────────

interface LushaHit {
  email: string;
  linkedinUrl?: string;
}

/**
 * Verified email via Lusha. Runs ONLY when LUSHA_API_KEY is configured;
 * otherwise returns null and email stays blank. Defensive parsing across a few
 * documented Lusha response shapes; any error degrades to null (never throws).
 */
export async function enrichEmailViaLusha(
  firstName: string,
  lastName: string,
  company: string,
): Promise<LushaHit | null> {
  const key = process.env.LUSHA_API_KEY;
  if (!key) return null;
  if (!(firstName && lastName && company)) return null;
  try {
    const params = new URLSearchParams({ firstName, lastName, company });
    const res = await fetch(`${LUSHA_BASE}/v2/person?${params.toString()}`, {
      headers: { api_key: key },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    // Tolerate the common shapes: {data:{...}} | {data:[{...}]} | {contacts:[{...}]} | {...}
    const dataField = j.data ?? j.contacts ?? j;
    const c = (Array.isArray(dataField) ? dataField[0] : dataField) as
      | Record<string, unknown>
      | undefined;
    if (!c) return null;
    const emailsRaw = (c.emailAddresses ?? c.emails ?? []) as unknown[];
    let addr = "";
    for (const e of emailsRaw) {
      const cand =
        typeof e === "string"
          ? e
          : ((e as Record<string, unknown>)?.email as string) ||
            ((e as Record<string, unknown>)?.address as string) ||
            "";
      if (cand && cand.includes("@")) {
        addr = cand;
        break;
      }
    }
    if (!addr) return null;
    const social = c.socialLinks as Record<string, unknown> | undefined;
    const li =
      (social?.linkedin as string) || ((c.linkedinUrl as string) ?? undefined);
    return { email: addr, linkedinUrl: li };
  } catch {
    return null;
  }
}

// ── Combined contact enrichment ──────────────────────────────────────────────

export interface ContactEnrichment {
  linkedinUrl: string;
  linkedinConfidence?: "high" | "medium";
  linkedinSource?: string;
  email: string;
  emailSource?: "lusha";
}

/**
 * Enrich a single contact's LinkedIn + email. Only fills what is missing
 * (haveLinkedin / haveEmail flags) and only with verified/cited values.
 */
export async function enrichContact(input: {
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  title?: string;
  haveLinkedin: boolean;
  haveEmail: boolean;
}): Promise<ContactEnrichment> {
  const out: ContactEnrichment = { linkedinUrl: "", email: "" };

  // Email (+ any bundled LinkedIn) from Lusha — verified, gated on the key.
  if (!input.haveEmail) {
    const lu = await enrichEmailViaLusha(
      input.firstName,
      input.lastName,
      input.company,
    );
    if (lu?.email) {
      out.email = lu.email;
      out.emailSource = "lusha";
    }
    if (lu?.linkedinUrl && !out.linkedinUrl) {
      out.linkedinUrl = lu.linkedinUrl;
      out.linkedinConfidence = "high";
      out.linkedinSource = "lusha";
    }
  }

  // LinkedIn from Sonar — only if still missing.
  if (!input.haveLinkedin && !out.linkedinUrl) {
    const li = await findLinkedInUrl(
      input.fullName,
      input.company,
      input.title || "",
    );
    if (li) {
      out.linkedinUrl = li.url;
      out.linkedinConfidence = li.confidence;
      out.linkedinSource = li.source;
    }
  }

  return out;
}
