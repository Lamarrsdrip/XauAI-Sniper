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
  });
});
