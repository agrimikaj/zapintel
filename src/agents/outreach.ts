/**
 * Per-lead outreach generator — multi-pass, rejection-class-aware,
 * web-search-grounded, critique-rewritten.
 *
 * Pipeline per lead:
 *
 *   1. SIGNAL FETCH (parallel, vertical-gated, Sonar via OpenRouter)
 *        See src/agents/signals.ts.
 *
 *   2. INTEL PASS (Sonnet 4.5)
 *        Produces the dense brief PLUS the structured Verdict block:
 *          Verdict: Accepted | Rejected
 *          Confidence: High | Medium | Low
 *          Rejection class: data_integrity | sub_icp_revenue |
 *                           wrong_vertical | wrong_contact_level |
 *                           f500_oversize | no_pain_hook | none_accepted
 *          Main reason: <one sentence>
 *        Fresh signals are passed in as context; the intel must cite them
 *        verbatim with date + URL, never invent.
 *
 *   3. DOC TYPE ROUTER
 *        Verdict + rejection_class → one of five doc generators:
 *          Accepted                         → pitch_full (the Appliance Direct template)
 *          Rejected.data_integrity          → enrichment (what's broken + flip conditions)
 *          Rejected.sub_icp_revenue         → park_warming (no-pitch warming touch + re-eval triggers)
 *          Rejected.wrong_vertical          → peer_referral (ask for intro to ICP-shaped peer)
 *          Rejected.wrong_contact_level     → up_org_referral (ask for intro up the org)
 *          Rejected.f500_oversize           → skip (one-line reason, no second pass, no critique)
 *          Rejected.no_pain_hook            → skip (same)
 *
 *        EVERY non-skip Rejected doc carries a "## Pain Points (likely)"
 *        section and a "## Messaging angles" section per Sarah's explicit
 *        2026-06-02 instruction — so even a Rejected doc has the
 *        intelligence layer her team can act on if the verdict gets
 *        manually overridden.
 *
 *   4. CRITIQUE PASS (Sonnet 4.5)
 *        Role-played as Pavan reading the draft in 5 seconds. Returns a
 *        ruthless numbered list of weaknesses (vague claims, generic
 *        phrases, missing "why now", banned-word slips, hallucinated
 *        metrics, etc.). Skipped for `skip`.
 *
 *   5. REWRITE PASS (Sonnet 4.5)
 *        Rewrites the doc to address every critique line. Same structure
 *        and section order as the draft. This is the final artifact.
 *        Skipped for `skip`.
 *
 * Every model call goes through `completeChat`/`searchSonar`, both of
 * which route through the single `OPENROUTER_API_KEY`. No other provider
 * is invoked from this file.
 */

import { Lead } from "@/lib/leads";
import { completeChat } from "./openrouter";
import {
  fetchSignalsForLead,
  renderSignalsBlock,
  Signal,
  SignalFetchResult,
} from "./signals";
import { Vertical } from "@/lib/vertical";

// ----------------------------- Shared context ------------------------------

const ZAPSIGHT_CONTEXT = `Zapsight is an AI services firm. We ship production AI in 12 weeks (not pilots, not strategy decks) to mid-market traditional businesses ($50M-$500M revenue) where AI pilots have stalled and the incumbent services partner cannot ship. One packaged offering: the AI Production Sprint — 2 weeks Discovery + 10 weeks Execution, fixed-fee $250K-$450K, one production-deployed outcome on a KPI the buyer's board already tracks.

Primary verticals (in priority order): 1) Third-Party Administrators (Health Benefits + Workers' Comp), 2) Mid-market Retail / Ecomm / Merchandising, 3) Adjacent insurance services + healthcare admin.

Buyers: CIO, COO, CDO, CFO, or VP-level operations leader. Sometimes founders/CEOs at family-owned mid-market firms. Almost never F500.

Voice: operators not commentators. Specific over abstract. Numbers, names, dates in every claim. Name what's hard. Founder-to-founder voice. Earned confidence, not performative.

Banned words: "digital transformation," "unlock value," "empower," "reimagine," "AI-powered," "end-to-end," "significantly," "meaningfully," "world-class."

Signature phrases: "Production AI in 12 weeks. Not a pilot. Not a strategy deck." · "Built by operators, not commentators." · "The pilot trap."

The senders are Sarah (sarah@zapsight.com — agent operator persona, marketing-ops) and Blake (relationship owner). BCC list on outbound mail: Pavan, Murtaza, Agrimika.`;

// ------------------------------ Types --------------------------------------

export type LeadVerdict = "Accepted" | "Rejected" | "Unknown";
export type VerdictConfidence = "High" | "Medium" | "Low" | "Unknown";

export type RejectionClass =
  | "data_integrity"
  | "sub_icp_revenue"
  | "wrong_vertical"
  | "wrong_contact_level"
  | "f500_oversize"
  | "no_pain_hook"
  | "none_accepted"
  | "unknown";

export type DocType =
  | "pitch_full"
  | "enrichment"
  | "park_warming"
  | "peer_referral"
  | "up_org_referral"
  | "skip";

export interface LeadGenerationResult {
  leadId: string;
  intelMarkdown: string;
  outreachMarkdown: string;
  /** The critique pass's findings — useful debugging context, included in the ZIP. */
  critiqueMarkdown: string;
  verdict: LeadVerdict;
  confidence: VerdictConfidence;
  rejectionClass: RejectionClass;
  mainReason: string;
  docType: DocType;
  vertical: Vertical;
  signals: Signal[];
  /** Per-stage latency for the row UI. */
  timings: {
    signals: number;
    intel: number;
    outreach: number;
    critique: number;
    rewrite: number;
    total: number;
  };
}

