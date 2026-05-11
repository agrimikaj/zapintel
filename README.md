# ZapIntel

**Boardroom-grade prospect intelligence for Zapsight sales.**

Drop a company URL. ZapIntel returns an 8-dimension brief on who they are,
what they need, and the exact Zapsight offer to lead with — including a
90-word opening email written in Zapsight's voice.

This is the sales-side sibling of the competitor-intelligence agent in
`/Intelligence`. Same architectural backbone, same CEO-ready output bar,
pivoted from "analyze a competitor" to "qualify a prospect".

---

## What it produces

For every prospect you submit, ZapIntel dispatches 8 parallel dimension
agents against Claude Sonnet 4.5 (via OpenRouter) and synthesizes the
findings into a single report:

1. **Company Fundamentals** — legal name, HQ, leadership, funding, ownership
2. **Digital Presence & Maturity** — web/SEO/social/content engine, maturity rating
3. **Products & Services** — SKU map, differentiators, observed weaknesses
4. **Market Position & Competitors** — real category, named rivals, where they sit
5. **Pain Points & Opportunities** — signals → Zapsight-shaped opportunities, ranked
6. **Decision Makers & Buying Signals** — who to email, why now
7. **Tech Stack & AI Readiness** — technographics + AI maturity rating
8. **Engagement Strategy** — wedge offer, 30/60/90 plan, the actual opening email

Followed by an **Executive Summary**: fit score, top 3 pains, CEO headline,
next 3 actions for the AE.

Every output ends with a one-line **"So What for Zapsight"** the AE can
quote on a call.

---

## Stack

- **Next.js 15** App Router, **TypeScript** strict, **Tailwind CSS**
- **OpenRouter** (OpenAI-compatible) as the LLM gateway → Claude Sonnet 4.5
- **SSE streaming** dimension-by-dimension to the UI
- Deployed on **Vercel**, source on **GitHub**

---

## Run locally

```bash
cp .env.example .env.local        # then fill in OPENROUTER_API_KEY
npm install
npm run dev                       # http://localhost:3000
```

### Required env

| Var                  | Default                                  |
| -------------------- | ---------------------------------------- |
| `OPENROUTER_API_KEY` | _(required)_                             |
| `OPENROUTER_MODEL`   | `anthropic/claude-sonnet-4.5`            |
| `OPENROUTER_BASE_URL`| `https://openrouter.ai/api/v1`           |

---

## Deploy

This repo is wired for Vercel. Push to `main` and Vercel auto-deploys.

```bash
gh repo create zapintel --public --source . --remote origin --push
vercel link
vercel env add OPENROUTER_API_KEY production
vercel --prod
```

---

## Architecture

```
src/
├── agents/
│   ├── dimensions.ts      # 8 dimension prompts + summary prompt
│   ├── openrouter.ts      # OpenRouter (OpenAI-compatible) client
│   └── orchestrator.ts    # parallel dispatch + SSE event stream
├── app/
│   ├── api/
│   │   ├── research/route.ts   # POST → SSE stream
│   │   └── export/route.ts     # POST → markdown download
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                # the dashboard
└── components/
    ├── ProspectForm.tsx
    ├── DimensionCard.tsx
    ├── ExecutiveSummary.tsx
    └── ProgressRail.tsx
```

---

© Zapsight. ZapIntel is an internal sales-intelligence tool.
