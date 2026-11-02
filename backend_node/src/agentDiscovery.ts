import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSettings } from "./services/settings.js";
import { clientIp, rateLimit } from "./auth.js";

export const SITE_ORIGIN = "https://xaucloud.io";
export const AGENT_PAGES: Record<string, { title: string; description: string; summary: string }> = {
  "/": { title: "XauCloud — Automated Gold Trading for MetaTrader 5", description: "Gold (XAUUSD) automation, documented performance, risk information and official product access.", summary: "XauCloud is gold trading automation for MetaTrader 5, with a connected Command Center. Trading carries risk of loss." },
  "/about": { title: "About XauCloud", description: "Learn what XauCloud builds and what its gold trading software can and cannot do.", summary: "XauCloud develops gold (XAUUSD) automation for MetaTrader 5, with monitoring and risk controls." },
  "/contact": { title: "Contact XauCloud", description: "Official customer support and contact information for XauCloud.", summary: "Use verified customer support details published on this page and the Command Center support interface." },
  "/terms": { title: "XauCloud Terms of Use", description: "Product access, payments, licensing and trading-related terms.", summary: "Read the product's usage and license terms before purchase or activation." },
  "/privacy": { title: "XauCloud Privacy Notice", description: "How the website processes account, order and support information.", summary: "Read XauCloud's public privacy notice regarding website and customer account data." },
  "/risk": { title: "XauCloud Trading Risk Disclosure", description: "Understand the risks and limitations of using automated gold trading software.", summary: "Automated leveraged trading risks a partial or total loss of trading capital." },
  "/performance": { title: "XauCloud Trading Performance", description: "See reported XauCloud trading results and their source classifications.", summary: "Review published performance separately from simulated or historical backtest results. No future results are guaranteed." },
  "/performance/history": { title: "XauCloud Performance History", description: "Published performance records for XauCloud.", summary: "Explore published trading performance periods and their documented sources." },
  "/ai-market-outlook": { title: "XauCloud Gold Market Outlook", description: "A gold market outlook derived from the available XauCloud data.", summary: "Market outlook information is not guaranteed trading advice." },
  "/labs": { title: "XauCloud Labs", description: "Research and experimental tools in the XauCloud experience.", summary: "Research tools and learning materials; verify feature availability in the actual application." },
  "/command": { title: "XauCloud Command Center", description: "Enter XauCloud's secure Command Center.", summary: "Access monitoring and license controls by signing in." },
};

const appOnly = new Set([
  "/command/signup", "/command/login", "/command/forgot-password", "/command/reset-password",
  "/command/dashboard", "/cloud", "/cloud/signup", "/cloud/login", "/cloud/forgot-password",
  "/cloud/reset-password", "/cloud/dashboard", "/purchase/success", "/purchase/cancel", "/admin",
]);
const allowedDynamic = [/^\/admin\/[a-zA-Z0-9/_-]+$/, /^\/verify-certificate\/[a-zA-Z0-9_-]{4,100}$/, /^\/campaign\/[a-zA-Z0-9_-]{2,100}$/];

export function isSpaPath(path: string): boolean {
  return Boolean(AGENT_PAGES[path] || appOnly.has(path) || allowedDynamic.some((pattern) => pattern.test(path)));
}

