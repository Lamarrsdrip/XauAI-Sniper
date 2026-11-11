import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";

const apiClient = axios.create({ withCredentials: true });
const inputClass = "w-full min-w-0 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-base text-white outline-none focus:border-amber-300/50";
const btnClass = "min-h-11 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-sm font-bold text-white disabled:opacity-40 hover:bg-white/15";
const reviewable = new Set(["MANUAL_PENDING", "MANUAL_SUBMITTED", "MANUAL_EXPIRED"]);

function Label({ title, children }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-white/55">{title}</span>{children}</label>;
}
function dateLabel(value) {
  if (!value || Number.isNaN(Date.parse(value))) return "Not submitted";
  return new Date(value).toLocaleString();
}
function amountLabel(order) {
  const currency = order.currency || "USD";
  const amount = Number(order.amount_minor) / 100;
  if (!Number.isFinite(amount)) return "Amount unavailable";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount) + " " + currency; }
  catch { return amount.toFixed(2) + " " + currency; }
}
function statusInfo(order) {
  const status = order.payment_status;
  if (status === "FULFILLMENT_FAILED" || order.fulfillment_error ||
      (status === "FULFILLED" && (order.license_status !== "ISSUED" || order.fulfillment_email_status !== "SENT" || order.account_link_status === "EXISTING_LINK_REQUIRES_REVIEW"))) {
    return ["Fulfillment failed", "border-rose-300/30 bg-rose-300/10 text-rose-200"];
  }
  if (status === "MANUAL_REJECTED") return ["Rejected", "border-rose-300/30 bg-rose-300/10 text-rose-200"];
  if (status === "FULFILLED") return ["Approved", "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"];
  if (status === "FULFILLING") return ["Approved · fulfilling", "border-sky-300/30 bg-sky-300/10 text-sky-200"];
  if (status === "MANUAL_EXPIRED") return ["Pending · payment window expired", "border-amber-300/30 bg-amber-300/10 text-amber-200"];
  return ["Pending", "border-amber-300/30 bg-amber-300/10 text-amber-200"];
}

