import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { ArrowUpRight, Check, Clock3, ShieldCheck, CreditCard } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ManualCheckout from "./ManualCheckout";

function Benefit({ children }) { return <div className="flex items-start gap-2 text-[13px] leading-6 text-[#445955]"><Check size={15} className="mt-1 flex-none text-[#987540]"/>{children}</div>; }

export default function PurchaseSection({ api }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [buyer, setBuyer] = useState(undefined);
  const [trial, setTrial] = useState(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await axios.get(api + "/purchase/direct/config"); setConfig(res.data); setError(""); }
    catch { setError("Unable to load the official price. Please retry before purchasing."); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    axios.get(api + "/cloud/auth/me", { withCredentials: true })
      .then(() => { if (!cancelled) setBuyer(true); })
      .catch(() => { if (!cancelled) setBuyer(false); });
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => {
    if (buyer !== true) return;
    axios.get(api + "/cloud/entitlement", { withCredentials: true })
      .then((r) => setTrial(r.data.trial ? { status: r.data.trial.status.toLowerCase(), expires_at: r.data.trial.trial_expires_at } : null))
      .catch(() => {});
  }, [api, buyer]);
  async function startTrial() {
    if (buyer === undefined) return;
    if (!buyer) { navigate("/command"); return; }
    setTrialBusy(true); setError("");
    try {
      const response = await axios.post(api + "/cloud/signals/trial/start", {}, { withCredentials: true });
      setTrial({ status: response.data.trial?.status?.toLowerCase() || "active", expires_at: response.data.trial?.trial_expires_at });
      navigate("/command");
    } catch (err) { setError(err.response?.data?.detail || "Trial could not start; check your account eligibility."); }
    finally { setTrialBusy(false); }
  }
  const moneyAvailable = config?.price_usd_cents > 0;
  return <div className="border-t border-[#e8e3d9] bg-[#f6f9f6] py-14 text-[#172b2e] md:py-20" data-testid="purchase-section">
    <div className="mx-auto max-w-6xl px-5 md:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <span className="text-[12px] font-bold uppercase tracking-[0.2em] text-[#957747]">Simple pricing</span>
        <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-4xl" data-testid="purchase-title">Choose how you begin.</h2>
        <p className="mt-4 text-[14px] leading-7 text-[#475b57]">Try the Command Center signal experience for three market days, or buy a one-time XauCloud MT5 trading license. No weekly or monthly renewals.</p>
      </div>
      <div className="mx-auto mt-9 grid max-w-4xl gap-4 md:grid-cols-2">
        <div className="flex flex-col rounded-[25px] border border-[#dedbd3] bg-white p-7 shadow-[0_8px_32px_rgba(33,39,35,.03)]" data-testid="plan-card-free-trial">
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-[#947747]"><Clock3 size={15}/> Explore first</div>
          <h3 className="mt-4 font-heading text-2xl font-semibold">3-Day Free Trial</h3>
          <div className="mt-4 text-4xl font-semibold tracking-tight">Free</div>
          <div className="mt-2 text-[12px] text-[#4f605c]">Three trading-market days · no automatic billing</div>
          <div className="mt-7 flex-1 space-y-3"><Benefit>Start with a secure Command Center account</Benefit><Benefit>Explore the available signals and Market Outlook features</Benefit><Benefit>No card or crypto deposit required</Benefit></div>
          {trial?.status === "active" && <p className="mt-4 text-[12px] font-semibold text-[#607b60]">Trial started · expires {new Date(trial.expires_at).toLocaleString()}</p>}
          {trial?.status === "expired" && <p className="mt-4 text-[12px] text-[#aa5b3d]">Your trial has expired.</p>}
          <button type="button" className="mt-8 inline-flex min-h-[49px] items-center justify-center gap-2 rounded-full border border-[#aa9262] bg-white px-5 text-sm font-bold text-[#4f492f] transition hover:bg-[#f8f4e9] disabled:opacity-40"
            disabled={buyer === undefined || trialBusy || trial?.status === "active" || trial?.status === "expired"} onClick={startTrial}>
            {trialBusy ? "Starting…" : trial?.status === "active" ? "Trial active" : trial?.status === "expired" ? "Trial used" : "Start 3-Day Trial"} <ArrowUpRight size={16}/>
          </button>
        </div>
        <div className="relative flex flex-col overflow-hidden rounded-[25px] border border-[#dacbaa] bg-[#fffaf0] p-7 text-[#1a3331] shadow-[0_18px_48px_rgba(46,65,51,.07)]" data-testid="purchase-form">
          <span className="pointer-events-none absolute -right-14 -top-14 h-52 w-52 rounded-full border border-[#bca36d]/35"/>
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-[#715322]"><CreditCard size={15}/> One-time purchase</div>
          <h3 className="mt-4 font-heading text-2xl font-semibold">Buy XauCloud</h3>
          <div className="mt-4 text-4xl font-semibold tracking-tight" data-testid="display-price">{loading ? "Loading…" : moneyAvailable ? config.price_formatted : "Price not set"}</div>
          <div className="mt-2 text-[12px] text-[#4c6058]">Official USD base price · one-time license</div>
          <div className="mt-7 flex-1 space-y-3 text-[#263e38]"><div className="flex items-start gap-2 text-[13px] text-[#405953]"><Check size={15} className="mt-1 flex-none text-[#856024]"/>Verified MT5 release with license PIN</div><div className="flex items-start gap-2 text-[13px] text-[#405953]"><Check size={15} className="mt-1 flex-none text-[#856024]"/>Connected Command Center</div><div className="flex items-start gap-2 text-[13px] text-[#405953]"><Check size={15} className="mt-1 flex-none text-[#856024]"/>Manual bank or crypto verification</div></div>
          <button type="button" data-testid="purchase-btn" disabled={!moneyAvailable || loading}
            onClick={() => setCheckoutOpen(true)}
            className="mt-8 inline-flex min-h-[49px] items-center justify-center gap-2 rounded-full bg-[#183d3b] px-5 text-sm font-bold text-white transition hover:bg-[#275851] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#183d3b] disabled:cursor-not-allowed disabled:opacity-40">
            Buy XauCloud <ArrowUpRight size={16}/>
          </button>
          <p className="mt-3 text-center text-[12px] text-[#50615b]"><ShieldCheck size={12} className="mr-1 inline"/> Verified manually before your license is sent.</p>
        </div>
      </div>
      {error && <div role="alert" className="mx-auto mt-5 flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-xl border border-[#d8b8ad] bg-white p-3 text-center text-[12px] text-[#914a34]">{error}<button type="button" onClick={load} className="font-bold underline">Retry</button></div>}
      <p className="mx-auto mt-7 max-w-3xl text-center text-[12px] leading-6 text-[#52625e]">Trading can lead to a total loss of capital. The trial is not a trial of an MT5 license. A completed payment does not grant access until verified and approved.</p>
    </div>
    {checkoutOpen && config && <ManualCheckout api={api} config={config} onClose={() => setCheckoutOpen(false)}/>}
  </div>;
}
