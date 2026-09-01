import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./xPosting.ts", import.meta.url), "utf8");

describe("admin X posting routes", () => {
  it("requires the normal admin session and never accepts an X token", () => {
    expect(source).toContain('preHandler: requireAdmin');
    expect(source).toContain('app.get("/admin/x-posting"');
    expect(source).toContain('app.get("/admin/x-posting/oauth/connect"');
    expect(source).toContain('app.get("/admin/x-posting/oauth/callback"');
    expect(source).toContain('startXOAuthConnection');
    expect(source).toContain('completeXOAuthConnection');
    expect(source).toContain('app.put("/admin/x-posting"');
    expect(source).toContain('confirm: z.literal(true)');
    expect(source).not.toMatch(/x_user_access_token:\s*z\./i);
  });
});