// ------------------------------ Intel pass ---------------------------------

function buildIntelSystemPrompt(): string {
  return `You are Zapsight's senior prospect-intelligence analyst. You produce dense, no-fluff intel briefs that a partner uses to write outbound to a specific human at a specific company.

${ZAPSIGHT_CONTEXT}

Hard rules:
- Numbers > adjectives. Names > vague references. Dates > "recently".
- The "Fresh signals" block in the user message contains web-search-verified items with dates and source URLs. Cite them VERBATIM (date + source) where relevant. If a signal type is marked "no public signal", say so plainly — do not infer or substitute.
- If you don't have grounded data on a point, write "no public signal" — never fabricate.
- No hedge filler ("it is worth noting", "in today's landscape", "importantly").
- Use plain Markdown. Tight headings, tight bullets, bolded key terms.

Output exactly these sections, in order:

## Company one-liner
One sentence: what the company does, where, since when. Mirror "Appliance Direct: Selling appliances in Central Florida since 1995."

## ICP match
One sentence: why THIS named contact (with this title and likely background) is or is not the right ICP for Zapsight's AI Production Sprint.

## Key insight on their needs
2-3 sentences: buying posture (budget posture, sophistication, AI maturity). End with the angle that works ("ROI / revenue-leakage" vs "operational efficiency" vs "compliance pressure" vs "post-M&A integration").

## What we want with them
One paragraph: target engagement shape (one big use case vs two small; Discovery+Execution split; which Zapsight motion most likely closes). If this lead is Rejected, write what would have to be true to flip them.

## Win mechanism
One phrase + one sentence explaining the unfair angle.

## Fresh signals (cited from web search)
Quote each fresh signal verbatim with its date and source URL. If "no public signal" for a type, say so. NEVER invent.

## Pain Points & Opportunities (Top 5)
Ranked, each: **Priority N: <Pain headline> = <Business consequence>**. Match the diagnostic-and-consequence style of "Weak E-commerce Intelligence = Lost Margin."

## Channel read
One line each on LinkedIn, Email, and any vertical-specific channel (e.g. trade-press for TPAs). Recommend the primary channel.

## Decision-maker map
- Named contact + 1-2 likely additional decision makers on the same buying committee.
- Note "company page is dormant, reach out personally" patterns when relevant.

## ZapIntel Verdict
Output exactly FOUR lines, in this order, at the very end of the brief. No other content after them.

Verdict: Accepted | Rejected
Confidence: High | Medium | Low
Rejection class: data_integrity | sub_icp_revenue | wrong_vertical | wrong_contact_level | f500_oversize | no_pain_hook | none_accepted
Main reason: <ONE sentence, under 22 words, the single most important reason behind the verdict>

Verdict criteria:
- Accepted = ICP fit (mid-market traditional business $50M-$500M revenue OR currently being absorbed into one via the fresh ownership-change signal), named contact is plausibly the buyer or a credible champion, vertical aligns with Zapsight's TPA / mid-market retail / insurance / healthcare admin / manufacturing / logistics focus or a credible adjacent, data is internally consistent, there is at least one real pain hook anchored in either the row or a fresh signal. When Accepted, set Rejection class = none_accepted. Geography (US vs Europe vs other) is NOT a disqualifier on its own — Zapsight's motion is global where the vertical and revenue band fit. Non-US leads in named verticals are Accepted; do not downgrade them to wrong_vertical because of location alone.
- Rejected.data_integrity = the lead row is contradictory or garbled (revenue/headcount mismatch, industry-vs-website mismatch, email-domain-vs-website mismatch, the named entity cannot be unambiguously identified).
- Rejected.sub_icp_revenue = company revenue is clearly below the $50M ICP floor AND no fresh ownership signal pulls it into an ICP-shaped parent.
- Rejected.wrong_vertical = company is in academia, non-profit, government, civic, religious, individual / solo services, or a vertical Zapsight has no pattern-match for — but the human is a credible professional who likely has ICP-shaped peers in their network.
- Rejected.wrong_contact_level = company itself IS ICP-shaped, but the named contact is too junior (IC, intern, individual member, community member) to be a buyer or champion.
- Rejected.f500_oversize = company revenue is clearly above $500M / F500 territory with internal AI capacity and Accenture/Deloitte-grade procurement — Zapsight motion does not fit and there is no salvage angle.
- Rejected.no_pain_hook = none of the above; we simply can't construct a credible AI Production Sprint pain.

Quality bar: a partner should be able to write the outbound or skip-decision directly from this brief without going back to do more research.`;
}

