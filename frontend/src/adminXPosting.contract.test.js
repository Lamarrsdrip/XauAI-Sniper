import fs from "fs";
import path from "path";

describe("Admin X posting panel", () => {
  const portal = fs.readFileSync(path.join(__dirname, "components/AdminPortal.jsx"), "utf8");
  test("exposes the safe X Posting tab and never collects the OAuth token", () => {
    expect(portal).toContain('"xPosting", "X Posting"');
    expect(portal).toContain('/admin/x-posting');
    expect(portal).toContain('X_USER_ACCESS_TOKEN');
    expect(portal).not.toMatch(/setXUserAccessToken|name=["']x_user_access_token/i);
  });
});
