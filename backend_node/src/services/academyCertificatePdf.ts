/**
 * Landscape PDF certificate rendering (pdfkit, pure JS -- no native/Chromium
 * dependency, safe for Hostinger's Node hosting). Uses pdfkit's built-in
 * standard fonts (Helvetica/Times families) so nothing needs to be embedded
 * or shipped as a separate asset -- they render identically on every PDF
 * viewer. Branding is a styled text wordmark (matching the existing HTML
 * transactional emails, which also render "XauCloud" as styled text rather
 * than an embedded logo image) rather than a raster logo file.
 */
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const GOLD = "#D4AF37";
const CREAM = "#F5F0E1";
const MUTED = "#A8A29E";
const INK = "#0A0A0A";
const PANEL = "#131313";

export interface CertificatePdfInput {
  recipientName: string;
  certificateId: string;
  completedAtIso: string;
  verifyUrl: string;
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
  let size = 34;
  doc.font("Times-Bold");
  doc.fontSize(size);
  while (size > 16 && doc.widthOfString(name) > maxWidth) {
    size -= 1;
    doc.fontSize(size);
  }
  return size;
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(input.verifyUrl, { margin: 1, color: { dark: "#0A0A0A", light: "#F5F0E1" }, width: 220 });

  const doc = new PDFDocument({ layout: "landscape", size: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  const H = doc.page.height;

  // Background + outer/inner border frame.
  doc.rect(0, 0, W, H).fill(INK);
  doc.rect(24, 24, W - 48, H - 48).lineWidth(1.5).stroke(GOLD);
  doc.rect(34, 34, W - 68, H - 68).lineWidth(0.5).stroke("#3A3A3C");

  // Wordmark.
  doc.font("Helvetica-Bold").fontSize(20).fillColor(GOLD).text("XAUCLOUD", 0, 62, { align: "center", width: W });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("BUILT FOR GOLD", 0, 86, { align: "center", width: W, characterSpacing: 2 });

  // Title.
  doc.font("Helvetica-Bold").fontSize(13).fillColor(CREAM).text("CERTIFICATE OF COMPLETION", 0, 128, { align: "center", width: W, characterSpacing: 3 });

  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("This certifies that", 0, 168, { align: "center", width: W });

  const nameFontSize = fitNameFontSize(doc, input.recipientName, W - 200);
  doc.font("Times-Bold").fontSize(nameFontSize).fillColor(GOLD).text(input.recipientName, 100, 196, { align: "center", width: W - 200 });

  doc.moveTo(W / 2 - 140, 196 + nameFontSize + 18).lineTo(W / 2 + 140, 196 + nameFontSize + 18).lineWidth(0.75).stroke("#3A3A3C");

  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("has successfully completed the", 0, 196 + nameFontSize + 34, { align: "center", width: W });
  doc.font("Helvetica-Bold").fontSize(15).fillColor(CREAM).text("XauCloud Forex Academy", 0, 196 + nameFontSize + 54, { align: "center", width: W });

  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(
    "curriculum covering foundational trading concepts, market mechanics, risk management,\nprice action, trading psychology, Gold/XAUUSD and trading systems.",
    80, 196 + nameFontSize + 82, { align: "center", width: W - 160, lineGap: 3 },
  );

  // Footer strip: completion date (left), QR (center), certificate id (right).
  const footerY = H - 150;
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("COMPLETED", 80, footerY, { characterSpacing: 1.5 });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(CREAM).text(fmtDate(input.completedAtIso), 80, footerY + 14);

  doc.image(qrPng, W / 2 - 45, footerY - 15, { width: 90, height: 90 });
  doc.font("Helvetica").fontSize(7).fillColor(MUTED).text("Scan to verify", W / 2 - 45, footerY + 78, { width: 90, align: "center" });

  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("CERTIFICATE ID", 0, footerY, { align: "right", width: W - 80, characterSpacing: 1.5 });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(CREAM).text(input.certificateId, 0, footerY + 14, { align: "right", width: W - 80 });

  doc.font("Helvetica").fontSize(7.5).fillColor("#5A5A5E").text(
    "This certificate confirms completion of the XauCloud Forex Academy educational curriculum only. It is not a trading license, financial\n" +
    "qualification, or professional accreditation, and does not guarantee trading performance or authorize management of client funds.",
    80, H - 46, { align: "center", width: W - 160, lineGap: 2 },
  );

  doc.end();
  return done;
}
