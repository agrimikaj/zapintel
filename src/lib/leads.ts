/**
 * Lead-list parsing.
 *
 * Handles two input shapes that Sarah's CSVs and Pavan's exports tend to use:
 *   1. The ZoomInfo / Apollo / Lusha "MyContacts" export — ~60 columns,
 *      one row per contact, with company embedded on the same row.
 *   2. A loose generic schema — any sheet with recognizable column names
 *      like First Name / Last Name / Title / Company / Website / Email /
 *      LinkedIn / Phone.
 *
 * Output: a `Lead` array where each row is one human + the company they
 * work at, ready to feed into the outreach generator.
 *
 * Uses SheetJS (`xlsx`) which handles .csv, .xlsx, .xlsm, .xls and .tsv
 * with the same API.
 */

import * as XLSX from "xlsx";

export interface Lead {
  /** Stable slug for filenames / React keys. */
  id: string;

  /* contact */
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  seniority: string;
  department: string;
  email: string;
  contactPhone: string;
  contactMobile: string;
  linkedinUrl: string;
  contactCity: string;
  contactState: string;
  contactCountry: string;

  /* company */
  companyName: string;
  companyWebsite: string;
  companyIndustry: string;
  companyDescription: string;
  companyRevenueRange: string;
  companyStaffCount: string;
  companyStaffRange: string;
  companyFoundedDate: string;
  companyCity: string;
  companyState: string;
  companyCountry: string;
  companyPhone: string;
  companyLinkedinUrl: string;
}

/** Lowercase + strip non-alnum so "Contact Full Name" matches "contact_full_name". */
function k(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Find the first column whose normalized header matches one of `aliases`. */
function pick(row: Record<string, unknown>, normIndex: Map<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    const realKey = normIndex.get(k(alias));
    if (realKey !== undefined) {
      const v = row[realKey];
      if (v !== null && v !== undefined) {
        const s = String(v).trim();
        if (s.length > 0) return s;
      }
    }
  }
  return "";
}

function slugify(s: string, fallback: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return out || fallback;
}

/** Normalize "actonagroup.com" → "https://actonagroup.com". */
function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return s;
}

/**
 * Parse a CSV/XLSX/XLS/TSV file's raw bytes into a normalized list of leads.
 * Throws if no recognizable rows are produced.
 */
export function parseLeadFile(bytes: ArrayBuffer, filename = ""): Lead[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets.");
  const sheet = wb.Sheets[sheetName];
  // defval ensures missing cells come back as "" rather than dropping the key.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false, // coerce dates/numbers to strings so we don't lose leading zeros
  });

  const leads: Lead[] = [];
  const seenIds = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const normIndex = new Map<string, string>();
    for (const key of Object.keys(row)) normIndex.set(k(key), key);

    const firstName = pick(row, normIndex, "First Name", "first");
    const lastName = pick(row, normIndex, "Last Name", "last");
    const fullName =
      pick(row, normIndex, "Contact Full Name", "Full Name", "Name") ||
      [firstName, lastName].filter(Boolean).join(" ");
    const title = pick(row, normIndex, "Title", "Job Title", "Position");
    const seniority = pick(row, normIndex, "Seniority", "Level");
    const department = pick(row, normIndex, "Department", "Function");
    const email =
      pick(
        row,
        normIndex,
        "Email 1",
        "Email",
        "Work Email",
        "Contact Email",
        "Primary Email",
      ) || "";
    const contactPhone = pick(
      row,
      normIndex,
      "Contact Phone 1",
      "Contact Phone",
      "Phone",
      "Direct Phone",
    );
    const contactMobile = pick(
      row,
      normIndex,
      "Contact Mobile Phone",
      "Mobile",
      "Cell",
      "Mobile Phone",
    );
    const linkedinUrl = pick(
      row,
      normIndex,
      "Contact LI Profile URL",
      "LinkedIn",
      "LinkedIn URL",
      "Person Linkedin Url",
    );
    const contactCity = pick(row, normIndex, "Contact City", "City");
    const contactState = pick(row, normIndex, "Contact State", "State");
    const contactCountry = pick(row, normIndex, "Contact Country", "Country");

    const companyName = pick(
      row,
      normIndex,
      "Company Name - Cleaned",
      "Company Name",
      "Company",
      "Account Name",
    );
    const companyWebsiteRaw = pick(
      row,
      normIndex,
      "Website",
      "Company Website",
      "Company Domain",
      "Company Website Domain",
      "Domain",
    );
    const companyWebsite = normalizeUrl(companyWebsiteRaw);
    const companyIndustry = pick(row, normIndex, "Company Industry", "Industry");
    const companyDescription = pick(row, normIndex, "Company Description", "About");
    const companyRevenueRange = pick(
      row,
      normIndex,
      "Company Revenue Range",
      "Revenue Range",
      "Annual Revenue",
      "Company Annual Revenue",
    );
    const companyStaffCount = pick(
      row,
      normIndex,
      "Company Staff Count",
      "Employee Count",
      "Headcount",
    );
    const companyStaffRange = pick(
      row,
      normIndex,
      "Company Staff Count Range",
      "Employee Range",
      "Size",
    );
    const companyFoundedDate = pick(row, normIndex, "Company Founded Date", "Founded");
    const companyCity = pick(row, normIndex, "Company City", "HQ City");
    const companyState = pick(row, normIndex, "Company State", "HQ State");
    const companyCountry = pick(row, normIndex, "Company Country", "HQ Country");
    const companyPhone = pick(row, normIndex, "Company Phone 1", "Company Phone", "HQ Phone");
    const companyLinkedinUrl = pick(
      row,
      normIndex,
      "Company LI Profile Url",
      "Company LinkedIn",
      "Company Linkedin Url",
    );

    // A row needs at least a company AND either a name or an email to be useful.
    const hasCompany = companyName.length > 0;
    const hasPerson = (fullName || firstName || lastName || email).length > 0;
    if (!hasCompany || !hasPerson) continue;

    // Build a stable, filesystem-safe ID. Dedupe collisions ("-2", "-3", ...).
    const personPart = slugify(fullName || `${firstName} ${lastName}`, `lead-${i + 1}`);
    const companyPart = slugify(companyName, "company");
    let id = `${companyPart}__${personPart}`;
    const seen = seenIds.get(id) ?? 0;
    seenIds.set(id, seen + 1);
    if (seen > 0) id = `${id}-${seen + 1}`;

    leads.push({
      id,
      firstName,
      lastName,
      fullName: fullName || [firstName, lastName].filter(Boolean).join(" "),
      title,
      seniority,
      department,
      email,
      contactPhone,
      contactMobile,
      linkedinUrl,
      contactCity,
      contactState,
      contactCountry,
      companyName,
      companyWebsite,
      companyIndustry,
      companyDescription,
      companyRevenueRange,
      companyStaffCount,
      companyStaffRange,
      companyFoundedDate,
      companyCity,
      companyState,
      companyCountry,
      companyPhone,
      companyLinkedinUrl,
    });
  }

  if (leads.length === 0) {
    throw new Error(
      `No leads recognized in "${filename || "the uploaded file"}". ` +
        "Need at least: Company Name + (Full Name or Email).",
    );
  }
  return leads;
}

/** One-line headline for the table UI. */
export function leadHeadline(l: Lead): string {
  const role = l.title ? ` — ${l.title}` : "";
  return `${l.fullName}${role} @ ${l.companyName}`;
}