function buildIntelUserPrompt(lead: Lead, signalsResult: SignalFetchResult): string {
  const lines: string[] = [];
  lines.push("Produce the intel brief for the following lead.");
  lines.push("");
  lines.push("## Lead row");
  lines.push(`- Contact: **${lead.fullName}** — ${lead.title || "title unknown"}`);
  if (lead.seniority) lines.push(`- Seniority: ${lead.seniority}`);
  if (lead.department) lines.push(`- Department: ${lead.department}`);
  if (lead.email) lines.push(`- Email: ${lead.email}`);
  if (lead.linkedinUrl) lines.push(`- LinkedIn: ${lead.linkedinUrl}`);
  if (lead.contactCity || lead.contactState || lead.contactCountry) {
    lines.push(
      `- Contact location: ${[lead.contactCity, lead.contactState, lead.contactCountry]
        .filter(Boolean)
        .join(", ")}`,
    );
  }
  lines.push("");
  lines.push("## Company row");
  lines.push(`- Name: **${lead.companyName}**`);
  if (lead.companyWebsite) lines.push(`- Website: ${lead.companyWebsite}`);
  if (lead.companyIndustry) lines.push(`- Industry: ${lead.companyIndustry}`);
  if (lead.companyFoundedDate) lines.push(`- Founded: ${lead.companyFoundedDate}`);
  if (lead.companyCity || lead.companyState || lead.companyCountry) {
    lines.push(
      `- HQ: ${[lead.companyCity, lead.companyState, lead.companyCountry]
        .filter(Boolean)
        .join(", ")}`,
    );
  }
  if (lead.companyRevenueRange) lines.push(`- Revenue range: ${lead.companyRevenueRange}`);
  if (lead.companyStaffRange || lead.companyStaffCount) {
    lines.push(
      `- Staff: ${lead.companyStaffRange || ""}${
        lead.companyStaffCount ? ` (${lead.companyStaffCount} headcount)` : ""
      }`,
    );
  }
  if (lead.companyLinkedinUrl) lines.push(`- Company LinkedIn: ${lead.companyLinkedinUrl}`);
  if (lead.companyDescription) {
    lines.push("");
    lines.push("### Company description (as in the source system)");
    lines.push(lead.companyDescription.slice(0, 2400));
  }
  lines.push("");
  lines.push("## Fresh signals (web search)");
  lines.push(renderSignalsBlock(signalsResult));
  lines.push("");
  lines.push(
    `Anchor every claim to this row + the fresh signals above + plausible inference from the website, LinkedIn profiles, and industry. Where you have nothing, write "no public signal".`,
  );
  return lines.join("\n");
}

// --------------------------- Verdict parsing -------------------------------

export function extractVerdict(intelMarkdown: string): {
  verdict: LeadVerdict;
  confidence: VerdictConfidence;
  rejectionClass: RejectionClass;
  mainReason: string;
} {
  const text = intelMarkdown.replace(/\*\*/g, "");
  const verdictMatch = text.match(/Verdict\s*:\s*(Accepted|Rejected|Reject|Accept)\b/i);
  const confidenceMatch = text.match(/Confidence\s*:\s*(High|Medium|Low)\b/i);
  const classMatch = text.match(
    /Rejection\s*class\s*:\s*(data_integrity|sub_icp_revenue|wrong_vertical|wrong_contact_level|f500_oversize|no_pain_hook|none_accepted)\b/i,
  );
  const reasonMatch = text.match(/(?:Main\s+reason|Reason)\s*:\s*([^\n]+)/i);

  let verdict: LeadVerdict = "Unknown";
  if (verdictMatch) {
    verdict = verdictMatch[1].toLowerCase().startsWith("accept") ? "Accepted" : "Rejected";
  }
  let confidence: VerdictConfidence = "Unknown";
  if (confidenceMatch) {
    const c = confidenceMatch[1];
    confidence = (c[0].toUpperCase() + c.slice(1).toLowerCase()) as VerdictConfidence;
  }
  let rejectionClass: RejectionClass = "unknown";
  if (classMatch) rejectionClass = classMatch[1].toLowerCase() as RejectionClass;
  else if (verdict === "Accepted") rejectionClass = "none_accepted";

  const mainReason = (reasonMatch?.[1] || "").trim().replace(/[.\s]+$/, "");
  return { verdict, confidence, rejectionClass, mainReason };
}

export function docTypeForVerdict(verdict: LeadVerdict, rc: RejectionClass): DocType {
  if (verdict === "Accepted") return "pitch_full";
  switch (rc) {
    case "data_integrity":
      return "enrichment";
    case "sub_icp_revenue":
      return "park_warming";
    case "wrong_vertical":
      return "peer_referral";
    case "wrong_contact_level":
      return "up_org_referral";
    case "f500_oversize":
    case "no_pain_hook":
      return "skip";
    default:
      // Unknown rejection class → treat as skip to avoid generating a bad doc.
      return verdict === "Rejected" ? "skip" : "pitch_full";
  }
}

// ------------------------ Doc-type system prompts --------------------------

