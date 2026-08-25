/**
 * Landscape PDF certificate rendering (pdfkit, pure JS -- no native/Chromium
 * dependency, safe for Hostinger's Node hosting). Text stays real PDF text
 * (vector/selectable), not a rasterized screenshot -- only the QR code and
 * the real XauCloud app-icon logo (public/xauai-logo.png) are raster images.
 * Uses pdfkit's built-in standard fonts (Helvetica/Times families) so
 * nothing needs to be embedded or shipped as a separate font asset.
 *
 * Palette is pulled from the project's own brand tokens
 * (frontend/tailwind.config.js `gold` scale), not invented for this file:
 * gold-600 (#C9962E) is the frame/primary accent, gold-700 (#A87A24) the
 * deeper accent (Academy name, seal ring, signature), gold-300 (#F3C969)
 * reserved for small bright highlights (ornament diamonds).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { curriculumDescription } from "./academyCurriculum.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IVORY = "#FBF6EA";
const CHARCOAL = "#221D14";
const CHARCOAL_SOFT = "#4A4235";
const MUTED = "#8B8069";
const HAIRLINE = "#E4D9BE";
const GOLD = "#C9962E"; // brand gold-600
const GOLD_DEEP = "#A87A24"; // brand gold-700
const GOLD_LIGHT = "#F3C969"; // brand gold-300

let logoBuffer: Buffer | null | undefined;
/** Lazily loaded and cached -- the file never changes at runtime, no reason to hit disk per PDF. */
function xauCloudLogo(): Buffer | null {
  if (logoBuffer !== undefined) return logoBuffer;
  try {
    logoBuffer = readFileSync(path.join(__dirname, "../../public/xauai-logo.png"));
  } catch {
    logoBuffer = null; // Renders without the badge rather than failing certificate issuance over a missing static asset.
  }
  return logoBuffer;
}

export interface CertificatePdfInput {
  recipientName: string;
  certificateId: string;
  completedAtIso: string;
  verifyUrl: string;
  curriculumVersion?: string;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } catch {
    return iso;
  }
}

/** Shrinks the name font until it fits one line within the certificate's inner width, so a long legal name never overflows or wraps awkwardly. */
function fitNameFontSize(doc: PDFKit.PDFDocument, name: string, maxWidth: number): number {
  let size = 38;
  doc.font("Times-Bold");
  doc.fontSize(size);
  while (size > 18 && doc.widthOfString(name) > maxWidth) {
    size -= 1;
    doc.fontSize(size);
  }
  return size;
}

/** A small rotated-square diamond ornament, used at border corners and as a rule separator mark. */
function drawDiamond(doc: PDFKit.PDFDocument, cx: number, cy: number, r: number, color: string): void {
  doc.save();
  doc.moveTo(cx, cy - r).lineTo(cx + r, cy).lineTo(cx, cy + r).lineTo(cx - r, cy).closePath().fill(color);
  doc.restore();
}

/** Gold diamond + inward bracket flourish at one inner-frame corner. sx/sy = +1|-1 direction to sweep the bracket inward from the corner. */
function drawCornerOrnament(doc: PDFKit.PDFDocument, x: number, y: number, sx: number, sy: number): void {
  drawDiamond(doc, x, y, 3.2, GOLD);
  doc.save();
  doc.lineWidth(0.75).strokeColor(GOLD);
  doc.moveTo(x + sx * 9, y).lineTo(x + sx * 26, y).stroke();
  doc.moveTo(x, y + sy * 9).lineTo(x, y + sy * 26).stroke();
  doc.restore();
}

/** Thin gold rule with a small centered diamond -- the recurring section-break motif. */
function drawOrnamentalRule(doc: PDFKit.PDFDocument, centerX: number, y: number, halfWidth: number): void {
  doc.save();
  doc.lineWidth(0.6).strokeColor(GOLD);
  doc.moveTo(centerX - halfWidth, y).lineTo(centerX - 6, y).stroke();
  doc.moveTo(centerX + 6, y).lineTo(centerX + halfWidth, y).stroke();
  doc.restore();
  drawDiamond(doc, centerX, y, 3, GOLD_LIGHT);
}

