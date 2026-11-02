#!/usr/bin/env node
/**
 * Emit an accurate per-URL sitemap lastmod date using the latest Git commit
 * affecting the relevant route content. Do not invent a date from build time.
 *
 * CRA prebuild runs this with cwd=frontend. If a shallow CI checkout cannot
 * resolve a path, retain the most recently source-verified dated fallback.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  { url: "/", path: "frontend/src/App.js", secondary: "frontend/src/components/HeroSection.jsx", baseline: "2026-11-02", priority: "1.0" },
  { url: "/about", path: "frontend/src/pages/InfoPage.jsx", baseline: "2026-11-02", priority: "0.6" },
  { url: "/contact", path: "frontend/src/pages/InfoPage.jsx", baseline: "2026-11-02", priority: "0.6" },
  { url: "/terms", path: "frontend/src/pages/InfoPage.jsx", baseline: "2026-11-02", priority: "0.5" },
  { url: "/privacy", path: "frontend/src/pages/InfoPage.jsx", baseline: "2026-11-02", priority: "0.5" },
  { url: "/risk", path: "frontend/src/pages/InfoPage.jsx", baseline: "2026-11-02", priority: "0.5" },
  { url: "/performance", path: "frontend/src/pages/PerformancePage.jsx", baseline: "2026-09-01", priority: "0.8" },
  { url: "/performance/history", path: "frontend/src/pages/PerformanceHistoryPage.jsx", baseline: "2026-09-01", priority: "0.6" },
  { url: "/ai-market-outlook", path: "frontend/src/pages/AIMarketOutlookPage.jsx", baseline: "2026-09-18", priority: "0.7" },
  { url: "/labs", path: "frontend/src/pages/LabsPage.jsx", baseline: "2026-09-01", priority: "0.4" },
  { url: "/command", path: "frontend/src/components/cloud/CloudLanding.jsx", baseline: "2026-09-01", priority: "0.4" },
];
function gitLastModified(file) {
  try {
    const v = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], {
      cwd: root, encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch { return null; }
}
const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
for (const p of pages) {
  const versions = [p.baseline, gitLastModified(p.path), p.secondary && gitLastModified(p.secondary)].filter(Boolean);
  const lastmod = versions.sort().at(-1);
  xml.push('  <url>', '    <loc>https://xaucloud.io' + (p.url === "/" ? "/" : p.url) + '</loc>',
    '    <lastmod>' + lastmod + '</lastmod>',
    '    <priority>' + p.priority + '</priority>', '  </url>');
}
xml.push('</urlset>', '');
writeFileSync(path.join(root, "frontend", "public", "sitemap.xml"), xml.join("\n"), "utf8");
console.info("Generated sitemap with per-page Git modification dates.");
