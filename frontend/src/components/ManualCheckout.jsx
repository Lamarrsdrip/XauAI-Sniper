import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, LoaderCircle, ShieldCheck, X } from "lucide-react";

const COUNTRY_CODES = "NG US GB CA AU DE FR ES IT NL IE BE AT CH SE NO DK FI PL PT GR CZ RO HU SK SI HR BG CY MT LU EE LV LT IS JP KR SG MY TH PH ID VN IN PK BD AE SA QA KW BH OM EG MA ZA KE GH UG TZ RW ET SN CI CM BJ TG LR SL GM ZM ZW NA BW MU SC TR BR AR CL CO MX PE NZ IL".split(" ");
const displayNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const countries = COUNTRY_CODES.map((code) => ({ code, name: displayNames ? displayNames.of(code) : code })).sort((a, b) => a.name.localeCompare(b.name));
const styles = {
  input: "w-full rounded-xl border border-[#dcd9d1] bg-white px-4 py-3.5 text-[16px] text-[#14282b] outline-none focus:border-[#a98b53] focus:ring-2 focus:ring-[#a98b53]/15",
  btn: "inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#172b2e] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#30494b] disabled:cursor-not-allowed disabled:opacity-40"
};
function CopyValue({ label, value }) {
  const [copied, setCopied] = useState(false);
  return <div className="flex items-center justify-between gap-3 border-b border-[#eeece5] py-3 last:border-0">
    <span className="text-[12px] text-[#667475]">{label}</span>
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 break-all text-right font-mono text-[12px] font-semibold text-[#1a2e31]">{value}</span>
      <button type="button" aria-label={"Copy " + label} onClick={async () => { try { await navigator.clipboard.writeText(String(value)); setCopied(true); } catch {} }} className="rounded-lg border border-[#e6e3db] bg-white p-2 text-[#6c5b38] hover:bg-[#f2efea]">{copied ? <CheckCircle2 size={14}/> : <Copy size={14}/>}</button>
    </div>
  </div>;
}
export default function ManualCheckout({ api, config, onClose }) {
  const [step, setStep] = useState("country");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [assetNetwork, setAssetNetwork] = useState("");
  const [quote, setQuote] = useState(null);
  const [proof, setProof] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => countries.filter((c) => (c.name + " " + c.code).toLowerCase().includes(search.trim().toLowerCase())), [search]);
  const isNigeria = country === "NG";
  const enabled = isNigeria ? config.bank_enabled : config.crypto_enabled && config.crypto_countries?.includes(country);
  const options = config.crypto_options || [];
  useEffect(() => {
    if (!quote?.reference || (step !== "pending" && step !== "payment")) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await axios.get(api + "/purchase/direct/" + encodeURIComponent(quote.reference) + "/status");
        if (!cancelled) setStatus(response.data.status);
      } catch { /* noncritical connectivity; keep last known state */ }
    };
    check();
    const timer = window.setInterval(check, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [api, quote, step]);
  async function createQuote() {
    if (!name.trim() || !email.includes("@")) { setError("Enter your name and a valid email address."); return; }
    if (!isNigeria && !assetNetwork) { setError("Select a supported stablecoin and network."); return; }
    setBusy(true); setError("");
    const [asset, network] = assetNetwork ? assetNetwork.split(":") : ["", ""];
    try {
      const response = await axios.post(api + "/purchase/direct/quote", { country, buyer_name: name, buyer_email: email, asset, network });
      setQuote(response.data);
      setStatus(response.data.status);
      setStep("payment");
    } catch (err) { setError(err.response?.data?.detail || "Unable to create a safe payment quote."); }
    finally { setBusy(false); }
  }
  async function submit() {
    setBusy(true); setError("");
    try {
      const response = await axios.post(api + "/purchase/direct/" + encodeURIComponent(quote.reference) + "/submit", { payment_reference: proof.trim() });
      setStatus(response.data.status);
      setStep("pending");
    } catch (err) { setError(err.response?.data?.detail || "Could not submit your reference. Check the details."); }
    finally { setBusy(false); }
  }
  return <div role="dialog" aria-modal="true" aria-label="XauCloud manual checkout" className="fixed inset-0 z-[100] overflow-y-auto bg-[#101d1c]/65 px-3 py-4 backdrop-blur-sm sm:p-8" data-testid="manual-checkout">
    <div className="mx-auto w-full max-w-[610px] overflow-hidden rounded-[26px] border border-[#e8e4d9] bg-[#f9f8f5] shadow-[0_25px_100px_rgba(0,0,0,.2)]">
      <div className="flex items-center justify-between gap-4 border-b border-[#e6e1d6] bg-white px-5 py-5 sm:px-7">
        <div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9b804a]">XauCloud · Secure manual checkout</div><h2 className="mt-1 font-heading text-xl font-semibold text-[#1b2a2a]">Purchase your license</h2></div>
        <button type="button" onClick={onClose} aria-label="Close checkout" className="rounded-full border border-[#eee9df] p-2.5 text-[#4a5959] hover:bg-[#f4f0e8]"><X size={19}/></button>
      </div>
      <div className="px-5 py-6 sm:px-7">
        <div className="mb-6 flex items-center gap-2 text-[10px] font-semibold text-[#778281]">
          {["country", "details", "payment", "pending"].map((item, i) => <React.Fragment key={item}><span className={["rounded-full px-2.5 py-1.5", item === step ? "bg-[#183235] text-white" : "bg-[#eceae4] text-[#69736d]"].join(" ")}>{["1. Country", "2. Details", "3. Pay", "4. Review"][i]}</span>{i < 3 && <ArrowRight size={11}/>}</React.Fragment>)}
        </div>
        {step === "country" && <>
          <h3 className="font-heading text-2xl font-semibold text-[#1c3032]">Select your country</h3>
          <p className="mt-2 text-sm leading-6 text-[#6f7b7d]">Your selected country determines available manual payment methods. We do not rely on IP location.</p>
          <input className={styles.input + " mt-5"} placeholder="Search countries…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search countries"/>
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-[#e5e0d7] bg-white p-2">
            {filtered.length === 0 && <p className="p-3 text-sm text-[#778281]">No matching country</p>}
            {filtered.map((c) => <button key={c.code} type="button" onClick={() => { setCountry(c.code); setError(""); }} className={["flex w-full justify-between rounded-lg px-3 py-3 text-left text-sm", country === c.code ? "bg-[#efe9da] font-bold text-[#574321]" : "text-[#394848] hover:bg-[#f5f4f0]"].join(" ")}>{c.name}<span className="text-xs text-[#85908d]">{c.code}</span></button>)}
          </div>
          {country && <p className="mt-4 text-xs text-[#657472]">{enabled ? (isNigeria ? "Nigeria — manual bank transfer" : "International — supported cryptocurrency transfer") : "Checkout is not yet available in this country."}</p>}
          <button className={styles.btn + " mt-5"} disabled={!country || !enabled} onClick={() => setStep("details")}>Continue <ArrowRight size={16}/></button>
        </>}
        {step === "details" && <>
          <button onClick={() => setStep("country")} className="mb-4 inline-flex items-center gap-2 text-xs text-[#74643d]"><ArrowLeft size={14}/> Change country</button>
          <h3 className="font-heading text-2xl font-semibold text-[#1c3032]">Your purchase details</h3>
          <p className="mt-2 text-sm text-[#6b7777]">XauCloud one-time license · {config.price_formatted}. No recurring charge.</p>
          <label className="mt-5 block text-[12px] font-bold text-[#475555]">Full name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} className={styles.input + " mt-2"}/></label>
          <label className="mt-4 block text-[12px] font-bold text-[#475555]">Email for license delivery<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} className={styles.input + " mt-2"}/></label>
          {!isNigeria && <label className="mt-4 block text-[12px] font-bold text-[#475555]">Stablecoin and network
            <select value={assetNetwork} onChange={(e) => setAssetNetwork(e.target.value)} className={styles.input + " mt-2"}>
              <option value="">Select an approved payment network</option>
              {options.map((o) => <option key={o.asset + o.network} value={o.asset + ":" + o.network}>{o.asset} · {o.network}</option>)}
            </select>
          </label>}
          <p className="mt-4 text-[12px] leading-5 text-[#7a8584]"><ShieldCheck className="mr-1 inline-block" size={14}/> Transfers are manually verified. Payment does not automatically activate access.</p>
          {error && <p role="alert" className="mt-3 text-sm text-[#a13c35]">{error}</p>}
          <button disabled={busy || !enabled} onClick={createQuote} className={styles.btn + " mt-5"}>{busy ? <LoaderCircle className="animate-spin" size={18}/> : "Get exact payment instructions"}</button>
        </>}
        {step === "payment" && quote && <>
          <h3 className="font-heading text-2xl font-semibold text-[#1c3032]">{isNigeria ? "Bank transfer" : "Cryptocurrency transfer"}</h3>
          <p className="mt-2 text-sm text-[#6f7c7b]">Transfer only to the verified details below. Keep your receipt/reference for manual review.</p>
          <div className="mt-5 rounded-2xl border border-[#e7e0d3] bg-white px-4 py-2">
            <CopyValue label="Product price" value={quote.usd_price}/>
            <CopyValue label="Exact amount" value={quote.amount_formatted}/>
            <CopyValue label="Order reference" value={quote.reference}/>
            {isNigeria ? <>
              <CopyValue label="Bank" value={quote.details.bank_name}/>
              <CopyValue label="Beneficiary" value={quote.details.account_name}/>
              <CopyValue label="Account number" value={quote.details.account_number}/>
              <CopyValue label="USD/NGN rate" value={quote.details.fx_rate}/>
              <CopyValue label="FX quoted at" value={new Date(quote.details.rate_as_of).toLocaleString()}/>
            </> : <>
              <CopyValue label="Asset" value={quote.details.asset}/>
              <CopyValue label="Network" value={quote.details.network}/>
              <CopyValue label="Wallet" value={quote.details.address}/>
              <p className="py-3 text-[11px] leading-5 text-[#6c7775]">{quote.details.quote_policy}</p>
            </>}
            <CopyValue label="Quote expires" value={new Date(quote.expires_at).toLocaleString()}/>
          </div>
          <label className="mt-5 block text-[12px] font-bold text-[#475555]">{isNigeria ? "Your bank transfer reference" : "Blockchain transaction hash"}
            <input className={styles.input + " mt-2"} value={proof} onChange={(e) => setProof(e.target.value)} placeholder={isNigeria ? "Enter the reference issued by your bank" : "Enter your on-chain transaction hash"}/>
          </label>
          <p className="mt-3 text-[11px] leading-5 text-[#72817e]">Never submit a reference before making a real transfer. Review takes place after submission, not automatically. Save your order reference.</p>
          {status === "MANUAL_EXPIRED" && <p role="alert" className="mt-3 text-sm text-[#a23e38]">Quote expired. Contact support if you already transferred.</p>}
          {error && <p role="alert" className="mt-3 text-sm text-[#a23e38]">{error}</p>}
          <button disabled={busy || !proof.trim() || status === "MANUAL_EXPIRED"} onClick={submit} className={styles.btn + " mt-5"}>{busy ? "Submitting…" : "I have paid — submit for verification"}</button>
        </>}
        {step === "pending" && quote && <>
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#edf1eb] text-[#4d7763]"><CheckCircle2 size={30}/></div>
          <h3 className="font-heading text-2xl font-semibold text-[#1c3032]">{status === "FULFILLED" ? "Payment verified" : status === "MANUAL_REJECTED" ? "Payment not approved" : "Payment submitted — awaiting verification"}</h3>
          <p className="mt-3 text-sm leading-6 text-[#6e7c79]">{status === "FULFILLED" ? "Your license has been issued. Check the email address used at checkout." : "Your payment reference is securely recorded. Our team must independently verify the bank or blockchain payment before fulfilling your license."}</p>
          <div className="mt-5 rounded-2xl border border-[#e7e0d3] bg-white px-4 py-2">
            <CopyValue label="Order reference" value={quote.reference}/>
            <CopyValue label="Payment method" value={quote.method}/>
            <CopyValue label="Amount" value={quote.amount_formatted}/>
            <CopyValue label="Status" value={status || "MANUAL_SUBMITTED"}/>
            <CopyValue label="Submitted at" value={new Date().toLocaleString()}/>
          </div>
          <button className={styles.btn + " mt-5"} onClick={onClose}>Close and keep my reference</button>
        </>}
      </div>
    </div>
  </div>;
}