const PITCH_FULL_PROMPT = `You are Zapsight's outbound-writing operator. You receive (a) a single lead row and (b) a focused intel brief on the lead's company that includes a "Fresh signals (cited from web search)" section. You output one Markdown document in the EXACT format Sarah uses by hand — the "Appliance Direct / Tom Mott / Blake" outreach doc.

${ZAPSIGHT_CONTEXT}

This is for an Accepted lead — full sales motion.

REQUIRED FORMAT — emit EXACTLY these sections, in this order. Where the intel brief carries a fresh signal with a date + URL, weave it into the hook, subject line, and email body — that is the "why now."

# <Company Name>: <one-line company description from intel>

**ICP match —** <First> <Last>, <one-sentence why they fit, anchored on the fresh signals or row evidence>.

**Key Insight on their needs:** <one tight paragraph from intel>.

**What we want with <Company Name>:** <one tight paragraph from intel>.

**Win mechanism:** <phrase>
<company website URL>

**Intel Report:** _(generated alongside this outreach doc — see the same ZIP)_

**Fresh signals used:** <bullet 1-3 of the fresh signals you cited in this doc, each with its date and source domain, or "no fresh signals — pitch grounded on row only".>

## Pain Points & Opportunities

Priority 1: <copy from intel>
Priority 2: <copy from intel>
Priority 3: <copy from intel>
Priority 4: <copy from intel>
Priority 5: <copy from intel>

## Channels: LinkedIn, Facebook & Mail

<One short paragraph: how the named contact should be approached. Reference the Channel read from intel. If company page is dormant, use the verbatim "[Sender] DMs might not get a response (company page is not active), so they reach out personally:" line.>

### LinkedIn DM (Blake → <First>)

> Hi <First>! I hope you've been doing great. It has been a pleasure connecting with you.
>
> <2 paragraphs of a real LinkedIn DM in Zapsight voice. Reference 1-2 specific items from the fresh signals or row about THEIR company. Land on the AI Production Sprint shape (2-week discovery + 10-week execution). End "Happy to share the specific gaps we mapped if it's relevant on your side.">

### Phone numbers on file

| Contact Phone 1 | Company Phone 1 | Contact Phone 2 | Company Phone 2 |
| --- | --- | --- | --- |
| <from lead row> | <from lead row> | <from lead row or blank> | <from lead row or blank> |

### Social signal

<One line: "<Channel>: <follower count if known or 'no public signal'>. Posts <cadence if known or 'no public signal'>.">

## Mail (Touchpoint 1)

**Sender:** Blake
**To:** <First> <Last>, <Title>: <email from lead row>
**BCC:** Pavan, Murtaza, Agrimika

**Hook (a Zapsight LinkedIn post will also be made using this):** <one-line hook anchored on the strongest fresh signal OR the #1 pain.>

**Subject:** <8-12 word subject line, specific to this company. Match the style of "Found 2 revenue leaks worth fixing at Appliance Direct". NO emojis.>

**Mail:**

Hi <First>,

<Opening paragraph (one sentence) tying to a specific fresh signal if one exists, else to a specific row fact.>

A few things stood out immediately:
- <Observation 1, from intel/signals, framed as a fixable problem>
- <Observation 2, from intel/signals, framed as a fixable problem>
- <Observation 3, from intel/signals, framed as a fixable problem>

<One-line synthesis, e.g. "All of these are margin-leakage problems." — match the angle from intel.>

The reason I'm reaching out: this is exactly the kind of operational AI work we execute at Zapsight — focused on measurable lift, not experimentation theater.

Two areas specifically looked high-impact for <Company Name>:

• **<Opportunity 1 headline>**
(<one-line, concrete description of what we'd do>)

• **<Opportunity 2 headline>**
(<one-line, concrete description>)

Not a transformation initiative. A focused build with measurable outcomes and reduced costs.

**CTA:** Happy to share the exact gaps we mapped and how we'd approach them practically. Worth a 30 minute conversation?
Know more about similar solutions we have worked on at zapsight.com/<vertical-slug>

**Attachment:** None for touchpoint 1.

## Touchpoint 2 (7th day)

**Reminder mail:**

Hi <First>,

Quick follow-up — I still think there's a strong operational AI opportunity at <Company>, especially around <top-pain phrase> and <opportunity phrase>.

Happy to share the exact use cases we mapped if useful.

Worth a quick conversation?

**Attachment:** Corporate deck (standard), <Vertical> one-pager (specifically made).

## Sample mail for a competitor of <Company Name>

**Subject:** <competitor-style subject. NO emojis.>

Hey <First>,

<3-4 sentences: the same problem framed for a competitor in the same category. Reference a Zapsight-shaped pattern win generically ("a similar mid-market TPA", "a comparable retailer") — do not invent specific named clients or fabricated metrics. End with the offer shape: "For <Company>: <scope>, <fixed fee>, <timeline>, you own the system."

Worth 20 minutes Tuesday or Wednesday?

Blake / Sarah
Zapsight

---

Final discipline:
- NEVER use a banned word ("digital transformation", "unlock value", "empower", "reimagine", "AI-powered", "end-to-end", "significantly", "meaningfully", "world-class").
- NEVER invent metrics, dollar figures, or named past clients that aren't in the lead row, intel brief, or fresh signals.
- NEVER use emojis.
- Output ONLY the Markdown document. No preface.`;

const SHARED_REJECTED_TAIL = `

## Pain Points (likely, for context)

A ranked list of the 3-5 likely operational pains for this company / vertical based on the row + fresh signals. Even though we are not pitching now, this is the intelligence layer Sarah's team uses if the verdict gets manually overridden or if a similar lead lands later. Each entry uses the diagnostic-and-consequence style: **<Pain headline> = <Business consequence>**.

## Messaging angles (if Zapsight ever pitches this exact lead)

3-4 specific angles a Zapsight AE could lead with IF this lead became a fit (e.g. the company grows past $50M, a parent buys them, the contact rotates into an ICP-shaped role). Each angle: a single sentence in Zapsight voice that says the wedge offer + the specific pain. NO banned words. NO fabricated metrics.

---

Final discipline:
- NEVER use a banned word ("digital transformation", "unlock value", "empower", "reimagine", "AI-powered", "end-to-end", "significantly", "meaningfully", "world-class").
- NEVER invent metrics, dollar figures, or named past clients.
- NEVER use emojis.
- Output ONLY the Markdown document. No preface.`;

