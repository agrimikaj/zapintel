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
 *        Verdict + rejection_class (+ vertical) → one of the doc generators:
 *          Accepted                         → pitch_full (the Appliance Direct template)
 *          Accepted + vertical=private_equity → pe_portfolio (portfolio value-creation play)
 *          Rejected.data_integrity          → enrichment (what's broken + flip conditions)
 *          Rejected.sub_icp_revenue         → park_warming (no-pitch warming touch + re-eval triggers)
 *          Rejected.wrong_vertical          → peer_referral (ask for intro to ICP-shaped peer)
 *          Rejected.wrong_contact_level     → up_org_referral (ask for intro up the org)
 *          Rejected.f500_oversize           → skip (one-line reason, no second pass, no critique)
 *          Rejected.no_pain_hook            → skip (same)
 *
 *        Note: board directors / non-exec directors / investors / advisors at
 *        an ICP-shaped company are NOT wrong_contact_level — they carry
 *        influence and route to the operating buyer, so they are Accepted
 *        (pitch_full), not bounced up the org.
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
import { getBrain } from "@/lib/brain/client";
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

// -------------------- Founder voice for LinkedIn DMs -----------------------
//
// LinkedIn DMs do NOT go out from Blake/Sarah — they go out from a founder,
// in the founder's own voice, because the warmest bridge to a prospect is the
// founder's real background (shared school, ex-employer, geography). These are
// the real personas and the studied pattern from Pavan's/Murtaza's hand-sent
// DMs. Encoded so the generator stops producing generic "pleasure connecting"
// boilerplate and respects LinkedIn's 300-char connection-request cap.

const FOUNDER_BIOS = `Founder senders (pick whichever background best bridges to THIS contact):
- **Pavan** (Pavan Sathiraju) — ex-McKinsey, New York office ~2011-2018; Mu Sigma; INSEAD. Co-founder, revenue & strategy. DEFAULT sender. Best bridge for finance/strategy/ops contacts, ex-consultants, INSEAD/McKinsey-adjacent people, search funds, PE-backed operators.
- **Murtaza** (Murtaza Bootwala) — Amazon, TrueLayer, PwC; IIT Bombay + INSEAD. Co-founder, product & tech. Best bridge for deeply technical / engineering-led / data-platform contacts.`;

const FOUNDER_DM_SPEC = `FOUNDER DM VOICE — how Pavan and Murtaza actually write LinkedIn DMs. Study the pattern; do NOT copy these verbatim.

Real openers they have sent:
- "Hi Sushant — how have you been, it's been a while since Northwestern. Congratulations (a bit late) on Third Wave Coffee — it's been my goto place when in India."
- "Hi Timothy — REP at INSEAD was one of the most thought-provoking courses I took, and a lot of INSEAD'ers are building their professional lives around it."
- "Hi Damien — I'm an ex-McKinsey consultant from the New York office (2011-2018). I cofounded an AI implementation company 2 years back with a friend from INSEAD, and recently came across your profile and the work you're doing."
- "Hi Olaf — I'm an ex-McKinsey consultant from the New York office. I cofounded an AI implementation company; we build and implement AI in companies' core workflows. Telematics is a tricky play — not easy to get AI embedded without heavy customization."

${FOUNDER_BIOS}

The pattern, in order:
1. PERSONAL ANCHOR FIRST. Open with a genuine shared thread when one is actually verifiable — same alma mater, same ex-employer, mutual geography, a named mutual connection, or honest affection for their product ("my goto place in India"). If there is NO verifiable shared thread, open with a short credibility bridge instead ("ex-McKinsey, New York office", "I built production systems at Amazon"). NEVER invent a shared school, employer, mutual contact, or visit. A fabricated anchor is worse than none.
2. ACKNOWLEDGE WHAT THEY BUILT — specifically, warmly, by name. A real, earned congratulations.
3. WHO WE ARE — light. "I cofounded an AI-services venture; we help mid-market enterprises implement AI in their core workflows." One line of modest proof with geography ("we work with a few retail operators, currently in the US", "already working with a couple of search funds in the UK and India"). Do not list the packaged offering.
4. VALUE = THEIR PROBLEMS, not our offering. Either (a) a short, plain list of problem-types we've actually solved for peers (staff training, spoilage, AI audits, demand planning) OR (b) 2-3 specific, HYPOTHESIS-FRAMED observations about where THEIR margin likely leaks ("pricing across a large SKU catalog likely still leans on manual competitor scraping while peers reprice hourly — that gap tends to cost 1-2 margin points"). Hypotheses must read as hypotheses ("likely", "probably", "tends to") and must never carry an invented dollar figure or a fabricated named client.
5. SOFT, LOW-COMMITMENT CTA. Curiosity, not a meeting demand: "would be great to connect and learn what you're running into as you scale", "happy to connect", "if you're open to it, a quick 4-6 week pilot can show value before any bigger commitment".
6. Sign with the founder's first name.

Hard voice rules for the DM:
- Plain, warm, founder-to-founder. Short sentences. Contractions. No marketing polish.
- BANNED in the DM (on top of the global banned-word list): "$250K", "$450K", any price, "AI Production Sprint", "2-week discovery", "10-week execution", "12 weeks", "measurable lift", "experimentation theater", "Worth a 30 minute conversation?", and every signature slogan ("Production AI in 12 weeks", "Not a pilot. Not a strategy deck.", "Built by operators, not commentators."). The DM opens a relationship; it does NOT pitch the packaged offering or quote a price. Save the Sprint shape and pricing for a later email touch.
- A soft "quick pilot" / "quick experimentation" entry ask IS allowed here — it is how the founders actually open doors. This 1:1 exception applies ONLY inside the DM, never in public copy.
- No emojis. No hard-sell bullet wall. At most one short cluster of 2-3 hypothesis lines, and only for a cold contact with no real shared anchor.

LinkedIn length reality — ALWAYS emit BOTH versions:
- CONNECTION REQUEST NOTE — HARD CAP 300 characters (LinkedIn truncates the note on a connection request to 300 chars for anyone who is not already a 1st-degree connection). One anchor + one value/curiosity line + a soft ask, signed. Count the characters. If it is over 300, cut words until it fits — a tight 270-char note beats a 320-char one that gets clipped mid-sentence. This is the version actually sent first to a cold contact.
- FIRST MESSAGE AFTER THEY ACCEPT (or InMail) — the fuller founder DM, ~80-130 words, following the pattern above. Used once connected.`;

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
  | "pe_portfolio"
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

## Outreach bridge
The single best personal anchor for a founder-to-founder LinkedIn DM. Look for a VERIFIABLE shared thread between this contact and a Zapsight founder (Pavan: ex-McKinsey New York 2011-2018, Mu Sigma, INSEAD · Murtaza: Amazon, TrueLayer, PwC, IIT Bombay, INSEAD): same alma mater, same ex-employer, mutual geography, a named mutual connection, or genuine product affinity. If one is verifiable from the row / fresh signals / public profile, name it precisely and say which founder it bridges to. If none is verifiable, write exactly: "no shared anchor — use credibility bridge (Pavan ex-McKinsey / Murtaza ex-Amazon) + a specific acknowledgment of their company." NEVER invent a shared school, employer, mutual contact, or meeting.

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
- Accepted = ICP fit on REVENUE BAND + a real pain hook + a contact who can buy, champion, or open the door. Specifically:
  - Revenue: mid-market traditional business roughly $50M-$500M revenue, OR currently being absorbed into one via a fresh ownership-change signal. This band is the primary gate.
  - Vertical is a PRIORITY/MESSAGING hint, NOT an accept/reject gate. Zapsight's three named verticals (TPA, mid-market retail, insurance / healthcare admin) are where we lead with the sharpest proof — but ANY mid-market traditional business with real operational complexity is a valid ICP. That explicitly includes manufacturing, logistics/distribution, financial services (banks, lenders, fintech, payments, wealth), healthcare providers, hospitality / food service / travel, construction / engineering, energy / utilities, real estate / property, business services, and other operations-heavy mid-market sectors. Do NOT reject a $50M-$500M operating company just because its industry string is not one of the three named verticals — Accept it and, in "Key insight" and "Win mechanism", route the messaging to the closest named-vertical proof or to a generic operations/margin angle.
  - Contact: plausibly the economic buyer (COO/CIO/CDO/CFO/VP Ops), a credible champion, OR a board director / non-executive director / chair / investor / advisor who can influence the decision and route us to the operating buyer. A board seat is AUTHORITY, not a disqualifier — accept these and, in the decision-maker map, name the operating buyer (COO/CIO/VP Ops) the board contact would sponsor us into.
  - Data is internally consistent and there is at least one real pain hook anchored in the row or a fresh signal.
  - Geography (US vs Europe vs other) is NOT a disqualifier on its own — Zapsight's motion is global where revenue band + operational complexity fit. Do not downgrade a non-US lead to wrong_vertical for location alone.
  - When Accepted, set Rejection class = none_accepted.
- Accepted (PE / investor — portfolio angle) = the contact is at a private equity, venture, growth-equity, family-office, or holding-company firm (titles like Partner, Operating Partner, Managing Director, Head of Portfolio Operations, Value Creation lead). ACCEPT these — they are one of our highest-leverage relationships because one operating partner is a door into the entire portfolio of $50M-$500M companies. Do NOT reject a PE/investor as wrong_vertical or wrong_contact_level. Set Verdict = Accepted, Rejection class = none_accepted. In "What we want" and "Win mechanism", frame the PORTFOLIO play: Zapsight as a repeatable AI value-creation lever deployed across portfolio companies, with the operating partner / value-creation lead as the buyer. (The downstream router sends PE leads to a portfolio-specific doc, so make the intel reflect the portfolio thesis, not a single-company pain list.)
- Rejected.data_integrity = the lead row is contradictory or garbled (revenue/headcount mismatch, industry-vs-website mismatch, email-domain-vs-website mismatch, the named entity cannot be unambiguously identified).
- Rejected.sub_icp_revenue = company revenue is clearly below the $50M ICP floor AND no fresh ownership signal pulls it into an ICP-shaped parent. (Does not apply to PE/investor contacts — judge those on the portfolio, not the firm's own revenue.)
- Rejected.wrong_vertical = use this ONLY when the organization is genuinely non-commercial or has no operational-AI workload to sprint on: academia / higher-ed, non-profit / philanthropy, government / public administration, civic, religious, or pure solo / individual services. A normal for-profit operating company in an "unusual" sector is NOT wrong_vertical — accept it on revenue-band grounds. When you do use wrong_vertical, the human is still a credible professional who likely has ICP-shaped peers in their network.
- Rejected.wrong_contact_level = company itself IS ICP-shaped, but the named contact is genuinely too junior to influence a buy — an individual contributor, intern, entry/mid-level specialist, community/individual member with no buying or board influence. NOTE: a board director, non-exec director, chair, founder, owner, investor, or any VP+/C-level/operating-leadership title is NOT too junior — those carry influence and must be Accepted, not classed here.
- Rejected.f500_oversize = company revenue is clearly above $500M / F500 territory with internal AI capacity and Accenture/Deloitte-grade procurement — Zapsight motion does not fit and there is no salvage angle. (A PE/investor contact is judged on portfolio companies, which are mid-market — do not f500-reject the investor just because the fund's AUM is large.)
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

export function docTypeForVerdict(
  verdict: LeadVerdict,
  rc: RejectionClass,
  vertical?: Vertical,
): DocType {
  if (verdict === "Accepted") {
    // A PE / investor lead is accepted, but the right artifact is the
    // portfolio value-creation play, not the single-company pitch.
    return vertical === "private_equity" ? "pe_portfolio" : "pitch_full";
  }
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

${FOUNDER_DM_SPEC}

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

### LinkedIn DM (founder → <First>)

This DM goes out from a FOUNDER, in the founder's own voice — NOT from Blake. Follow the FOUNDER DM VOICE spec above exactly. Use the intel brief's "## Outreach bridge" line to decide the anchor: lead with the verified shared thread if one exists, otherwise the credibility bridge + a specific acknowledgment of their company. Never invent a shared anchor.

**Sender:** <Pavan|Murtaza — whichever background bridges best; default Pavan>
**Bridge:** <the real shared anchor used, or "credibility bridge — no shared thread">

**Connection request note (sent first — HARD CAP 300 characters):**

> <one anchor + one value/curiosity line + soft ask, signed with the founder's first name. Count the characters and keep it at or under 300. No price, no "AI Production Sprint", no slogan.>

**(character count: <N>/300)**

**First message after they accept (or InMail):**

> <the fuller founder DM, ~80-130 words: anchor → specific congrats on what they built → light "I cofounded an AI-services venture, we help mid-market enterprises implement AI in core workflows" + one line of geo proof → 1-2 of THEIR likely problems pulled from the fresh signals / pain points (hypothesis-framed, no invented metrics) → soft low-commitment CTA ("would be great to connect and learn what you're running into as you scale" — or a soft "quick 4-6 week pilot" ask) → signed first name. No price, no packaged-offering pitch, no slogan, no emojis.>

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

const PE_PORTFOLIO_PROMPT = `You are Zapsight's outbound-writing operator. You receive (a) a single lead row for a contact at a PRIVATE EQUITY / venture / growth-equity / family-office / holding-company firm and (b) a focused intel brief that includes a "Fresh signals (cited from web search)" section. The contact is an investor or operating-side leader (Partner, Operating Partner, Managing Director, Head of Portfolio Operations, Value Creation lead). This is an Accepted lead — but the play is NOT to sell the AI Production Sprint to the FUND. It is to position Zapsight as a repeatable AI value-creation lever deployed ACROSS the fund's portfolio of $50M-$500M companies, with the operating partner as the buyer.

${ZAPSIGHT_CONTEXT}

${FOUNDER_DM_SPEC}

Mental model for this doc: one operating partner is a door into 5-30 portfolio companies. We do not pitch the fund's own "operations." We give the operating partner a repeatable, low-risk way to ship production AI into portfolio companies and show value creation at the next board cycle. The wedge is one portfolio company; the prize is a portfolio-wide motion.

REQUIRED FORMAT — emit EXACTLY these sections, in this order. Where the intel brief carries a fresh signal with a date + URL (new fund close, new platform acquisition, new operating-partner hire), weave it into the hook and email body — that is the "why now."

# <Firm Name>: <one-line firm description from intel — strategy, check size, sectors, AUM if public>

**ICP match —** <First> <Last>, <one-sentence why this PE/operating contact is the right buyer for a portfolio value-creation motion, anchored on their role + the firm's sectors>.

**Portfolio thesis (why Zapsight fits this fund):** <one tight paragraph: where this fund's portfolio companies — given their sectors and size band — most plausibly leak margin or carry manual operational load that production AI fixes in 12 weeks. Tie to the named sectors the fund invests in.>

**What we want with <Firm Name>:** <one tight paragraph: land one portfolio company as a proof wedge (one production-deployed outcome on a KPI the portco's board tracks), then templatize across the portfolio. Name the buying motion: operating partner sponsors → portco COO/CIO executes.>

**Win mechanism:** <phrase>
<firm website URL>

**Intel Report:** _(generated alongside this outreach doc — see the same ZIP)_

**Fresh signals used:** <bullet 1-3 of the fresh signals you cited, each with its date and source domain, or "no fresh signals — pitch grounded on row only".>

## Portfolio fit map

A ranked list of 3-5 portfolio-company PROFILES (by sector + size band) inside this fund where an AI Production Sprint most plausibly lands first. Each entry: **<Sector / portco profile> = <the specific operational AI opportunity + the KPI it moves>**. If the intel brief names actual portfolio companies, use them; otherwise use sector profiles consistent with the fund's stated strategy. Do NOT invent specific named portfolio companies or fabricated metrics.

## Channels: LinkedIn & Mail

<One short paragraph: how this operating partner should be approached. Reference the Channel read from intel. Founder-to-investor is the warmest path — Pavan's ex-McKinsey / search-fund / PE-operator background bridges best here.>

### LinkedIn DM (founder → <First>)

This DM goes out from a FOUNDER, in the founder's own voice — NOT from Blake. Follow the FOUNDER DM VOICE spec above exactly. Use the intel brief's "## Outreach bridge" line for the anchor (Pavan is the DEFAULT sender for PE/operator/search-fund contacts). The DM opens a peer relationship and floats the portfolio angle softly — it does NOT quote a price or name the packaged offering.

**Sender:** <Pavan|Murtaza — default Pavan for PE/investor contacts>
**Bridge:** <the real shared anchor used, or "credibility bridge — no shared thread">

**Connection request note (sent first — HARD CAP 300 characters):**

> <one anchor + one portfolio-value-creation curiosity line + soft ask, signed with the founder's first name. At or under 300 chars. No price, no "AI Production Sprint", no slogan.>

**(character count: <N>/300)**

**First message after they accept (or InMail):**

> <the fuller founder DM, ~80-130 words: anchor → acknowledge the fund / a recent move (fresh signal) → light "I cofounded an AI-services venture; we help mid-market operators ship production AI into core workflows in ~12 weeks" + one line of geo/operator proof ("already working with a couple of search funds in the UK and India") → the portfolio angle, hypothesis-framed ("most funds your size have 2-3 portcos where claims/ops/pricing still runs manual — that's usually where a quick win lives") → soft low-commitment CTA ("happy to compare notes on where AI is actually moving the needle across portfolios — or run a quick pilot in one portco before any bigger commitment") → signed first name. No price, no packaged-offering name, no slogan, no emojis.>

### Phone numbers on file

| Contact Phone 1 | Company Phone 1 | Contact Phone 2 | Company Phone 2 |
| --- | --- | --- | --- |
| <from lead row> | <from lead row> | <from lead row or blank> | <from lead row or blank> |

## Mail (Touchpoint 1)

**Sender:** Blake
**To:** <First> <Last>, <Title>: <email from lead row>
**BCC:** Pavan, Murtaza, Agrimika

**Hook (a Zapsight LinkedIn post will also be made using this):** <one-line hook anchored on the strongest fresh signal OR the portfolio thesis.>

**Subject:** <8-12 word subject, specific to this fund and the portfolio-value-creation angle. NO emojis.>

**Mail:**

Hi <First>,

<Opening sentence tying to a specific fresh signal (new fund, new platform deal) if one exists, else to the fund's stated strategy.>

We help mid-market operators ship production AI on a board-level KPI in about 12 weeks — and the highest-leverage way we have found to do that is through the funds that own them.

For a portfolio like <Firm>'s, two patterns usually pay back fastest:

• **<Portfolio opportunity 1 headline>**
(<one-line, concrete description of the portco-level build and the KPI it moves>)

• **<Portfolio opportunity 2 headline>**
(<one-line, concrete description>)

The model is simple: pick one portfolio company, ship one production outcome in 12 weeks, then templatize what works across the rest of the portfolio. You get a repeatable value-creation lever, not another stalled pilot.

**CTA:** Worth a 30-minute conversation on where this could land first across the portfolio?
Know more at zapsight.com.

**Attachment:** None for touchpoint 1.

## Touchpoint 2 (7th day)

**Reminder mail:**

Hi <First>,

Quick follow-up — I still think there's a strong portfolio value-creation angle for <Firm>, especially in <portco-profile phrase> around <opportunity phrase>.

Happy to share the exact portco patterns we'd start with.

Worth a quick conversation?

**Attachment:** Corporate deck (standard), portfolio value-creation one-pager.

## Sample note for a peer fund

**Subject:** <peer-fund-style subject. NO emojis.>

Hey <First>,

<3-4 sentences: the same portfolio value-creation framing for a comparable fund. Reference a Zapsight-shaped pattern generically ("a comparable lower-middle-market fund", "a similar operator-led PE shop") — do not invent specific named funds, portfolio companies, or fabricated metrics. End with the wedge shape: "Start in one portco: <scope>, <fixed fee>, 12 weeks, the portco owns the system."

Worth 20 minutes Tuesday or Wednesday?

Blake / Sarah
Zapsight

---

Final discipline:
- NEVER use a banned word ("digital transformation", "unlock value", "empower", "reimagine", "AI-powered", "end-to-end", "significantly", "meaningfully", "world-class").
- NEVER invent metrics, dollar figures, named portfolio companies, or named past clients that aren't in the lead row, intel brief, or fresh signals.
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

${FOUNDER_DM_SPEC}

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

## LinkedIn warming-touch DM (founder → <First>)

This goes out from a FOUNDER (default Pavan), in founder voice per the FOUNDER DM VOICE spec — NOT from Blake. NO pitch. NO meeting ask. Use the intel brief's "## Outreach bridge" for the anchor. Emit BOTH versions:

**Sender:** <Pavan|Murtaza>
**Bridge:** <real shared anchor, or "credibility bridge — no shared thread">

**Connection request note (sent first — HARD CAP 300 characters):**

> <anchor + one warm operator-y line acknowledging a specific recent thing about their company + "happy to swap notes anytime, not selling anything", signed. At or under 300 chars.>

**(character count: <N>/300)**

**First message after they accept (or InMail):**

> <4-6 sentence warming note: anchor → specific recent thing about their company (from row + signals) → one operator-y line about a pattern we see in their adjacent space → "happy to swap notes anytime — not selling anything, just like staying close to good operators." → signed first name. DO NOT mention any price, the AI Production Sprint, or any commercial framing.>

## Recommended cadence

One line: "Re-touch in <N> months unless a re-eval trigger fires sooner."${SHARED_REJECTED_TAIL}`;

const PEER_REFERRAL_PROMPT = `You are Zapsight's relationship operator. You receive (a) a lead row and (b) an intel brief whose Verdict is **Rejected — wrong_vertical**. The company is in a vertical Zapsight does not currently serve (academia, government, philanthropy, civic, religious, solo services, or another non-ICP space), but the human is a credible operator who likely has ICP-shaped peers in their network.

${ZAPSIGHT_CONTEXT}

${FOUNDER_DM_SPEC}

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

## LinkedIn referral-ask DM (founder → <First>)

This goes out from a FOUNDER (default Pavan), in founder voice per the FOUNDER DM VOICE spec — NOT from Blake. Use the intel brief's "## Outreach bridge" for the anchor. Emit BOTH versions:

**Sender:** <Pavan|Murtaza>
**Bridge:** <real shared anchor, or "credibility bridge — no shared thread">

**Connection request note (sent first — HARD CAP 300 characters):**

> <anchor + the specific peer ask ("if you know an operator at a $50M-$500M [TPA / regional retailer / insurance services firm] wrestling with [pain], I'd love a warm intro"), signed. At or under 300 chars.>

**(character count: <N>/300)**

**First message after they accept (or InMail):**

> <5-7 sentence referral ask: anchor → acknowledge the contact's work → one true operator-y line about Zapsight's focus (TPAs / mid-market retail / insurance services) → the specific ask above → a real offer in return ("happy to share what we've learned across the space"). Signed first name. No price, no slogan, no emojis.>

## Email referral ask (alternative to the DM)

**Sender:** Blake
**To:** <First> <Last>: <email from lead row>
**BCC:** Pavan, Murtaza, Agrimika

**Subject:** <8-12 word subject line that frames this as a peer ask, NOT a pitch.>

A 6-10 line email in Zapsight voice. Same structure as the DM — acknowledge, frame Zapsight's focus, ask for an ICP-shaped intro, offer something in return. End with Blake / Sarah / Zapsight.${SHARED_REJECTED_TAIL}`;

const UP_ORG_REFERRAL_PROMPT = `You are Zapsight's relationship operator. You receive (a) a lead row and (b) an intel brief whose Verdict is **Rejected — wrong_contact_level**. The COMPANY is ICP-shaped — right vertical, right revenue band — but the named contact is too junior (IC, intern, community member, individual member, board observer) to be a buyer or champion.

${ZAPSIGHT_CONTEXT}

${FOUNDER_DM_SPEC}

You output a Markdown "Up-the-org referral ask" document. The goal is to use this contact as a path INTO the right buyer at the same company, without burning the relationship.

REQUIRED FORMAT — emit exactly these sections, in this order.

# <Company Name> — REFERRAL · Wrong contact level, ask for intro up the org

**Status:** Company is ICP. Named contact is too junior to be the buyer. Use as a path to the real decision-maker.

**Named contact:** <First> <Last> — <Title>
**LinkedIn:** <linkedin or "missing">

## Who the real buyer probably is

A numbered list of 1-3 likely buying-committee titles AT THIS company (be specific to the vertical and signals): e.g. "COO", "CIO", "VP of Claims Operations", "Chief Underwriting Officer". For each, write one sentence on why they're the right buyer for the AI Production Sprint at this company specifically. Use the fresh signals to name a NAMED exec if one came up (e.g. a recently-rotated COO from the ops_leadership_rotation signal).

## LinkedIn intro-ask DM (founder → <First>)

This goes out from a FOUNDER (default Pavan), in founder voice per the FOUNDER DM VOICE spec — NOT from Blake. Use the intel brief's "## Outreach bridge" for the anchor. Emit BOTH versions:

**Sender:** <Pavan|Murtaza>
**Bridge:** <real shared anchor, or "credibility bridge — no shared thread">

**Connection request note (sent first — HARD CAP 300 characters):**

> <anchor + the specific intro ask ("if you're up for it, I'd love an intro to <name or title> — I think there's a real operational AI opportunity around <specific pain> at <Company>"), signed. At or under 300 chars. No price, no "AI Production Sprint".>

**(character count: <N>/300)**

**First message after they accept (or InMail):**

> <5-7 sentence intro ask: anchor → acknowledge the contact's role → one true operator-y line on why <Company> has a specific operational AI opportunity (anchor on row + fresh signals) → the specific intro ask above → offer something forwardable in return (a one-pager, a quick walkthrough). Signed first name. A soft "quick pilot" framing is fine; do NOT quote a price or name the packaged offering in the DM.>

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
    case "pe_portfolio":
      return PE_PORTFOLIO_PROMPT;
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

LinkedIn DM checks (these matter most — the DMs are what was previously weak):
- Connection request note OVER 300 characters. The note is sent to non-1st-degree contacts and LinkedIn truncates it at 300 chars. If the stated count is over 300, or the note visibly looks longer than ~300 chars, flag it and say roughly how much to cut.
- A DM that PITCHES the packaged offering — any price ("$250K", "$450K"), "AI Production Sprint", "2-week discovery", "10-week execution", "12 weeks", or any signature slogan. The DM opens a relationship; it must not quote price or name the offering. Flag every instance.
- A FABRICATED shared anchor — the DM claims a shared school, ex-employer, mutual connection, or visit that is NOT supported by the intel brief's "## Outreach bridge" line. This is the most dangerous failure; flag it hard and say to fall back to the credibility bridge.
- Generic corporate boilerplate instead of founder voice — "it has been a pleasure connecting", "I hope you've been doing great", "exactly the kind of operational AI work we execute", "measurable lift, not experimentation theater". Flag and demand the plain, warm, founder-to-founder rewrite.
- Missing personal anchor OR missing a specific, named acknowledgment of THEIR company — a DM that could have been sent to anyone.
- DM not signed by a founder first name (Pavan / Murtaza), or still attributed to Blake.

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

LinkedIn DM rules (preserve and enforce):
- Every LinkedIn DM section MUST keep BOTH versions: the **Connection request note** (hard cap 300 characters) and the **First message after they accept**, plus the **Sender:** and **Bridge:** lines. If the draft has them, the rewrite keeps them.
- The connection request note MUST be at or under 300 characters. If the draft's note is over 300, cut it down — a tight 270-char note beats a clipped 320-char one. Keep the "(character count: N/300)" line accurate to the rewritten note.
- DMs are founder-voiced and founder-signed (Pavan or Murtaza) — never Blake, never generic. Plain, warm, founder-to-founder. Strip any corporate boilerplate ("pleasure connecting", "measurable lift, not experimentation theater").
- DMs must NOT quote a price or name the packaged offering ("AI Production Sprint", "2-week discovery", "10-week execution", "12 weeks", any "$" figure) or any slogan. Move that to the email touch if it appeared in a DM.
- NEVER introduce a shared anchor (school, ex-employer, mutual contact, visit) that is not supported by the intel brief's "## Outreach bridge" line. If the draft fabricated one, replace it with the credibility bridge + a specific acknowledgment of their company.

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

/**
 * Phase 1 — the cheap, decision-grade pass: signal fetch + intel + verdict.
 *
 * This is the half of the pipeline a salesperson needs to decide whether a
 * lead is worth the expensive doc-generation passes. The intel brief it
 * returns already has the fresh signals cited verbatim inside it, so phase 2
 * (generateLeadDocs) can run off `intelMarkdown` alone — no signal refetch,
 * no intel recompute.
 */
export interface LeadVerdictResult {
  leadId: string;
  intelMarkdown: string;
  verdict: LeadVerdict;
  confidence: VerdictConfidence;
  rejectionClass: RejectionClass;
  mainReason: string;
  docType: DocType;
  vertical: Vertical;
  signals: Signal[];
  timings: {
    signals: number;
    intel: number;
    total: number;
  };
}

// --- Zapsight Brain: shared cross-agent memory ------------------------------
// Recall is best-effort and cached per warm instance so it adds ~one brain call
// per run, not per lead. No BRAIN_* env → getBrain() is null → these no-op and
// the pipeline runs exactly as before.
let _sharedKnowledge: { text: string; at: number } | null = null;
const SHARED_TTL_MS = 10 * 60 * 1000;

async function recallSharedKnowledge(): Promise<string> {
  const brain = getBrain();
  if (!brain) return "";
  if (_sharedKnowledge && Date.now() - _sharedKnowledge.at < SHARED_TTL_MS) {
    return _sharedKnowledge.text;
  }
  try {
    const { patterns } = await brain.patterns.recall({
      query: "Zapsight positioning, ICP, prospect qualification, and outreach voice rules",
      limit: 8,
    });
    const text = patterns.length
      ? "Shared Zapsight knowledge (from the agent brain — apply these):\n" +
        patterns.map((p) => `- ${p.statement}`).join("\n") +
        "\n\n"
      : "";
    _sharedKnowledge = { text, at: Date.now() };
    return text;
  } catch {
    return ""; // brain unreachable → proceed without it
  }
}

async function recordOutreachEvent(lead: Lead, docType: DocType): Promise<void> {
  const brain = getBrain();
  if (!brain) return;
  try {
    await brain.events.record({
      kind: "outreach.generated",
      payload: {
        company: lead.companyName,
        contact: lead.fullName,
        title: lead.title || undefined,
        docType,
      },
      tags: ["outreach", docType],
      embedText: `Outreach (${docType}) generated for ${lead.fullName} at ${lead.companyName}`,
    });
  } catch {
    /* non-fatal — recording a learning must never break generation */
  }
}

export async function generateLeadVerdict(
  lead: Lead,
  opts: GenerationOpts = {},
): Promise<LeadVerdictResult> {
  const tTotal0 = Date.now();

  // --- 1. Signal fetch (parallel, vertical-gated) -----------------------
  const signalsResult = await fetchSignalsForLead(lead, {
    deepMode: opts.deepMode,
  });

  // --- 2. Intel pass ----------------------------------------------------
  const tIntel0 = Date.now();
  const shared = await recallSharedKnowledge();
  const intelMarkdown = await completeChat(
    [
      { role: "system", content: shared + buildIntelSystemPrompt() },
      { role: "user", content: buildIntelUserPrompt(lead, signalsResult) },
    ],
    { maxTokens: 2400, temperature: 0.35 },
  );
  const intelMs = Date.now() - tIntel0;
  if (!intelMarkdown.trim()) throw new Error("Intel pass returned empty output.");

  const { verdict, confidence, rejectionClass, mainReason } = extractVerdict(intelMarkdown);
  const docType = docTypeForVerdict(verdict, rejectionClass, signalsResult.vertical);

  return {
    leadId: lead.id,
    intelMarkdown,
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
      total: Date.now() - tTotal0,
    },
  };
}

/**
 * Phase 2 — the expensive doc-generation pass: outreach + critique + rewrite.
 *
 * Driven entirely off the phase-1 intel brief + routed doc type, so it can be
 * invoked independently for whichever subset of leads the operator chose to
 * write up (e.g. accepted-only). Recomputes nothing from phase 1.
 */
export interface LeadDocsResult {
  leadId: string;
  outreachMarkdown: string;
  critiqueMarkdown: string;
  timings: {
    outreach: number;
    critique: number;
    rewrite: number;
    total: number;
  };
}

export async function generateLeadDocs(
  lead: Lead,
  intelMarkdown: string,
  docType: DocType,
): Promise<LeadDocsResult> {
  const tTotal0 = Date.now();
  if (!intelMarkdown.trim()) {
    throw new Error("generateLeadDocs requires a non-empty intel brief from phase 1.");
  }

  // --- 3. Outreach pass (doc-type-aware) --------------------------------
  const tOut0 = Date.now();
  const shared = await recallSharedKnowledge();
  const outreachDraft = await completeChat(
    [
      { role: "system", content: shared + systemPromptForDocType(docType) },
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

  // Record this generation into the brain so other agents (and future runs)
  // can recall what outreach we've produced. Best-effort, never blocks output.
  await recordOutreachEvent(lead, docType);

  return {
    leadId: lead.id,
    outreachMarkdown: rewritten,
    critiqueMarkdown: critique,
    timings: {
      outreach: outMs,
      critique: critiqueMs,
      rewrite: rewriteMs,
      total: Date.now() - tTotal0,
    },
  };
}

/**
 * Full pipeline in one call — phase 1 + phase 2 composed. Retained for the
 * one-shot /api/bulk/lead endpoint and any caller that wants the whole
 * treatment without orchestrating the two phases itself.
 */
export async function generateLeadOutreach(
  lead: Lead,
  opts: GenerationOpts = {},
): Promise<LeadGenerationResult> {
  const v = await generateLeadVerdict(lead, opts);
  const d = await generateLeadDocs(lead, v.intelMarkdown, v.docType);

  return {
    leadId: lead.id,
    intelMarkdown: v.intelMarkdown,
    outreachMarkdown: d.outreachMarkdown,
    critiqueMarkdown: d.critiqueMarkdown,
    verdict: v.verdict,
    confidence: v.confidence,
    rejectionClass: v.rejectionClass,
    mainReason: v.mainReason,
    docType: v.docType,
    vertical: v.vertical,
    signals: v.signals,
    timings: {
      signals: v.timings.signals,
      intel: v.timings.intel,
      outreach: d.timings.outreach,
      critique: d.timings.critique,
      rewrite: d.timings.rewrite,
      total: v.timings.total + d.timings.total,
    },
  };
}
