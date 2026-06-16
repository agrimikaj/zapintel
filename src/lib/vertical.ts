/**
 * Vertical inference.
 *
 * Maps the free-text `companyIndustry` field from a lead row to a small enum
 * that drives the web-search gate and the rejection-class doc routing.
 *
 * The mapping is keyword-based on purpose: enrichment sources use wildly
 * inconsistent industry strings ("Insurance", "Insurance Services",
 * "Property & Casualty Insurance", "Health Insurance Services"), so a
 * rigid lookup table would miss most of them. Each vertical has a list
 * of substrings; the first one that hits wins, and the priority order is
 * tuned so the narrower ICP-shaped buckets (TPA, healthcare admin) win
 * over the broader "insurance" / "healthcare" catch-alls when both could
 * match.
 *
 * `unknown` falls through to a "generic mid-market" treatment — we still
 * try the universal signals (ownership change, ops leadership rotation,
 * restructuring) but skip the vertical-specific ones.
 *
 * Important: the vertical is a SEARCH-routing + messaging hint, NOT an
 * accept/reject gate. Zapsight's ICP is any mid-market traditional business
 * ($50M-$500M) with real operational complexity; the named verticals are
 * priority order for proof and messaging, not a filter. The accept/reject
 * decision lives in the intel verdict (src/agents/outreach.ts), which treats
 * every vertical here except `skip` as a viable ICP on revenue-band grounds.
 *
 * `private_equity` is the one special case: it routes to the PE
 * portfolio-value-creation play rather than a single-company pitch, because
 * the buyer (operating partner / head of value creation) buys for the whole
 * portfolio, not for the firm itself.
 *
 * `skip` is the early-exit signal: no web search fired at all, doc-type
 * routing goes straight to a one-line skip note.
 */

export type Vertical =
  | "tpa"
  | "insurance_services"
  | "healthcare_admin"
  | "private_equity"
  | "financial_services"
  | "retail"
  | "manufacturing"
  | "b2b_saas"
  | "logistics"
  | "professional_services"
  | "hospitality"
  | "construction"
  | "energy_utilities"
  | "real_estate"
  | "skip"
  | "unknown";

interface Rule {
  vertical: Vertical;
  /** Lowercased substring matchers. ANY match → vertical assigned. */
  any: string[];
}