export default function DirectCheckoutAdmin({ api }) {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [busyOrders, setBusyOrders] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inflight = useRef(new Set());
  const requestId = useRef(0);
  const refreshOrders = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadOrders = useCallback(async (offset = 0) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await apiClient.get(api + "/admin/direct-checkout/orders", {
        params: { status: statusFilter, q: query, limit: 50, offset },
      });
      if (id !== requestId.current) return;
      const entries = result.data.entries || [];
      setOrders((previous) => offset ? [...new Map([...previous, ...entries].map((order) => [order.reference, order])).values()] : entries);
      setTotal(result.data.total ?? entries.length);
      setError("");
    } catch (e) {
      if (id === requestId.current) setError(e.response?.data?.detail || "Unable to load payments. Please refresh.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [api, query, statusFilter]);

  useEffect(() => {
    refreshOrders.current = loadOrders;
    loadOrders();
    const timer = window.setInterval(() => loadOrders(), 30000);
    return () => { window.clearInterval(timer); requestId.current += 1; };
  }, [loadOrders]);

  async function action(order, name) {
    if (inflight.current.has(order.reference)) return;
    const prompts = {
      approve: "Approve payment for " + order.buyer_name + " (" + order.reference + ") and activate the purchased license?",
      reject: "Reject payment for " + order.buyer_name + " (" + order.reference + ")?",
      "retry-fulfillment": "Retry license activation and delivery for " + order.reference + "?",
    };
    if (!window.confirm(prompts[name])) return;
    inflight.current.add(order.reference);
    setBusyOrders((current) => ({ ...current, [order.reference]: true }));
    setError(""); setNotice("");
    try {
      const result = await apiClient.post(api + "/admin/direct-checkout/" + encodeURIComponent(order.reference) + "/" + name, {});
      const failed = result.data.status === "FULFILLMENT_FAILED";
      if (failed) {
        setStatusFilter("failed");
        await refreshOrders.current();
        setError(result.data.fulfillment_error || "Payment approved, but fulfillment failed. Use Retry Fulfillment below.");
      } else {
        await refreshOrders.current();
        setNotice(name === "reject" ? order.reference + ": payment rejected."
          : order.reference + ": payment approved. License: " + (result.data.license_status || "processing") + ". Email: " + (result.data.fulfillment_email_status || "processing") + ".");
      }
    } catch (e) {
      await refreshOrders.current();
      setError(e.response?.data?.detail || e.message || "Unable to update payment. Please refresh and retry.");
    } finally {
      inflight.current.delete(order.reference);
      setBusyOrders((current) => ({ ...current, [order.reference]: false }));
    }
  }

  return <div className="space-y-5" data-testid="admin-direct-checkout">
    <section className="space-y-4" aria-labelledby="pending-payments-heading" data-testid="pending-payments">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="pending-payments-heading" className="font-heading text-2xl font-semibold text-white">Pending Payments</h2><p className="mt-1 text-sm text-white/55">Confirm receipt in your bank or wallet, then approve.</p></div>
        <button type="button" className={btnClass} onClick={() => loadOrders()} disabled={loading}>Refresh</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="block"><span className="sr-only">Search by customer name, email, or order ID</span><input type="search" maxLength={254} className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, or order ID"/></label>
        <label className="block"><span className="sr-only">Payment status</span><select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option className="bg-[#111216]" value="pending">Pending</option>
          <option className="bg-[#111216]" value="approved">Approved</option>
          <option className="bg-[#111216]" value="failed">Fulfillment failed</option>
          <option className="bg-[#111216]" value="rejected">Rejected</option>
          <option className="bg-[#111216]" value="all">All payments</option>
        </select></label>
      </div>
      {error && <p role="alert" className="break-words rounded-xl border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="break-words rounded-xl border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm text-emerald-200">{notice}</p>}
      <div aria-live="polite" aria-busy={loading}>
        <p className="mb-3 text-xs text-white/50">{loading ? "Updating payments…" : total + (total === 1 ? " payment" : " payments")}</p>
        {!loading && orders.length === 0 && <p className="rounded-xl border border-white/10 p-5 text-sm text-white/55">No payments match this search and status.</p>}
        <div className="grid items-start gap-3 lg:grid-cols-2">{orders.map((order) => {
          const [status, tone] = statusInfo(order);
          const busy = Boolean(busyOrders[order.reference]);
          const needsRetry = status === "Fulfillment failed" || order.payment_status === "FULFILLING";
          const asset = order.quote_details?.asset || order.asset || "Crypto";
          const network = order.quote_details?.network || order.network;
          return <article key={order.reference} className="min-w-0 rounded-2xl border border-white/10 bg-[#111216] p-4" aria-label={"Payment " + order.reference} data-testid="payment-card">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words text-base font-semibold text-white">{order.buyer_name || "Customer"}</h3><span className={"rounded-full border px-2.5 py-1 text-xs font-semibold " + tone}>{status}</span></div>
            <p className="mt-1 break-all text-sm text-white/75">{order.buyer_email}</p>
            <p className="mt-1 break-all font-mono text-xs text-white/50">{order.reference}</p>
            <p className="mt-3 text-sm font-medium text-white">{order.product_name || "One-Time XauCloud MT5 License"}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><p className="font-mono text-base font-bold text-white">{amountLabel(order)}</p><p className="text-sm text-white/70">{order.method === "BANK" ? "Bank Transfer" : asset + " Crypto"}{order.method !== "BANK" && network ? " · " + network : ""}</p></div>
            <p className="mt-2 text-xs text-white/50">{order.submitted_at ? "Submitted " + dateLabel(order.submitted_at) : "Created " + dateLabel(order.created_at)}</p>
            {(order.fulfillment_error || order.fulfillment_email_error) && <p role="alert" className="mt-3 break-words rounded-xl border border-rose-300/20 bg-rose-300/5 p-3 text-sm text-rose-200">{order.fulfillment_error || order.fulfillment_email_error}</p>}
            {order.account_link_status === "EXISTING_LINK_REQUIRES_REVIEW" && !order.fulfillment_error && <p role="alert" className="mt-3 text-sm text-rose-200">Customer account linking requires recovery. Use Retry Fulfillment.</p>}
            {reviewable.has(order.payment_status) && <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" className="min-h-12 touch-manipulation rounded-xl bg-emerald-400 px-3 py-3 text-sm font-bold text-[#062315] hover:bg-emerald-300 disabled:opacity-40" disabled={busy} onClick={() => action(order, "approve")}>✓ APPROVE</button>
              <button type="button" className="min-h-12 touch-manipulation rounded-xl border border-rose-300/30 bg-rose-400/15 px-3 py-3 text-sm font-bold text-rose-200 hover:bg-rose-400/25 disabled:opacity-40" disabled={busy} onClick={() => action(order, "reject")}>✕ REJECT</button>
            </div>}
            {needsRetry && <button type="button" className={btnClass + " mt-4 w-full min-h-12 border-amber-300/30 text-amber-200"} disabled={busy} onClick={() => action(order, "retry-fulfillment")}>{busy ? "Retrying…" : "Retry Fulfillment"}</button>}
            {busy && <p role="status" className="mt-2 text-xs text-white/65">Updating payment…</p>}
            <details className="mt-3 border-t border-white/10 pt-3 text-xs text-white/60">
              <summary className="cursor-pointer py-1 text-white/65">Order details</summary>
              <dl className="mt-2 space-y-2 break-words">
                <div><dt className="inline text-white/40">License: </dt><dd className="inline">{order.license_status || "NOT_ISSUED"}</dd></div>
                <div><dt className="inline text-white/40">Account: </dt><dd className="inline">{order.account_link_status || "NOT_LINKED"}</dd></div>
                <div><dt className="inline text-white/40">License email: </dt><dd className="inline">{order.fulfillment_email_status || "NOT_SENT"}</dd></div>
                <div><dt className="inline text-white/40">Created: </dt><dd className="inline">{dateLabel(order.created_at)}</dd></div>
                <div><dt className="inline text-white/40">Submitted: </dt><dd className="inline">{dateLabel(order.submitted_at)}</dd></div>
                {order.approved_by && <div><dt className="inline text-white/40">Approved by: </dt><dd className="inline">{order.approved_by} · {dateLabel(order.approved_at)}</dd></div>}
                {order.rejected_by && <div><dt className="inline text-white/40">Rejected by: </dt><dd className="inline">{order.rejected_by} · {dateLabel(order.rejected_at)}</dd></div>}
              </dl>
            </details>
          </article>;
        })}</div>
        {orders.length < total && <button type="button" className={btnClass + " mt-4 w-full"} disabled={loading} onClick={() => loadOrders(orders.length)}>Load more payments</button>}
      </div>
    </section>
    <PaymentSettings api={api}/>
  </div>;
}

function networksFor(asset) {
  return asset === "USDC" ? ["ERC20"] : ["ERC20", "TRC20"];
}
const BANK_REASON = {
  USD_PRICE_MISSING: "Set the official USD price.",
  BANK_DISABLED: "Turn on Nigerian bank transfer in this payment configuration. Crypto stays available.",
  BANK_DETAILS_MISSING: "Enter the beneficiary name, bank name, and account number.",
  FX_RATE_MISSING: "Enter the verified USD/NGN rate. Crypto checkout stays available.",
  FX_RATE_INVALID: "Correct the saved USD/NGN rate. Crypto checkout stays available.",
  FX_TIMESTAMP_MISSING: "Review and save the configured USD/NGN rate. Crypto checkout stays available.",
  FX_RATE_STALE: "The USD/NGN review is over 24 hours old. Save the reviewed rate to restore bank transfer. Crypto stays available.",
};

function PaymentSettings({ api }) {
  const [cfg, setCfg] = useState(null);
  const [bankCheckoutLive, setBankCheckoutLive] = useState(null);
  const [bankUnavailableReason, setBankUnavailableReason] = useState(null);
  const [dollars, setDollars] = useState("");
  const [fx, setFx] = useState("");
  const [wallets, setWallets] = useState([]);
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const [config, publicConfig] = await Promise.all([
        apiClient.get(api + "/admin/direct-checkout/config"),
        apiClient.get(api + "/purchase/direct/config"),
      ]);
      setCfg(config.data);
      setBankCheckoutLive(publicConfig.data.bank_enabled === true);
      setBankUnavailableReason(publicConfig.data.bank_unavailable_reason || null);
      setDollars(config.data.price_usd_cents ? (config.data.price_usd_cents / 100).toFixed(2) : "");
      setFx(config.data.usd_ngn_rate || "");
      setWallets(config.data.wallets || []);
      setBankName(config.data.bank_name || "");
      setAccountName(config.data.account_name || "");
      setAccountNumber(config.data.account_number || "");
      setInstructions(config.data.instructions || "");
      setError("");
    } catch (e) { setError(e.response?.data?.detail || "Unable to load payment configuration."); }
  }, [api]);
  useEffect(() => { load(); }, [load]);
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const amount = dollars.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error("Enter a valid USD price with at most two decimals.");
      const [whole, fraction = ""] = amount.split(".");
      const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("USD price exceeds safe limits.");
      const number = accountNumber.trim();
      if (number && !/^\d{6,20}$/.test(number)) throw new Error("Account number must be 6 to 20 digits.");
      const payload = {
        price_usd_cents: cents,
        bank_enabled: cfg.bank_enabled, crypto_enabled: cfg.crypto_enabled,
        bank_name: bankName.trim(), account_name: accountName.trim(), instructions: instructions.trim(),
        wallets: wallets.map((w) => ({ asset: w.asset, network: networksFor(w.asset).includes(w.network) ? w.network : "ERC20", address: w.address.trim() })),
      };
      if (number) payload.account_number = number;
      else if (cfg.account_number) throw new Error("Enter the Nigerian account number. Leave crypto enabled if bank transfer is not ready.");
      if (fx.trim() !== (cfg.usd_ngn_rate || "")) payload.usd_ngn_rate = fx.trim();
      await apiClient.put(api + "/admin/direct-checkout/config", payload);
      await load();
      setNotice("Payment configuration saved. Checkout now uses these settings.");
    } catch (e) { setError(e.response?.data?.detail || e.message || "Could not save configuration."); }
    finally { setBusy(false); }
  }
  async function saveReviewedRate() {
    setBusy(true); setError(""); setNotice("");
    try {
      await apiClient.put(api + "/admin/direct-checkout/config", { usd_ngn_rate: fx.trim() });
      await load();
      setNotice("Reviewed USD/NGN rate saved.");
    } catch (e) { setError(e.response?.data?.detail || e.message || "Could not save the reviewed rate."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-white/10 bg-[#111216] p-4" aria-labelledby="payment-configuration-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="payment-configuration-heading" className="font-heading text-2xl font-semibold text-white">Payment configuration</h2>
        <p className="mt-1 text-sm text-white/55">One place for the USD price, crypto wallets, and Nigerian bank transfer. Crypto is offered in every country. Bank transfer is Nigeria only.</p>
      </div>
      {!cfg && <button type="button" className={btnClass} onClick={load}>Load settings</button>}
    </div>
    <div className="mt-4 space-y-4">
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
      {cfg && <>
        <div className="grid gap-4 md:grid-cols-2">
          <Label title="Official product price (USD)"><input className={inputClass} inputMode="decimal" value={dollars} onChange={(e) => setDollars(e.target.value)}/></Label>
          <Label title="Reviewed USD → NGN rate (Nigeria bank transfer)"><input className={inputClass} inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)}/></Label>
        </div>
        <div className="flex flex-wrap items-center gap-3"><p className="text-xs text-white/50">Rate reviewed: {cfg.rate_as_of ? dateLabel(cfg.rate_as_of) : "Not configured"}</p><button type="button" className={btnClass} disabled={busy || !fx.trim()} onClick={saveReviewedRate}>Save reviewed rate</button></div>
        <p className="text-sm text-white/70">Nigerian bank checkout: <strong>{bankCheckoutLive ? "Available" : "Unavailable"}</strong>{!bankCheckoutLive && " · " + (BANK_REASON[bankUnavailableReason] || "Check the saved bank account and pricing configuration.")}</p>
        <div className="flex flex-wrap gap-5">
          <label className="flex min-h-11 items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={Boolean(cfg.bank_enabled)} onChange={(e) => setCfg({ ...cfg, bank_enabled: e.target.checked })}/> Bank transfer enabled (Nigeria only)</label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={Boolean(cfg.crypto_enabled)} onChange={(e) => setCfg({ ...cfg, crypto_enabled: e.target.checked })}/> Crypto payments enabled for every country</label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Label title="Nigerian bank name"><input className={inputClass} value={bankName} onChange={(e) => setBankName(e.target.value)}/></Label>
          <Label title="Beneficiary name"><input className={inputClass} value={accountName} onChange={(e) => setAccountName(e.target.value)}/></Label>
          <Label title="Account number"><input className={inputClass} inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)}/></Label>
          <Label title="Bank payment instructions"><input className={inputClass} value={instructions} onChange={(e) => setInstructions(e.target.value)}/></Label>
        </div>
        <div className="space-y-3">
          <p className="text-xs font-bold text-white/70">Supported coins, networks, and receiving wallets</p>
          {wallets.map((wallet, index) => <div key={index} className="grid gap-2 md:grid-cols-[100px_110px_1fr_auto]">
            <label><span className="sr-only">Wallet {index + 1} coin</span><select className={inputClass} value={wallet.asset} onChange={(e) => setWallets(wallets.map((value, i) => index === i ? { ...value, asset: e.target.value, network: networksFor(e.target.value).includes(value.network) ? value.network : "ERC20" } : value))}><option className="bg-black" value="USDT">USDT</option><option className="bg-black" value="USDC">USDC</option></select></label>
            <label><span className="sr-only">Wallet {index + 1} network</span><select className={inputClass} value={networksFor(wallet.asset).includes(wallet.network) ? wallet.network : "ERC20"} onChange={(e) => setWallets(wallets.map((value, i) => index === i ? { ...value, network: e.target.value } : value))}>{networksFor(wallet.asset).map((network) => <option className="bg-black" key={network} value={network}>{network}</option>)}</select></label>
            <input className={inputClass} aria-label={"Wallet " + (index + 1) + " receiving address"} value={wallet.address} onChange={(e) => setWallets(wallets.map((value, i) => index === i ? { ...value, address: e.target.value } : value))} placeholder="Receiving wallet address"/>
            <button type="button" className={btnClass} onClick={() => setWallets(wallets.filter((_, i) => index !== i))}>Remove</button>
          </div>)}
          <button type="button" className={btnClass} onClick={() => setWallets([...wallets, { asset: "USDT", network: "ERC20", address: "" }])}>Add configured wallet</button>
          <p className="text-xs text-white/50">USDT supports ERC20 and TRC20. USDC supports ERC20. Wallet addresses are only saved when you enter them. Nothing is generated automatically.</p>
        </div>
        <button type="button" disabled={busy} onClick={save} className="min-h-12 w-full rounded-xl bg-amber-300 px-5 py-3 text-sm font-bold text-black disabled:opacity-50 sm:w-auto">Save payment configuration</button>
      </>}
    </div>
  </section>;
}

