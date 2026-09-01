const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname);

describe("XauCloud customer surface cleanup contract", () => {
  test("removed ecosystem wall cannot return", () => {
    const app = fs.readFileSync(path.join(root, "App.js"), "utf8");

    expect(app).not.toContain("ProductEcosystemSection");
    expect(app).not.toContain("MORE THAN AN EA");
    expect(app).not.toContain(
      "One XauCloud ecosystem from execution to understanding"
    );
  });

  test("obsolete ecosystem component stays deleted", () => {
    expect(
      fs.existsSync(
        path.join(root, "components", "ProductEcosystemSection.jsx")
      )
    ).toBe(false);
  });

  test("broker remains but account type is not shown", () => {
    const dashboard = fs.readFileSync(
      path.join(root, "components", "cloud", "CloudDashboard.jsx"),
      "utf8"
    );

    expect(dashboard).not.toContain("Live · Acct");
    expect(dashboard).toContain("brokerBrand");
    expect(dashboard).toContain("heartbeat.broker_server");
    expect(dashboard).not.toMatch(/\{heartbeat\.broker_server\s*\|\|/);
    expect(dashboard).toContain("brokerBrand(heartbeat.broker_server)");
  });

  test("mobile roadmap uses generated high-contrast text utilities", () => {
    const roadmap = fs.readFileSync(
      path.join(root, "components", "ComingSoonAppsSection.jsx"),
      "utf8"
    );

    expect(roadmap).not.toMatch(/text-white\/(58|65|72|82|84)/);
    expect(roadmap).toContain("text-white/90");
    expect(roadmap).toContain("text-white/80");
  });

  test("removed Features section cannot return", () => {
    const app = fs.readFileSync(path.join(root, "App.js"), "utf8");

    expect(app).not.toContain("FeaturesSection");
    expect(app).not.toContain('id="features"');
    expect(
      fs.existsSync(path.join(root, "components", "FeaturesSection.jsx"))
    ).toBe(false);

    const header = fs.readFileSync(
      path.join(root, "components", "Header.jsx"),
      "utf8"
    );
    expect(header).not.toContain('id: "features"');
  });

  test("removed hero Command Center preview card cannot return", () => {
    const hero = fs.readFileSync(
      path.join(root, "components", "HeroSection.jsx"),
      "utf8"
    );

    expect(hero).not.toContain("ProductPreview");
    expect(hero).not.toContain("Live product environment");
    expect(hero).not.toContain("EA heartbeat");
    expect(hero).not.toContain("Mobile Command Center");
    // The approved hero headline/CTAs must survive untouched.
    expect(hero).toContain("Professional automation for");
    expect(hero).toContain("Get XauCloud");
    expect(hero).toContain("Explore Command Center");
  });
});
