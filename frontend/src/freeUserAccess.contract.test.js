import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");

// Superseded by the 2026-08-25 "ONE Command Center" refactor: there is no
// longer a second, smaller dashboard component that free/trial users get
// routed into (see signalEntitlementGate.contract.test.js for the full
// architecture contract). Academy and Support live directly inside
// CloudDashboard.jsx's single shared nav/router now, reachable identically
// for every signed-in user regardless of bot ownership -- these tests
// verify that specifically.
describe("Academy + Support are real, universal Command Center features -- not a stripped-down duplicate", () => {
  test("EducationPage/SupportCenterPage are real function declarations, rendered directly by the one shared router", () => {
    expect(dashboard).toMatch(/export function EducationPage\(/);
    expect(dashboard).toMatch(/export function SupportCenterPage\(/);
    expect(dashboard).toMatch(/active==="education"\s*&&\s*<EducationPage/);
    expect(dashboard).toMatch(/active==="support"\s*&&\s*<SupportCenterPage/);
  });

  test("Academy and Support nav entries are unconditional -- not gated on ownsBot/entitlement like the bot-personal tabs", () => {
    const eduLine = dashboard.match(/active==="education"[^\n]*/)[0];
    const supportLine = dashboard.match(/active==="support"[^\n]*/)[0];
    expect(eduLine).not.toMatch(/ownsBot/);
    expect(supportLine).not.toMatch(/ownsBot/);
  });

  test("Academy and Support routes require no plan/capability -- confirmed against the actual backend source, not assumed", () => {
    const academyRoute = fs.readFileSync(path.join(__dirname, "../../backend_node/src/routes/cloud/academy.ts"), "utf8");
    const supportRoute = fs.readFileSync(path.join(__dirname, "../../backend_node/src/routes/cloud/support.ts"), "utf8");
    expect(academyRoute).not.toContain("requireCapability");
    expect(supportRoute).not.toContain("requireCapability");
    expect(academyRoute).toContain("requireCloudUser");
    expect(supportRoute).toContain("requireCloudUser");
  });

  test("bot-only teaser gives a real purchase CTA, not just a passive lock icon", () => {
    expect(dashboard).toContain("Get XauCloud Bot");
    expect(dashboard).toContain("This feature connects directly to your personal XauCloud trading bot and MT5 account.");
  });

  test("Home's Continue Learning card links straight into the Academy tab", () => {
    expect(dashboard).toMatch(/setActive\("education"\)/);
  });
});
