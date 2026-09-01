import fs from "fs";
import path from "path";

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");
const dashboard = read("components/cloud/CloudDashboard.jsx");

// Bug found during platform-unification audit (2026-08-25): the generic
// push-notification toggle used on both the bot-owner and subscriber/free
// Home only ever registered the raw browser push subscription. It never
// set cloud_notification_prefs' `tier` -- the field the backend's actual
// signal-notification delivery (sendSubscriberSignalNotification,
// notifications.ts) checks before sending anything. Only the bot-owner-only
// AI Market Outlook settings page ever wrote that field, so a free/trial
// user could enable "Push notifications" and still never receive a signal
// alert. This proves the fix without needing a live device/browser.
describe("free/trial users can actually receive signal notifications, not just toggle a device subscription", () => {
  const fn = dashboard.slice(dashboard.indexOf("function NotificationPrompt("), dashboard.indexOf("// ── Bot ON/OFF"));

  test("enabling the toggle sets a real delivery tier, not just the device subscription", () => {
    expect(fn).toContain("enableWebPush(commandAxios)");
    expect(fn).toMatch(/notifications\/prefs["'],\s*\{\s*tier:\s*"HOURLY_ONLY"\s*\}/);
  });

  test("disabling the toggle turns delivery back off, not just the device", () => {
    expect(fn).toMatch(/notifications\/prefs["'],\s*\{\s*tier:\s*"OFF"\s*\}/);
    expect(fn).toContain("disableWebPush(commandAxios)");
  });

  test("this toggle is not bot-license-gated -- it's rendered on both Home variants", () => {
    expect(dashboard).toMatch(/<NotificationPrompt \/>/);
    // SubscriberHomePage renders it directly with no ownsBot/entitlement check around it.
    const subscriberHome = dashboard.slice(dashboard.indexOf("function SubscriberHomePage("), dashboard.indexOf("// ── Recent Signals (Activity tab"));
    expect(subscriberHome).toContain("<NotificationPrompt />");
  });
});
