const fs = require("fs");
const path = require("path");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const luminance = (hex) => {
  const values = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = values.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("Public light theme readability contract", () => {
  test.each([
    ["hero supporting text", "#425956", "#fcfdfb"],
    ["footer text", "#193532", "#eef4f0"],
    ["footer links", "#36564f", "#eef4f0"],
    ["footer risk notice", "#4d635c", "#eef4f0"],
    ["purchase description", "#445955", "#f6f9f6"],
    ["purchase secondary text", "#4c6058", "#fffaf0"],
    ["purchase gold label", "#795719", "#fffaf0"],
    ["checkout secondary text", "#52635d", "#f9f8f5"],
    ["dark purchase CTA", "#ffffff", "#183d3b"],
  ])("%s meets 4.5:1 text contrast", (name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  test("header, footer and purchase surfaces are light with readable typography", () => {
    const header = read("components/Header.jsx");
    const footer = read("components/Footer.jsx");
    const purchase = read("components/PurchaseSection.jsx");
    expect(header).toContain("bg-white/95 text-[#183133]");
    expect(footer).toContain("bg-[#eef4f0]");
    expect(footer).not.toContain("text-white/");
    expect(purchase).toContain('data-testid="purchase-form"');
    expect(purchase).toContain("bg-[#fffaf0]");
    expect(purchase).not.toContain("bg-[#182e31]");
    expect(purchase).toContain("bg-[#183d3b]");
  });

  test("checkout fields and navigation have legible contrast and visible keyboard focus", () => {
    const checkout = read("components/ManualCheckout.jsx");
    const css = read("index.css");
    expect(checkout).toContain("placeholder:text-[#5b7068]");
    expect(checkout).toContain("focus:ring-2");
    expect(css).toContain('data-testid="manual-checkout"');
    expect(css).toContain("focus-visible");
    expect(css).toContain("html:has(.xc-marketing)");
  });

  test("the same public theme applies to informational pages without changing the terminal", () => {
    const info = read("pages/InfoPage.jsx");
    const dashboard = read("components/cloud/CloudDashboard.jsx");
    expect(info).toContain('data-testid="info-page"');
    expect(dashboard).toContain('const CARD = "rounded-2xl bg-[#0C0D12]"');
  });
});