const ENRICHMENT_PROMPT = `You are Zapsight's RevOps analyst. You receive (a) a single lead row and (b) an intel brief whose Verdict is **Rejected — data_integrity**. The lead row is internally contradictory or garbled and we cannot tell who the company actually is.

${ZAPSIGHT_CONTEXT}

You output a Markdown "Enrichment worksheet" — what's broken in the row, what fields would have to be re-pulled to flip the verdict to Accepted, and the likely operational pains if the company turns out to be real.

REQUIRED FORMAT — emit exactly these sections, in this order.

# <Company Name as in row> — REJECTED · Needs enrichment

**Status:** Rejected for data-integrity issues. Do not contact until the row is re-enriched.

**Named contact:** <First> <Last> — <Title>
**Email on file:** <email or "missing">
**LinkedIn on file:** <linkedin or "missing">

## What's broken in this row

A numbered list. Each item names the SPECIFIC contradiction (e.g. "Industry says 'Higher Education' but website autonomo.tech and description suggest a UK B2B tech firm", or "Revenue says $5M-$20M but Staff Count says 10,001+ — impossible together"). Be specific. Reference the fresh-signal context if it helped diagnose the issue.

## Fields to re-pull (in priority order)

A numbered list. Each item: the FIELD that needs re-pulling + the SOURCE to pull it from (e.g. "Company Industry — re-pull from the company website's About page", "Revenue Range — re-pull from Crunchbase or PitchBook", "Headcount — re-pull from LinkedIn Insights"). The order is what we'd verify first to disambiguate the row fastest.

## Conditions to flip to Accepted

A numbered list of the SPECIFIC field-value combinations that would flip this lead to Accepted in a future enrichment pass. Example: "If Revenue resolves to $50M-$500M AND Industry resolves to TPA, retail, manufacturing, healthcare admin, or insurance services AND the website domain matches the contact's email domain — accept and route to standard outreach."${SHARED_REJECTED_TAIL}`;

const PARK_WARMING_PROMPT = `You are Zapsight's relationship operator. You receive (a) a lead row and (b) an intel brief whose Verdict is **Rejected — sub_icp_revenue**. The company is too small for the AI Production Sprint today ($250K-$450K fixed-fee is uneconomic at their scale), but the contact is real, the company is in a credible vertical, and they may grow into ICP — or get rolled up into a Zapsight-shaped parent.

${ZAPSIGHT_CONTEXT}

You output a Markdown "Park and warm" document. NO pitch in this doc. The goal is to keep the relationship warm, give the AE a 12-month re-eval trigger list, and produce a soft warming-touch DM the contact can read without feeling sold to.

REQUIRED FORMAT — emit exactly these sections, in this order.

# <Company Name> — PARK · Sub-ICP revenue, re-eval in 12 months

**Status:** Below the $50M revenue ICP floor today. Park, watch, re-eval in 12 months or earlier on a trigger event.

**Named contact:** <First> <Last> — <Title>
**LinkedIn:** <linkedin or "missing">
**Company website:** <website>

## Why parked (one line)

<One sentence anchored on revenue band + vertical.>

## Re-eval triggers (the events that flip this to Accepted)

A numbered list, each item a CONCRETE event. Examples:
- "Revenue crosses $50M (track via LinkedIn Insights or Crunchbase update)."
- "Announcement of acquisition by a PE-backed parent or strategic acquirer."
- "Series B+ round or growth equity round above $20M."
- "Hiring an SVP/COO from a TPA, insurance, or mid-market retail background."
- "Public RFP win or major contract announcement that 2x's revenue."

Include one trigger anchored on the fresh signals or vertical if appropriate.

## LinkedIn warming-touch DM (Blake → <First>)

A 4-6 sentence DM in Zapsight voice. NO pitch. NO ask for a meeting. Acknowledge a specific recent thing about their company (from row + signals), say one operator-y line about a pattern Zapsight sees in their adjacent space, end with "happy to swap notes anytime — not selling anything, just like staying close to good operators." DO NOT mention $250K-$450K, the AI Production Sprint, or any commercial framing.

## Recommended cadence

One line: "Re-touch in <N> months unless a re-eval trigger fires sooner."${SHARED_REJECTED_TAIL}`;

const PEER_REFERRAL_PROMPT = `You are Zapsight's relationship operator. You receive (a) a lead row and (b) an intel brief whose Verdict is **Rejected — wrong_vertical**. The company is in a vertical Zapsight does not currently serve (academia, government, philanthropy, civic, religious, solo services, or another non-ICP space), but the human is a credible operator who likely has ICP-shaped peers in their network.

${ZAPSIGHT_CONTEXT}

You output a Markdown "Peer referral ask" document. The doc does not pitch this contact's own company. Instead it (1) explains why we are NOT pitching, respectfully, and (2) asks for warm introductions to ICP-shaped peers in their network.

REQUIRED FORMAT — emit exactly these sections, in this order.

# <Company Name> — REFERRAL · Wrong vertical, ask for peer intros

**Status:** Contact's own company is outside Zapsight's served verticals. Ask for warm intros to ICP-shaped peers in their network.

**Named contact:** <First> <Last> — <Title>
**LinkedIn:** <linkedin or "missing">

## Why we're not pitching their company (one line)

<One sentence: vertical mismatch, respectfully phrased.>

## Likely ICP-shaped peers in their network

A numbered list of 3-5 SPECIFIC peer profiles the contact likely knows or could introduce us to. Each entry: TITLE + VERTICAL + one sentence on why they're likely in this person's network (shared conference circuit, alumni network, previous employer, geographic cluster, board overlap). Example: "COO at a $100M-$300M TPA in the Southeast US — likely in their alumni network from <University> or shared SIIA conference circuit."

Use the fresh signals if they hint at network proximity.

## LinkedIn referral-ask DM (Blake → <First>)

A 5-7 sentence DM in Zapsight voice. Acknowledge the contact's work. Say one true operator-y thing about Zapsight's focus (TPAs / mid-market retail / insurance services). Make the ask specific: "if you happen to know an operator at a $50M-$500M [TPA / regional retailer / insurance services firm] who's wrestling with [specific operational pain], I'd love a warm intro." End with a real offer — "happy to share what we've learned across the space in return."

## Email referral ask (alternative to the DM)

**Sender:** Blake
**To:** <First> <Last>: <email from lead row>
**BCC:** Pavan, Murtaza, Agrimika

**Subject:** <8-12 word subject line that frames this as a peer ask, NOT a pitch.>

A 6-10 line email in Zapsight voice. Same structure as the DM — acknowledge, frame Zapsight's focus, ask for an ICP-shaped intro, offer something in return. End with Blake / Sarah / Zapsight.${SHARED_REJECTED_TAIL}`;

