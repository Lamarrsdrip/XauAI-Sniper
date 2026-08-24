import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./httpSecurity.js";

function capture(path: string, production = true): Record<string, string> {
  const headers: Record<string, string> = {};
  applySecurityHeaders({ header(name: string, value: string) { headers[name] = value; return this; } } as never, path, production);
  return headers;
}

describe("HTTP security headers", () => {
  it("protects browser responses and enables HSTS in production", () => {
    const headers = capture("/");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["strict-transport-security"]).toContain("max-age=31536000");
  });

  it.each(["/api/admin/settings", "/api/auth/login", "/api/cloud/monitor/status"])("prevents sensitive API caching for %s", (path) => {
    expect(capture(path)["cache-control"]).toBe("no-store");
  });

  it("does not add HSTS to non-production local HTTP", () => {
    expect(capture("/", false)["strict-transport-security"]).toBeUndefined();
  });
});
