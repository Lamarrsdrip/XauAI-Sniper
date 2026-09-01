import * as cheerio from "cheerio";
import type { EmailBranding } from "./emailBranding.js";

export interface BroadcastEmailContent {
  bodyHtml: string;
  previewText?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function renderBody(raw: string): string {
  const looksLikeHtml = /<(p|div|br|ul|ol|li|h[1-6]|table|a|strong|em|blockquote)\b/i.test(raw);
  if (!looksLikeHtml) {
    return raw
      .trim()
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => `<p style="margin:0 0 18px 0;">${escapeHtml(paragraph).replace(/\r?\n/g, "<br>")}</p>`)
      .join("");
  }

  const $ = cheerio.load(raw, null, false);
  $("script,style,iframe,object,embed,form,input,button,meta,link").remove();
  $("*").each((_index, element) => {
    if (!("attribs" in element)) return;
    for (const name of Object.keys(element.attribs ?? {})) {
      const value = String(element.attribs[name] ?? "");
      if (name.toLowerCase().startsWith("on") || /javascript\s*:/i.test(value)) $(element).removeAttr(name);
    }
  });
  $("a").each((_index, element) => {
    const href = safeHttpUrl($(element).attr("href") ?? "");
    if (!href) $(element).removeAttr("href");
    else {
      $(element).attr("href", href);
      $(element).attr("style", "color:#9A6A00;text-decoration:underline;font-weight:700;");
    }
  });
  $("p").each((_index, element) => { $(element).attr("style", "margin:0 0 18px 0;"); });
  $("h1,h2,h3").each((_index, element) => { $(element).attr("style", "margin:0 0 16px 0;color:#111114;font-size:22px;line-height:29px;"); });
  $("ul,ol").each((_index, element) => { $(element).attr("style", "margin:0 0 18px 0;padding-left:22px;"); });
  return $.html();
}

/** Email-client-safe broadcast shell used by both sends and admin preview. */
export function renderBroadcastEmail(content: BroadcastEmailContent, branding: EmailBranding): string {
  const sender = escapeHtml(branding.sender_name || "XauCloud");
  const preheader = escapeHtml(content.previewText?.trim() ?? "");
  const body = renderBody(content.bodyHtml);
  const ctaUrl = safeHttpUrl(content.ctaUrl?.trim() ?? "");
  const ctaLabel = escapeHtml(content.ctaLabel?.trim() ?? "");
  const commandCenter = safeHttpUrl(branding.command_center_url);
  const support = branding.support_email.trim();
  const supportLink = support
    ? `<a href="mailto:${escapeHtml(support)}" style="color:#D6B35A;text-decoration:none;">${escapeHtml(support)}</a>`
    : "the Support area in Command Center";
  const preferences = commandCenter
    ? `<a href="${commandCenter}" style="color:#A9A9B1;text-decoration:underline;">Account &amp; communication preferences</a>`
    : "Account &amp; communication preferences";
  const cta = ctaUrl && ctaLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 4px 0;"><tr><td bgcolor="#D6B35A" style="border-radius:8px;text-align:center;">
<a href="${ctaUrl}" style="display:inline-block;padding:14px 24px;color:#111114;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;font-weight:800;text-decoration:none;border-radius:8px;">${ctaLabel}</a>
</td></tr></table>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<title>${sender}</title>
<style>@media only screen and (max-width:620px){.xc-shell{width:100%!important}.xc-pad{padding-left:20px!important;padding-right:20px!important}.xc-card{padding:26px 20px!important}}</style></head>
<body style="margin:0;padding:0;background-color:#08080A;word-spacing:normal;">
${preheader ? `<div style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#08080A"><tr><td align="center" class="xc-pad" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="xc-shell" style="width:600px;max-width:600px;">
<tr><td style="height:3px;background:#D6B35A;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:24px 26px;background:#111114;border-bottom:1px solid #2A2A2F;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>
<div style="font-family:Arial,Helvetica,sans-serif;color:#FFFFFF;font-size:20px;line-height:24px;font-weight:800;letter-spacing:-0.3px;">Xau<span style="color:#D6B35A;">Cloud</span></div>
<div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;color:#8E8E97;font-size:10px;line-height:14px;letter-spacing:1.4px;text-transform:uppercase;">Gold intelligence infrastructure</div>
</td><td align="right" valign="middle" style="font-family:Arial,Helvetica,sans-serif;color:#D6B35A;font-size:11px;font-weight:700;letter-spacing:.8px;">XAUCLOUD.IO</td></tr></table>
</td></tr>
<tr><td class="xc-card" style="padding:38px 38px 34px;background:#FFFFFF;color:#25252A;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;">
${body}${cta}
</td></tr>
<tr><td style="padding:24px 26px;background:#111114;color:#8E8E97;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;">
<div style="margin-bottom:8px;color:#C8C8CE;">Questions? Contact ${supportLink}.</div>
<div>You're receiving this message because you have a ${sender} account. ${preferences}</div>
<div style="margin-top:10px;color:#66666F;">XauCloud.io · Automated gold trading software · Trading involves risk.</div>
</td></tr>
</table></td></tr></table>
</body></html>`;
}
