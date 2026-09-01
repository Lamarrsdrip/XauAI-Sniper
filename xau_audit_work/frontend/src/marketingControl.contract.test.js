import fs from "fs";
import path from "path";

const read = (file) => fs.readFileSync(path.join(__dirname, file), "utf8");

describe("XauCloud Marketing Control surfaces", () => {
  const admin = read("components/AdminPortal.jsx");
  const control = read("components/admin/MarketingControl.jsx");
  const surfaces = read("components/MarketingSurfaces.jsx");
  const notifications = read("components/cloud/NotificationCenter.jsx");
  const app = read("App.js");

  test("normal Admin includes one shared Marketing campaign control screen", () => {
    expect(admin).toContain('["marketing", "Marketing", Megaphone]');
    expect(admin).toContain("<MarketingControl api={api} />");
    expect(control).toContain("/admin/marketing/campaigns");
    expect(control).toContain("Approved marketing facts");
    expect(control).toContain("SAVE STRUCTURED CONTENT");
  });

  test("public website and landing pages render only controlled data-backed surfaces", () => {
    expect(surfaces).toContain("/marketing/website");
    expect(surfaces).toContain("/marketing/campaign/");
    expect(surfaces).not.toContain("dangerouslySetInnerHTML");
    expect(app).toContain("<WebsiteCampaignSlots />");
    expect(app).toContain('path="/campaign/:slug"');
  });

  test("Command Center announcements use the authenticated existing surface", () => {
    expect(surfaces).toContain("/marketing/announcements/current");
    expect(surfaces).toContain("withCredentials: true");
    expect(app).toContain("<CommandCenterAnnouncements />");
  });

  test("marketing push remains inside first-party notification preferences", () => {
    expect(notifications).toContain('MARKETING: "Marketing"');
    expect(notifications).toContain('"PAYMENTS", "MARKETING", "SYSTEM"');
  });
});
