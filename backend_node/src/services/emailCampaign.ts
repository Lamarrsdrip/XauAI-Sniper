import * as cheerio from "cheerio";
import { z } from "zod";
import type { EmailBranding } from "./emailBranding.js";

const ColorSchema = z.enum(["#08080A", "#111114", "#19191D", "#FFFFFF", "#F5F0E1", "#D6B35A", "#B88716", "#25252A", "#8E8E97"]);
const AlignSchema = z.enum(["left", "center", "right"]);

export const EmailBlockSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["hero", "announcement", "text", "heading", "button", "image", "divider", "spacer", "callout", "metrics", "feature", "steps", "columns", "section", "risk", "footer"]),
  html: z.string().max(100_000).optional(),
  text: z.string().max(10_000).optional(),
  title: z.string().max(500).optional(),
  subtitle: z.string().max(2_000).optional(),
  badge: z.string().max(80).optional(),
  level: z.number().int().min(1).max(3).optional(),
  url: z.string().max(2_000).optional(),
  alt: z.string().max(500).optional(),
  link: z.string().max(2_000).optional(),
  width: z.number().int().min(80).max(640).optional(),
  align: AlignSchema.optional(),
  style: z.enum(["gold", "outline", "dark"]).optional(),
  fullWidth: z.boolean().optional(),
  tone: z.enum(["neutral", "gold", "warning"]).optional(),
  height: z.number().int().min(8).max(120).optional(),
  items: z.array(z.object({ label: z.string().max(120), value: z.string().max(120).optional(), text: z.string().max(1000).optional(), title: z.string().max(300).optional() })).max(8).optional(),
  columns: z.array(z.object({
    title: z.string().max(300).optional(),
    html: z.string().max(20_000).optional(),
    text: z.string().max(5_000).optional(),
  }).strict()).length(2).optional(),
  background: ColorSchema.optional(),
  padding: z.enum(["compact", "normal", "spacious"]).optional(),
}).strict();

export const EmailDocumentSchema = z.object({
  version: z.literal(1),
  theme: z.object({
    width: z.union([z.literal(600), z.literal(640), z.literal(680)]).default(640),
    background: ColorSchema.default("#08080A"),
    contentBackground: ColorSchema.default("#FFFFFF"),
    accent: z.enum(["#D6B35A", "#B88716"]).default("#D6B35A"),
    radius: z.union([z.literal(0), z.literal(6), z.literal(10), z.literal(14)]).default(10),
    spacing: z.enum(["compact", "normal", "spacious"]).default("normal"),
  }).strict(),
  blocks: z.array(EmailBlockSchema).min(1).max(100),
}).strict();

export type EmailDocument = z.infer<typeof EmailDocumentSchema>;
export type EmailBlock = z.infer<typeof EmailBlockSchema>;

export interface CampaignMeta {
  previewText?: string | null;
  senderName?: string | null;
}

export interface RenderedCampaign {
  html: string;
  text: string;
}

export interface Personalization {
  first_name?: string;
  display_name?: string;
  account_email?: string;
}

export function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function personalize(value: string, recipient: Personalization): string {
  const display = recipient.display_name?.trim() || recipient.account_email?.split("@")[0] || "there";
  const first = recipient.first_name?.trim() || display.split(/\s+/)[0] || "there";
  const values: Record<string, string> = {
    first_name: first,
    display_name: display,
    account_email: recipient.account_email?.trim() || "your account email",
  };
  return value.replace(/\{\{\s*(first_name|display_name|account_email)\s*\}\}/gi, (_all, key: string) => values[key.toLowerCase()] ?? "");
}

