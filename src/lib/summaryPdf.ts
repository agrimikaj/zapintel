/**
 * Render the bulk-outreach summary PDF.
 *
 * One page header + a paginated table:
 *   #  | Lead | Company | Verdict | Main reason
 *
 * Plus a visible note: "All reasons mentioned in individual documents."
 *
 * Uses pdf-lib (pure JS, runs in the browser). We don't load any custom
 * fonts — Helvetica is one of pdf-lib's standard fonts and renders without
 * an embed step, which keeps the bundle small and the call synchronous.
 */

import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

export type SummaryDocType =
  | "pitch_full"
  | "enrichment"
  | "park_warming"
  | "peer_referral"
  | "up_org_referral"
  | "skip"
  | "—";

export interface SummaryRow {
  index: number;
  leadName: string;
  company: string;
  verdict: "Accepted" | "Rejected" | "Unknown" | "Failed";
  /** Doc type chosen for this lead (or "—" for failed rows). */
  docType: SummaryDocType;
  /** One-line signal headline used in the doc (or empty if none). */
  signalUsed: string;
  mainReason: string;
}

export interface SummaryMeta {
  sourceLabel: string; // e.g. "MyContacts_export_…csv"
  generatedAtISO: string;
  totalLeads: number;
  acceptedCount: number;
  rejectedCount: number;
  failedCount: number;
  /** Breakdown of rejected docs by routed doc type, for the header sub-line. */
  docTypeCounts?: Partial<Record<SummaryDocType, number>>;
}