// Order matters: narrower / higher-priority verticals first.
const RULES: Rule[] = [
  // Hard skips — never search, never pitch.
  {
    vertical: "skip",
    any: [
      "academ",
      "higher education",
      "university",
      "research institut",
      "non-profit",
      "nonprofit",
      "philanthrop",
      "foundation",
      "religious",
      "government",
      "public administration",
      "civic",
      "social organiz",
      "individual",
      "self-employ",
      "freelance",
      "personal services",
    ],
  },

  // TPA / claims admin — Zapsight's #1 ICP.
  {
    vertical: "tpa",
    any: [
      "tpa",
      "third-party administrator",
      "third party administrator",
      "claims administrator",
      "claims administration",
      "workers' comp",
      "workers comp",
      "benefits administration",
      "employee benefits",
      "self-insured",
      "stop-loss",
    ],
  },

  // Healthcare admin — provider / payer / RCM / health-admin shapes.
  {
    vertical: "healthcare_admin",
    any: [
      "hospital",
      "health system",
      "managed care",
      "revenue cycle",
      "health plan",
      "payer",
      "pharmacy benefit",
      "pbm",
      "medical billing",
      "patient access",
      "health insurance",
      "medicare",
      "medicaid",
    ],
  },

  // General insurance services — P&C, life, reinsurance.
  {
    vertical: "insurance_services",
    any: [
      "insurance",
      "reinsurance",
      "underwriting",
      "actuari",
      "risk management",
      "broker",
    ],
  },

  // Private equity / venture / holdco — NOT an operating ICP, but a
  // high-value relationship: one operating partner is a door into the whole
  // portfolio. Routed to the PE "portfolio value-creation" play, not the
  // single-company pitch. Sits above financial_services so PE/VC strings win
  // over the generic "financial services" bucket.
  {
    vertical: "private_equity",
    any: [
      "private equity",
      "venture capital",
      "venture fund",
      "growth equity",
      "buyout",
      "leveraged buyout",
      "family office",
      "holding company",
      "holdco",
      "portfolio company",
      "investment firm",
      "private capital",
      "capital partners",
      "search fund",
      "middle-market private",
    ],
  },

  // Financial services — banks, lenders, fintech, payments, wealth. Operating
  // mid-market financial businesses (distinct from the PE/VC investors above).
  {
    vertical: "financial_services",
    any: [
      "bank",
      "credit union",
      "lending",
      "lender",
      "mortgage",
      "fintech",
      "financial technology",
      "financial services",
      "payments",
      "wealth management",
      "asset management",
      "capital markets",
      "consumer finance",
      "commercial finance",
      "factoring",
      "leasing",
    ],
  },

  // Manufacturing.
  {
    vertical: "manufacturing",
    any: [
      "manufactur",
      "industrial",
      "machinery",
      "automotive",
      "aerospace",
      "chemicals",
      "metals",
      "furniture",
      "textiles",
      "food production",
    ],
  },

  // Retail / Ecomm / Consumer Goods.
  {
    vertical: "retail",
    any: [
      "retail",
      "ecomm",
      "e-commerce",
      "consumer goods",
      "consumer product",
      "apparel",
      "fashion",
      "merchandis",
      "wholesale",
      "direct-to-consumer",
      "dtc",
      "cpg",
      "supermarket",
      "grocer",
      "department store",
    ],
  },

  // Logistics / supply chain.
  {
    vertical: "logistics",
    any: [
      "logistics",
      "supply chain",
      "transportation",
      "freight",
      "warehous",
      "distribution",
      "3pl",
      "fulfillment",
    ],
  },

  // B2B SaaS / software.
  {
    vertical: "b2b_saas",
    any: [
      "saas",
      "software-as-a-service",
      "computer software",
      "information technology",
      "it services",
      "platform",
      "developer tools",
      "cloud computing",
    ],
  },

  // Professional services (consulting, advisory, accounting, legal).
  {
    vertical: "professional_services",
    any: [
      "consulting",
      "advisory",
      "accountancy",
      "accounting",
      "legal services",
      "law firm",
      "professional services",
      "management consult",
    ],
  },

  // Hospitality / food service / travel / leisure.
  {
    vertical: "hospitality",
    any: [
      "hospitality",
      "hotel",
      "restaurant",
      "food service",
      "foodservice",
      "travel",
      "tourism",
      "leisure",
      "gaming",
      "casino",
      "resort",
      "lodging",
      "catering",
    ],
  },

  // Construction / engineering / built environment.
  {
    vertical: "construction",
    any: [
      "construction",
      "contractor",
      "building materials",
      "civil engineering",
      "architecture",
      "homebuild",
      "home build",
      "infrastructure",
      "built environment",
      "aec",
    ],
  },

  // Energy / utilities / resources.
  {
    vertical: "energy_utilities",
    any: [
      "energy",
      "oil & gas",
      "oil and gas",
      "utilit",
      "power generation",
      "renewable",
      "solar",
      "wind power",
      "electric utility",
      "natural gas",
      "mining",
      "petroleum",
      "drilling",
    ],
  },

  // Real estate / property / facilities.
  {
    vertical: "real_estate",
    any: [
      "real estate",
      "property management",
      "reit",
      "commercial real estate",
      "residential real estate",
      "facilities management",
      "property developer",
      "realty",
      "proptech",
    ],
  },
];

export function inferVertical(industryRaw?: string): Vertical {
  if (!industryRaw) return "unknown";
  const s = industryRaw.toLowerCase().trim();
  if (!s) return "unknown";
  for (const rule of RULES) {
    for (const needle of rule.any) {
      if (s.includes(needle)) return rule.vertical;
    }
  }
  return "unknown";
}