function cleanRichText(raw: string, recipient: Personalization): string {
  const $ = cheerio.load(personalize(raw, recipient), null, false);
  const alignments = new Map<object, string>();
  $("script,style,iframe,object,embed,form,input,button,meta,link,svg,video,audio").remove();
  $("*").each((_index, el) => {
    if (!("attribs" in el)) return;
    const alignment = String(el.attribs?.["style"] ?? "").match(/text-align\s*:\s*(left|center|right)/i)?.[1]?.toLowerCase();
    if (alignment) alignments.set(el, alignment);
    for (const name of Object.keys(el.attribs ?? {})) {
      if (!["href"].includes(name.toLowerCase())) $(el).removeAttr(name);
    }
  });
  $("a").each((_index, el) => {
    const href = safeHttpUrl($(el).attr("href") ?? "");
    if (!href) $(el).replaceWith($(el).text());
    else $(el).attr({ href, style: "color:#9A6A00;text-decoration:underline;font-weight:700;" });
  });
  $("p").each((_index, el) => { $(el).attr("style", `margin:0 0 18px 0;text-align:${alignments.get(el) || "left"};`); });
  $("strong").attr("style", "font-weight:800;color:#111114;");
  $("em").attr("style", "font-style:italic;");
  $("u").attr("style", "text-decoration:underline;");
  $("h1").each((_index, el) => { $(el).attr("style", `margin:0 0 18px;color:#111114;font-size:30px;line-height:36px;letter-spacing:-.7px;text-align:${alignments.get(el) || "left"};`); });
  $("h2").each((_index, el) => { $(el).attr("style", `margin:0 0 16px;color:#111114;font-size:24px;line-height:30px;text-align:${alignments.get(el) || "left"};`); });
  $("h3").each((_index, el) => { $(el).attr("style", `margin:0 0 14px;color:#111114;font-size:19px;line-height:25px;text-align:${alignments.get(el) || "left"};`); });
  $("ul,ol").attr("style", "margin:0 0 18px;padding-left:24px;");
  $("li").attr("style", "margin:0 0 8px;");
  $("blockquote").attr("style", "margin:0 0 18px;padding:4px 0 4px 16px;border-left:3px solid #D6B35A;color:#55555D;");
  return $.html();
}

function blockPad(theme: EmailDocument["theme"], block: EmailBlock): string {
  const spacing = block.padding ?? theme.spacing;
  return spacing === "compact" ? "18px 28px" : spacing === "spacious" ? "38px 38px" : "28px 34px";
}

function rich(value: string | undefined, recipient: Personalization): string {
  return cleanRichText(value?.trim() || "", recipient);
}

