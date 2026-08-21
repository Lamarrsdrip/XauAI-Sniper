import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ShoppingCart, ShieldCheck, Lightning, Check, Bell, Lock } from "@phosphor-icons/react";
import { PaymentMethodModal } from "./BankTransferFlow";
import { useSignalCheckout } from "@/lib/signalCheckout";

const BOT_PERKS = [
  "Lifetime license — free updates forever",
  "PIN issued after confirmed payment",
  "Free VPS activation included",
];

const DISPLAY_CURRENCIES = ["NGN", "USD", "EUR", "GBP"];

// Formats a kobo amount from the backend (GET /purchase/plans or GET
// /cloud/billing) into a naira display string. Every plan card renders its
// price through this from a live API response -- no plan price is ever
// hardcoded in this file.
function formatNaira(koboAmount) {
  if (koboAmount === null || koboAmount === undefined) return "—";
  const naira = koboAmount / 100;
  if (naira === 0) return "Free";
  return `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

// ─── Free trial / Weekly / Monthly signal plan cards ────────────────────────
// Reuses this file's existing rounded-card / gold-accent / dark-surface
// language (the "single old checkout card" visual system) rather than
// inventing a second design. `cloudUser` (undefined while checking,
// null when logged out, an object once known) decides whether a click on
// Weekly/Monthly opens the payment-method modal directly or sends the
// visitor to sign up first.
function SignalPlanCard({ badge, badgeTone, title, priceLabel, priceSub, perks, cta, onCta, busy, note, highlight }) {
  return (
    <div
      className={`flex h-full flex-col rounded-[24px] border p-6 shadow-xl shadow-black/30 ${
        highlight ? "border-gold-300/40 bg-gold-300/[0.06]" : "border-white/[0.1] bg-white/[0.04]"
      }`}
      data-testid={`plan-card-${badge.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] ${badgeTone}`}
      >
        {badge}
      </span>
      <h3 className="mt-3 font-heading text-lg font-bold text-white">{title}</h3>

      <div className="mt-3 flex items-end gap-1.5">
        <span className="font-mono text-3xl font-black text-white" data-testid="plan-price">{priceLabel}</span>
        {priceSub && <span className="mb-1 font-mono text-[11px] text-white/35">{priceSub}</span>}
      </div>

      <div className="mt-5 flex-1 space-y-2">
        {perks.map((p) => (
          <div key={p} className="flex items-start gap-2.5">
            <Check size={13} weight="bold" className="mt-0.5 flex-none text-gold-300" />
            <span className="text-[12.5px] leading-5 text-white/60">{p}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        data-testid="plan-cta"
        onClick={onCta}
        disabled={busy}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold-300 px-5 py-3 text-[13px] font-extrabold text-black transition hover:bg-gold-200 disabled:opacity-50"
      >
        {busy ? "Please wait…" : cta}
      </button>
      {note && <p className="mt-2 text-center text-[10.5px] leading-4 text-white/30">{note}</p>}
    </div>
  );
}

export default function PurchaseSection({ api }) {
  const navigate = useNavigate();

  // ── Shared plan pricing (trial/weekly/monthly/bot), always live from the
  // backend's authoritative price list. ──────────────────────────────────
  const [plans, setPlans] = useState(null);
  const [plansError, setPlansError] = useState(false);
  useEffect(() => {
    axios.get(`${api}/purchase/plans`)
      .then((r) => setPlans(r.data))
      .catch(() => setPlansError(true));
  }, [api]);

  // ── Cloud (Command Center) login state -- decides whether Trial/Weekly/
  // Monthly CTAs act immediately or send the visitor to sign up first. A
  // 401 here just means "not logged in", not an error. ────────────────────
  const [cloudUser, setCloudUser] = useState(undefined); // undefined = checking, null = logged out
  useEffect(() => {
    axios.get(`${api}/cloud/auth/me`, { withCredentials: true })
      .then((r) => setCloudUser(r.data))
      .catch(() => setCloudUser(null));
  }, [api]);

  // ── Free trial ───────────────────────────────────────────────────────
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialError, setTrialError] = useState("");
  const startTrial = async () => {
    if (cloudUser === undefined) return;
    if (!cloudUser) { navigate("/command/signup"); return; }
    setTrialBusy(true); setTrialError("");
    try {
      await axios.post(`${api}/cloud/signals/trial/start`, {}, { withCredentials: true });
      navigate("/command/dashboard");
    } catch (e) {
      setTrialError(e.response?.data?.message || e.response?.data?.detail || "Could not start your trial. Please try again.");
    } finally {
      setTrialBusy(false);
    }
  };

  // ── Weekly / Monthly signal subscriptions -- shared checkout logic with
  // CloudSignalDashboard's billing section (see @/lib/signalCheckout). ──
  const signalCheckout = useSignalCheckout(api);
  const chooseSignalPlan = (planId) => {
    if (cloudUser === undefined) return;
    if (!cloudUser) {
      // Preserve intent across the signup/login detour so the Command
      // Center dashboard can resume straight into the payment-method
      // picker for this plan once the account exists.
      try { window.sessionStorage.setItem("xaucloud_pending_plan", planId); } catch { /* private mode etc. -- non-fatal */ }
      navigate("/command/signup");
      return;
    }
    signalCheckout.openPlan(planId);
  };

  const signalPlanMeta = signalCheckout.planId === "SIGNALS_WEEKLY" ? plans?.signals_weekly : plans?.signals_monthly;
  const signalPriceDisplay = formatNaira(signalPlanMeta?.price_kobo);

  // ── Lifetime bot license -- EXISTING flow, unchanged, just re-hosted as
  // the 4th card in this layout. ───────────────────────────────────────
  const [buyerName,  setBuyerName]  = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [loading,    setLoading]    = useState(false);
  const [priceData,  setPriceData]  = useState(null);
  const [currency,   setCurrency]   = useState(null); // null = let the server detect it
  const [error,      setError]      = useState("");
  const [showMethodModal, setShowMethodModal] = useState(false);
  // Bug fix (purchase-flow audit, 2026-08-04): a failed /purchase/price
  // fetch used to be silently swallowed, leaving priceData null and the
  // widget showing a hardcoded "₦300,000" fallback with checkout still
  // enabled -- if the admin had actually changed the price and this fetch
  // failed, the customer saw a stale/wrong number here and a different
  // (correct) one later in the Bank Transfer step, looking like a
  // bait-and-switch. Now tracked explicitly and checkout is blocked until
  // a real price is loaded.
  const [priceLoading, setPriceLoading] = useState(true);
  const [priceLoadFailed, setPriceLoadFailed] = useState(false);

  const loadPrice = React.useCallback(() => {
    setPriceLoading(true); setPriceLoadFailed(false);
    const params = currency ? { display_currency: currency } : {};
    axios.get(`${api}/purchase/price`, { params })
      .then(r => { setPriceData(r.data); setPriceLoading(false); })
      .catch(() => { setPriceLoadFailed(true); setPriceLoading(false); });
  }, [api, currency]);

  useEffect(() => { loadPrice(); }, [loadPrice]);

  const paymentUnavailable = priceData?.payment_method === "unavailable";
  const checkoutBlocked = paymentUnavailable || priceLoadFailed || (priceLoading && !priceData);

  const validateBuyer = () => {
    if (!buyerName.trim() || !buyerEmail.trim()) { setError("Please enter your name and email."); return false; }
    if (!buyerEmail.includes("@")) { setError("Please enter a valid email address."); return false; }
    return true;
  };

  const openMethodChoice = () => {
    if (priceLoadFailed) { setError("Could not load the current price. Please try again."); return; }
    if (paymentUnavailable) { setError("Payments are temporarily unavailable. Please try again shortly."); return; }
    if (!validateBuyer()) return;
    setError("");
    setShowMethodModal(true);
  };

  const payViaProvider = async (endpoint) => {
    if (loading) return; // belt-and-braces against double-submit beyond the disabled button alone
    setError(""); setLoading(true);
    try {
      const res = await axios.post(`${api}${endpoint}`, {
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        origin_url: window.location.origin,
        display_currency: priceData?.display_currency || null,
      });
      if (res.data.authorization_url) window.location.href = res.data.authorization_url;
    } catch (e) {
      setError(e.response?.data?.detail || "Payment failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };
  const payByPaystack = () => payViaProvider("/purchase/paystack/initialize");
  const payByNomba = () => payViaProvider("/purchase/initialize");

  const displayPrice = priceData?.formatted || (priceLoading ? "Loading…" : "—");
  const showingConverted = priceData?.display_currency && priceData.display_currency !== "NGN" && priceData.display_amount_formatted;

  return (
    <div className="bg-[#07080B] border-t border-white/[0.06] text-white" data-testid="purchase-section">
      <div className="mx-auto max-w-6xl px-4 py-11 md:px-8 md:py-16">

        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-gold-200">
            Plans & Pricing
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="purchase-title">
            Start free. Upgrade whenever you're ready.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-[13px] leading-6 text-white/45">
            Try XauCloud's Gold signals and Market Outlook free for 3 market days, then continue with a Weekly or Monthly signal plan. The XauCloud Bot license is a separate, one-time purchase for automated MT5 execution.
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-[11.5px] leading-5 text-white/32" data-testid="signal-vs-bot-notice">
            Signal subscription: XauCloud's signal and Market Outlook experience. Bot license: XauCloud executes trades through the licensed MT5 EA. A signal subscriber never receives automated execution.
          </p>
        </div>

        {plansError && (
          <div className="mx-auto mb-6 max-w-md rounded-2xl border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-center text-[12px] text-rose-300">
            Could not load current plan pricing. Please refresh and try again.
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 lg:items-stretch">

          <SignalPlanCard
            badge="Free Trial"
            badgeTone="border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-300"
            title={plans?.trial?.label || "Free Signal Trial"}
            priceLabel={plansError ? "—" : formatNaira(plans?.trial?.price_kobo)}
            priceSub={plans?.trial?.market_days ? `${plans.trial.market_days} market days` : undefined}
            perks={[
              "XauCloud Market Outlook",
              "10-minute signal engine",
              "No card required",
              "No automated execution",
            ]}
            cta="Start Free"
            onCta={startTrial}
            busy={trialBusy || cloudUser === undefined}
            highlight
            note={trialError || (cloudUser ? undefined : "Free account required")}
          />

          <SignalPlanCard
            badge="Weekly"
            badgeTone="border-sky-300/25 bg-sky-300/[0.08] text-sky-200"
            title={plans?.signals_weekly?.label || "Weekly Signals"}
            priceLabel={plansError ? "—" : formatNaira(plans?.signals_weekly?.price_kobo)}
            priceSub="/ week"
            perks={[
              "XauCloud Market Outlook",
              "10-minute signal engine",
              "Signal notifications",
              "No automated execution",
            ]}
            cta="Subscribe Weekly"
            onCta={() => chooseSignalPlan("SIGNALS_WEEKLY")}
            busy={cloudUser === undefined || (signalCheckout.busy && signalCheckout.planId === "SIGNALS_WEEKLY")}
            note={cloudUser ? undefined : "Sign in or create an account to continue"}
          />

          <SignalPlanCard
            badge="Monthly"
            badgeTone="border-sky-300/25 bg-sky-300/[0.08] text-sky-200"
            title={plans?.signals_monthly?.label || "Monthly Signals"}
            priceLabel={plansError ? "—" : formatNaira(plans?.signals_monthly?.price_kobo)}
            priceSub="/ month"
            perks={[
              "XauCloud Market Outlook",
              "10-minute signal engine",
              "Signal notifications",
              "No automated execution",
            ]}
            cta="Subscribe Monthly"
            onCta={() => chooseSignalPlan("SIGNALS_MONTHLY")}
            busy={cloudUser === undefined || (signalCheckout.busy && signalCheckout.planId === "SIGNALS_MONTHLY")}
            note={cloudUser ? undefined : "Sign in or create an account to continue"}
          />

          {/* Lifetime bot license -- existing anonymous checkout card, unchanged logic, restyled to fit this grid. */}
          <div className="flex h-full flex-col rounded-[24px] border border-white/[0.1] bg-white/[0.04] p-6 shadow-xl shadow-black/30" data-testid="purchase-form">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-gold-200">
              Lifetime License
            </span>
            <h3 className="mt-3 font-heading text-lg font-bold text-white">XauCloud Bot</h3>

            <div className="mt-3 flex items-end gap-1.5">
              <span className="font-mono text-3xl font-black text-white" data-testid="display-price">{displayPrice}</span>
              <span className="mb-1 font-mono text-[11px] text-white/35">NGN · one-time</span>
            </div>

            {showingConverted && (
              <div className="mt-1 font-mono text-[11px] text-white/40" data-testid="display-price-converted">
                ≈ {priceData.display_amount_formatted} <span className="text-white/25">(indicative)</span>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <span className="font-mono text-[9px] uppercase tracking-widest text-white/25">Show in</span>
              <div className="flex gap-1">
                {DISPLAY_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    data-testid={`currency-${c}`}
                    onClick={() => setCurrency(c)}
                    className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold transition ${
                      (priceData?.display_currency || "NGN") === c
                        ? "bg-gold-300 text-black"
                        : "bg-white/[0.06] text-white/40 hover:bg-white/[0.1]"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex-1 space-y-2">
              {BOT_PERKS.map((p) => (
                <div key={p} className="flex items-start gap-2.5">
                  <Check size={13} weight="bold" className="mt-0.5 flex-none text-gold-300" />
                  <span className="text-[12.5px] leading-5 text-white/60">{p}</span>
                </div>
              ))}
              <div className="flex items-start gap-2.5">
                <Lock size={13} weight="bold" className="mt-0.5 flex-none text-gold-300" />
                <span className="text-[12.5px] leading-5 text-white/60">Automated MT5 execution</span>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              <input
                data-testid="purchase-name"
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-3.5 py-2.5 font-mono text-[12.5px] text-white placeholder-white/25 outline-none transition focus:border-gold-300/40 focus:bg-white/[0.08]"
              />
              <input
                data-testid="purchase-email"
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-3.5 py-2.5 font-mono text-[12.5px] text-white placeholder-white/25 outline-none transition focus:border-gold-300/40 focus:bg-white/[0.08]"
              />
              {priceLoadFailed && (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-400/25 bg-rose-400/[0.06] px-3.5 py-2.5 text-[11px] text-rose-300" data-testid="purchase-price-error">
                  <span>Could not load the current price.</span>
                  <button type="button" onClick={loadPrice} className="font-bold underline underline-offset-2 hover:text-rose-200">Retry</button>
                </div>
              )}
              {error && (
                <div className="text-[12px] text-rose-400 font-mono" data-testid="purchase-error">{error}</div>
              )}
              <button
                data-testid="purchase-btn"
                onClick={openMethodChoice}
                disabled={loading || checkoutBlocked}
                className="mt-1 w-full inline-flex items-center justify-center gap-2 rounded-full bg-gold-300 px-5 py-3 text-[13px] font-extrabold text-black transition hover:bg-gold-200 disabled:opacity-50">
                <ShoppingCart size={16} weight="bold" />
                {loading ? "Redirecting…" : priceLoadFailed ? "Price Unavailable" : paymentUnavailable ? "Payments Unavailable" : priceLoading ? "Loading…" : `Buy · ${displayPrice}`}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-center gap-5 text-white/25 text-[11px]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={13} /> Secure checkout
          </div>
          <div className="flex items-center gap-1.5">
            <Lightning size={13} /> Fast fulfillment
          </div>
          <div className="flex items-center gap-1.5">
            <Bell size={13} /> Cancel anytime — signal plans don't auto-renew
          </div>
        </div>

      </div>

      {showMethodModal && (
        <PaymentMethodModal
          api={api}
          priceDisplay={displayPrice}
          buyerName={buyerName}
          buyerEmail={buyerEmail}
          onPaystack={() => { setShowMethodModal(false); payByPaystack(); }}
          onNomba={() => { setShowMethodModal(false); payByNomba(); }}
          onClose={() => setShowMethodModal(false)}
        />
      )}

      {signalCheckout.showModal && (
        <PaymentMethodModal
          api={api}
          priceDisplay={signalPriceDisplay}
          subtitle={`${signalPriceDisplay} · ${cloudUser?.email || ""}`}
          onPaystack={() => { signalCheckout.closeModal(); signalCheckout.payByPaystack(); }}
          onNomba={() => { signalCheckout.closeModal(); signalCheckout.payByNomba(); }}
          onClose={signalCheckout.closeModal}
          bankTransfer={signalCheckout.bankTransferProps}
        />
      )}
      {signalCheckout.error && !signalCheckout.showModal && (
        <div className="mx-auto mt-4 max-w-md text-center font-mono text-[12px] text-rose-400" data-testid="signal-purchase-error">{signalCheckout.error}</div>
      )}
    </div>
  );
}
