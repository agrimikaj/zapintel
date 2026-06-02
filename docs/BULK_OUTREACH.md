# Bulk Outreach Generator

Drop a CSV/XLSX of leads. Each row goes through a four-pass pipeline that
produces a **doc-type-appropriate** Markdown artifact (a sales pitch, an
enrichment worksheet, a warming note, a referral ask, or an honest skip
note). The download is a ZIP organized by doc type plus a one-page
founder-ready summary PDF.

The feature is built so that **every lead produces a useful artifact —
not just the Accepted ones.**

---

## Pipeline per lead

```
1. SIGNAL FETCH (parallel, vertical-gated)        — Perplexity Sonar Pro via OpenRouter
2. INTEL PASS                                     — Claude Sonnet 4.5 via OpenRouter
3. DOC-TYPE ROUTER                                — verdict + rejection class → 1 of 6
4. OUTREACH PASS (doc-type-aware system prompt)   — Claude Sonnet 4.5 via OpenRouter
5. CRITIQUE PASS ("Pavan reading in 30 seconds")  — Claude Sonnet 4.5 via OpenRouter
6. REWRITE PASS (addresses every critique)        — Claude Sonnet 4.5 via OpenRouter
```

Steps 5 and 6 are skipped for `skip` docs.

All six steps run through a **single OpenRouter API key**. Sonar is
accessed at the OpenRouter route `perplexity/sonar-pro` — no second
provider, no second bill.

## Doc-type taxonomy

The verdict block at the bottom of every intel brief carries a
`Rejection class` line. Verdict + class deterministically picks the doc
type the outreach pass writes.

| Verdict / class | Doc type | What it contains |
| --- | --- | --- |
| Accepted | `pitch_full` | Full Appliance Direct sales template (LinkedIn DM, Touchpoint 1 mail, Touchpoint 2 reminder, competitor sample mail) — anchored on the strongest fresh signal as the "why now" |
| Rejected · `data_integrity` | `enrichment` | What's broken in the row, fields to re-pull, conditions to flip to Yes, **likely pain points**, **messaging angles** |
| Rejected · `sub_icp_revenue` | `park_warming` | No-pitch warming-touch DM, re-eval triggers, recommended cadence, **likely pain points**, **messaging angles** |
| Rejected · `wrong_vertical` | `peer_referral` | Ask the contact for warm intros to ICP-shaped peers; DM + email versions, **likely pain points**, **messaging angles** |
| Rejected · `wrong_contact_level` | `up_org_referral` | Ask the contact to point us up the org to the real buyer; DM + email, **likely pain points**, **messaging angles** |
| Rejected · `f500_oversize` | `skip` | One-line reason, no body |
| Rejected · `no_pain_hook` | `skip` | One-line reason, no body |

**Every non-skip Rejected doc carries a "Pain Points (likely)" section
and a "Messaging angles" section** — Sarah's explicit requirement so
that if a verdict gets manually overridden later, the intelligence layer
is already in the doc.

## The five corrected signals

Web-search fetches are vertical-gated. The signals are tuned for
Zapsight's actual ICP (TPAs, insurance services, healthcare admin,
mid-market retail, manufacturing) — not retail-shaped instincts.

| Signal | Window | Where it actually moves the pitch |
| --- | --- | --- |
| **Ownership change** (M&A, PE buyout, recap) | 18 months | Budget moment + 90-day post-deal mandate — strongest signal across every Zapsight vertical. Also used to **flip false-negative verdicts** when a sub-ICP lead has just been absorbed into an ICP-shaped parent. |
| **Operational leadership rotation** (COO, CIO, VP Claims, VP Ops, CMO) | 9 months | New ops authority = AI roadmap gets rewritten. For `wrong_contact_level` rejects, the new exec is often the real buyer — referral doc names them. |
| **Systems migration / platform change** (EHR, claims platform, ERP, ecomm replatform) | 18 months | Concrete integration wedge; named in the email body. |
| **Restructuring / layoffs / cost takeout** | 12 months | Pitch flips from "growth AI" to "cost-takeout AI" when this signal is present. |
| **Regulatory or compliance event** (CMS, DOL, state DOI, ERISA, NCQA) | 12 months | TPA / insurance / health-admin only. Operational consequence drives the wedge. |

