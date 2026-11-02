import { sendEmailDetailed } from "./email.js";

export interface DirectManualPaymentInstruction {
  buyerName: string;
  buyerEmail: string;
  reference: string;
  method: "BANK" | "CRYPTO";
  amountFormatted: string;
  usdPrice: string;
  details: Record<string, string>;
  expiresAt: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function sendDirectManualPaymentInstructions(order: DirectManualPaymentInstruction): Promise<boolean> {
  const bank = order.method === "BANK";
  const rows: Array<[string, string]> = bank
    ? [["Bank", order.details.bank_name], ["Beneficiary", order.details.account_name],
       ["Account number", order.details.account_number]]
    : [["Asset", order.details.asset], ["Network", order.details.network],
       ["Receiving wallet", order.details.address]];
  const rowHtml = rows.map(([label, value]) =>
    '<tr><td style="padding:12px 0;color:#52655e;vertical-align:top;width:38%;">' + escapeHtml(label) +
    '</td><td style="padding:12px 0;color:#173a33;font-weight:700;overflow-wrap:anywhere;word-break:break-word;">' +
    escapeHtml(value) + '</td></tr>').join("");
  const extra = bank
    ? 'Transfer the exact NGN amount to the bank account shown below.'
    : 'Send only the specified asset on the specified network. Sending another asset or using the wrong network can cause permanent loss. Network fees are separate; the nominal stablecoin/USD peg is not guaranteed.';
  const html = '<div style="background:#f4f8f5;padding:24px 10px;font-family:Arial,sans-serif;color:#173a33;">' +
    '<div style="max-width:600px;margin:auto;background:#fff;border:1px solid #dce8de;border-radius:18px;padding:28px;">' +
    '<p style="font-size:12px;letter-spacing:2px;color:#89692e;font-weight:700;">XAUCLOUD · PAYMENT INSTRUCTIONS</p>' +
    '<h1 style="font-size:26px;margin:12px 0 8px;">Your payment is awaiting transfer</h1>' +
    '<p style="font-size:14px;line-height:1.6;color:#475a53;">Hello ' + escapeHtml(order.buyerName) +
    '. An order has been created, but it is <strong>not yet paid or approved</strong>. ' + extra + '</p>' +
    '<div style="background:#f0f6f1;border:1px solid #dce8df;border-radius:12px;padding:20px;margin:20px 0;">' +
    '<div style="font-size:12px;color:#53665f;">Exact amount to send</div>' +
    '<div style="font-size:28px;font-weight:800;color:#173a33;margin:7px 0 4px;">' + escapeHtml(order.amountFormatted) + '</div>' +
    '<div style="color:#5b6d66;font-size:12px;">One-time XauCloud license · ' + escapeHtml(order.usdPrice) + ' base price</div></div>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px;">' + rowHtml + '</table>' +
    '<p style="margin-top:18px;padding:14px;background:#f8f6ed;border:1px solid #e8ddbe;border-radius:10px;line-height:1.6;font-size:13px;">' +
    '<strong>Order reference:</strong> ' + escapeHtml(order.reference) + '<br>' +
    '<strong>Payment window closes:</strong> ' + escapeHtml(order.expiresAt) + ' (UTC)</p>' +
    '<p style="font-size:13px;line-height:1.7;color:#475a53;">After transferring, return to the open XauCloud checkout and submit your actual bank transaction reference or blockchain hash. Your payment is independently checked by our team before a license can be issued. Never share passwords or wallet seed phrases.</p>' +
    '<p style="font-size:12px;color:#5c6f67;margin-top:24px;">If the payment window has expired, do not reuse the old quote; contact support if you already transferred.</p>' +
    '</div></div>';
  const plain = ["XauCloud manual payment instructions", "Order: " + order.reference,
    "Status: Awaiting transfer; not paid or approved", "Amount: " + order.amountFormatted,
    "Base price: " + order.usdPrice, ...rows.map(([k, v]) => k + ": " + v),
    "Expires: " + order.expiresAt + " UTC", extra,
    "After paying, return to XauCloud and submit your bank reference or blockchain hash for independent manual verification."].join("\n");
  const result = await sendEmailDetailed(order.buyerEmail,
    "XauCloud payment instructions — " + order.reference, html, { text: plain });
  return result.ok;
}
