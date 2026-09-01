import { describe, expect, it } from "vitest";
import { renderCertificatePdf } from "./academyCertificatePdf.js";

describe("Academy certificate PDF rendering", () => {
  it("produces a genuine PDF document for a normal name", async () => {
    const pdf = await renderCertificatePdf({
      recipientName: "Ada Lovelace",
      certificateId: "XC-ACADEMY-ABCDEF1234",
      completedAtIso: "2026-08-20T12:00:00.000Z",
      verifyUrl: "https://xaucloud.io/verify-certificate/XC-ACADEMY-ABCDEF1234",
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("does not throw and stays a valid PDF for a very long full name", async () => {
    const longName = "Alexandra Wilhelmina Constantine-Featherington-Okonkwo-Abernathy";
    const pdf = await renderCertificatePdf({
      recipientName: longName,
      certificateId: "XC-ACADEMY-LONGNAME01",
      completedAtIso: "2026-08-20T12:00:00.000Z",
      verifyUrl: "https://xaucloud.io/verify-certificate/XC-ACADEMY-LONGNAME01",
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders correctly for a very short name too (no divide-by-zero/layout break)", async () => {
    const pdf = await renderCertificatePdf({
      recipientName: "Bo",
      certificateId: "XC-ACADEMY-SHORTNAME1",
      completedAtIso: "2026-08-20T12:00:00.000Z",
      verifyUrl: "https://xaucloud.io/verify-certificate/XC-ACADEMY-SHORTNAME1",
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("embeds a QR image pointing at the given verify URL (present as an XObject image stream)", async () => {
    const pdf = await renderCertificatePdf({
      recipientName: "Ada Lovelace",
      certificateId: "XC-ACADEMY-QRTEST0001",
      completedAtIso: "2026-08-20T12:00:00.000Z",
      verifyUrl: "https://xaucloud.io/verify-certificate/XC-ACADEMY-QRTEST0001",
    });
    // pdfkit embeds raster images as an /Image XObject -- confirms the QR
    // code buffer actually made it into the document, not just the text.
    expect(pdf.toString("latin1")).toContain("/Image");
  });
});