function button(label: string, url: string, block: EmailBlock, accent: string): string {
  const href = safeHttpUrl(url);
  if (!href || !label.trim()) return "";
  const align = block.align ?? "left";
  const full = block.fullWidth ? ' width="100%"' : "";
  const bg = block.style === "dark" ? "#111114" : block.style === "outline" ? "#FFFFFF" : accent;
  const fg = block.style === "gold" || !block.style ? "#111114" : block.style === "outline" ? "#111114" : "#FFFFFF";
  const border = block.style === "outline" ? `border:1px solid ${accent};` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${full} style="margin:${align === "center" ? "0 auto" : align === "right" ? "0 0 0 auto" : "0"};"><tr><td bgcolor="${bg}" style="${border}border-radius:8px;text-align:center;"><a href="${href}" style="display:block;padding:14px 24px;color:${fg};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;font-weight:800;letter-spacing:.3px;text-decoration:none;border-radius:8px;">${esc(label)}</a></td></tr></table>`;
}

function renderBlock(block: EmailBlock, theme: EmailDocument["theme"], recipient: Personalization): string {
  const pad = blockPad(theme, block);
  const text = personalize(block.text ?? "", recipient);
  const title = personalize(block.title ?? "", recipient);
  const subtitle = personalize(block.subtitle ?? "", recipient);
  switch (block.type) {
    case "hero":
      return `<tr><td class="xc-content-pad" style="padding:42px 38px 38px;background:${block.background ?? theme.contentBackground};text-align:${block.align ?? "left"};"><div style="margin-bottom:12px;color:${theme.accent};font:700 10px/14px Arial,sans-serif;letter-spacing:1.8px;text-transform:uppercase;">${esc(block.badge || "XauCloud update")}</div><div style="color:#111114;font:800 32px/39px Arial,sans-serif;letter-spacing:-.8px;">${esc(title)}</div>${subtitle ? `<div style="margin-top:14px;color:#B8B8C0;font:400 16px/25px Arial,sans-serif;">${esc(subtitle)}</div>` : ""}${block.url && text ? `<div style="margin-top:26px;">${button(text, block.url, block, theme.accent)}</div>` : ""}</td></tr>`;
    case "announcement":
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? "#F5F0E1"};"><div style="color:#8A6200;font:800 10px/14px Arial,sans-serif;letter-spacing:1.4px;text-transform:uppercase;">${esc(block.badge || "Announcement")}</div><div style="margin-top:8px;color:#111114;font:800 24px/30px Arial,sans-serif;">${esc(title)}</div><div style="margin-top:10px;color:#45454C;font:400 15px/24px Arial,sans-serif;">${rich(block.html || subtitle, recipient)}</div></td></tr>`;
    case "heading": {
      const size = block.level === 1 ? "30px/36px" : block.level === 3 ? "18px/24px" : "23px/30px";
      return `<tr><td class="xc-content-pad" style="padding:${pad};padding-bottom:10px;background:${block.background ?? theme.contentBackground};color:#111114;text-align:${block.align ?? "left"};font:800 ${size} Arial,sans-serif;">${esc(text || title)}</td></tr>`;
    }
    case "text":
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? theme.contentBackground};color:#2D2D33;font:400 15px/24px Arial,sans-serif;text-align:${block.align ?? "left"};">${rich(block.html || text, recipient)}</td></tr>`;
    case "button":
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? theme.contentBackground};">${button(text || "Open XauCloud", block.url || "", block, theme.accent)}</td></tr>`;
    case "image": {
      const src = safeHttpUrl(block.url || "");
      if (!src) return "";
      const image = `<img src="${src}" width="${block.width ?? 560}" alt="${esc(block.alt || "")}" style="display:block;width:${block.width ?? 560}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`;
      const linked = safeHttpUrl(block.link || "");
      return `<tr><td class="xc-content-pad" align="${block.align ?? "center"}" style="padding:${pad};background:${block.background ?? theme.contentBackground};">${linked ? `<a href="${linked}" style="text-decoration:none;">${image}</a>` : image}</td></tr>`;
    }
    case "divider":
      return `<tr><td style="padding:10px 34px;background:${block.background ?? theme.contentBackground};"><div style="height:1px;background:${block.tone === "gold" ? theme.accent : "#E4E4E7"};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
    case "spacer":
      return `<tr><td style="height:${block.height ?? 24}px;background:${block.background ?? theme.contentBackground};font-size:0;line-height:0;">&nbsp;</td></tr>`;
    case "callout": {
      const color = block.tone === "warning" ? "#9B4D18" : "#8A6200";
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? theme.contentBackground};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:20px 22px;background:#F7F2E5;border-left:4px solid ${theme.accent};"><div style="color:${color};font:800 12px/17px Arial,sans-serif;text-transform:uppercase;letter-spacing:.8px;">${esc(title || "Important")}</div><div style="margin-top:7px;color:#35353A;font:400 14px/22px Arial,sans-serif;">${rich(block.html || text, recipient)}</div></td></tr></table></td></tr>`;
    }
    case "metrics": {
      const items = (block.items ?? []).slice(0, 4);
      const cells = items.map((item) => `<td class="xc-stack" width="${100 / Math.max(items.length, 1)}%" valign="top" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px 12px;background:${block.background ?? theme.contentBackground};border-top:2px solid ${theme.accent};text-align:center;"><div style="color:#111114;font:800 23px/29px Arial,sans-serif;">${esc(personalize(item.value || "", recipient))}</div><div style="margin-top:5px;color:#A9A9B1;font:700 9px/13px Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;">${esc(personalize(item.label, recipient))}</div></td></tr></table></td>`).join("");
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? theme.contentBackground};">${title ? `<div style="margin-bottom:16px;color:#111114;font:800 22px/28px Arial,sans-serif;">${esc(title)}</div>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr class="xc-row">${cells}</tr></table></td></tr>`;
    }
    case "feature":
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? theme.contentBackground};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="40" valign="top"><div style="width:30px;height:30px;background:${block.background ?? theme.contentBackground};color:${theme.accent};font:800 14px/30px Arial,sans-serif;text-align:center;">${esc(block.badge || "✓")}</div></td><td valign="top"><div style="color:#111114;font:800 16px/22px Arial,sans-serif;">${esc(title)}</div><div style="margin-top:5px;color:#55555D;font:400 14px/22px Arial,sans-serif;">${rich(block.html || text, recipient)}</div></td></tr></table></td></tr>`;
    case "steps": {
      const rows = (block.items ?? []).map((item, i) => `<tr><td width="42" valign="top" style="padding:0 12px 18px 0;"><div style="width:28px;height:28px;border-radius:50%;background:${theme.accent};color:#111114;font:800 12px/28px Arial,sans-serif;text-align:center;">${i + 1}</div></td><td valign="top" style="padding:0 0 18px;"><div style="color:#111114;font:800 15px/21px Arial,sans-serif;">${esc(personalize(item.title || item.label, recipient))}</div><div style="margin-top:3px;color:#55555D;font:400 14px/21px Arial,sans-serif;">${esc(personalize(item.text || "", recipient))}</div></td></tr>`).join("");
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? theme.contentBackground};">${title ? `<div style="margin-bottom:20px;color:#111114;font:800 22px/28px Arial,sans-serif;">${esc(title)}</div>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>`;
    }
    case "columns": {
      const cols = (block.columns ?? [{}, {}]).map((col) => `<td class="xc-stack" width="50%" valign="top" style="padding:8px;"><div style="color:#111114;font:800 16px/22px Arial,sans-serif;">${esc(personalize(col.title || "", recipient))}</div><div style="margin-top:7px;color:#55555D;font:400 14px/22px Arial,sans-serif;">${rich(col.html || col.text, recipient)}</div></td>`).join("");
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? theme.contentBackground};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr class="xc-row">${cols}</tr></table></td></tr>`;
    }
    case "section":
      return `<tr><td class="xc-content-pad" style="padding:${pad};background:${block.background ?? "#F5F0E1"};text-align:${block.align ?? "left"};"><div style="color:#111114;font:800 22px/28px Arial,sans-serif;">${esc(title)}</div><div style="margin-top:9px;color:#45454C;font:400 14px/22px Arial,sans-serif;">${rich(block.html || text, recipient)}</div></td></tr>`;
    case "risk":
      return `<tr><td class="xc-content-pad" style="padding:20px 34px;background:#F4F4F5;color:#686870;font:400 11px/17px Arial,sans-serif;border-top:1px solid #DEDEE2;"><strong style="color:#44444A;">Risk disclosure:</strong> ${esc(text || "Trading involves risk. Historical and Strategy Tester results do not guarantee future performance. Live results may differ due to market conditions, spread, liquidity, slippage, execution and other factors.")}</td></tr>`;
    case "footer":
      return ""; // The required legal/account footer is rendered once by the shell.
    default:
      return "";
  }
}

