import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, Clock3,
  Copy, CreditCard, Globe2, Landmark, LoaderCircle, LockKeyhole, Mail,
  MailCheck, ReceiptText, RefreshCw, Search, ShieldCheck,
  Wallet, X
} from "lucide-react";

// The backend is authoritative for country eligibility and supported networks.
const COUNTRY_CODES = "AW AF AO AI AX AL AD AE AR AM AS AQ TF AG AU AT AZ BI BE BJ BQ BF BD BG BH BS BA BL BY BZ BM BO BR BB BN BT BV BW CF CA CC CH CL CN CI CM CD CG CK CO KM CV CR CU CW CX KY CY CZ DE DJ DM DK DO DZ EC EG ER EH ES EE ET FI FJ FK FR FO FM GA GB GE GG GH GI GN GP GM GW GQ GR GD GL GT GF GU GY HK HM HN HR HT HU ID IM IN IO IE IR IQ IS IL IT JM JE JO JP KZ KE KG KH KI KN KR KW LA LB LR LY LC LI LK LS LT LU LV MO MF MA MC MD MG MV MX MH MK ML MT MM ME MN MP MZ MR MS MQ MU MW MY YT NA NC NE NF NG NI NU NL NO NP NR NZ OM PK PA PN PE PH PW PG PL PR KP PT PY PS PF QA RE RO RU RW SA SD SN SG GS SH SJ SB SL SV SM SO PM RS SS ST SR SK SI SE SZ SX SC SY TC TD TG TH TJ TK TM TL TO TT TN TR TV TW TZ UG UA UM UY US UZ VA VC VE VG VI VN VU WF WS YE ZA ZM ZW".split(" ");
const displayNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const countries = COUNTRY_CODES.map((code) => ({ code, name: displayNames ? displayNames.of(code) : code }))
  .sort((a, b) => a.name.localeCompare(b.name));

const ORDER_KEY = "xaucloud.pay.session.v1";

function readSavedOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    const quote = saved?.quote;
    if (!quote || typeof quote.reference !== "string" || typeof quote.expires_at !== "string" || !quote.details) return null;
    if (quote.method !== "BANK" && quote.method !== "CRYPTO") return null;
    if (saved.country !== "NG" && quote.method === "BANK") return null;
    const details = { ...quote.details };
    delete details.fx_rate;
    delete details.rate_as_of;
    return { ...saved, quote: { ...quote, details } };
  } catch { return null; }
}

function customerQuote(quote) {
  const details = { ...(quote.details || {}) };
  delete details.fx_rate;
  delete details.rate_as_of;
  return { ...quote, details };
}
const fieldClass = "mt-2 w-full rounded-2xl border border-[#cbd9d0] bg-white px-4 py-3.5 text-[16px] text-[#15382d] placeholder:text-[#5d6e66] outline-none transition focus:border-[#28725d] focus:ring-4 focus:ring-[#28725d]/10";
const primaryButton = "inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#143f35] px-5 py-3 text-[14px] font-bold text-white shadow-[0_7px_18px_rgba(20,63,53,.16)] transition hover:bg-[#1f5c4b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#143f35] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";
const secondaryButton = "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#d3e0d6] bg-white px-4 py-2.5 text-[12px] font-bold text-[#2a5647] transition hover:bg-[#edf5ef] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#143f35]";
const defaultCryptoChoice = (options) => {
  const list = options || [];
  const usdt = list.find((item) => item.asset === "USDT");
  const pick = usdt || list[0];
  return pick ? pick.asset + ":" + pick.network : "";
};
const moneyLabel = (value) => String(value || "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const formatTime = (seconds) => String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
const buttonLabel = (busy, label) => busy ? <><LoaderCircle size={17} className="animate-spin" /> Processing securely…</> : <>{label}<ArrowRight size={17}/></>;

function CopyButton({ value, title = "Copy", className = "" }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setFailed(false);
    } catch { setFailed(true); }
  };
  return <button type="button" onClick={copy} className={secondaryButton + " " + className}
    aria-label={title + " to clipboard"} title={failed ? "Copy unavailable: select the text instead" : title}>
    {copied ? <Check size={15}/> : <Copy size={15}/>} {failed ? "Select text" : copied ? "Copied" : title}
  </button>;
}

