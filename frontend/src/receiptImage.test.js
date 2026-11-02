const { describeReceiptFile } = require("./receiptImage");

describe("receipt upload guard", () => {
  test("accepts phone photos and screenshots, including HEIC", () => {
    expect(describeReceiptFile({ type: "image/jpeg", name: "IMG_1.JPG", size: 4_000_000 }).ok).toBe(true);
    expect(describeReceiptFile({ type: "image/heic", name: "receipt.HEIC", size: 3_000_000 }).ok).toBe(true);
    expect(describeReceiptFile({ type: "", name: "image", size: 1_800_000 }).ok).toBe(true);
    expect(describeReceiptFile({ type: "", name: "Screenshot.png", size: 2_500_000 }).ok).toBe(true);
  });

  test("rejects non-images and oversized camera rolls before upload starts", () => {
    expect(describeReceiptFile({ type: "application/pdf", name: "receipt.pdf", size: 1000 }).ok).toBe(false);
    expect(describeReceiptFile({ type: "image/jpeg", name: "huge.jpg", size: 26 * 1024 * 1024 }).error)
      .toMatch(/under 25 MB/);
    expect(describeReceiptFile(null).ok).toBe(false);
  });
});
