import React, { useState, useEffect } from "react";
import axios from "axios";
import { ShoppingCart, ShieldCheck, Lightning, Check } from "@phosphor-icons/react";
import { PaymentMethodModal } from "./BankTransferFlow";

const PERKS = [
  "Lifetime license — free updates forever",
  "PIN issued after confirmed payment",
  "Free VPS activation included",
];

const DISPLAY_CURRENCIES = ["NGN", "USD", "EUR", "GBP"];

export default function PurchaseSection({ api }) {
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
      <div className="mx-auto max-w-5xl px-4 py-14 md:px-8 md:py-20">

        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-gold-200">
            Lifetime License
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="purchase-title">
            One payment. Trade forever.
          </h2>
        </div>

        <div className="mx-auto max-w-md">
          <div className="rounded-[28px] border border-white/[0.1] bg-white/[0.04] p-7 shadow-2xl shadow-black/40" data-testid="purchase-form">

            <div className="mb-2 flex items-end gap-2">
              <span className="font-mono text-4xl font-black" data-testid="display-price">{displayPrice}</span>
              <span className="mb-1 font-mono text-sm text-white/30">NGN · one-time</span>
            </div>

            {showingConverted && (
              <div className="mb-2 font-mono text-[12px] text-white/40" data-testid="display-price-converted">
                ≈ {priceData.display_amount_formatted} <span className="text-white/25">(indicative)</span>
              </div>
            )}

            <div className="mb-6 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-white/25">Show in</span>
              <div className="flex gap-1">
                {DISPLAY_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    data-testid={`currency-${c}`}
                    onClick={() => setCurrency(c)}
                    className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold transition ${
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

            <div className="mb-6 font-mono text-[11px] text-white/30" data-testid="charge-currency-notice">
              You will be charged {displayPrice} NGN — the amount above is exact, any other currency shown is an indicative estimate only.
            </div>

            <div className="mb-6 space-y-2">
              {PERKS.map((p) => (
                <div key={p} className="flex items-center gap-2.5">
                  <Check size={13} weight="bold" className="flex-none text-gold-300" />
                  <span className="text-[13px] text-white/60">{p}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <input
                data-testid="purchase-name"
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-4 py-3 font-mono text-sm text-white placeholder-white/25 outline-none transition focus:border-gold-300/40 focus:bg-white/[0.08]"
              />
              <input
                data-testid="purchase-email"
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-4 py-3 font-mono text-sm text-white placeholder-white/25 outline-none transition focus:border-gold-300/40 focus:bg-white/[0.08]"
              />
              {priceLoadFailed && (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-400/25 bg-rose-400/[0.06] px-4 py-3 text-[12px] text-rose-300" data-testid="purchase-price-error">
                  <span>Could not load the current price.</span>
                  <button type="button" onClick={loadPrice} className="font-bold underline underline-offset-2 hover:text-rose-200">Retry</button>
                </div>
              )}
              {error && (
                <div className="text-sm text-rose-400 font-mono" data-testid="purchase-error">{error}</div>
              )}
              <button
                data-testid="purchase-btn"
                onClick={openMethodChoice}
                disabled={loading || checkoutBlocked}
                className="mt-1 w-full inline-flex items-center justify-center gap-2 rounded-full bg-gold-300 px-6 py-4 text-[14px] font-extrabold text-black transition hover:bg-gold-200 disabled:opacity-50">
                <ShoppingCart size={17} weight="bold" />
                {loading ? "Redirecting…" : priceLoadFailed ? "Price Unavailable" : paymentUnavailable ? "Payments Unavailable" : priceLoading ? "Loading…" : `Continue to Payment · ${displayPrice}`}
              </button>
            </div>

            <div className="mt-5 flex items-center justify-center gap-5 border-t border-white/[0.06] pt-5">
              <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
                <ShieldCheck size={13} /> Secure checkout
              </div>
              <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
                <Lightning size={13} /> Fast fulfillment
              </div>
            </div>
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
    </div>
  );
}
