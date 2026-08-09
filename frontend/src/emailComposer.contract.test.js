const fs = require("fs");
const path = require("path");

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), "utf8");

describe("XauCloud admin email composer contract", () => {
  const composer = read("components/admin/EmailComposer.jsx");
  const admin = read("components/AdminPortal.jsx");

  test("uses TipTap and exposes the required rich-text controls", () => {
    expect(composer).toContain('from "@tiptap/react"');
    for (const label of ["Paragraph", "Heading 1", "Heading 2", "Heading 3", "Bold", "Italic", "Underline", "Link", "Bullet list", "Numbered list", "Blockquote", "Align left", "Align center", "Align right", "Undo", "Redo"]) {
      expect(composer).toContain(label);
    }
  });

  test("includes the email-safe block library and exact preview/source modes", () => {
    for (const type of ["text", "heading", "button", "image", "divider", "spacer", "callout", "metrics", "columns", "section", "hero", "announcement", "feature", "steps", "risk", "footer"]) {
      expect(composer).toContain(`["${type}"`);
    }
    expect(composer).toContain("/admin/email/preview");
    expect(composer).toContain('sandbox=""');
    expect(composer).toContain("Plain-text fallback");
  });

  test("supports drafts, templates, audience confirmation, test sends and history reuse", () => {
    for (const route of ["/admin/email/drafts", "/admin/email/templates", "/admin/email/test", "/admin/email/send", "/admin/email/log"]) {
      expect(composer).toContain(route);
    }
    expect(composer).toContain("Confirm broadcast");
    expect(composer).toContain("DUPLICATE");
    expect(admin).toContain("<EmailComposer");
    expect(admin).not.toContain("function EmailTab");
  });
});