/** Official completion seal: engraved-style concentric rings with a radial tick band and stacked centered wordmark. */
function drawSeal(doc: PDFKit.PDFDocument, cx: number, cy: number): void {
  const rOuter = 42;
  const rTick = 36;
  const rInner = 31;

  doc.save();
  doc.lineWidth(1.6).strokeColor(GOLD).circle(cx, cy, rOuter).stroke();
  doc.lineWidth(0.5).strokeColor(GOLD_DEEP).circle(cx, cy, rInner).stroke();

  doc.lineWidth(0.5).strokeColor(GOLD);
  const ticks = 40;
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * rTick;
    const y1 = cy + Math.sin(a) * rTick;
    const x2 = cx + Math.cos(a) * (rTick - 3.5);
    const y2 = cy + Math.sin(a) * (rTick - 3.5);
    doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  }
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(CHARCOAL).text("XAUCLOUD", cx - rInner, cy - 17, { width: rInner * 2, align: "center", characterSpacing: 0.5 });
  doc.font("Helvetica-Bold").fontSize(6).fillColor(GOLD_DEEP).text("FOREX ACADEMY", cx - rInner, cy - 6, { width: rInner * 2, align: "center", characterSpacing: 0.5 });
  drawDiamond(doc, cx, cy + 3, 2, GOLD_LIGHT);
  doc.font("Helvetica").fontSize(5).fillColor(CHARCOAL_SOFT).text("CERTIFIED COMPLETION", cx - rInner, cy + 9, { width: rInner * 2, align: "center", characterSpacing: 0.7 });
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(input.verifyUrl, { margin: 1, color: { dark: CHARCOAL, light: IVORY }, width: 240 });

  const doc = new PDFDocument({ layout: "landscape", size: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const H = doc.page.height;

  // ── Background + frame ──────────────────────────────────────────────
  doc.rect(0, 0, W, H).fill(IVORY);
  doc.rect(28, 28, W - 56, H - 56).lineWidth(1.4).stroke(GOLD);
  doc.rect(38, 38, W - 76, H - 76).lineWidth(0.6).stroke(GOLD_DEEP);
  doc.rect(41, 41, W - 82, H - 82).lineWidth(0.4).stroke(HAIRLINE);

  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    drawCornerOrnament(doc, sx > 0 ? 38 : W - 38, sy > 0 ? 38 : H - 38, sx, sy);
  }

  // ── Brand mark ───────────────────────────────────────────────────────
  const logo = xauCloudLogo();
  let cursorY = 44;
  if (logo) {
    doc.image(logo, W / 2 - 21, cursorY, { width: 42, height: 42 });
    cursorY += 50;
  }
  doc.font("Helvetica-Bold").fontSize(14).fillColor(GOLD_DEEP).text("XAUCLOUD", 0, cursorY, { align: "center", width: W, characterSpacing: 3.5 });
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("BUILT FOR GOLD", 0, cursorY + 17, { align: "center", width: W, characterSpacing: 2.5 });

  drawOrnamentalRule(doc, W / 2, cursorY + 36, 46);

  // ── Title ────────────────────────────────────────────────────────────
  const titleY = cursorY + 50;
  doc.font("Times-Bold").fontSize(40).fillColor(CHARCOAL).text("Certificate", 0, titleY, { align: "center", width: W });
  doc.font("Helvetica-Bold").fontSize(12.5).fillColor(GOLD_DEEP).text("O F   C O M P L E T I O N", 0, titleY + 48, { align: "center", width: W, characterSpacing: 2 });

  drawOrnamentalRule(doc, W / 2, titleY + 70, 30);

  // ── Recipient ────────────────────────────────────────────────────────
  const contentInset = 110;
  let y = titleY + 92;
  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text("THIS CERTIFIES THAT", 0, y, { align: "center", width: W, characterSpacing: 2.5 });

  y += 26;
  const nameFontSize = fitNameFontSize(doc, input.recipientName, W - contentInset * 2);
  doc.font("Times-Bold").fontSize(nameFontSize).fillColor(CHARCOAL).text(input.recipientName, contentInset, y, { align: "center", width: W - contentInset * 2 });

  y += nameFontSize + 12;
  doc.save();
  doc.lineWidth(1).strokeColor(GOLD);
  doc.moveTo(W / 2 - 130, y).lineTo(W / 2 + 130, y).stroke();
  doc.restore();

  y += 22;
  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text("HAS SUCCESSFULLY COMPLETED THE", 0, y, { align: "center", width: W, characterSpacing: 2 });

  y += 22;
  doc.font("Times-Bold").fontSize(19).fillColor(GOLD_DEEP).text("XauCloud Forex Academy", 0, y, { align: "center", width: W });

  y += 32;
  const description = curriculumDescription(input.curriculumVersion ?? "v1");
  doc.font("Helvetica").fontSize(9.5).fillColor(CHARCOAL_SOFT).text(description, 130, y, { align: "center", width: W - 260, lineGap: 3 });

  // ── Bottom row: seal | completion + authorization | QR + certificate id ──
  const footerY = H - 158;
  const colW = (W - contentInset * 2) / 3;
  const col1X = contentInset;
  const col2X = contentInset + colW;
  const col3X = contentInset + colW * 2;

  drawSeal(doc, col1X + colW / 2, footerY + 30);

  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text("COMPLETED", col2X, footerY, { width: colW, align: "center", characterSpacing: 1.5 });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(CHARCOAL).text(fmtDate(input.completedAtIso), col2X, footerY + 13, { width: colW, align: "center" });

  doc.font("Times-Italic").fontSize(15).fillColor(GOLD_DEEP).text("XauCloud Team", col2X, footerY + 40, { width: colW, align: "center" });
  doc.save();
  doc.lineWidth(0.6).strokeColor(CHARCOAL_SOFT);
  doc.moveTo(col2X + colW / 2 - 55, footerY + 63).lineTo(col2X + colW / 2 + 55, footerY + 63).stroke();
  doc.restore();
  doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("AUTHORIZED CERTIFICATION", col2X, footerY + 69, { width: colW, align: "center", characterSpacing: 1.5 });

  const qrSize = 68;
  doc.image(qrPng, col3X + colW / 2 - qrSize / 2, footerY - 6, { width: qrSize, height: qrSize });
  doc.font("Helvetica").fontSize(6.5).fillColor(MUTED).text("SCAN TO VERIFY", col3X, footerY + qrSize - 2, { width: colW, align: "center", characterSpacing: 1.2 });
  doc.font("Helvetica").fontSize(6.5).fillColor(MUTED).text("CERTIFICATE ID", col3X, footerY + qrSize + 16, { width: colW, align: "center", characterSpacing: 1.2 });
  doc.font("Courier-Bold").fontSize(8.5).fillColor(CHARCOAL).text(input.certificateId, col3X, footerY + qrSize + 27, { width: colW, align: "center" });

  // ── Legal footer ─────────────────────────────────────────────────────
  doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(
    "This certificate confirms successful completion of the XauCloud Forex Academy educational curriculum and required assessments. It is an\n" +
    "educational credential and does not constitute financial advice, a trading license, professional financial certification, or a guarantee of trading performance.",
    90, H - 44, { align: "center", width: W - 180, lineGap: 2 },
  );

  doc.end();
  return done;
}