/**
 * Sanitize a string to characters pdf-lib's standard Helvetica can encode.
 *
 * The font is WinAnsi (CP-1252). That's ASCII + Latin-1 + 27 extras at
 * 0x80-0x9F (em/en dash, smart quotes, bullet, ellipsis, €, ™ …). Anything
 * outside that throws at render time, so we whitelist the WinAnsi
 * codepoints and map the common LLM offenders (≠ ≤ ≥ → •) to ASCII before
 * the catch-all replaces remaining strays with "?".
 *
 * EVERY string drawn to the page MUST pass through here first — including the
 * header (source filename, generated-at date). `toLocaleString` on Chrome
 * 110+/Node 19+ emits a narrow no-break space (U+202F) before AM/PM, which
 * is not encodable and otherwise throws mid-render.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);
function sanitize(s: string): string {
  return String(s == null ? "" : s)
    .replace(/≠/g, "!=")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≈/g, "~")
    .replace(/[←⇐]/g, "<-")
    .replace(/[→⇒]/g, "->")
    .replace(/[↔⇔]/g, "<->")
    .replace(/[↑-⇿]/g, "->")
    .replace(/[∀-⋿]/g, "?")
    // Unicode spaces > 0xFF that WinAnsi can't encode -> ASCII space. Notably
    // U+202F (narrow no-break space), which Chrome 110+/Node 19+ toLocaleString
    // inserts before AM/PM; left unmapped it throws at draw time.
    .replace(/[ -   　]/g, " ")
    // Zero-width / joiner / BOM characters -> drop entirely.
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/./gu, (ch) => {
      const cp = ch.codePointAt(0) ?? 63;
      if (cp <= 0xff) return ch;
      if (WINANSI_EXTRAS.has(cp)) return ch;
      return "?";
    });
}

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN_X = 40;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 44;

// Column widths (sum + margins should equal PAGE_W).
const COL_WIDTHS = {
  num: 22,
  lead: 105,
  company: 105,
  verdict: 56,
  docType: 60,
  reason: PAGE_W - 2 * MARGIN_X - 22 - 105 - 105 - 56 - 60,
};

function shortDocLabel(t: SummaryDocType): string {
  switch (t) {
    case "pitch_full":
      return "Pitch";
    case "enrichment":
      return "Enrich";
    case "park_warming":
      return "Park";
    case "peer_referral":
      return "Peer Ref";
    case "up_org_referral":
      return "Up-Org Ref";
    case "skip":
      return "Skip";
    default:
      return "—";
  }
}

function docTypeColor(t: SummaryDocType): { r: number; g: number; b: number } {
  switch (t) {
    case "pitch_full":
      return { r: 0.08, g: 0.55, b: 0.32 };
    case "enrichment":
      return { r: 0.85, g: 0.45, b: 0.05 }; // amber
    case "park_warming":
      return { r: 0.25, g: 0.45, b: 0.7 }; // muted blue
    case "peer_referral":
      return { r: 0.35, g: 0.3, b: 0.65 }; // violet
    case "up_org_referral":
      return { r: 0.5, g: 0.25, b: 0.55 }; // purple
    case "skip":
      return { r: 0.55, g: 0.55, b: 0.6 };
    default:
      return { r: 0.55, g: 0.55, b: 0.6 };
  }
}

const ROW_PAD_X = 6;
const ROW_PAD_Y = 5;
const FONT_SIZE = 9;
const HEADER_FONT_SIZE = 9.5;
const LINE_HEIGHT = 11.5;

/** Wrap `text` into lines that fit within `maxWidth` at `fontSize`. */
function wrapText(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(trial, fontSize) <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      // Word itself longer than column? hard-break it.
      if (font.widthOfTextAtSize(w, fontSize) > maxWidth) {
        let chunk = "";
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = w;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

function verdictColor(v: SummaryRow["verdict"]): { r: number; g: number; b: number } {
  if (v === "Accepted") return { r: 0.08, g: 0.55, b: 0.32 }; // emerald
  if (v === "Rejected") return { r: 0.75, g: 0.18, b: 0.18 }; // red
  if (v === "Failed") return { r: 0.55, g: 0.16, b: 0.16 };
  return { r: 0.45, g: 0.45, b: 0.5 }; // unknown gray
}

interface PageCtx {
  page: PDFPage;
  y: number;
}

function newPage(pdf: PDFDocument): PageCtx {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  return { page, y: PAGE_H - MARGIN_TOP };
}

function drawHeader(
  ctx: PageCtx,
  font: PDFFont,
  bold: PDFFont,
  meta: SummaryMeta,
  pageNumber: number,
): void {
  const { page } = ctx;
  page.drawText(sanitize("Zapsight — Bulk Outreach Summary"), {
    x: MARGIN_X,
    y: PAGE_H - 36,
    size: 16,
    font: bold,
    color: rgb(0.08, 0.08, 0.1),
  });
  const dtc = meta.docTypeCounts || {};
  const docTypeBits: string[] = [];
  if ((dtc.enrichment ?? 0) > 0) docTypeBits.push(`${dtc.enrichment} enrich`);
  if ((dtc.park_warming ?? 0) > 0) docTypeBits.push(`${dtc.park_warming} park`);
  if ((dtc.peer_referral ?? 0) > 0) docTypeBits.push(`${dtc.peer_referral} peer-ref`);
  if ((dtc.up_org_referral ?? 0) > 0) docTypeBits.push(`${dtc.up_org_referral} up-org-ref`);
  if ((dtc.skip ?? 0) > 0) docTypeBits.push(`${dtc.skip} skip`);
  const docTypeSuffix = docTypeBits.length > 0 ? ` · routed: ${docTypeBits.join(", ")}` : "";
  const sub = sanitize(
    `${meta.totalLeads} leads · ${meta.acceptedCount} accepted · ${meta.rejectedCount} rejected${
      meta.failedCount > 0 ? ` · ${meta.failedCount} failed` : ""
    }${docTypeSuffix}`,
  );
  page.drawText(sub, {
    x: MARGIN_X,
    y: PAGE_H - 52,
    size: 9.5,
    font,
    color: rgb(0.3, 0.3, 0.36),
  });

  // Right-side metadata. Sanitize BEFORE measuring width so right-alignment
  // matches what's actually drawn.
  const gen = sanitize(`Generated: ${new Date(meta.generatedAtISO).toLocaleString()}`);
  const genW = font.widthOfTextAtSize(gen, 9);
  page.drawText(gen, {
    x: PAGE_W - MARGIN_X - genW,
    y: PAGE_H - 36,
    size: 9,
    font,
    color: rgb(0.3, 0.3, 0.36),
  });
  const src = sanitize(`Source: ${meta.sourceLabel}`);
  const srcW = font.widthOfTextAtSize(src, 9);
  page.drawText(src, {
    x: PAGE_W - MARGIN_X - srcW,
    y: PAGE_H - 52,
    size: 9,
    font,
    color: rgb(0.3, 0.3, 0.36),
  });

  // Visible note required by Sarah.
  ctx.y = PAGE_H - MARGIN_TOP - 22;
  page.drawRectangle({
    x: MARGIN_X,
    y: ctx.y - 4,
    width: PAGE_W - 2 * MARGIN_X,
    height: 18,
    color: rgb(0.95, 0.97, 1),
    borderColor: rgb(0.55, 0.75, 0.95),
    borderWidth: 0.6,
  });
  page.drawText(sanitize("All reasons mentioned in individual documents — see <slug>/intel.md for the full brief per lead."), {
    x: MARGIN_X + 8,
    y: ctx.y + 1,
    size: 9,
    font: bold,
    color: rgb(0.05, 0.32, 0.6),
  });
  ctx.y -= 16;

  // Footer page number on every page.
  page.drawText(`Page ${pageNumber}`, {
    x: PAGE_W - MARGIN_X - 40,
    y: MARGIN_BOTTOM - 18,
    size: 8,
    font,
    color: rgb(0.55, 0.55, 0.6),
  });
}

function drawTableHeader(ctx: PageCtx, bold: PDFFont): void {
  const { page } = ctx;
  const rowH = 18;
  page.drawRectangle({
    x: MARGIN_X,
    y: ctx.y - rowH + 2,
    width: PAGE_W - 2 * MARGIN_X,
    height: rowH,
    color: rgb(0.94, 0.94, 0.96),
    borderColor: rgb(0.8, 0.8, 0.85),
    borderWidth: 0.5,
  });
  let cx = MARGIN_X + ROW_PAD_X;
  const cy = ctx.y - rowH + 7;
  page.drawText("#", { x: cx, y: cy, size: HEADER_FONT_SIZE, font: bold });
  cx += COL_WIDTHS.num;
  page.drawText("Lead", { x: cx, y: cy, size: HEADER_FONT_SIZE, font: bold });
  cx += COL_WIDTHS.lead;
  page.drawText("Company", { x: cx, y: cy, size: HEADER_FONT_SIZE, font: bold });
  cx += COL_WIDTHS.company;
  page.drawText("Verdict", { x: cx, y: cy, size: HEADER_FONT_SIZE, font: bold });
  cx += COL_WIDTHS.verdict;
  page.drawText("Doc", { x: cx, y: cy, size: HEADER_FONT_SIZE, font: bold });
  cx += COL_WIDTHS.docType;
  page.drawText("Main reason / signal", { x: cx, y: cy, size: HEADER_FONT_SIZE, font: bold });

  ctx.y -= rowH;
}

export async function buildSummaryPdf(
  rows: SummaryRow[],
  meta: SummaryMeta,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Zapsight Bulk Outreach Summary — ${meta.sourceLabel}`);
  pdf.setSubject("Lead-by-lead verdict summary");
  pdf.setCreator("Zapsight ZapIntel");
  pdf.setProducer("pdf-lib");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let pageNumber = 1;
  let ctx = newPage(pdf);
  drawHeader(ctx, font, bold, meta, pageNumber);
  drawTableHeader(ctx, bold);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Build the reason cell — main reason + optional signal-used line.
    const reasonRaw = row.signalUsed
      ? `${row.mainReason || "—"}\nSignal: ${row.signalUsed}`
      : row.mainReason || "—";

    // Pre-wrap each cell, then take the max line count = row height.
    const leadLines = wrapText(sanitize(row.leadName || "—"), font, FONT_SIZE, COL_WIDTHS.lead - 2 * ROW_PAD_X);
    const companyLines = wrapText(sanitize(row.company || "—"), font, FONT_SIZE, COL_WIDTHS.company - 2 * ROW_PAD_X);
    // Manually keep the signal line on its own row.
    const reasonLines: string[] = [];
    for (const part of reasonRaw.split("\n")) {
      const wrapped = wrapText(sanitize(part), font, FONT_SIZE, COL_WIDTHS.reason - 2 * ROW_PAD_X);
      reasonLines.push(...wrapped);
    }
    const verdictLines = wrapText(sanitize(row.verdict), font, FONT_SIZE, COL_WIDTHS.verdict - 2 * ROW_PAD_X);
    const docLines = wrapText(sanitize(shortDocLabel(row.docType)), font, FONT_SIZE, COL_WIDTHS.docType - 2 * ROW_PAD_X);

    const lineCount = Math.max(
      leadLines.length,
      companyLines.length,
      reasonLines.length,
      verdictLines.length,
      docLines.length,
    );
    const rowH = Math.max(lineCount * LINE_HEIGHT + 2 * ROW_PAD_Y, 18);

    // Page-break if needed.
    if (ctx.y - rowH < MARGIN_BOTTOM) {
      pageNumber++;
      ctx = newPage(pdf);
      drawHeader(ctx, font, bold, meta, pageNumber);
      drawTableHeader(ctx, bold);
    }

    // Zebra-stripe.
    if (i % 2 === 1) {
      ctx.page.drawRectangle({
        x: MARGIN_X,
        y: ctx.y - rowH,
        width: PAGE_W - 2 * MARGIN_X,
        height: rowH,
        color: rgb(0.985, 0.985, 0.99),
      });
    }
    // Row baseline (right above the next row position).
    ctx.page.drawLine({
      start: { x: MARGIN_X, y: ctx.y - rowH },
      end: { x: PAGE_W - MARGIN_X, y: ctx.y - rowH },
      thickness: 0.3,
      color: rgb(0.85, 0.85, 0.88),
    });

    const topY = ctx.y - ROW_PAD_Y - FONT_SIZE;

    let cx = MARGIN_X + ROW_PAD_X;
    ctx.page.drawText(String(row.index), {
      x: cx,
      y: topY,
      size: FONT_SIZE,
      font,
      color: rgb(0.45, 0.45, 0.5),
    });

    cx += COL_WIDTHS.num;
    leadLines.forEach((line, k) => {
      ctx.page.drawText(line, {
        x: cx,
        y: topY - k * LINE_HEIGHT,
        size: FONT_SIZE,
        font: k === 0 ? bold : font,
        color: rgb(0.1, 0.1, 0.12),
      });
    });

    cx += COL_WIDTHS.lead;
    companyLines.forEach((line, k) => {
      ctx.page.drawText(line, {
        x: cx,
        y: topY - k * LINE_HEIGHT,
        size: FONT_SIZE,
        font,
        color: rgb(0.18, 0.18, 0.22),
      });
    });

    cx += COL_WIDTHS.company;
    const vc = verdictColor(row.verdict);
    verdictLines.forEach((line, k) => {
      ctx.page.drawText(line, {
        x: cx,
        y: topY - k * LINE_HEIGHT,
        size: FONT_SIZE,
        font: bold,
        color: rgb(vc.r, vc.g, vc.b),
      });
    });

    cx += COL_WIDTHS.verdict;
    const dc = docTypeColor(row.docType);
    docLines.forEach((line, k) => {
      ctx.page.drawText(line, {
        x: cx,
        y: topY - k * LINE_HEIGHT,
        size: FONT_SIZE,
        font: bold,
        color: rgb(dc.r, dc.g, dc.b),
      });
    });

    cx += COL_WIDTHS.docType;
    reasonLines.forEach((line, k) => {
      const isSignalLine = line.startsWith("Signal: ");
      ctx.page.drawText(line, {
        x: cx,
        y: topY - k * LINE_HEIGHT,
        size: FONT_SIZE,
        font: isSignalLine ? bold : font,
        color: isSignalLine
          ? rgb(0.05, 0.32, 0.6)
          : rgb(0.18, 0.18, 0.22),
      });
    });

    ctx.y -= rowH;
  }

  return pdf.save();
}