/**
 * Which signals to fetch for each vertical. The matrix follows the
 * "corrected signals" parameter set agreed with Sarah:
 *   ownership_change, ops_leadership_rotation, systems_migration,
 *   restructuring, regulatory_event — the five Zapsight-ICP-shaped
 *   signals — plus three retail/SaaS-only legacy signals.
 *
 * `skip` returns an empty list (and the caller bypasses search entirely).
 */
export type SignalType =
  | "ownership_change"
  | "ops_leadership_rotation"
  | "systems_migration"
  | "restructuring"
  | "regulatory_event"
  | "competitor_pricing"
  | "product_launch"
  | "job_postings_ai"
  | "funding_standalone";

const VERTICAL_GATE: Record<Vertical, SignalType[]> = {
  tpa: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "restructuring",
    "regulatory_event",
  ],
  insurance_services: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "restructuring",
    "regulatory_event",
  ],
  // For a PE/VC investor the live signals are platform acquisitions
  // (ownership_change), new operating-partner / value-creation hires
  // (ops_leadership_rotation), and fund closes (funding_standalone).
  private_equity: [
    "ownership_change",
    "ops_leadership_rotation",
    "funding_standalone",
    "restructuring",
  ],
  financial_services: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "regulatory_event",
    "restructuring",
  ],
  healthcare_admin: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "regulatory_event",
  ],
  retail: [
    "ownership_change",
    "ops_leadership_rotation",
    "competitor_pricing",
    "product_launch",
    "restructuring",
  ],
  manufacturing: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "restructuring",
  ],
  b2b_saas: [
    "ownership_change",
    "ops_leadership_rotation",
    "product_launch",
    "job_postings_ai",
    "funding_standalone",
    "restructuring",
  ],
  logistics: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "restructuring",
  ],
  professional_services: [
    "ownership_change",
    "ops_leadership_rotation",
    "restructuring",
  ],
  hospitality: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "restructuring",
  ],
  construction: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "restructuring",
  ],
  energy_utilities: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "regulatory_event",
    "restructuring",
  ],
  real_estate: [
    "ownership_change",
    "ops_leadership_rotation",
    "systems_migration",
    "restructuring",
  ],
  unknown: ["ownership_change", "ops_leadership_rotation", "restructuring"],
  skip: [],
};

/** Recency window per signal type, in days. Older → drop. */
export const SIGNAL_WINDOWS: Record<SignalType, number> = {
  ownership_change: 540,
  ops_leadership_rotation: 270,
  systems_migration: 540,
  restructuring: 365,
  regulatory_event: 365,
  competitor_pricing: 2,
  product_launch: 365,
  job_postings_ai: 30,
  funding_standalone: 540,
};

export function signalsForVertical(v: Vertical, deepMode = false): SignalType[] {
  const base = VERTICAL_GATE[v];
  if (!deepMode) return base;
  // Deep mode: add restructuring + product_launch where not already there.
  const extra: SignalType[] = [];
  if (!base.includes("restructuring")) extra.push("restructuring");
  if (v === "retail" && !base.includes("job_postings_ai")) extra.push("job_postings_ai");
  return [...base, ...extra];
}

/** Human-readable label for a signal type — used in prompts and the UI. */
export function signalLabel(s: SignalType): string {
  switch (s) {
    case "ownership_change":
      return "Ownership change (M&A, PE buyout, recap)";
    case "ops_leadership_rotation":
      return "Operational leadership rotation (COO, CIO, VP Claims, VP Ops, CMO)";
    case "systems_migration":
      return "Systems migration / platform change (EHR, claims platform, ERP, ecomm replatform)";
    case "restructuring":
      return "Restructuring / layoffs / cost takeout";
    case "regulatory_event":
      return "Regulatory or compliance event (CMS, DOL, state DOI, ERISA, NCQA)";
    case "competitor_pricing":
      return "Competitor pricing snapshot vs theirs";
    case "product_launch":
      return "New product launch or major release";
    case "job_postings_ai":
      return "Open AI / Data / ML roles";
    case "funding_standalone":
      return "Funding round (non-PE)";
  }
}
