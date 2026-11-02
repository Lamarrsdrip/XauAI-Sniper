import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
const apiClient = axios.create({ withCredentials: true });
const inputClass = "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-[13px] text-white outline-none focus:border-amber-300/50";
const btnClass = "rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white disabled:opacity-40 hover:bg-white/15";
function Label({ title, children }) {
  return <label className="block space-y-1.5"><span className="text-[11px] font-medium text-white/55">{title}</span>{children}</label>;
}
export default function DirectCheckoutAdmin({ api }) {
  const [cfg, setCfg] = useState(null);
  const [orders, setOrders] = useState([]);
  const [dollars, setDollars] = useState("");
  const [fx, setFx] = useState("");
  const [countries, setCountries] = useState("");
  const [wallets, setWallets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState({});
  const [evidence, setEvidence] = useState({});
  const [proofView, setProofView] = useState(null);
  const load = useCallback(async () => {
    try {
      const [config, result] = await Promise.all([
        apiClient.get(api + "/admin/direct-checkout/config"),
        apiClient.get(api + "/admin/direct-checkout/orders")
      ]);
      setCfg(config.data);
      setOrders(result.data.entries || []);
      setDollars(config.data.price_usd_cents ? (config.data.price_usd_cents / 100).toFixed(2) : "");
      setFx(config.data.usd_ngn_rate || "");
      setCountries((config.data.crypto_countries || []).join(", "));
      setWallets(config.data.wallets || []);
    } catch (e) { setError(e.response?.data?.detail || "Unable to fetch direct checkout administration."); }
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
      const payload = {
        price_usd_cents: cents,
        bank_enabled: cfg.bank_enabled, crypto_enabled: cfg.crypto_enabled,
        crypto_countries: countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
        wallets: wallets.map((w) => ({ asset: w.asset, network: w.network, address: w.address.trim() }))
      };
      // Do not refresh a rate timestamp just by saving unrelated settings.
      if (fx.trim() !== (cfg.usd_ngn_rate || "")) payload.usd_ngn_rate = fx.trim();
      await apiClient.put(api + "/admin/direct-checkout/config", payload);
      setNotice("Configuration saved. Production payments require validated destinations and operational review.");
      await load();
    } catch (e) { setError(e.response?.data?.detail || e.message || "Could not save configuration."); }
    finally { setBusy(false); }
  }
  async function viewProof(reference) {
    setError("");
    try {
      const response = await apiClient.get(api + "/admin/direct-checkout/" + encodeURIComponent(reference));
      const src = response.data?.order?.evidence_image;
      if (typeof src !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(src)) throw new Error("No safe image proof is stored.");
      setProofView({ reference, src });
    } catch (err) { setError(err.response?.data?.detail || err.message || "Unable to load evidence."); }
  }
  async function action(reference, name) {
    setError(""); setNotice(""); setBusy(true);
    try {
      const confirmation = name === "approve" ? "Approve only after independently verifying the exact bank payment or on-chain transfer. Continue?" : "Reject this order?";
      if (!window.confirm(confirmation)) return;
      await apiClient.post(api + "/admin/direct-checkout/" + encodeURIComponent(reference) + "/" + name,
        { evidence_reference: (evidence[reference] || "").trim(),
          verification_notes: (notes[reference] || "").trim() });
      setNotice("Order " + reference + " " + (name === "approve" ? "verified and processed" : "rejected") + ".");
      await load();
    } catch (e) { setError(e.response?.data?.detail || "Unable to update order."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5" data-testid="admin-direct-checkout">
    <div><h2 className="font-heading text-2xl font-semibold text-white">Manual payment operations</h2><p className="mt-1 text-sm text-white/45">USD is the source price. Bank FX and crypto destinations must be approved manually before checkout is enabled.</p></div>
    {error && <p role="alert" className="rounded-xl border border-rose-300/30 bg-rose-300/10 p-3 text-sm text-rose-300">{error}</p>}
    {notice && <p className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 p-3 text-sm text-emerald-300">{notice}</p>}
    {cfg && <section className="rounded-2xl border border-white/10 bg-[#111216] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-bold text-white">Payment settings</h3><button onClick={load} className={btnClass}>Refresh</button></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Label title="One-time product price (USD)"><input className={inputClass} inputMode="decimal" value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder="Set official selling price"/></Label>
        <Label title="USD → NGN rate (manually reviewed; valid 24h)"><input className={inputClass} inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="Rate from a verified current source"/></Label>
      </div>
      <p className="mt-2 text-[11px] text-white/40">Rate timestamp: {cfg.rate_as_of ? new Date(cfg.rate_as_of).toLocaleString() : "Not configured"} · Rates older than 24 hours fail closed.</p>
      <div className="mt-5 flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={cfg.bank_enabled} onChange={(e) => setCfg({ ...cfg, bank_enabled: e.target.checked })}/> Enable Nigerian manual bank</label>
        <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={cfg.crypto_enabled} onChange={(e) => setCfg({ ...cfg, crypto_enabled: e.target.checked })}/> Enable international stablecoins</label>
      </div>
      <div className="mt-5"><Label title="Approved countries for crypto (2-letter ISO codes separated by commas)"><input className={inputClass} value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="US, GB, CA"/></Label></div>
      <div className="mt-5 space-y-3">
        <p className="text-xs font-bold text-white/70">Approved receiving wallets</p>
        {wallets.map((w, i) => <div key={i} className="grid gap-2 md:grid-cols-[100px_100px_1fr_auto]">
          <select className={inputClass} value={w.asset} onChange={(e) => setWallets(wallets.map((v, j) => i === j ? { ...v, asset: e.target.value } : v))}><option className="bg-black" value="USDT">USDT</option><option className="bg-black" value="USDC">USDC</option></select>
          <select className={inputClass} value={w.network} onChange={(e) => setWallets(wallets.map((v, j) => i === j ? { ...v, network: e.target.value } : v))}><option className="bg-black" value="ERC20">ERC20</option><option className="bg-black" value="TRC20">TRC20</option></select>
          <input className={inputClass} aria-label="Receiving wallet address" placeholder="Approved destination address" value={w.address} onChange={(e) => setWallets(wallets.map((v, j) => i === j ? { ...v, address: e.target.value } : v))}/>
          <button className={btnClass} onClick={() => setWallets(wallets.filter((_, j) => i !== j))}>Remove</button>
        </div>)}
        <button className={btnClass} onClick={() => setWallets([...wallets, { asset: "USDT", network: "ERC20", address: "" }])}>Add approved wallet</button>
        <p className="text-[11px] text-white/40">Nigerian bank account details are managed in the existing Bank Transfers tab. Wallets must be independently verified before activating payments.</p>
      </div>
      <button disabled={busy} onClick={save} className="mt-5 rounded-xl bg-amber-300 px-5 py-3 text-sm font-bold text-black disabled:opacity-50">Save direct-checkout configuration</button>
    </section>}
    <section className="rounded-2xl border border-white/10 bg-[#111216] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-base font-bold text-white">Manual orders and review</h3><button className={btnClass} onClick={load}>Refresh orders</button></div>
      {orders.length === 0 && <p className="text-sm text-white/45">No direct-checkout orders yet.</p>}
      <div className="space-y-3">{orders.map((order) => <div key={order.reference} className="rounded-xl border border-white/10 bg-white/[.03] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="break-all font-mono text-xs text-white">{order.reference}</strong><span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-amber-200">{order.payment_status}</span></div>
        <p className="mt-2 text-[12px] text-white/60">{order.buyer_name} · {order.buyer_email} · {order.country} · {order.method}</p>
        <p className="mt-1 font-mono text-[12px] text-white/60">{order.amount_minor / 100} {order.currency} · {new Date(order.created_at).toLocaleString()}</p>
        <p className="mt-1 break-all text-xs text-white/65">Submitted reference: {order.submitted_reference || "Not submitted"}</p>
        {order.has_proof && <button className={btnClass + " mt-2"} type="button" onClick={() => viewProof(order.reference)}>View optional proof (unverified)</button>}
        {order.payment_status === "MANUAL_SUBMITTED" && <div className="mt-4 space-y-2">
          <input className={inputClass} aria-label="Authoritative verification reference" value={evidence[order.reference] || ""} onChange={(e) => setEvidence({ ...evidence, [order.reference]: e.target.value })} placeholder="Independently verified bank/chain transaction ID"/>
          <textarea className={inputClass} aria-label="Review verification notes" value={notes[order.reference] || ""} onChange={(e) => setNotes({ ...notes, [order.reference]: e.target.value })} rows={2} placeholder="Verification evidence, amount, beneficiary/network, check date"/>
          <div className="flex gap-2"><button className={btnClass} disabled={busy || (evidence[order.reference] || "").length < 6 || (notes[order.reference] || "").length < 12} onClick={() => action(order.reference, "approve")}>Approve verified payment</button><button className={btnClass} disabled={busy || (evidence[order.reference] || "").length < 6 || (notes[order.reference] || "").length < 12} onClick={() => action(order.reference, "reject")}>Reject</button></div>
        </div>}
      </div>)}</div>
    </section>
    {proofView && <div role="dialog" aria-label="Unverified transfer evidence" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
      <div className="max-h-[90vh] max-w-xl overflow-auto rounded-2xl border border-white/20 bg-[#121416] p-5">
        <div className="flex justify-between gap-4"><h3 className="text-sm font-bold text-white">Supporting evidence · {proofView.reference}</h3><button type="button" className={btnClass} onClick={() => setProofView(null)}>Close</button></div>
        <p className="mt-2 text-xs leading-5 text-amber-200">Not verified. Check an authoritative bank statement or blockchain explorer before approving.</p>
        <img src={proofView.src} alt="Customer submitted payment evidence, unverified" className="mt-4 max-h-[65vh] max-w-full rounded-xl object-contain"/>
      </div>
    </div>}
  </div>;
}
