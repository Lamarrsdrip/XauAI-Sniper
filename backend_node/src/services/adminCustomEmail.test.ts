import { describe, expect, it } from "vitest";
import { CustomEmailDraftSchema, draftDocument, resolveCustomEmailRecipients } from "./adminCustomEmail.js";

describe("custom email safety contract", () => {
  it("deduplicates selected valid recipients", async () => {
    const recipients = await resolveCustomEmailRecipients({ recipient_mode: "selected", selected_recipients: ["A@example.com", "a@example.com", "b@example.com"] });
    expect(recipients.map((r) => r.account_email)).toEqual(["a@example.com", "b@example.com"]);
  });

  it("rejects malformed recipients and raw HTML-only drafts", () => {
    expect(() => CustomEmailDraftSchema.parse({ title: "x", subject: "hello\nthere", recipient_mode: "single", to: "not-an-email", document: {} })).toThrow();
  });

  it("forces the customer campaign shell to the approved white theme", () => {
    const document = draftDocument({ document: { version: 1, theme: { background: "#08080A", contentBackground: "#08080A" }, blocks: [{ id: "copy", type: "text", text: "Hello" }] } });
    expect(document.theme.background).toBe("#FFFFFF");
    expect(document.theme.contentBackground).toBe("#FFFFFF");
  });
});
