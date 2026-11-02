import Fastify from "fastify";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { join } from "node:path";

const env = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock("./services/settings.js", () => ({ getSettings: async () => env.settings }));
vi.mock("./auth.js", () => ({ clientIp: () => "127.0.0.1", rateLimit: () => {} }));
const { registerAgentDiscovery, isSpaPath, makeAgentHtml, markdownFor, MCP_CARD, publicIdentity } =
  await import("./agentDiscovery.js");

const template = '<!doctype html><html><head><title>Old title</title><link rel="canonical" href="https://xaucloud.io/" /></head><body><div id="root"></div></body></html>';
describe("XauCloud agent-ready discovery", () => {
  beforeEach(() => { env.settings = {}; });

  it("recognizes real public/secure client paths but does not give random URLs a 200", () => {
    for (const path of ["/", "/about", "/contact", "/terms", "/risk", "/performance", "/command/login"]) {
      expect(isSpaPath(path), path).toBe(true);
    }
    for (const path of ["/gibberish-404-check-2026", "/llms-not-real", "/api/unused", "/fake/buy", "/../private"]) {
      expect(isSpaPath(path), path).toBe(false);
    }
    const indexSource = fs.readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(indexSource).toContain("isSpaPath(route)");
    expect(indexSource).toContain("reply.code(404)");
    expect(indexSource).not.toContain('request.url !== "/health" && indexHtml');
  });

  it("SSR fallback has exactly one h1, a canonical route and no fake business details", () => {
    const html = makeAgentHtml(template, "/about", {});
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>About XauCloud</h1>");
    expect(html).toContain('rel="canonical" href="https://xaucloud.io/about"');
    expect(html).not.toContain('"telephone"');
    expect(html).not.toContain('"address"');
    expect(html).toContain('"sameAs"');
  });

  it("publishes authorized contact fields and postal address, not placeholders", () => {
    env.settings = {
      support_email: "help@example.com", support_phone: "+234 801 123 4567",
      organization_street_address: "12 Verified Street", organization_city: "Abuja",
      organization_region: "FCT", organization_country: "NG"
    };
    const details = publicIdentity(env.settings);
    expect(details.address?.addressLocality).toBe("Abuja");
    expect(details.phone).toBe("+234 801 123 4567");
    const html = makeAgentHtml(template, "/contact", env.settings);
    expect(html).toContain("mailto:help@example.com");
    expect(html).toContain("tel:+2348011234567");
    expect(html).toContain('"addressLocality":"Abuja"');
  });

  it("serves Markdown on Accept text/markdown and advertises alternate links", async () => {
    const app = Fastify();
    await registerAgentDiscovery(app, Buffer.from(template));
    const md = await app.inject({ method: "GET", url: "/", headers: { accept: "text/markdown, text/html;q=0.8" } });
    expect(md.statusCode).toBe(200);
    expect(md.headers["content-type"]).toContain("text/markdown");
    expect(md.body).toMatch(/^# XauCloud/m);
    expect(md.headers["link"]).toContain("llms.txt");
    const html = await app.inject({ method: "GET", url: "/about", headers: { accept: "text/html" } });
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.body).toContain("<h1>About XauCloud</h1>");
    await app.close();
  });

  it("serves a real MCP card and read-only MCP tools over JSON-RPC HTTP", async () => {
    const app = Fastify();
    await registerAgentDiscovery(app, Buffer.from(template));
    const card = await app.inject({ method: "GET", url: "/.well-known/mcp/server-card.json" });
    expect(card.statusCode).toBe(200);
    expect(card.headers["content-type"]).toContain("application/json");
    expect(card.json()).toMatchObject({ transport: { endpoint: "https://xaucloud.io/mcp" },
      capabilities: { tools: { listChanged: false } } });
    expect(MCP_CARD.tools).toHaveLength(2);
    const init = await app.inject({ method: "POST", url: "/mcp",
      headers: { origin: "https://xaucloud.io", accept: "application/json, text/event-stream" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.protocolVersion).toBe("2025-06-18");
    const list = await app.inject({ method: "POST", url: "/mcp", headers: { "mcp-protocol-version": "2025-06-18" },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(list.statusCode).toBe(200);
    expect(list.json().result.tools).toHaveLength(2);
    const call = await app.inject({ method: "POST", url: "/mcp", headers: { "mcp-protocol-version": "2025-06-18" },
      payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_public_pages", arguments: {} } } });
    expect(call.statusCode).toBe(200);
    expect(call.json().result.content[0].text).toContain("https://xaucloud.io/about");
    const blocked = await app.inject({ method: "POST", url: "/mcp", headers: { origin: "https://evil.example" },
      payload: { jsonrpc: "2.0", id: 4, method: "tools/list" } });
    expect(blocked.statusCode).toBe(403);
    await app.close();
  });

  it("writes plain llms and sitemap source assets for both build and server", () => {
    for (const prefix of ["../frontend/public", "./public"]) {
      const robots = fs.readFileSync(join(process.cwd(), prefix, "robots.txt"), "utf8");
      const llms = fs.readFileSync(join(process.cwd(), prefix, "llms.txt"), "utf8");
      const sitemap = fs.readFileSync(join(process.cwd(), prefix, "sitemap.xml"), "utf8");
      expect(robots).toContain("Content-Signal: search=yes, ai-train=no");
      expect(llms.startsWith("# XauCloud\n")).toBe(true);
      expect(llms).toContain("> XauCloud");
      expect(llms).toContain("[Contact and support](https://xaucloud.io/contact)");
      expect(sitemap).toContain("<lastmod>");
      expect(sitemap).toContain("/terms</loc>");
    }
  });

  it("Markdown copy includes published navigation but no invented returns", () => {
    const md = markdownFor("/", {});
    expect(md).toContain("https://xaucloud.io/risk");
    expect(md).toContain("not a promise of future performance");
    expect(md).not.toMatch(/guaranteed monthly profit/i);
  });
});