const UP_ORG_REFERRAL_PROMPT = `You are Zapsight's relationship operator. You receive (a) a lead row and (b) an intel brief whose Verdict is **Rejected — wrong_contact_level**. The COMPANY is ICP-shaped — right vertical, right revenue band — but the named contact is too junior (IC, intern, community member, individual member, board observer) to be a buyer or champion.

${ZAPSIGHT_CONTEXT}

You output a Markdown "Up-the-org referral ask" document. The goal is to use this contact as a path INTO the right buyer at the same company, without burning the relationship.

REQUIRED FORMAT — emit exactly these sections, in this order.

# <Company Name> — REFERRAL · Wrong contact level, ask for intro up the org

**Status:** Company is ICP. Named contact is too junior to be the buyer. Use as a path to the real decision-maker.

**Named contact:** <First> <Last> — <Title>
**LinkedIn:** <linkedin or "missing">

## Who the real buyer probably is

A numbered list of 1-3 likely buying-committee titles AT THIS company (be specific to the vertical and signals): e.g. "COO", "CIO", "VP of Claims Operations", "Chief Underwriting Officer". For each, write one sentence on why they're the right buyer for the AI Production Sprint at this company specifically. Use the fresh signals to name a NAMED exec if one came up (e.g. a recently-rotated COO from the ops_leadership_rotation signal).

## LinkedIn intro-ask DM (Blake → <First>)

A 5-7 sentence DM in Zapsight voice. Acknowledge the contact's role on the team. Say one true operator-y thing about why Zapsight thinks <Company> has a specific operational opportunity (anchor on row + fresh signals). Make the ask specific: "if you're up for it, I'd love an intro to <name or title> — I think the 12-week AI Production Sprint we run could be relevant to the <specific pain> at <Company>." Offer something in return: a one-pager, a quick walkthrough they can forward, etc.

## Email intro ask (alternative to the DM)

**Sender:** Blake
**To:** <First> <Last>: <email from lead row>
**BCC:** Pavan, Murtaza, Agrimika

**Subject:** <8-12 word subject framing this as a friendly intro ask, NOT a cold pitch.>

A 6-10 line email in Zapsight voice. Same structure as the DM, with a forwardable one-paragraph summary the contact can paste to the real buyer if they don't want to do a live intro. End with Blake / Sarah / Zapsight.${SHARED_REJECTED_TAIL}`;

const SKIP_PROMPT = `You are Zapsight's RevOps analyst. You receive a lead row and an intel brief whose Verdict is **Rejected** with rejection_class = f500_oversize OR no_pain_hook.

${ZAPSIGHT_CONTEXT}

You output a single short Markdown skip note. NO pitch. NO pain points. NO messaging angles. Just the reason and a one-line note for the AE.

REQUIRED FORMAT — exactly:

# <Company Name> — SKIP

**Named contact:** <First> <Last> — <Title>
**Email on file:** <email or "missing">
**Status:** Rejected. Do not contact.

**Reason:** <one tight sentence — verbatim or near-verbatim from the intel brief's Main reason line.>

**AE note:** <one sentence: what would have to change for this lead to ever come back into scope. If nothing realistic would change it, write "Permanent skip.">

Output ONLY the Markdown above. No preface, no extra sections.`;

function systemPromptForDocType(t: DocType): string {
  switch (t) {
    case "pitch_full":
      return PITCH_FULL_PROMPT;
    case "enrichment":
      return ENRICHMENT_PROMPT;
    case "park_warming":
      return PARK_WARMING_PROMPT;
    case "peer_referral":
      return PEER_REFERRAL_PROMPT;
    case "up_org_referral":
      return UP_ORG_REFERRAL_PROMPT;
    case "skip":
      return SKIP_PROMPT;
  }
}

// ------------------------ Outreach user prompt -----------------------------

function buildOutreachUserPrompt(
  lead: Lead,
  intelBrief: string,
  docType: DocType,
): string {
  const lines: string[] = [];
  lines.push(
    `Write the **${docType}** document using the intel brief below. Follow the system-prompt template exactly.`,
  );
  lines.push("");
  lines.push("## Lead row (use these values verbatim where the template asks)");
  lines.push(`- Full name: ${lead.fullName}`);
  lines.push(`- First name: ${lead.firstName || lead.fullName.split(" ")[0]}`);
  lines.push(`- Last name: ${lead.lastName || lead.fullName.split(" ").slice(1).join(" ")}`);
  lines.push(`- Title: ${lead.title || "—"}`);
  lines.push(`- Email: ${lead.email || "—"}`);
  lines.push(`- LinkedIn: ${lead.linkedinUrl || "—"}`);
  lines.push(`- Contact Phone 1: ${lead.contactPhone || ""}`);
  lines.push(`- Contact Phone 2: ${lead.contactMobile || ""}`);
  lines.push(`- Company name: ${lead.companyName}`);
  lines.push(`- Company website: ${lead.companyWebsite || "—"}`);
  lines.push(`- Company industry: ${lead.companyIndustry || "—"}`);
  lines.push(
    `- Company HQ: ${[lead.companyCity, lead.companyState, lead.companyCountry]
      .filter(Boolean)
      .join(", ") || "—"}`,
  );
  lines.push(`- Company Phone 1: ${lead.companyPhone || ""}`);
  lines.push("");
  lines.push("## Intel brief");
  lines.push(intelBrief.trim());
  lines.push("");
  lines.push("Now produce the Markdown document. Output the Markdown only.");
  return lines.join("\n");
}