Three legacy retail/SaaS signals (`competitor_pricing`, `product_launch`,
`job_postings_ai`, `funding_standalone`) remain but only fire on
`retail` and `b2b_saas` vertical buckets.

## Vertical gate

`inferVertical(industry)` maps the lead's free-text `Company Industry`
field to a vertical bucket. The bucket determines which signals get
searched.

| Vertical | Signals fetched (default Lite mode) |
| --- | --- |
| `tpa` | ownership, ops leadership, systems migration, restructuring, regulatory |
| `insurance_services` | same as TPA |
| `healthcare_admin` | ownership, ops leadership, systems migration, regulatory |
| `retail` | ownership, ops leadership, competitor pricing, product launch, restructuring |
| `manufacturing` | ownership, ops leadership, systems migration, restructuring |
| `b2b_saas` | ownership, ops leadership, product launch, job postings, funding (standalone), restructuring |
| `logistics` | ownership, ops leadership, systems migration, restructuring |
| `professional_services` | ownership, ops leadership, restructuring |
| `unknown` | ownership, ops leadership, restructuring |
| `skip` | _no search fired at all; doc routes straight to a skip note_ |

`skip` matches academic, non-profit, religious, government, civic,
solo-services, freelance, and personal-services rows. Useful because
your historical CSVs always include a handful of these and the search
budget should not be wasted on them.

## Accuracy guardrails

Every signal that makes it into the brief has cleared **all** of these:

1. Returned with `published_date` (extracted from citation metadata or
   the answer text).
2. Returned with a working source URL.
3. The cited entity matches the lead's company (via website-domain
   substring match OR brand-name substring match in the answer text).
   Stops the Autonomo Technologies / Autonomo GmbH problem.
4. Per-type cap of 2 signals, total cap of 6 signals.
5. If no signal passes, the brief says `"no public signal in last
   <window>"` and the intel pass is explicitly told not to substitute.

## Critique-and-rewrite

The critique pass role-plays Pavan with 30 seconds and a McKinsey/INSEAD
background, and emits a numbered list of weaknesses (vague claims,
banned words, hallucinated metrics, weak "why now", wrong tone for the
doc type, missing required sections). The rewrite pass takes the draft
plus the critique list and produces the final artifact addressing
**every** point.

Skipped for `skip` docs.

## API

```
POST /api/bulk/lead
Content-Type: application/json
{
  "lead": { ...normalized Lead row... },
  "deepMode": false
}

200 OK
{
  "data": {
    "leadId": "actona-group-a-s__jimmi-mortensen",
    "intelMarkdown": "...",
    "outreachMarkdown": "...",
    "critiqueMarkdown": "...",
    "verdict": "Accepted" | "Rejected" | "Unknown",
    "confidence": "High" | "Medium" | "Low" | "Unknown",
    "rejectionClass": "none_accepted" | "data_integrity" | "sub_icp_revenue" | "wrong_vertical" | "wrong_contact_level" | "f500_oversize" | "no_pain_hook",
    "mainReason": "...",
    "docType": "pitch_full" | "enrichment" | "park_warming" | "peer_referral" | "up_org_referral" | "skip",
    "vertical": "tpa" | "insurance_services" | "...",
    "signals": [
      { "type": "ownership_change", "label": "...", "summary": "...", "date": "2026-03-12", "url": "...", "sourceName": "reuters.com" }
    ],
    "timings": {
      "signals": 4500, "intel": 41200, "outreach": 38200, "critique": 24100, "rewrite": 42800, "total": 156400
    }
  }
}
```

