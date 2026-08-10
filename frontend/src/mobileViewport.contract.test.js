import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const sourceHtml = read("../public/index.html");
const productionHtml = read("../../backend_node/public/index.html");
const styles = read("index.css");
const manifest = read("../public/manifest.json");
const guards = read("viewportGuards.js");

const viewportMeta = (html) => html.match(/<meta\s+[^>]*name=["']viewport["'][^>]*>/gi) || [];
const requiredViewport = [
  "width=device-width",
  "initial-scale=1",
  "maximum-scale=1",
  "minimum-scale=1",
  "user-scalable=no",
  "viewport-fit=cover",
];

describe("mobile/PWA scale contract", () => {
  test("source and production each have one complete viewport declaration", () => {
    for (const html of [sourceHtml, productionHtml]) {
      const metas = viewportMeta(html);
      expect(metas).toHaveLength(1);
      for (const value of requiredViewport) expect(metas[0]).toContain(value);
    }
  });

  test("mobile controls prevent double-tap zoom without disabling vertical scrolling", () => {
    expect(styles).toContain("touch-action: manipulation");
    expect(styles).toContain("@media (max-width: 767px)");
    expect(styles).toContain('input, textarea, select, [contenteditable="true"]');
    expect(styles).toContain("font-size: 16px !important");
    expect(styles).toContain("-webkit-overflow-scrolling: touch");
    expect(styles).not.toContain("touch-action: none");
    expect(guards).toContain('document.addEventListener("gesturestart"');
    expect(guards).toContain("if (event.touches.length > 1) event.preventDefault()");
  });

  test("PWA remains standalone", () => {
    expect(JSON.parse(manifest).display).toBe("standalone");
  });
});
