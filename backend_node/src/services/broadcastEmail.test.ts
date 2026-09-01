import { describe, expect, test } from "vitest";
import { renderBroadcastEmail } from "./broadcastEmail.js";
import type { EmailBranding } from "./emailBranding.js";

const branding: EmailBranding = {
  sender_name: "XauCloud",
  admin_notification_email: "",
  support_email: "support@xaucloud.io",
  support_phone: "",
  community_link: "",
  mt5_download_url: "https://www.metatrader5.com/en/download",
  vps_guide_url: "https://xaucloud.io/command",
  installation_guide_url: "https://xaucloud.io/command",
  command_center_url: "https://xaucloud.io/command",
};

describe("renderBroadcastEmail", () => {
  test("renders short plain text without hardcoded sample copy", () => {
    const html = renderBroadcastEmail({ bodyHtml: "A concise customer update." }, branding);
    expect(html).toContain("A concise customer update.");
    expect(html).not.toContain("testing if this worked");
    expect(html).toContain("Xau<span");
    expect(html).toContain("Account &amp; communication preferences");
  });

  test("uses safe basic HTML, links and the premium CTA", () => {
    const html = renderBroadcastEmail({
      bodyHtml: "<h2>Market update</h2><p>Read the <a href='https://xaucloud.io/command'>details</a>.</p><script>alert(1)</script>",
      previewText: "A measured update",
      ctaLabel: "Open Command Center",
      ctaUrl: "https://xaucloud.io/command",
    }, branding);
    expect(html).toContain("Market update");
    expect(html).toContain("Open Command Center");
    expect(html).toContain("https://xaucloud.io/command");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  test("keeps long paragraphs inside the responsive 600px shell", () => {
    const body = Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}: ${"clear information ".repeat(8)}`).join("\n\n");
    const html = renderBroadcastEmail({ bodyHtml: body }, branding);
    expect(html.match(/<p style=/g)?.length).toBe(30);
    expect(html).toContain("width:600px;max-width:600px");
    expect(html).toContain("@media only screen and (max-width:620px)");
  });
});
