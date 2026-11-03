const fs = require("fs");
const path = require("path");

const checkout = fs.readFileSync(path.join(__dirname, "components", "ManualCheckout.jsx"), "utf8");
const nodeRoute = fs.readFileSync(path.join(__dirname, "..", "..", "backend_node", "src", "routes", "directCheckout.ts"), "utf8");
const mailer = fs.readFileSync(path.join(__dirname, "..", "..", "backend_node", "src", "services", "manualCheckoutInstructions.ts"), "utf8");

describe("Premium manual gateway contract", () => {
  test("offers USDT in every country and bank transfer only in Nigeria", () => {
    expect(checkout).toContain('country === "NG"');
    expect(checkout).toContain("Every country pays with USDT");
    expect(checkout).toContain("Nigeria can also pay by bank transfer");
    expect(checkout).toContain("Bank transfer · NGN at checkout");
    expect(checkout).toContain('defaultCryptoChoice');
    expect(checkout).not.toContain("crypto_countries?.includes");
    expect(checkout).not.toContain("Checkout has not been enabled for this country");
    expect(nodeRoute).toContain('Bank transfer is only available in Nigeria.');
    expect(nodeRoute).not.toContain("crypto_countries.includes");
  });

  test("renders a server-expiry-based live 30-minute countdown without displaying FX internals", () => {
    expect(checkout).toContain('Date.parse(quote.expires_at) - nowMs');
    expect(checkout).toContain('secondsLeft / 1800 * 100');
    expect(checkout).toContain('data-testid="gateway-countdown"');
    expect(checkout).toContain("Payment window expired");
    expect(checkout).not.toContain('<Detail label="USD/NGN rate"');
    expect(checkout).not.toContain('<Detail label="FX quoted at"');
    expect(checkout).not.toContain('<Detail label="Quote expires"');
    expect(nodeRoute).toContain("const expires = new Date(stamp.getTime() + 1800000)");
  });

  test("presents a premium copyable bank or crypto destination, and real review states", () => {
    expect(checkout).toContain('data-testid="gateway-amount"');
    expect(checkout).toContain('label="Account number"');
    expect(checkout).toContain('label="Receiving wallet"');
    expect(checkout).toContain('title="Copy all details"');
    expect(checkout).toContain('label="Bank name" value={quote.details.bank_name}');
    expect(checkout).toContain('label="Account holder" value={quote.details.account_name}');
    expect(checkout).toContain('label="Stablecoin" value={quote.details.asset}');
    expect(checkout).toContain('label="Network" value={quote.details.network}');
    expect(checkout).not.toContain('label="Bank name" value={quote.details.bank_name} copy={false}');
    expect(checkout).toContain("xaucloud.pay.session.v1");
    expect(checkout).toContain("localStorage.getItem(ORDER_KEY)");
    expect(checkout).toContain("Account name sent from");
    expect(checkout).toContain("sender_account_name");
    expect(checkout).toContain("No receipt photo is required");
    expect(checkout).not.toContain("type=\"file\"");
    expect(checkout).not.toContain("/proof");
    expect(checkout).not.toContain("Bank transaction reference");
    expect(checkout).toContain("independently confirm receipt");
    expect(checkout).toContain("status === \"FULFILLED\"");
    expect(checkout).toContain("status === \"MANUAL_REJECTED\"");
  });

  test("emails exact buyer instructions on quote and safe retry, without client-selected destination", () => {
    expect(nodeRoute).toContain("sendDirectManualPaymentInstructions({");
    expect(nodeRoute).toContain('"/purchase/direct/:reference/resend-instructions"');
    expect(nodeRoute).toContain('instructions_resend_count: { $lt: 2 }');
    expect(checkout).toContain('response.data.instructions_email_sent === true');
    expect(checkout).toContain('"/resend-instructions"');
    expect(mailer).toContain("sendEmailDetailed(order.buyerEmail");
    expect(mailer).toContain("not yet paid or approved");
  });
});
