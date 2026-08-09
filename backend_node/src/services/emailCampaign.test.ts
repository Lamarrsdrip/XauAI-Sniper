import { describe, expect, test } from "vitest";
import type { EmailBranding } from "./emailBranding.js";
import { BUILT_IN_EMAIL_TEMPLATES, EmailDocumentSchema, personalize, renderEmailCampaign, type EmailDocument } from "./emailCampaign.js";

const branding: EmailBranding = {
  sender_name: "XauCloud",
  admin_notification_email: "admin@xaucloud.io",
  support_email: "support@xaucloud.io",
  support_phone: "",
  community_link: "",
  mt5_download_url: "https://www.metatrader5.com/en/download",
  vps_guide_url: "https://xaucloud.io/command",
  installation_guide_url: "https://xaucloud.io/command",
  command_center_url: "https://xaucloud.io/command",
};

const theme: EmailDocument["theme"] = { width: 640, background: "#08080A", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" };

describe("XauCloud email campaign renderer", () => {
  test("ships every requested starter category and the immediate rebrand campaign", () => {
    const names = BUILT_IN_EMAIL_TEMPLATES.map((template) => template.name);
    expect(names).toEqual(expect.arrayContaining([
      "Product Announcement", "Bot Update", "Performance / Backtest Update", "Outlook / Market Update",
      "Maintenance Notice", "Welcome / Onboarding", "Purchase Follow-Up", "Important Account Notice", "General Broadcast", "XauCloud Rebrand",
    ]));
    expect(BUILT_IN_EMAIL_TEMPLATES.find((template) => template.id === "performance")?.document.blocks.some((block) => block.type === "metrics")).toBe(true);
    expect(BUILT_IN_EMAIL_TEMPLATES.find((template) => template.id === "rebrand")?.subject).toBe("XauAI Sniper is now XauCloud");
  });

  test("renders rich blocks, responsive table layout, plain text, and safe personalization fallbacks", () => {
    const document: EmailDocument = {
      version: 1,
      theme,
      blocks: [
        { id: "hero", type: "hero", badge: "NEW", title: "Hello {{first_name}} 👋", subtitle: "Account: {{account_email}}", text: "OPEN", url: "https://xaucloud.io/command" },
        { id: "rich", type: "text", html: "<h2 style='text-align:center'>Results</h2><p><strong>Bold</strong> <em>italic</em> <u>underlined</u></p><ul><li>One</li></ul><ol><li>Two</li></ol><blockquote>Measured quote</blockquote><p><a href='https://xaucloud.io/replay'>Replay</a></p>" },
        { id: "metrics", type: "metrics", items: [{ label: "Net Profit", value: "+$9,968.01" }, { label: "Trades", value: "44" }] },
        { id: "columns", type: "columns", columns: [{ title: "iPhone", html: "<p>Add to Home Screen</p>" }, { title: "Android", html: "<p>Install the app</p>" }] },
        { id: "steps", type: "steps", items: [{ label: "Download", text: "Get XauCloud.io.ex5" }] },
        { id: "risk", type: "risk" },
      ],
    };
    const rendered = renderEmailCampaign(document, { previewText: "A new result for {{first_name}}" }, branding, { account_email: "customer@example.com" });
    expect(rendered.html).toContain("Hello customer 👋");
    expect(rendered.html).not.toContain("undefined");
    expect(rendered.html).toContain("text-align:center");
    expect(rendered.html).toContain("role=\"presentation\"");
    expect(rendered.html).toContain(".xc-stack{display:block!important;width:100%!important");
    expect(rendered.html).toContain("Account &amp; communication preferences");
    expect(rendered.text).toContain("https://xaucloud.io/command");
    expect(rendered.text).toContain("Trading involves risk");
  });

  test("removes scripts, event handlers, unsafe URLs, and arbitrary inline styles", () => {
    const document: EmailDocument = {
      version: 1,
      theme,
      blocks: [
        { id: "text", type: "text", html: "<p style='position:fixed;color:red' onclick='steal()'>Safe <a href='javascript:alert(1)'>bad link</a></p><script>alert('x')</script><img src=x onerror=steal()>" },
        { id: "bad-button", type: "button", text: "BAD", url: "javascript:alert(1)" },
        { id: "bad-image", type: "image", url: "data:text/html,bad", alt: "bad" },
      ],
    };
    const rendered = renderEmailCampaign(document, {}, branding);
    expect(rendered.html).toContain("Safe bad link");
    expect(rendered.html).not.toMatch(/<script|onclick|onerror|javascript:|position:fixed|data:text/i);
    expect(rendered.html).not.toContain(">BAD<");
  });

  test("renders premium text-only Action blocks without raw HTML in the request document", () => {
    const document = EmailDocumentSchema.parse({
      version: 1,
      theme,
      blocks: [
        { id: "hero", type: "hero", badge: "PREMIUM", title: "XauCloud intelligence", subtitle: "Styled on the trusted backend." },
        { id: "intro", type: "text", text: "Hi {{first_name}}, your premium update is ready." },
        { id: "columns", type: "columns", columns: [{ title: "Intelligence", text: "Clear market context." }, { title: "Control", text: "One focused Command Center." }] },
        { id: "cta", type: "button", text: "OPEN COMMAND CENTER", url: "https://xaucloud.io/command", style: "gold", fullWidth: true },
      ],
    });
    expect(JSON.stringify(document)).not.toContain('"html"');
    const rendered = renderEmailCampaign(document, { previewText: "Premium update" }, branding, { first_name: "Tala", account_email: "tala@example.test" });
    expect(rendered.html).toContain("XauCloud intelligence");
    expect(rendered.html).toContain("Clear market context.");
    expect(rendered.html).toContain("OPEN COMMAND CENTER");
    expect(rendered.html).toContain(".xc-stack{display:block!important;width:100%!important");
    expect(rendered.text).toContain("Intelligence\nClear market context.");
  });

  test("handles a very long, special-character and emoji message without breaking schema limits", () => {
    const long = `<p>${"Gold & risk < clarity > noise 🟡 ".repeat(500)}</p>`;
    const parsed = EmailDocumentSchema.parse({ version: 1, theme, blocks: [{ id: "long", type: "text", html: long }] });
    const rendered = renderEmailCampaign(parsed, { previewText: "Gold & clarity 🟡" }, branding);
    expect(rendered.html).toContain("Gold &amp; risk &lt; clarity &gt; noise 🟡");
    expect(rendered.text.length).toBeGreaterThan(10_000);
  });

  test("personalization never emits undefined for missing account data", () => {
    expect(personalize("Hi {{first_name}} / {{display_name}} / {{account_email}}", {})).toBe("Hi there / there / your account email");
  });
});