// ----------------------- Critique + rewrite passes -------------------------

const CRITIQUE_SYSTEM = `You are Pavan, co-founder and revenue/strategy lead at Zapsight (McKinsey, Mu Sigma, INSEAD background). A team member has handed you the outreach Markdown for a specific lead. You have 30 seconds to read it before deciding whether to send it.

You are ruthless. Operators-not-commentators voice. Specific over abstract. Numbers > adjectives.

Output a numbered list of critique points. Each numbered point is ONE concrete weakness in the doc. Examples of the kinds of weakness you call out:

- Vague claims ("operational efficiency" without naming the specific KPI)
- Generic phrases that don't tie to this company
- Missing or weak "why now" (the doc could have been written 12 months ago)
- Banned words used ("digital transformation," "unlock value," "empower," "reimagine," "AI-powered," "end-to-end," "significantly," "meaningfully," "world-class")
- Hallucinated metrics or named past clients (any dollar figure or named client not in the source row/signals is a hallucination — flag it)
- Subject lines that are 12+ words or have emojis or clickbait
- Pitch that doesn't match the AI Production Sprint shape (2-week discovery + 10-week execution, $250K-$450K)
- Wrong tone for the doc type (e.g. a referral-ask doc that accidentally pitches)
- For Rejected-type docs: weak or generic content within the Pain Points or Messaging sections (sharpen them, do NOT recommend deletion)

HARD RULES — these override every other instruction:

- The Pain Points and Messaging sections are **MANDATORY** on every non-skip Rejected doc (enrichment, park_warming, peer_referral, up_org_referral). They are required by the product owner (Sarah). NEVER critique them as "unnecessary," "wasted effort," "not needed for this doc type," or "should be deleted." Only critique their CONTENT (too generic, hallucinated metrics, missing specific vertical pains, etc.) and the rewrite must preserve them.
- Do not recommend dropping any section the system-prompt template requires. Only recommend tightening, sharpening, or replacing the CONTENT within sections.

If the doc is genuinely strong on a dimension, don't fake a critique. Output only real issues. Maximum 10 numbered points. Minimum 3 (any doc has at least 3 things to tighten).

Do NOT rewrite the doc. Do NOT add a summary. Just the numbered critique list.`;

function buildCritiqueUserPrompt(
  lead: Lead,
  docType: DocType,
  outreachDraft: string,
): string {
  return `Doc type: **${docType}**
Lead: ${lead.fullName} (${lead.title || "—"}) at ${lead.companyName}

---

# DRAFT TO CRITIQUE

${outreachDraft.trim()}

---

Output: ruthless numbered critique list, ${docType === "skip" ? "1-3 points" : "3-10 points"}. No rewrite. No summary.`;
}

const REWRITE_SYSTEM = `You are Zapsight's outbound writer. You receive (a) the original draft outreach doc, (b) a ruthless numbered critique list from Pavan, and (c) the lead row + intel brief.

Your job: rewrite the doc to address EVERY critique point. Same structure, same section order, same template. Tighter, sharper, more specific, no banned words, no hallucinated metrics or named past clients.

HARD RULES — these override every critique point:

- PRESERVE every section that exists in the original draft. The section count and order of the rewrite must match the draft. If a critique point recommends dropping a section, IGNORE that part of the critique — sharpen the content instead.
- On every non-skip Rejected doc (enrichment, park_warming, peer_referral, up_org_referral), the "## Pain Points (likely, for context)" section and the "## Messaging angles" section are MANDATORY. They must appear in the rewrite, in that order, even if a critique called them unnecessary. The rewrite improves their CONTENT (more specific, vertical-correct, no banned words, no hallucinated metrics) — it does not delete them.
- The "## Pain Points (likely, for context)" section must contain a ranked list of 3-5 pains in the diagnostic-and-consequence format ("<Pain headline> = <Business consequence>").
- The "## Messaging angles" section must contain 3-4 specific angles in Zapsight voice — no banned words, no fabricated metrics.

Output ONLY the rewritten Markdown document. No preface, no explanation, no summary of changes. The rewritten doc IS the final artifact.`;

function buildRewriteUserPrompt(
  lead: Lead,
  docType: DocType,
  outreachDraft: string,
  critique: string,
  intelBrief: string,
): string {
  const lines: string[] = [];
  lines.push(`Doc type: **${docType}**`);
  lines.push(`Lead: ${lead.fullName} (${lead.title || "—"}) at ${lead.companyName}`);
  lines.push("");
  lines.push("## Original draft");
  lines.push(outreachDraft.trim());
  lines.push("");
  lines.push("## Pavan's critique (address every point)");
  lines.push(critique.trim());
  lines.push("");
  lines.push("## Source intel brief (anchor on this — do not invent past this)");
  lines.push(intelBrief.trim());
  lines.push("");
  lines.push("Output the rewritten Markdown document. Only the document.");
  return lines.join("\n");
}

// ---------------- Safety net: enforce mandatory tail sections --------------

/**
 * Pull a Markdown section starting at a heading like "## Pain Points (likely,
 * for context)" or "## Messaging angles" and ending at the next H2/H1 or
 * end of document. Returns null if not found.
 */
