import React, { act } from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import DirectCheckoutAdmin from "./components/admin/DirectCheckoutAdmin";

jest.mock("axios", () => ({ create: jest.fn(() => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() })) }));
const client = axios.create.mock.results[0].value;
const paidCustomer = {
  reference: "XC-00000000000000000001", buyer_name: "Test Customer", buyer_email: "paid.customer@example.test",
  product_name: "One-Time XauCloud MT5 License", amount_minor: 25000, currency: "USD", method: "CRYPTO",
  quote_details: { asset: "USDT", network: "TRC20" }, payment_status: "MANUAL_SUBMITTED",
  created_at: "2026-11-01T12:00:00Z", submitted_at: "2026-11-01T12:05:00Z", license_status: "NOT_ISSUED",
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function isOrdersRequest(url) { return String(url).endsWith("/admin/direct-checkout/orders"); }
function configResponse(url) {
  if (String(url).endsWith("/purchase/direct/config")) return { data: { bank_enabled: true, crypto_enabled: true, crypto_options: [] } };
  if (String(url).endsWith("/admin/direct-checkout/config")) {
    return { data: { price_usd_cents: 25000, usd_ngn_rate: "1600", rate_as_of: "2026-11-11T00:00:00Z", bank_enabled: true, crypto_enabled: true, wallets: [], bank_name: "Access Bank", account_name: "XauCloud Ltd", account_number: "0123456789", instructions: "" } };
  }
  return null;
}
let container;
let root;
let entries;

async function render() { await act(async () => { root.render(<DirectCheckoutAdmin api="/api"/>); await flush(); }); }
function button(text) { return [...container.querySelectorAll("button")].find((node) => node.textContent === text); }
async function click(node) { await act(async () => { node.click(); await flush(); }); }
async function change(node, value) {
  await act(async () => {
    const prototype = node.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    await flush();
  });
}

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  entries = [{ ...paidCustomer }];
  client.get.mockReset(); client.post.mockReset();
  client.get.mockImplementation(async (url, options) => {
    const configured = configResponse(url);
    if (configured) return configured;
    const filter = options?.params?.status;
    const filtered = entries.filter((order) => filter === "failed" ? order.payment_status === "FULFILLMENT_FAILED"
      : filter === "pending" ? order.payment_status.startsWith("MANUAL_") && order.payment_status !== "MANUAL_REJECTED" : true);
    return { data: { entries: filtered, total: filtered.length } };
  });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  jest.spyOn(window, "prompt").mockImplementation(() => { throw new Error("Approval must never prompt for fields"); });
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); jest.restoreAllMocks(); jest.useRealTimers();
});

test("shows the existing customer, product, amount, network and submission immediately in a compact card", async () => {
  await render();
  const queue = container.querySelector('[data-testid="pending-payments"]');
  for (const text of [paidCustomer.buyer_name, paidCustomer.buyer_email, paidCustomer.reference, paidCustomer.product_name, "250.00 USD", "USDT Crypto · TRC20", "Submitted", "Pending"]) {
    expect(queue.textContent).toContain(text);
  }
  expect(queue.querySelector("table")).toBeNull();
  expect(queue.querySelectorAll("input")).toHaveLength(1);
  expect(queue.querySelector("input").type).toBe("search");
  expect(queue.querySelector("textarea")).toBeNull();
  expect(button("✓ APPROVE").className).toContain("min-h-12");
  expect(button("✕ REJECT").className).toContain("min-h-12");
  expect(client.get.mock.calls.filter((call) => isOrdersRequest(call[0]))).toHaveLength(1);
});

test("approves with an empty body, prevents repeated clicks, and reports license/email delivery", async () => {
  await render();
  let finish;
  client.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const approve = button("✓ APPROVE");
  await act(async () => { approve.click(); approve.click(); await flush(); });
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(client.post).toHaveBeenCalledWith("/api/admin/direct-checkout/" + paidCustomer.reference + "/approve", {});
  expect(approve.disabled).toBe(true);
  entries = [{ ...paidCustomer, payment_status: "FULFILLED", license_status: "ISSUED", fulfillment_email_status: "SENT" }];
  await act(async () => { finish({ data: { status: "FULFILLED", license_status: "ISSUED", fulfillment_email_status: "SENT" } }); await flush(); });
  expect(container.textContent).toContain("payment approved. License: ISSUED. Email: SENT.");
  expect(button("✓ APPROVE")).toBeUndefined();
  expect(window.prompt).not.toHaveBeenCalled();
});

test("rejects without a reason or extra form and immediately removes the pending card", async () => {
  await render();
  client.post.mockImplementation(async () => { entries = []; return { data: { status: "MANUAL_REJECTED" } }; });
  await click(button("✕ REJECT"));
  expect(client.post).toHaveBeenCalledWith("/api/admin/direct-checkout/" + paidCustomer.reference + "/reject", {});
  expect(container.textContent).toContain("payment rejected.");
  expect(container.querySelector('[data-testid="payment-card"]')).toBeNull();
  expect(window.prompt).not.toHaveBeenCalled();
});