function safe(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function nonempty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
const MQL5_URL = "https://www.mql5.com/en/market/product/188838";
const CREATOR_URL = "https://x.com/ghostcdev?s=11";

export function publicIdentity(settings: Record<string, unknown>) {
  const email = nonempty(settings["support_email"]);
  const phone = nonempty(settings["support_phone"]);
  const street = nonempty(settings["organization_street_address"]);
  const city = nonempty(settings["organization_city"]);
  const region = nonempty(settings["organization_region"]);
  const country = nonempty(settings["organization_country"]);
  const postalCode = nonempty(settings["organization_postal_code"]);
  const address = street && city && country ? {
    "@type": "PostalAddress", streetAddress: street, addressLocality: city,
    ...(region && { addressRegion: region }), ...(postalCode && { postalCode }),
    addressCountry: country,
  } : null;
  return { email: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : "",
    phone: /^\+?[0-9()\s-]{7,25}$/.test(phone) ? phone : "", address };
}

function organizationJson(settings: Record<string, unknown>) {
  const id = publicIdentity(settings);
  return {
    "@context": "https://schema.org", "@type": "Organization", "@id": SITE_ORIGIN + "/#organization",
    name: "XauCloud", url: SITE_ORIGIN + "/", logo: SITE_ORIGIN + "/xauai-logo.png",
    description: "Trading technology for Gold (XAUUSD) on MetaTrader 5.",
    // This is an external listing of the *product*, not a claim that the creator's X account is the corporate account.
    ...(id.email && { email: id.email }),
    ...(id.phone && { telephone: id.phone }),
    ...(id.address && { address: id.address }),
    contactPoint: id.email || id.phone ? [{
      "@type": "ContactPoint", contactType: "customer support",
      ...(id.email && { email: id.email }), ...(id.phone && { telephone: id.phone }),
    }] : [],
  };
}

export function makeAgentHtml(template: string, path: string, settings: Record<string, unknown>): string {
  const page = AGENT_PAGES[path] ?? { title: "XauCloud Command Center", description: "Secure XauCloud account access.", summary: "" };
  const id = publicIdentity(settings);
  const links = '<nav aria-label="Public site links"><a href="/about">About</a> · <a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/risk">Risk disclosure</a></nav>';
  // CRA will replace the HTML fallback on load. An agent fetching HTML without JS gets ONE informative heading.
  const fallback = '<h1>' + safe(page.title.replace(/^XauCloud — /, "")) + '</h1><p>' + safe(page.summary) + '</p>' + links +
    (id.email ? '<p>Support: <a href="mailto:' + safe(id.email) + '">' + safe(id.email) + '</a></p>' : "") +
    (id.phone ? '<p>Telephone: <a href="tel:' + safe(id.phone.replace(/[\s()-]/g, "")) + '">' + safe(id.phone) + '</a></p>' : "");
  const payload = JSON.stringify(organizationJson(settings)).replace(/</g, "\\u003c");
  const product = JSON.stringify({
    "@context": "https://schema.org", "@type": "SoftwareApplication",
    "@id": SITE_ORIGIN + "/#software", name: "XauCloud", url: SITE_ORIGIN + "/",
    applicationCategory: "FinanceApplication", operatingSystem: "MetaTrader 5",
    description: "Automated Gold (XAUUSD) trading Expert Advisor for MetaTrader 5.",
    sameAs: [MQL5_URL], creator: { "@type": "Person", name: "Emriz", sameAs: [CREATOR_URL] },
  }).replace(/</g, "\\u003c");
  return template
    .replace(/<title>[^<]*<\/title>/, "<title>" + safe(page.title) + "</title>")
    .replace(/<link rel="canonical" href="[^"]*" \/>/, '<link rel="canonical" href="' + SITE_ORIGIN + path + '" />')
    .replace(/<div id="root"><\/div>/, '<div id="root">' + fallback + "</div>")
    .replace("</head>", '<script type="application/ld+json">' + payload + '</script><script type="application/ld+json">' + product + '</script></head>');
}

export function markdownFor(path: string, settings: Record<string, unknown>): string {
  const page = AGENT_PAGES[path] ?? AGENT_PAGES["/"]!;
  const id = publicIdentity(settings);
  const lines = ["# " + page.title, "", "> " + page.description, "", page.summary, "",
    "## Official pages", "",
    ...Object.entries(AGENT_PAGES).map(([route, value]) => "- [" + value.title + "](" + SITE_ORIGIN + (route === "/" ? "/" : route) + ")"),
    "", "## External product listing", "",
    "- [XauCloud on MQL5](" + MQL5_URL + ")", "", "## Contact", ""];
  if (id.email) lines.push("- Email: " + id.email);
  if (id.phone) lines.push("- Telephone: " + id.phone);
  if (!id.email && !id.phone) lines.push("Contact the support team through your XauCloud Command Center account.");
  lines.push("", "## Trading risk", "", "Trading can lose the full capital at risk. Published results are not a promise of future performance.", "");
  return lines.join("\n");
}
const tools = [
  { name: "list_public_pages", description: "List published public XauCloud pages and their URLs. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_product_overview", description: "Explain XauCloud's product scope, trial and risk statement. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];
export const MCP_CARD = {
  "$schema": "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
  version: "1.0", protocolVersion: "2025-06-18",
  serverInfo: { name: "xaucloud-public", title: "XauCloud Public Information", version: "1.0.0" },
  description: "Read-only public XauCloud product and page discovery; no account access or trading execution.",
  documentationUrl: SITE_ORIGIN + "/llms.txt",
  transport: { type: "streamable-http", endpoint: SITE_ORIGIN + "/mcp" },
  capabilities: { tools: { listChanged: false } },
  tools, authentication: { required: false, schemes: [] },
};

export async function registerAgentDiscovery(app: FastifyInstance, indexHtml: Buffer | null): Promise<void> {
  function common(reply: FastifyReply) {
    reply.header("Link", '</llms.txt>; rel="describedby"; type="text/plain", </index.md>; rel="alternate"; type="text/markdown"');
    reply.header("Vary", "Accept");
    return reply;
  }
  const render = async (request: FastifyRequest, reply: FastifyReply, path: string) => {
    rateLimit("agent_page:" + clientIp(request), 100, 60);
    const settings = await getSettings();
    common(reply);
    const wantsMarkdown = String(request.headers.accept ?? "").split(",").some((v) => v.trim().toLowerCase().startsWith("text/markdown"));
    if (wantsMarkdown) return reply.type("text/markdown; charset=utf-8").send(markdownFor(path, settings));
    if (!indexHtml) return reply.code(503).send({ detail: "The website build is not available." });
    return reply.type("text/html; charset=utf-8").send(makeAgentHtml(indexHtml.toString("utf8"), path, settings));
  };
  app.get("/", (request, reply) => render(request, reply, "/"));
  app.get("/index.md", async (request, reply) => {
    rateLimit("agent_markdown:" + clientIp(request), 60, 60);
    return reply.type("text/markdown; charset=utf-8").header("Cache-Control", "public, max-age=300")
      .send(markdownFor("/", await getSettings()));
  });
  app.get("/.well-known/mcp/server-card.json", async (request, reply) => {
    rateLimit("agent_card:" + clientIp(request), 60, 60);
    return reply.type("application/json; charset=utf-8").headers({
      "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET",
      "Cache-Control": "public, max-age=3600",
    }).send(MCP_CARD);
  });
  app.get("/mcp", async (_request, reply) => reply.code(405).header("Allow", "POST").send({ error: "Use Streamable HTTP POST." }));
  app.post("/mcp", { bodyLimit: 32_000 }, async (request, reply) => {
    rateLimit("public_mcp:" + clientIp(request), 30, 60);
    const origin = nonempty(request.headers.origin);
    if (origin && origin !== SITE_ORIGIN) return reply.code(403).send({ error: "Origin not allowed" });
    const body = request.body;
    const valid = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!valid || valid["jsonrpc"] !== "2.0" || typeof valid["method"] !== "string") {
      return reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid JSON-RPC request" } });
    }
    const method = valid["method"];
    if (method === "notifications/initialized" && valid["id"] === undefined) return reply.code(202).send();
    const id = valid["id"];
    if (typeof id !== "string" && typeof id !== "number") {
      return reply.code(400).send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request id required" } });
    }
    const send = (result: unknown) => reply.type("application/json").send({ jsonrpc: "2.0", id, result });
    if (method === "initialize") {
      return send({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_CARD.serverInfo, instructions: "Public read-only content. Never use this endpoint to place trades or approve payments." });
    }
    const version = request.headers["mcp-protocol-version"];
    if (version !== "2025-06-18") {
      return reply.code(400).send({ jsonrpc: "2.0", id, error: { code: -32600, message: "Supported MCP version: 2025-06-18" } });
    }
    if (method === "ping") return send({});
    if (method === "tools/list") return send({ tools });
    if (method === "tools/call") {
      const params = valid["params"] as Record<string, unknown> | undefined;
      const name = params && typeof params === "object" ? params["name"] : undefined;
      let output: string;
      if (name === "list_public_pages") output = Object.entries(AGENT_PAGES).map(([p, v]) => v.title + ": " + SITE_ORIGIN + p).join("\n");
      else if (name === "get_product_overview") output = AGENT_PAGES["/"]!.summary + " A three-market-day signals trial and one-time EA license are the available purchase paths; the official price must be verified with the live pricing API.";
      else return reply.code(404).send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown tool" } });
      return send({ content: [{ type: "text", text: output }], isError: false });
    }
    return reply.code(404).send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  });
  for (const route of Object.keys(AGENT_PAGES).filter((p) => p !== "/")) {
    app.get(route, (request, reply) => render(request, reply, route));
  }
}