Single lead per request. The client orchestrates concurrency, ZIP, and
PDF. `maxDuration = 300` — borderline calls can hit ~3-4 minutes when
all five passes fire.

## ZIP layout

```
zapsight-outreach-<timestamp>.zip
├── _index.md                       full directory, grouped by doc type
├── _summary.pdf                    founder-ready table (Lead, Company, Verdict, Doc, Main reason / signal)
├── pitch_full/
│   └── <slug>/
│       ├── outreach.md
│       ├── intel.md
│       └── critique.md
├── enrichment/<slug>/...
├── park_warming/<slug>/...
├── peer_referral/<slug>/...
├── up_org_referral/<slug>/...
└── skip/<slug>/...
```

The summary PDF carries the visible note **"All reasons mentioned in
individual documents — see `<slug>/intel.md` for the full brief per
lead."** at the top of every page.

## Cost + latency per lead

Wall clock is dominated by the Sonnet 4.5 passes; Sonar is fast.

| Mode | Signals fetched | LLM passes | Wall clock | Approx $/lead |
| --- | :-: | :-: | --- | --- |
| `skip` doc (auto-skip vertical or no-pain class) | 0 | 2 (intel + skip note) | 50-90s | ~$0.04 |
| Standard (any non-`skip` doc) | 2-5 | 4 (intel + outreach + critique + rewrite) | 110-200s | $0.12-0.22 |
| Deep mode | 4-7 | 4 | 140-260s | $0.18-0.30 |

For a 23-lead bulk this is roughly **$2-5 of LLM + search spend
total** depending on the verticals and the toggle.

## Environment

```
OPENROUTER_API_KEY=<required>
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
SONAR_MODEL=perplexity/sonar-pro
```

Only `OPENROUTER_API_KEY` is required. Everything else has working
defaults.

## Code map

```
src/lib/leads.ts                       CSV/XLSX parser → normalized Lead[]
src/lib/vertical.ts                    Industry string → vertical enum + vertical-gate matrix + windows
src/lib/summaryPdf.ts                  Client-side founder summary PDF (pdf-lib)
src/agents/openrouter.ts               Generic OpenRouter chat client
src/agents/sonar.ts                    Sonar client (OpenRouter route, returns citations)
src/agents/signals.ts                  Per-signal query templates + guardrails + parallel fetch
src/agents/outreach.ts                 6 system prompts + intel + verdict parser + doc-type router + critique + rewrite
src/app/api/bulk/lead/route.ts         POST /api/bulk/lead
src/components/BulkOutreach.tsx        UI: drop-zone, row table, doc-type badges, deep-mode toggle, ZIP+PDF download
```

## Known gotchas

- **WinAnsi sanitization.** pdf-lib's standard Helvetica is CP-1252. LLM
  output occasionally contains math/arrow chars (≠ ≤ → ⋯) that would
  throw the PDF render. The sanitizer in `src/lib/summaryPdf.ts` maps
  the common offenders to ASCII and preserves WinAnsi extras (em-dash,
  en-dash, smart quotes, bullet, €, ™).
- **Hobby tier Vercel cap.** `maxDuration = 300` requires Pro tier. On
  Hobby this silently caps to 60s and standard-mode runs will fail.
- **Verdict parser tolerance.** Parser accepts "Reject" / "Accept" /
  bold markers / trailing punctuation, but if the model drifts hard the
  row is marked `Unknown` and falls back to `skip` to avoid producing a
  bad doc.
- **No web search on `skip` verticals.** Academic, non-profit,
  government, etc. — search budget is preserved. If you need to force
  search for one of these, change the vertical mapping in
  `src/lib/vertical.ts`.
- **Entity match on signals is heuristic.** Substring match against
  website host or brand. Strong enough for the false-positive case from
  the Pavan-23 run, but a brand whose name is a common English word can
  occasionally pass through.
