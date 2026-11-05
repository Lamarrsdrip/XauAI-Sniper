import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import ManualCheckout from "./components/ManualCheckout";

jest.mock("axios", () => ({ get: jest.fn(), post: jest.fn() }));
jest.setTimeout(30000);
const config = {
  bank_enabled: true, crypto_enabled: true, price_formatted: "USD 250.00",
  crypto_options: [{ asset: "USDT", network: "ERC20" }, { asset: "USDT", network: "TRC20" }, { asset: "USDC", network: "ERC20" }],
};
let container, root;
const button = (text) => [...container.querySelectorAll("button")].find((node) => node.textContent.includes(text));
async function click(node) { await act(async () => node.click()); }
async function fill(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers();
  localStorage.clear(); jest.clearAllMocks();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  axios.get.mockResolvedValue({ data: { status: "MANUAL_PENDING" } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.useRealTimers(); });
async function renderCheckout(settings = config) { await act(async () => root.render(<ManualCheckout api="/api" config={settings} onClose={() => {}}/>)); }
async function openDetails(country) {
  await click(button(country));
  container.querySelector('[role="dialog"]').scrollTop = 600;
  await click(button("Continue to payment details"));
  expect(container.querySelector('[role="dialog"]').scrollTop).toBe(0);
}

test("Nigeria presents working Bank Transfer and Crypto choices without an unavailable message", async () => {
  await renderCheckout(); await openDetails("Nigeria");
  expect(button("Bank transfer").disabled).toBe(false);
  expect(button("Crypto · USDT").disabled).toBe(false);
  expect(container.textContent).not.toContain("temporarily unavailable");
  expect(button("Bank transfer").getAttribute("aria-pressed")).toBe("true");
  await click(button("Crypto · USDT"));
  expect(button("Crypto · USDT").getAttribute("aria-pressed")).toBe("true");
  expect([...container.querySelector("select").options].map((o) => o.value)).toEqual(["USDT:ERC20", "USDT:TRC20", "USDC:ERC20"]);
});

test("an international customer sees crypto only and submits their selected supported coin/network", async () => {
  await renderCheckout(); await openDetails("United States");
  expect(button("Bank transfer")).toBeUndefined();
  await fill(container.querySelector('input[autocomplete="name"]'), "Test Customer");
  await fill(container.querySelector('input[type="email"]'), "test@example.com");
  await act(async () => {
    const select = container.querySelector("select"); select.value = "USDC:ERC20";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  axios.post.mockResolvedValue({ data: {
    reference: "XC-TEST", method: "CRYPTO", amount_formatted: "250.00 USDC", currency: "USDC", amount_minor: 25000,
    details: { asset: "USDC", network: "ERC20", address: "0x" + "a".repeat(40) },
    expires_at: new Date(Date.now() + 1800000).toISOString(), status: "MANUAL_PENDING", instructions_email_sent: true,
  } });
  container.querySelector('[role="dialog"]').scrollTop = 1000;
  await click(button("Create secure payment order"));
  expect(container.querySelector('[role="dialog"]').scrollTop).toBe(0);
  expect(axios.post).toHaveBeenCalledWith("/api/purchase/direct/quote", {
    country: "US", method: "CRYPTO", buyer_name: "Test Customer", buyer_email: "test@example.com", asset: "USDC", network: "ERC20",
  });
  expect(container.textContent).toContain("Complete your USDC payment");
  expect(container.textContent).toContain("250.00 USDC");
  expect(container.textContent).toContain("ERC20");
  expect(container.textContent).toContain("0x" + "a".repeat(40));
});

test("a Nigerian bank order displays the stored beneficiary and configured instructions", async () => {
  await renderCheckout(); await openDetails("Nigeria");
  await fill(container.querySelector('input[autocomplete="name"]'), "Test Customer");
  await fill(container.querySelector('input[type="email"]'), "test@example.com");
  axios.post.mockResolvedValue({ data: {
    reference: "XC-BANK", method: "BANK", amount_formatted: "NGN 375125.00", currency: "NGN", amount_minor: 37512500,
    details: { bank_name: "Test bank", account_name: "Test beneficiary", account_number: "0000000000", instructions: "Include your order ID in the narration." },
    expires_at: new Date(Date.now() + 1800000).toISOString(), status: "MANUAL_PENDING", instructions_email_sent: true,
  } });
  await click(button("Create secure payment order"));
  expect(axios.post.mock.calls[0][1]).toMatchObject({ country: "NG", method: "BANK" });
  expect(container.textContent).toContain("Test bank");
  expect(container.textContent).toContain("Test beneficiary");
  expect(container.textContent).toContain("0000000000");
  expect(container.textContent).toContain("Include your order ID in the narration.");
});