test("a cancelled confirmation makes no approval request", async () => {
  await render(); window.confirm.mockReturnValue(false);
  await click(button("✓ APPROVE"));
  expect(client.post).not.toHaveBeenCalled();
});

test("shows the specific fulfillment error and safely retries with no required fields", async () => {
  await render();
  client.post.mockImplementation(async () => {
    entries = [{ ...paidCustomer, payment_status: "FULFILLMENT_FAILED", approved_by: "owner@example.test", fulfillment_error: "SMTP authentication failed", license_status: "ISSUED" }];
    return { data: { status: "FULFILLMENT_FAILED", fulfillment_error: "SMTP authentication failed" } };
  });
  await click(button("✓ APPROVE"));
  expect(container.textContent).toContain("Fulfillment failed");
  expect(container.textContent).toContain("SMTP authentication failed");
  expect(button("✓ APPROVE")).toBeUndefined();
  expect(button("Retry Fulfillment")).toBeDefined();
  await click(button("Retry Fulfillment"));
  expect(client.post).toHaveBeenLastCalledWith("/api/admin/direct-checkout/" + paidCustomer.reference + "/retry-fulfillment", {});
});

test("searches the server by a historical customer's full order ID and switches status filters", async () => {
  await render();
  await change(container.querySelector('input[type="search"]'), paidCustomer.reference);
  await act(async () => { jest.advanceTimersByTime(250); await flush(); });
  expect(client.get).toHaveBeenLastCalledWith("/api/admin/direct-checkout/orders", { params: { q: paidCustomer.reference, status: "pending", limit: 50, offset: 0 } });
  await change(container.querySelector("select"), "approved");
  expect(client.get).toHaveBeenLastCalledWith("/api/admin/direct-checkout/orders", { params: { q: paidCustomer.reference, status: "approved", limit: 50, offset: 0 } });
});

test("loads subsequent results without losing earlier customers", async () => {
  client.get.mockImplementation(async (url, options) => {
    const configured = configResponse(url);
    if (configured) return configured;
    return { data: { entries: options?.params?.offset ? [{ ...paidCustomer, reference: "XC-SECOND", buyer_name: "Another Customer" }] : [paidCustomer], total: 2 } };
  });
  await render(); await click(button("Load more payments"));
  expect(client.get).toHaveBeenLastCalledWith("/api/admin/direct-checkout/orders", { params: { status: "pending", q: "", limit: 50, offset: 1 } });
  expect(container.querySelectorAll('[data-testid="payment-card"]')).toHaveLength(2);
  expect(container.textContent).toContain("Test Customer"); expect(container.textContent).toContain("Another Customer");
});

test("refreshes new orders automatically and exposes authorization errors", async () => {
  await render();
  entries.push({ ...paidCustomer, reference: "XC-NEW", buyer_name: "New Customer" });
  await act(async () => { jest.advanceTimersByTime(30000); await flush(); });
  expect(container.textContent).toContain("New Customer");
  client.post.mockRejectedValue({ response: { data: { detail: "Administrator permissions required" } } });
  await click(button("✓ APPROVE"));
  expect(container.querySelector('[role="alert"]').textContent).toContain("Administrator permissions required");
});

test("keeps ambiguous historical email delivery visible for safe recovery instead of showing a complete approval", async () => {
  entries = [{ ...paidCustomer, payment_status: "FULFILLED", license_status: "ISSUED", fulfillment_email_status: "DELIVERY_UNKNOWN",
    fulfillment_email_error: "Email delivery outcome is unknown; a duplicate email was prevented." }];
  await render();
  await change(container.querySelector("select"), "all");
  const card = container.querySelector('[data-testid="payment-card"]');
  expect(card.textContent).toContain("Fulfillment failed");
  expect(card.textContent).toContain("duplicate email was prevented");
  expect(button("✓ APPROVE")).toBeUndefined();
  expect(button("Retry Fulfillment")).toBeDefined();
  client.post.mockRejectedValue({ response: { data: { detail: "Check the sender delivery log before another send." } } });
  await click(button("Retry Fulfillment"));
  expect(client.post).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Check the sender delivery log before another send.");
});

test("offers account-link recovery for a historical fulfilled order without approving a second time", async () => {
  entries = [{ ...paidCustomer, payment_status: "FULFILLED", license_status: "ISSUED", fulfillment_email_status: "SENT",
    account_link_status: "EXISTING_LINK_REQUIRES_REVIEW" }];
  await render(); await change(container.querySelector("select"), "all");
  expect(container.querySelector('[data-testid="payment-card"]').textContent).toContain("Fulfillment failed");
  expect(container.textContent).toContain("Customer account linking requires recovery");
  expect(button("✓ APPROVE")).toBeUndefined();
  expect(button("Retry Fulfillment")).toBeDefined();
});
