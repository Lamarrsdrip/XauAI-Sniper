import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const landing = read("components/cloud/CloudLanding.jsx");
const dashboard = read("components/cloud/CloudDashboard.jsx");
const auth = read("components/cloud/CloudAuth.jsx");

// Bug found during the platform-unification audit (2026-08-25): /command
// (CloudLanding, the logged-out marketing page for the authenticated
// product) never checked auth state -- an already-signed-in user landed
// back on "Log in / Create account" every time they visited it, including
// every time they tapped their OWN dashboard's header logo, which linked
// there. This is the literal "website -> Command Center homepage -> another
// dashboard" bounce the unification request described.
describe("no redundant Command Center homepage for an already-authenticated user", () => {
  test("CloudLanding checks auth and redirects an existing session straight into the dashboard", () => {
    expect(landing).toContain("/cloud/auth/me");
    expect(landing).toMatch(/navigate\(["']\/command\/dashboard["'],\s*\{\s*replace:\s*true\s*\}\)/);
  });

  test("a failed/timed-out auth check still shows the logged-out marketing page -- never traps a real visitor on a blank spinner", () => {
    expect(landing).toContain("timeout: 5000");
    expect(landing).toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setChecking\(false\); \}\)/);
  });

  test("the dashboard's own header logo goes straight to the dashboard, not back through the marketing page", () => {
    expect(dashboard).toContain('<Link to="/command/dashboard" className="flex min-w-0 items-center gap-2.5">');
    expect(dashboard).not.toContain('<Link to="/command" className="flex min-w-0 items-center gap-2.5">');
  });

  test("login/signup still land the user in the dashboard directly (unaffected by this fix)", () => {
    expect(auth).toContain('nav("/command/dashboard")');
  });
});