function Detail({ label, value, copy = true, featured = false }) {
  return <div className={"flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-5 " + (featured ? "" : "border-b border-[#e7ede8] last:border-0")}>
    <div className="text-[12px] font-medium text-[#526960]">{label}</div>
    <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
      <span className={"min-w-0 break-all font-semibold text-[#153d33] " + (featured ? "font-mono text-[20px] tracking-tight" : "text-[14px]")}>{value}</span>
      {copy && <CopyButton value={value} title="Copy" className="!min-h-[38px] !px-3 !py-2"/>}
    </div>
  </div>;
}

function StatusDot({ children, tone = "green" }) {
  const style = tone === "amber"
    ? "bg-[#fff3d9] text-[#745321] ring-[#ead6ac]"
    : tone === "red" ? "bg-[#fff0ea] text-[#a13b32] ring-[#f1cbc5]"
    : "bg-[#e8f5ed] text-[#24674b] ring-[#d4e9da]";
  return <span className={"inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 " + style}>
    <span className="h-1.5 w-1.5 rounded-full bg-current"/>{children}
  </span>;
}

export default function ManualCheckout({ api, config, onClose }) {
  const savedOrder = useState(readSavedOrder)[0];
  const [step, setStep] = useState(savedOrder?.step === "pending" ? "pending" : savedOrder?.quote ? "payment" : "country");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState(savedOrder?.country || "");
  const [name, setName] = useState(savedOrder?.name || "");
  const [email, setEmail] = useState(savedOrder?.email || "");
  const [assetNetwork, setAssetNetwork] = useState("");
  const [payMethod, setPayMethod] = useState(savedOrder?.quote?.method === "BANK" ? "BANK" : "CRYPTO");
  const [quote, setQuote] = useState(savedOrder?.quote || null);
  const [referenceInput, setReferenceInput] = useState(savedOrder?.referenceInput || "");
  const [submittedAt, setSubmittedAt] = useState(savedOrder?.submittedAt || null);
  const [status, setStatus] = useState(savedOrder?.status || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [instructionsSent, setInstructionsSent] = useState(savedOrder?.instructionsSent === true);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  const filtered = useMemo(() => countries.filter((item) =>
    (item.name + " " + item.code).toLowerCase().includes(search.trim().toLowerCase())), [search]);
  const isNigeria = country === "NG";
  const cryptoOn = Boolean(config.crypto_enabled);
  const bankOn = Boolean(config.bank_enabled);
  const enabled = isNigeria ? (bankOn || cryptoOn) : Boolean(country && cryptoOn);
  const options = useMemo(() => [...(config.crypto_options || [])].sort((a, b) =>
    (a.asset === "USDT" ? 0 : 1) - (b.asset === "USDT" ? 0 : 1)), [config.crypto_options]);
  const checkoutMethod = isNigeria ? (payMethod === "BANK" ? "BANK" : "CRYPTO") : "CRYPTO";
  const bankPay = quote?.method === "BANK";
  const secondsLeft = quote?.expires_at ? Math.max(0, Math.ceil((Date.parse(quote.expires_at) - nowMs) / 1000)) : 0;
  const expired = step === "payment" && (secondsLeft === 0 || status === "MANUAL_EXPIRED");
  const finished = status === "FULFILLED";
  const rejected = status === "MANUAL_REJECTED";
  const submitted = status === "MANUAL_SUBMITTED" || status === "FULFILLING" || finished || rejected;
  const progress = Math.min(100, Math.max(0, secondsLeft / 1800 * 100));

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!quote?.reference) return;
    const payload = {
      quote: customerQuote(quote), country, name, email, instructionsSent, payMethod,
      referenceInput, submittedAt, status,
      step: step === "pending" ? "pending" : "payment",
    };
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(payload)); } catch { /* Private mode can still complete checkout on screen. */ }
  }, [quote, country, name, email, instructionsSent, referenceInput, submittedAt, status, step, payMethod]);

  useEffect(() => {
    const key = (event) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", key);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", key);
    };
  }, [busy, onClose]);

  useEffect(() => {
    if (!quote?.reference || (step !== "pending" && step !== "payment")) return;
    let active = true;
    const check = async () => {
      try {
        const response = await axios.get(api + "/purchase/direct/" + encodeURIComponent(quote.reference) + "/status");
        if (!active) return;
        setStatus(response.data.status);
        if (response.data.submitted_at) setSubmittedAt(response.data.submitted_at);
        if (response.data.expires_at) setQuote((current) => current && current.expires_at !== response.data.expires_at ? { ...current, expires_at: response.data.expires_at } : current);
        if (response.data.status === "MANUAL_PENDING" || response.data.status === "MANUAL_EXPIRED") setStep("payment");
        if (["MANUAL_SUBMITTED", "FULFILLING", "FULFILLED", "MANUAL_REJECTED"].includes(response.data.status)) setStep("pending");
      } catch (err) {
        if (err.response?.status === 404) {
          try { localStorage.removeItem(ORDER_KEY); } catch { /* ignore */ }
          setQuote(null); setStep("country"); setStatus("");
          setError("That payment order could not be restored. Create a new one if you have not already transferred.");
        }
      }
    };
    check();
    const timer = window.setInterval(check, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, quote?.reference, step]);

  function chooseCountry(code) {
    setCountry(code);
    setError("");
    const nextMethod = code === "NG" && bankOn ? "BANK" : "CRYPTO";
    setPayMethod(nextMethod);
    if (!assetNetwork) setAssetNetwork(defaultCryptoChoice(options));
  }

  async function createQuote() {
    if (!enabled || !country) { setError("Checkout is unavailable right now."); return; }
    if (name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter your full name and a valid email to receive payment details."); return;
    }
    const method = checkoutMethod;
    const choice = assetNetwork || defaultCryptoChoice(options);
    if (method === "CRYPTO" && !choice) { setError("USDT checkout is not configured yet."); return; }
    if (method === "BANK" && !bankOn) { setError("Nigerian bank transfer is not available right now."); return; }
    setBusy(true); setError(""); setResendMessage("");
    const [asset, network] = method === "CRYPTO" ? choice.split(":") : ["", ""];
    try {
      const response = await axios.post(api + "/purchase/direct/quote", {
        country, method, buyer_name: name.trim(), buyer_email: email.trim(), asset, network,
      });
      setQuote(customerQuote(response.data));
      setInstructionsSent(response.data.instructions_email_sent === true);
      setNowMs(Date.now());
      setStatus(response.data.status);
      setReferenceInput("");
      setStep("payment");
    } catch (err) { setError(err.response?.data?.detail || "Unable to create payment instructions. Please try again."); }
    finally { setBusy(false); }
  }

  async function submit() {
    const value = referenceInput.trim().replace(/\s+/g, " ");
    if (!value || expired || submitted) return;
    setBusy(true); setError("");
    try {
      const response = await axios.post(api + "/purchase/direct/" + encodeURIComponent(quote.reference) + "/submit",
        bankPay ? { sender_account_name: value } : { payment_reference: value });
      setStatus(response.data.status);
      if (response.data.submitted_at) setSubmittedAt(response.data.submitted_at);
      setStep("pending");
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : (bankPay
        ? "We couldn't record that account name. Check it and try again."
        : "We couldn't record your transaction hash. Please check it and retry."));
    }
    finally { setBusy(false); }
  }

  async function resendInstructions() {
    if (!quote?.reference || resendBusy || expired) return;
    setResendBusy(true); setResendMessage("");
    try {
      const response = await axios.post(api + "/purchase/direct/" + encodeURIComponent(quote.reference) + "/resend-instructions");
      setInstructionsSent(response.data.sent === true);
      setResendMessage(response.data.sent ? "Instructions sent to your email." : "Email delivery is unavailable. Copy the details below.");
    } catch (err) {
      setResendMessage(err.response?.data?.detail || "Email could not be resent. You can still copy the details below.");
    } finally { setResendBusy(false); }
  }

  function newQuote() {
    try { localStorage.removeItem(ORDER_KEY); } catch { /* ignore */ }
    setQuote(null); setReferenceInput(""); setStatus(""); setInstructionsSent(false);
    setSubmittedAt(null); setResendMessage(""); setError(""); setAssetNetwork(""); setPayMethod(bankOn ? "BANK" : "CRYPTO"); setStep("details");
  }

  const instructions = quote && (bankPay
    ? ["XauCloud — Bank transfer", "Amount: " + quote.amount_formatted, "Bank: " + quote.details.bank_name,
      "Beneficiary: " + quote.details.account_name, "Account number: " + quote.details.account_number,
      "Order reference: " + quote.reference].join("\n")
    : ["XauCloud — Crypto transfer", "Amount: " + quote.amount_formatted,
      "Asset: " + quote.details.asset, "Network: " + quote.details.network,
      "Wallet: " + quote.details.address, "Order reference: " + quote.reference].join("\n"));

  return <div role="dialog" aria-modal="true" aria-label="XauCloud secure payment gateway"
    className="fixed inset-0 z-[100] overflow-y-auto bg-[#0c241c]/75 backdrop-blur-md sm:px-5 sm:py-8" data-testid="manual-checkout">
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[760px] flex-col overflow-hidden bg-[#f7f9f6] text-[#193d32] shadow-[0_32px_105px_rgba(0,0,0,.24)] sm:min-h-0 sm:rounded-[30px] sm:border sm:border-white/60">

      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#e5ece6] bg-white px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#173f34] font-heading text-[17px] font-bold text-[#f1d795] shadow-sm">X</div>
          <div>
            <div className="font-heading text-[16px] font-bold tracking-tight">XauCloud <span className="text-[#9a783e]">Pay</span></div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#597168]"><LockKeyhole size={12}/> Secure manual checkout</div>
          </div>
        </div>
        <button type="button" aria-label="Close payment gateway" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#dfe7df] bg-[#f7f9f6] text-[#264c3e] hover:bg-[#eef3ed]"><X size={18}/></button>
      </div>

      <div className="px-5 pb-6 pt-5 sm:px-8 sm:pb-8">
        <div className="mb-6 grid grid-cols-4 gap-2" aria-label="Checkout progress">
          {["country", "details", "payment", "pending"].map((item, i) => {
            const index = ["country", "details", "payment", "pending"].indexOf(step);
            return <div key={item} className="min-w-0">
              <div className={"h-1.5 rounded-full " + (i <= index ? "bg-[#22644f]" : "bg-[#dfe6de]")}/>
              <div className={"mt-2 text-center text-[10px] font-bold sm:text-[11px] " + (i === index ? "text-[#194637]" : "text-[#687a6e]")}>{["Country", "Details", "Transfer", "Review"][i]}</div>
            </div>;
          })}
        </div>

        {step === "country" && <section>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#e8f2ea] px-3 py-1.5 text-[11px] font-bold text-[#30674d]"><Globe2 size={13}/> STEP 01 · LOCATION</div>
          <h2 className="font-heading text-[26px] font-bold tracking-tight sm:text-[34px]">Where are you paying from?</h2>
          <p className="mt-2 text-[14px] leading-6 text-[#52675b]">Every country pays with USDT. Nigeria can also pay by bank transfer.</p>
          <button type="button" onClick={() => chooseCountry("NG")}
            className={"mt-6 flex w-full items-center gap-4 rounded-[22px] border p-4 text-left transition sm:p-5 " + (country === "NG" ? "border-[#28765b] bg-[#eaf5ed] shadow-[0_0_0_2px_rgba(40,118,91,.07)]" : "border-[#e0e8df] bg-white hover:border-[#a8c8b7]")}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e4efe6] text-[#235a44]"><Landmark size={23}/></span>
            <span className="flex-1"><strong className="block text-[15px]">Nigeria</strong><span className="mt-1 block text-[12px] text-[#5d7167]">Bank transfer or USDT</span></span>
            <span className={"flex h-6 w-6 items-center justify-center rounded-full border-2 " + (country === "NG" ? "border-[#28765b] bg-[#28765b] text-white" : "border-[#a6b7aa]")}>{country === "NG" && <Check size={14}/>}</span>
          </button>
          <div className="my-5 flex items-center gap-4 text-[11px] font-bold uppercase tracking-widest text-[#798a7f]"><span className="h-px flex-1 bg-[#dfe7dd]"/>OR ANOTHER COUNTRY<span className="h-px flex-1 bg-[#dfe7dd]"/></div>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-4 top-4 text-[#687c70]"/>
            <input aria-label="Search your country" placeholder="Search country name..." value={search} onChange={(e) => setSearch(e.target.value)}
              className={fieldClass + " !mt-0 !pl-11"}/>
          </div>
          <div className="mt-3 max-h-[208px] overflow-y-auto rounded-2xl border border-[#dfe8df] bg-white p-1.5">
            {filtered.filter((c) => c.code !== "NG").map((c) => <button key={c.code} type="button" onClick={() => chooseCountry(c.code)}
              className={"flex w-full items-center justify-between rounded-xl px-4 py-2.5 text-left text-[13px] transition " + (country === c.code ? "bg-[#eaf5ed] font-bold text-[#235b46]" : "text-[#40564b] hover:bg-[#f4f7f3]")}>
              {c.name} <span className="text-[11px] text-[#76887a]">{c.code}</span>
            </button>)}
            {filtered.filter((c) => c.code !== "NG").length === 0 && <div className="p-4 text-[13px] text-[#697d70]">No matching country</div>}
          </div>
          {country && <div className={"mt-4 rounded-xl px-4 py-3 text-[12px] " + (enabled ? "bg-[#e8f5ee] text-[#236246]" : "bg-[#fff4e6] text-[#875825]")}>
            {enabled ? (isNigeria
              ? bankOn ? "Nigeria: bank transfer and USDT are available. Bank transfer is the default."
                : "USDT is available. Bank transfer is temporarily unavailable; it cannot be selected until it is restored."
              : "USDT crypto is available for this country.")
              : "Checkout is temporarily unavailable. No payment will be requested."}
          </div>}
          {error && <p role="alert" className="mt-3 text-sm text-[#a1352b]">{error}</p>}
          <button type="button" disabled={!country || !enabled} onClick={() => { setError(""); setStep("details"); }} className={primaryButton + " mt-5"}>{buttonLabel(false, "Continue to payment details")}</button>
        </section>}

        {step === "details" && <section>
          <button type="button" onClick={() => { setError(""); setStep("country"); }} className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-[#3b6952]"><ArrowLeft size={15}/> Change country</button>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#e8f2ea] px-3 py-1.5 text-[11px] font-bold text-[#30674d]"><ReceiptText size={13}/> STEP 02 · ORDER DETAILS</div>
          <h2 className="font-heading text-[26px] font-bold tracking-tight sm:text-[34px]">Complete your order</h2>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[#d8e8dc] bg-white p-5">
            <div><div className="text-[11px] font-semibold uppercase tracking-wider text-[#687b6d]">One-time XauCloud MT5 license</div><div className="mt-1 text-[12px] text-[#597064]">{checkoutMethod === "BANK" ? "Bank transfer · NGN at checkout" : "USDT crypto · " + country}</div></div>
            <strong className="font-heading text-[24px] tracking-tight text-[#194b39]">{config.price_formatted}</strong>
          </div>
          <label className="mt-5 block text-[13px] font-bold text-[#344f41]">Full name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" placeholder="Your full name" className={fieldClass}/>
          </label>
          <label className="mt-4 block text-[13px] font-bold text-[#344f41]">Email address
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" placeholder="you@example.com" className={fieldClass}/>
            <span className="mt-2 flex items-start gap-2 text-[12px] font-medium leading-5 text-[#597064]"><Mail size={14} className="mt-0.5 shrink-0"/> We'll email your payment details here immediately after creating the order.</span>
          </label>
          {isNigeria && <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={!bankOn} aria-pressed={bankOn && payMethod === "BANK"} aria-label={"Nigerian bank transfer" + (bankOn ? "" : " - temporarily unavailable")} onClick={() => { setPayMethod("BANK"); setError(""); }}
              className={"rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#28765b] disabled:cursor-not-allowed disabled:opacity-50 " + (payMethod === "BANK" && bankOn ? "border-[#28765b] bg-[#eaf5ed]" : "border-[#e0e8df] bg-white")}>
              <strong className="block text-[14px]">Bank transfer</strong>
              <span className="mt-1 block text-[12px] text-[#5d7167]">{bankOn ? "Pay in NGN · Nigeria only" : "Temporarily unavailable · Please use USDT"}</span>
            </button>
            <button type="button" disabled={!cryptoOn} aria-pressed={cryptoOn && payMethod === "CRYPTO"} onClick={() => { setPayMethod("CRYPTO"); setError(""); if (!assetNetwork) setAssetNetwork(defaultCryptoChoice(options)); }}
              className={"rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#28765b] disabled:cursor-not-allowed disabled:opacity-50 " + (payMethod === "CRYPTO" && cryptoOn ? "border-[#28765b] bg-[#eaf5ed]" : "border-[#e0e8df] bg-white")}>
              <strong className="block text-[14px]">USDT crypto</strong>
              <span className="mt-1 block text-[12px] text-[#5d7167]">Same crypto checkout as every other country</span>
            </button>
          </div>}
          {isNigeria && !bankOn && <p role="status" className="mt-3 rounded-xl bg-[#fff1df] p-3 text-[12px] leading-5 text-[#76521c]">Bank payment is unavailable right now. Your existing crypto order cannot be converted; a new order must be created after bank transfer is restored.</p>}
          {checkoutMethod === "CRYPTO" && <label className="mt-4 block text-[13px] font-bold text-[#344f41]">USDT network
            <select value={assetNetwork || defaultCryptoChoice(options)} onChange={(e) => setAssetNetwork(e.target.value)} className={fieldClass}>
              {options.map((o) => <option key={o.asset + o.network} value={o.asset + ":" + o.network}>{o.asset} · {o.network}</option>)}
            </select>
            <span className="mt-2 block text-[12px] leading-5 text-[#795c2b]">USDT is selected by default. Only send the selected token on its exact network.</span>
          </label>}
          <p className="mt-5 flex items-start gap-2 text-[12px] leading-5 text-[#5b7164]"><ShieldCheck size={16} className="shrink-0 text-[#28684a]"/> No subscription or automatic charge. Your license is issued only after independent verification.</p>
          {error && <p role="alert" className="mt-3 rounded-xl bg-[#fff0eb] p-3 text-sm text-[#a13b32]">{error}</p>}
          <button type="button" disabled={busy || !enabled || (checkoutMethod === "CRYPTO" ? !cryptoOn : !bankOn)} onClick={createQuote} className={primaryButton + " mt-6"}>{buttonLabel(busy, "Create secure payment order")}</button>
        </section>}

        {step === "payment" && quote && <section>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#e8f2ea] px-3 py-1.5 text-[11px] font-bold text-[#30674d]">{bankPay ? <Landmark size={13}/> : <Wallet size={13}/>} STEP 03 · {bankPay ? "BANK TRANSFER" : "USDT TRANSFER"}</div>
              <h2 className="font-heading text-[27px] font-bold tracking-tight sm:text-[34px]">{bankPay ? "Complete your bank transfer" : "Complete your USDT payment"}</h2>
            </div>
            <StatusDot tone={expired ? "red" : "amber"}>{expired ? "Quote expired" : "Awaiting payment"}</StatusDot>
          </div>

          <div className="mt-5 overflow-hidden rounded-[24px] bg-[#153f35] text-white shadow-[0_15px_34px_rgba(21,63,53,.15)]">
            <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#bdd6c7]">Exact amount to send</p>
                <p className="mt-1 break-words font-heading text-[30px] font-bold leading-tight tracking-tight sm:text-[38px]" data-testid="gateway-amount">{moneyLabel(quote.amount_formatted)}</p>
                <p className="mt-2 text-[12px] text-[#d6e8dc]">XauCloud MT5 · One-time license</p>
              </div>
              <CopyButton value={quote.amount_formatted} title="Copy amount" className="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20"/>
            </div>
            <div className="border-t border-white/15 bg-white/[0.06] px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[12px] font-semibold text-[#dcece1]"><Clock3 size={16}/> Time remaining</span>
                <strong className={"font-mono text-[22px] font-bold tabular-nums " + (secondsLeft <= 300 ? "text-[#ffdc9d]" : "text-white")} data-testid="gateway-countdown">{formatTime(secondsLeft)}</strong>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20"><div className={"h-full rounded-full transition-[width] duration-1000 " + (secondsLeft <= 300 ? "bg-[#f5c77b]" : "bg-[#b4dbc5]")} style={{ width: progress + "%" }}/></div>
              <p className="mt-2 text-[11px] leading-4 text-[#c5dacc]">{expired ? "This payment window closed. If you already transferred, contact support with your reference." : "Your exact payment amount is reserved during this window. Do not pay after expiry."}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[#d6e9dc] bg-[#ecf6ee] px-4 py-3">
            <div className="flex min-w-0 items-start gap-2.5">
              {instructionsSent ? <MailCheck size={19} className="mt-0.5 shrink-0 text-[#286748]"/> : <Mail size={19} className="mt-0.5 shrink-0 text-[#8b5b24]"/>}
              <div className="min-w-0">
                <div className="text-[12px] font-bold text-[#28513c]">{instructionsSent ? "Payment instructions emailed" : "Payment instructions available here"}</div>
                <p className="mt-0.5 break-words text-[11px] leading-5 text-[#516b5b]">{instructionsSent ? "A copy was sent to " + email : "Email delivery wasn't confirmed. Copy these details or try resending."}</p>
              </div>
            </div>
            <button type="button" onClick={resendInstructions} disabled={resendBusy || expired} className="shrink-0 text-[11px] font-bold text-[#28674b] underline underline-offset-2 disabled:opacity-40">{resendBusy ? "Sending…" : "Resend"}</button>
          </div>
          {resendMessage && <p role="status" className="mt-2 text-[12px] text-[#3e6250]">{resendMessage}</p>}

          <div className="mt-5 rounded-[22px] border border-[#dbe6db] bg-white p-5 shadow-[0_4px_14px_rgba(30,63,43,.025)] sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5"><span className="rounded-xl bg-[#e6f1e9] p-2 text-[#286348]">{bankPay ? <Landmark size={21}/> : <Wallet size={21}/>}</span>
                <div><h3 className="font-heading text-[17px] font-bold">{bankPay ? "Transfer to this account" : "Send to this wallet"}</h3><p className="text-[11px] text-[#637568]">Verified payment destination</p></div>
              </div>
              <CopyButton value={instructions} title="Copy all details"/>
            </div>
            <div className="mt-4 border-t border-[#e7ede7]">
              {bankPay ? <>
                <Detail label="Bank name" value={quote.details.bank_name}/>
                <Detail label="Account holder" value={quote.details.account_name}/>
                <Detail label="Account number" value={quote.details.account_number} featured/>
              </> : <>
                <Detail label="Stablecoin" value={quote.details.asset}/>
                <Detail label="Network" value={quote.details.network}/>
                <Detail label="Receiving wallet" value={quote.details.address} featured/>
              </>}
              <Detail label="Order reference" value={quote.reference}/>
            </div>
            <p className="mt-3 rounded-xl bg-[#f7f7f0] p-3 text-[11px] leading-5 text-[#66735e]">{bankPay
              ? "Use the order reference in the transfer narration if your bank supports it. After paying, enter the account name you sent the money from."
              : "Use the exact token and network shown above. Wrong-network transfers may be irrecoverable. Network fees are separate."}</p>
          </div>

          {expired ? <div className="mt-5 rounded-2xl border border-[#e9bbb5] bg-[#fff3ee] p-5">
            <p className="flex items-center gap-2 text-[14px] font-bold text-[#9f3e33]"><CircleAlert size={18}/> Payment window expired</p>
            <p className="mt-2 text-[12px] leading-5 text-[#79594e]">If you've already paid, do not pay again. Contact support with order reference {quote.reference}. Otherwise create a fresh quote.</p>
            <button type="button" onClick={newQuote} className={primaryButton + " mt-4"}><RefreshCw size={16}/> Create a new payment order</button>
          </div> : <>
            <div className="mt-6">
              <h3 className="font-heading text-[18px] font-bold">I've made the payment</h3>
              <p className="mt-1 text-[12px] leading-5 text-[#5a6e62]">{bankPay
                ? "Enter the account name the transfer was sent from so our team can match your payment."
                : "Enter the blockchain transaction hash so our team can verify your payment."}</p>
              <label className="mt-4 block text-[12px] font-bold text-[#344f41]">{bankPay ? "Account name sent from" : "Blockchain transaction hash"}
                <input value={referenceInput} onChange={(e) => setReferenceInput(e.target.value)} maxLength={bankPay ? 80 : 180}
                  autoComplete={bankPay ? "name" : "off"} spellCheck={bankPay}
                  placeholder={bankPay ? "Name on the account you paid from" : "Transaction hash from your wallet"}
                  className={fieldClass}/>
              </label>
              <p className="mt-3 text-[11px] leading-5 text-[#66786b]">{bankPay
                ? "We match the account name against the bank transfer before issuing your license. No receipt photo is required."
                : "An authorized reviewer checks the blockchain transaction hash before issuing your license. No receipt photo is required."}</p>
              {error && <p role="alert" className="mt-3 rounded-xl bg-[#fff0eb] px-4 py-3 text-[12px] font-medium text-[#a1352b]">{error}</p>}
              <button type="button" disabled={busy || referenceInput.trim().length < (bankPay ? 2 : 5)} onClick={submit} className={primaryButton + " mt-5"}>{buttonLabel(busy, "Submit payment for verification")}</button>
            </div>
          </>}
        </section>}

        {step === "pending" && quote && <section className="pb-1">
          <div className="mx-auto max-w-xl text-center">
            <div className={"mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] " + (rejected ? "bg-[#fff1e8] text-[#a44535]" : "bg-[#e8f6ed] text-[#28744f]")}>{rejected ? <CircleAlert size={32}/> : <CheckCircle2 size={34}/>}</div>
            <StatusDot tone={rejected ? "red" : finished ? "green" : "amber"}>{rejected ? "Not approved" : finished ? "Verified" : "Under manual review"}</StatusDot>
            <h2 className="mt-4 font-heading text-[25px] font-bold leading-tight tracking-tight">{finished ? "Your license has been issued" : rejected ? "Payment couldn't be approved" : "Your payment is under review"}</h2>
            <p className="mt-3 text-[13px] leading-6 text-[#556d5e]">{finished ? "Your license has been issued. Check your email for the activation instructions." : rejected ? "The payment was not approved. Contact support if you believe this is a mistake." : "We've recorded the reference you supplied. Our team must independently confirm receipt of funds before your license is issued."}</p>
          </div>
          <div className="mt-7 rounded-[22px] border border-[#dbe6db] bg-white px-5 py-1 sm:px-6">
            <Detail label="Order reference" value={quote.reference}/>
            <Detail label="Amount" value={quote.amount_formatted} copy={false}/>
            <Detail label="Payment status" value={finished ? "Verified" : rejected ? "Not approved" : status === "FULFILLING" ? "Issuing license" : "Awaiting independent review"} copy={false}/>
            {submittedAt && <Detail label="Submitted on" value={new Date(submittedAt).toLocaleString()} copy={false}/>}
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-[12px] leading-5 text-[#5c7063]"><MailCheck size={17}/> We'll send your license by email after successful verification.</p>
          {error && <p role="alert" className="mt-3 text-[12px] text-[#a1352b]">{error}</p>}
          <button type="button" className={primaryButton + " mt-6"} onClick={onClose}>Done <Check size={18}/></button>
        </section>}

        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-[#e1e9e0] pt-5 text-[11px] font-semibold text-[#66796b]">
          <span className="flex items-center gap-1.5"><ShieldCheck size={15} className="text-[#307752]"/> Secure checkout</span>
          <span className="flex items-center gap-1.5"><LockKeyhole size={14}/> No saved card details</span>
          <span className="flex items-center gap-1.5"><CreditCard size={15}/> One-time purchase</span>
        </div>
      </div>
    </div>
  </div>;
}
