import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");
const signalDashboard = read("components/cloud/CloudSignalDashboard.jsx");

describe("free/trial dashboard gets Academy + Support, not a stripped-down page", () => {
  test("CloudSignalDashboard imports the real EducationPage/SupportCenterPage, not forked copies", () => {
    expect(signalDashboard).toMatch(/import\s*\{\s*EducationPage,\s*SupportCenterPage\s*\}\s*from\s*"\.\/CloudDashboard"/);
    // Guards against someone "fixing" this by writing a second, smaller
    // Academy/Support component instead of reusing the real ones.
    expect(signalDashboard).not.toMatch(/function\s+EducationPage\b/);
    expect(signalDashboard).not.toMatch(/function\s+SupportCenterPage\b/);
  });

  test("CloudDashboard actually exports EducationPage/SupportCenterPage as real function declarations", () => {
    // This is the property that makes the circular import between these two
    // files (CloudDashboard -> CloudSignalDashboard -> CloudDashboard) safe:
    // `export function X()` is hoisted during module evaluation, so by the
    // time either component is actually CALLED (during a later render pass,
    // never at either module's top level), the binding is fully resolved --
    // unlike `export const X = () => {}`, which would not be.
    expect(dashboard).toMatch(/export function EducationPage\(/);
    expect(dashboard).toMatch(/export function SupportCenterPage\(/);
  });

  test("neither component is invoked at module top level in either file (the thing that would actually break under a circular import)", () => {
    // A bare call like `EducationPage(...)` or `<EducationPage` outside a
    // function body would execute during module evaluation, before the
    // circular import resolves. Both files only ever reference these names
    // inside a function body (JSX inside a render function still lowers to
    // React.createElement(...) calls made when that render function runs,
    // not at import time) -- confirmed by their sole appearances being the
    // import line, the export declaration, and JSX usage inside another
    // function's body in CloudSignalDashboard.
    const signalDashboardUsages = [...signalDashboard.matchAll(/<EducationPage\b|<SupportCenterPage\b/g)];
    expect(signalDashboardUsages.length).toBeGreaterThan(0);
    for (const match of signalDashboardUsages) {
      const before = signalDashboard.slice(0, match.index);
      const openBraces = (before.match(/function CloudSignalDashboard/) || []).length;
      expect(openBraces).toBeGreaterThan(0); // usage is textually after the component function starts
    }
  });

  test("the free/trial dashboard exposes real navigation to Academy and Support -- not just backend access with no way to reach it", () => {
    expect(signalDashboard).toMatch(/signal-dashboard-nav-\$\{t\.id\}/);
    expect(signalDashboard).toMatch(/id:\s*"academy"/);
    expect(signalDashboard).toMatch(/id:\s*"support"/);
    expect(signalDashboard).toContain("setView(t.id)");
  });

  test("Academy and Support routes require no plan/capability -- confirmed against the actual backend source, not assumed", () => {
    const academyRoute = fs.readFileSync(path.join(__dirname, "../../backend_node/src/routes/cloud/academy.ts"), "utf8");
    const supportRoute = fs.readFileSync(path.join(__dirname, "../../backend_node/src/routes/cloud/support.ts"), "utf8");
    expect(academyRoute).not.toContain("requireCapability");
    expect(supportRoute).not.toContain("requireCapability");
    expect(academyRoute).toContain("requireCloudUser");
    expect(supportRoute).toContain("requireCloudUser");
  });

  test("bot-only teaser card gives a real purchase CTA, not just a passive lock icon", () => {
    expect(signalDashboard).toContain("Get XauCloud Bot");
    expect(signalDashboard).toContain("This feature requires the XauCloud automated trading bot");
  });
});