function documentText(document: EmailDocument, recipient: Personalization, branding: EmailBranding): string {
  const lines: string[] = [];
  for (const b of document.blocks) {
    if (b.type === "divider" || b.type === "spacer" || b.type === "footer") continue;
    if (b.badge) lines.push(personalize(b.badge, recipient));
    if (b.title) lines.push(personalize(b.title, recipient));
    if (b.subtitle) lines.push(personalize(b.subtitle, recipient));
    if (b.html) lines.push(cheerio.load(cleanRichText(b.html, recipient)).text());
    else if (b.text) lines.push(personalize(b.text, recipient));
    for (const item of b.items ?? []) lines.push([item.value, item.label, item.title, item.text].filter(Boolean).map((v) => personalize(String(v), recipient)).join(" — "));
    for (const col of b.columns ?? []) lines.push([col.title, cheerio.load(cleanRichText(col.html || col.text || "", recipient)).text()].filter(Boolean).join("\n"));
    const link = safeHttpUrl(b.url || b.link || "");
    if (link) lines.push(link);
    lines.push("");
  }
  lines.push(`Questions? ${branding.support_email || branding.command_center_url}`);
  lines.push(`Account & communication preferences: ${branding.command_center_url}`);
  lines.push("XauCloud.io · Automated gold trading software · Trading involves risk.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** One authoritative renderer for preview, test sends, and broadcasts. */
export function renderEmailCampaign(documentInput: EmailDocument, meta: CampaignMeta, branding: EmailBranding, recipient: Personalization = {}): RenderedCampaign {
  const document = EmailDocumentSchema.parse(documentInput);
  const sender = esc(meta.senderName?.trim() || branding.sender_name || "XauCloud");
  const preheader = esc(personalize(meta.previewText?.trim() || "", recipient));
  const width = document.theme.width;
  const blocks = document.blocks.map((block) => renderBlock(block, document.theme, recipient)).join("");
  const command = safeHttpUrl(branding.command_center_url);
  const support = branding.support_email.trim();
  const supportLink = support ? `<a href="mailto:${esc(support)}" style="color:#D6B35A;text-decoration:none;">${esc(support)}</a>` : "Support in Command Center";
  const prefs = command ? `<a href="${command}" style="color:#A9A9B1;text-decoration:underline;">Account &amp; communication preferences</a>` : "Account & communication preferences";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${sender}</title><style>@media only screen and (max-width:620px){.xc-shell{width:100%!important}.xc-outer{padding:14px 8px!important}.xc-content-pad{padding-left:20px!important;padding-right:20px!important}.xc-stack{display:block!important;width:100%!important;box-sizing:border-box!important}.xc-row{display:block!important}}</style></head><body style="margin:0;padding:0;background:${document.theme.background};word-spacing:normal;">${preheader ? `<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${document.theme.background}"><tr><td align="center" class="xc-outer" style="padding:32px 16px;"><table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" class="xc-shell" style="width:${width}px;max-width:${width}px;border-radius:${document.theme.radius}px;overflow:hidden;"><tr><td style="height:3px;background:${document.theme.accent};font-size:0;line-height:0;">&nbsp;</td></tr><tr><td style="padding:23px 28px;background:${document.theme.contentBackground};border-bottom:1px solid #E8E8E8;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><div style="font:800 20px/24px Arial,Helvetica,sans-serif;color:#FFFFFF;">Xau<span style="color:${document.theme.accent};">Cloud</span></div><div style="margin-top:4px;font:400 10px/14px Arial,Helvetica,sans-serif;color:#8E8E97;letter-spacing:1.4px;text-transform:uppercase;">Gold intelligence infrastructure</div></td><td align="right" style="font:700 11px/16px Arial,sans-serif;color:${document.theme.accent};">XAUCLOUD.IO</td></tr></table></td></tr>${blocks}<tr><td style="padding:24px 28px;background:${document.theme.contentBackground};color:#666666;font:400 11px/18px Arial,Helvetica,sans-serif;"><div style="margin-bottom:8px;color:#C8C8CE;">Questions? Contact ${supportLink}.</div><div>You're receiving this message because you have a ${sender} account or customer relationship. ${prefs}</div><div style="margin-top:10px;color:#66666F;">XauCloud.io · Automated gold trading software · Trading involves risk.</div></td></tr></table></td></tr></table></body></html>`;
  return { html, text: documentText(document, recipient, branding) };
}

const id = (suffix: string) => `block-${suffix}`;
const baseTheme: EmailDocument["theme"] = { width: 640, background: "#FFFFFF", contentBackground: "#FFFFFF", accent: "#D6B35A", radius: 10, spacing: "normal" };
const textBlock = (suffix: string, html: string): EmailBlock => ({ id: id(suffix), type: "text", html });
const buttonBlock = (suffix: string, text: string, url = "https://xaucloud.io/command"): EmailBlock => ({ id: id(suffix), type: "button", text, url, align: "left", style: "gold" });
const riskBlock = (suffix: string): EmailBlock => ({ id: id(suffix), type: "risk" });

export interface EmailTemplate { id: string; name: string; description: string; subject: string; previewText: string; document: EmailDocument; builtIn: boolean; }

export const BUILT_IN_EMAIL_TEMPLATES: EmailTemplate[] = [
  { id: "product-announcement", name: "Product Announcement", description: "Launch a new XauCloud capability with a focused hero and CTA.", subject: "A new XauCloud capability is live", previewText: "See what is new inside your Command Center.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("pa-hero"), type: "hero", badge: "Product announcement", title: "Built for sharper gold execution", subtitle: "A focused update to the XauCloud experience.", text: "OPEN COMMAND CENTER", url: "https://xaucloud.io/command" }, textBlock("pa-copy", "<p>Hi {{first_name}},</p><p>We have released a new capability designed to make your XauCloud workflow clearer and more dependable.</p>"), buttonBlock("pa-cta", "EXPLORE THE UPDATE")] } },
  { id: "bot-update", name: "Bot Update", description: "Explain an EA release and installation steps.", subject: "Your latest XauCloud bot update", previewText: "The latest production EA is ready to download.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("bu-hero"), type: "hero", badge: "Production update", title: "The latest XauCloud bot is ready", subtitle: "Download the official production build from Command Center." }, { id: id("bu-steps"), type: "steps", title: "Update safely", items: [{ label: "Open Command Center", text: "Sign in with your XauCloud account." }, { label: "Download XauCloud.io.ex5", text: "Use the licensed production download." }, { label: "Replace the previous EA", text: "Refresh Expert Advisors and confirm only one production chart is active." }] }, buttonBlock("bu-cta", "DOWNLOAD XAUCLOUD"), riskBlock("bu-risk")] } },
  { id: "performance", name: "Performance / Backtest Update", description: "Publish the current 30-day Strategy Tester replay.", subject: "New 30-day real gold replay", previewText: "+$9,968.01 net profit across 44 trades in the latest real-tick replay.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("pf-hero"), type: "hero", badge: "30-day real gold replay", title: "Pattern + Breakout intelligence in motion", subtitle: "XAUUSD M10 · Jun 30 – Jul 31 · MetaTrader 5 real historical tick replay" }, { id: id("pf-metrics"), type: "metrics", title: "Replay overview", items: [{ label: "Net Profit", value: "+$9,968.01" }, { label: "Profit Factor", value: "2.12" }, { label: "Win Rate", value: "70.45%" }, { label: "Trades", value: "44" }] }, textBlock("pf-copy", "<p>Review the complete methodology and trade-by-trade replay on XauCloud.io.</p>"), buttonBlock("pf-cta", "VIEW FULL REPLAY", "https://xaucloud.io/#performance"), riskBlock("pf-risk")] } },
  { id: "outlook", name: "Outlook / Market Update", description: "Share a measured gold-market outlook without implying a guarantee.", subject: "XauCloud gold market outlook", previewText: "The latest market context and levels to watch.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("ou-hero"), type: "hero", badge: "Market outlook", title: "Gold: the setup we are watching", subtitle: "A concise view of current structure, confirmation, and risk." }, { id: id("ou-call"), type: "callout", title: "Current posture", html: "<p>Add the evidence, invalidation level, and timing context here.</p>", tone: "gold" }, textBlock("ou-body", "<h2>What matters next</h2><ul><li>Price structure and liquidity</li><li>M10/M30 confirmation</li><li>Execution conditions and spread</li></ul>"), buttonBlock("ou-cta", "OPEN COMMAND CENTER"), riskBlock("ou-risk")] } },
  { id: "maintenance", name: "Maintenance Notice", description: "Communicate service maintenance and required action clearly.", subject: "Scheduled XauCloud maintenance", previewText: "What to expect and whether you need to take action.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("mn-ann"), type: "announcement", badge: "Service notice", title: "Scheduled maintenance", html: "<p>We are completing planned maintenance to keep XauCloud dependable.</p>" }, { id: id("mn-call"), type: "callout", title: "Action required", html: "<p>No action is required unless we contact you directly.</p>", tone: "warning" }, textBlock("mn-body", "<p>Maintenance window: add date and time here.</p><p>We will confirm when all systems are operating normally.</p>") ] } },
  { id: "welcome", name: "Welcome / Onboarding", description: "Guide a new customer from account to MT5 setup.", subject: "Welcome to XauCloud", previewText: "Set up Command Center, your EA, and notifications.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("we-hero"), type: "hero", badge: "Welcome to XauCloud", title: "Your gold intelligence infrastructure", subtitle: "Let’s connect your account and get the official production EA running." }, textBlock("we-hi", "<p>Hi {{first_name}},</p><p>Your XauCloud account is ready.</p>"), { id: id("we-steps"), type: "steps", title: "Get started", items: [{ label: "Open Command Center", text: "Sign in and link your active license." }, { label: "Download the EA", text: "Download XauCloud.io.ex5 from your account." }, { label: "Install in MT5", text: "Add the EA to XAUUSD M10 and preserve your approved settings." }, { label: "Enable notifications", text: "Install Command Center on iPhone or Android and allow alerts." }] }, buttonBlock("we-cta", "OPEN COMMAND CENTER"), riskBlock("we-risk")] } },
  { id: "purchase-follow-up", name: "Purchase Follow-Up", description: "Help a buyer complete setup after purchase.", subject: "Your XauCloud purchase: next steps", previewText: "Access your license, production EA, and installation guide.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("pu-hero"), type: "hero", badge: "Purchase complete", title: "You’re ready to set up XauCloud", subtitle: "Everything you need is inside Command Center." }, textBlock("pu-copy", "<p>Hi {{first_name}},</p><p>Thank you for choosing XauCloud. Your account email is <strong>{{account_email}}</strong>.</p>"), { id: id("pu-steps"), type: "steps", items: [{ label: "Link your license", text: "Enter the activation key from your purchase email." }, { label: "Download the bot", text: "Get the official XauCloud.io.ex5 build." }, { label: "Follow installation", text: "Use the guided MT5 setup in Command Center." }] }, buttonBlock("pu-cta", "CONTINUE SETUP"), riskBlock("pu-risk")] } },
  { id: "account-notice", name: "Important Account Notice", description: "Deliver a high-trust account or security notice.", subject: "Important notice about your XauCloud account", previewText: "Please review this account update.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("an-ann"), type: "announcement", badge: "Important account notice", title: "Please review your account", html: "<p>We are contacting you about an update that affects your XauCloud account.</p>" }, { id: id("an-call"), type: "callout", title: "What you need to do", html: "<p>Add the required action and deadline here.</p>", tone: "warning" }, buttonBlock("an-cta", "REVIEW ACCOUNT") ] } },
  { id: "general", name: "General Broadcast", description: "A clean, flexible starting point for any customer update.", subject: "An update from XauCloud", previewText: "The latest from the XauCloud team.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("gb-hero"), type: "hero", badge: "XauCloud update", title: "A clear update for our customers", subtitle: "Replace this text with the main reason for your message." }, textBlock("gb-copy", "<p>Hi {{first_name}},</p><p>Write your update here. Keep the most important information first and use one clear call to action.</p>"), buttonBlock("gb-cta", "OPEN XAUCLOUD") ] } },
  { id: "rebrand", name: "XauCloud Rebrand", description: "Announce the XauAI Sniper rebrand and guide customers through every new surface.", subject: "XauAI Sniper is now XauCloud", previewText: "Your new Command Center, latest gold engine, notifications and replay are live.", builtIn: true, document: { version: 1, theme: baseTheme, blocks: [{ id: id("rb-hero"), type: "hero", badge: "One platform. A stronger identity.", title: "XauAI Sniper is now XauCloud", subtitle: "The same trading system and account—now with a clearer Command Center and a production identity built for what comes next.", text: "OPEN COMMAND CENTER", url: "https://xaucloud.io/command" }, textBlock("rb-intro", "<p>Hi {{first_name}},</p><p>XauCloud is the new name for the XauAI Sniper platform you already use. Your existing account, license, and access continue on the same system.</p>"), { id: id("rb-feat1"), type: "feature", badge: "1", title: "Command Center", text: "Your account, licensed download, activity, performance and Outlooks now live in one focused workspace." }, { id: id("rb-feat2"), type: "feature", badge: "2", title: "iPhone and Android access", text: "Open Command Center in your mobile browser, add it to your home screen, and allow notifications when prompted." }, { id: id("rb-feat3"), type: "feature", badge: "3", title: "Latest production bot", text: "Download XauCloud.io.ex5 from your licensed account and install it in MetaTrader 5 on XAUUSD M10." }, { id: id("rb-metrics"), type: "metrics", title: "Latest 30-day real gold replay", items: [{ label: "Net Profit", value: "+$9,968.01" }, { label: "Profit Factor", value: "2.12" }, { label: "Win Rate", value: "70.45%" }, { label: "Trades", value: "44" }] }, { id: id("rb-cols"), type: "columns", columns: [{ title: "Market Outlooks", html: "<p>Review the current gold thesis, evidence, and status inside Command Center.</p>" }, { title: "Notifications", html: "<p>Receive account and market updates on the device you use every day.</p>" }] }, buttonBlock("rb-command", "OPEN COMMAND CENTER"), { ...buttonBlock("rb-buy", "BUY XAUCLOUD", "https://xaucloud.io/#pricing"), style: "outline" }, riskBlock("rb-risk")] } },
];