function sliceSection(md: string, headingRegex: RegExp): string | null {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRegex.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (/^#{1,2}\s/.test(lines[j])) {
      end = j;
      break;
    }
    if (/^---\s*$/.test(lines[j])) {
      end = j;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

const PAIN_HEADING = /^##\s*Pain Points(\s*\(.*\))?\s*$/i;
const MESSAGING_HEADING = /^##\s*Messaging angles(\s*\(.*\))?\s*$/i;

function enforceRejectedTail(rewritten: string, draft: string): string {
  const hasPain = PAIN_HEADING.test(rewritten) || /## Pain Points/i.test(rewritten);
  const hasMessaging =
    MESSAGING_HEADING.test(rewritten) || /## Messaging angles/i.test(rewritten);

  if (hasPain && hasMessaging) return rewritten;

  const draftPain = sliceSection(draft, PAIN_HEADING);
  const draftMessaging = sliceSection(draft, MESSAGING_HEADING);

  let out = rewritten.trimEnd();
  // Drop a trailing horizontal-rule that some rewrites add as a sign-off.
  out = out.replace(/\n+---\s*$/, "");

  if (!hasPain && draftPain) {
    out += "\n\n" + draftPain;
  }
  if (!hasMessaging && draftMessaging) {
    out += "\n\n" + draftMessaging;
  }
  // If we had to splice anything in, add the discipline rule from the draft
  // back so the doc closes the way the template specifies.
  if ((!hasPain && draftPain) || (!hasMessaging && draftMessaging)) {
    out += "\n";
  }
  return out;
}

// ------------------------- Orchestration -----------------------------------

/** Options on the per-lead generator. */
export interface GenerationOpts {
  /** Toggle from the upload form. Default true. */
  deepMode?: boolean;
}

export async function generateLeadOutreach(
  lead: Lead,
  opts: GenerationOpts = {},
): Promise<LeadGenerationResult> {
  const tTotal0 = Date.now();

  // --- 1. Signal fetch (parallel, vertical-gated) -----------------------
  const signalsResult = await fetchSignalsForLead(lead, {
    deepMode: opts.deepMode,
  });

  // --- 2. Intel pass ----------------------------------------------------
  const tIntel0 = Date.now();
  const intelMarkdown = await completeChat(
    [
      { role: "system", content: buildIntelSystemPrompt() },
      { role: "user", content: buildIntelUserPrompt(lead, signalsResult) },
    ],
    { maxTokens: 2400, temperature: 0.35 },
  );
  const intelMs = Date.now() - tIntel0;
  if (!intelMarkdown.trim()) throw new Error("Intel pass returned empty output.");

  const { verdict, confidence, rejectionClass, mainReason } = extractVerdict(intelMarkdown);
  const docType = docTypeForVerdict(verdict, rejectionClass);

  // --- 3. Outreach pass (doc-type-aware) --------------------------------
  const tOut0 = Date.now();
  const outreachDraft = await completeChat(
    [
      { role: "system", content: systemPromptForDocType(docType) },
      { role: "user", content: buildOutreachUserPrompt(lead, intelMarkdown, docType) },
    ],
    { maxTokens: docType === "skip" ? 600 : 2800, temperature: 0.4 },
  );
  const outMs = Date.now() - tOut0;
  if (!outreachDraft.trim()) throw new Error("Outreach pass returned empty output.");

  // --- 4. + 5. Critique + Rewrite (skipped for `skip`) ------------------
  let critique = "";
  let rewritten = outreachDraft;
  let critiqueMs = 0;
  let rewriteMs = 0;

  if (docType !== "skip") {
    const tCrit0 = Date.now();
    critique = await completeChat(
      [
        { role: "system", content: CRITIQUE_SYSTEM },
        { role: "user", content: buildCritiqueUserPrompt(lead, docType, outreachDraft) },
      ],
      { maxTokens: 900, temperature: 0.3 },
    );
    critiqueMs = Date.now() - tCrit0;

    const tRw0 = Date.now();
    rewritten = await completeChat(
      [
        { role: "system", content: REWRITE_SYSTEM },
        {
          role: "user",
          content: buildRewriteUserPrompt(
            lead,
            docType,
            outreachDraft,
            critique,
            intelMarkdown,
          ),
        },
      ],
      { maxTokens: 2800, temperature: 0.4 },
    );
    rewriteMs = Date.now() - tRw0;
    if (!rewritten.trim()) {
      // Fall back to the draft if the rewrite came back empty.
      rewritten = outreachDraft;
    }

    // Safety net: if the rewrite dropped a mandatory Rejected-doc section
    // despite the prompt's hard rules, splice the original section from
    // the draft so the contract with Sarah holds even on a noncompliant
    // rewrite. We only do this for non-pitch_full Rejected doc types.
    const isRejectedNonSkip =
      docType === "enrichment" ||
      docType === "park_warming" ||
      docType === "peer_referral" ||
      docType === "up_org_referral";
    if (isRejectedNonSkip) {
      rewritten = enforceRejectedTail(rewritten, outreachDraft);
    }
  }

  return {
    leadId: lead.id,
    intelMarkdown,
    outreachMarkdown: rewritten,
    critiqueMarkdown: critique,
    verdict,
    confidence,
    rejectionClass,
    mainReason,
    docType,
    vertical: signalsResult.vertical,
    signals: signalsResult.signals,
    timings: {
      signals: signalsResult.durationMs,
      intel: intelMs,
      outreach: outMs,
      critique: critiqueMs,
      rewrite: rewriteMs,
      total: Date.now() - tTotal0,
    },
  };
}
