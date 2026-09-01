import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const landing = read("components/cloud/CloudLanding.jsx");
const dashboard = read("components/cloud/CloudDashboard.jsx");
const auth = read("components/cloud/CloudAuth.jsx");

// Product decision (2026-08-25): XauCloud has exactly ONE homepage.
// CloudLanding ("/command") used to render its own separate "welcome to
// XauCloud" marketing page -- distinct copy from the real public homepage
// at "/" -- for anyone not currently authenticated. A visitor could land on
// two different introductions to the product depending on the URL. This
// was fixed twice: first (wrong) to only redirect an authenticated visitor
// while still showing the marketing page to a logged-out one, which still
// left a second homepage in place; then corrected so "/command" never
// renders marketing content at all, for anyone, logged in or not.
describe("/command is a pure routing gate -- never a second homepage", () => {
  test("CloudLanding renders no marketing copy of its own -- only a redirect + loading state", () => {
    expect(landing).not.toMatch(/Gold signals and bot monitoring/i);
    expect(landing).not.toMatch(/Start free 3-day trial/i);
    expect(landing).not.toContain("FEATURES");
    expect(landing).not.toContain("INCLUDED");
  });

  test("an authenticated visitor is routed straight into the dashboard", () => {
    expect(landing).toContain("/cloud/auth/me");
    expect(landing).toMatch(/navigate\(["']\/command\/dashboard["'],\s*\{\s*replace:\s*true\s*\}\)/);
  });

  test("an unauthenticated visitor is routed straight to login -- not shown a marketing page", () => {
    expect(landing).toMatch(/navigate\(["']\/command\/login["'],\s*\{\s*replace:\s*true\s*\}\)/);
  });

  test("the auth check has a bounded timeout so a visitor can never be stuck on the spinner forever", () => {
    expect(landing).toContain("timeout: 5000");
  });

  test("the dashboard's own header logo goes straight to the dashboard, not back through the gate", () => {
    expect(dashboard).toContain('<Link to="/command/dashboard" className="flex min-w-0 items-center gap-2.5">');
    expect(dashboard).not.toContain('<Link to="/command" className="flex min-w-0 items-center gap-2.5">');
  });

  test("login/signup still land the user in the dashboard directly (unaffected by this fix)", () => {
    expect(auth).toContain('nav("/command/dashboard")');
  });
});
