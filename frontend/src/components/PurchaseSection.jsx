import React, { useState, useEffect } from "react";
import axios from "axios";
import { ShoppingCart, ShieldCheck, Lightning, Check } from "@phosphor-icons/react";

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

  useEffect(() => {
    const params = currency ? { display_currency: currency } : {};
    axios.get(`${api}/purchase/price`, { params })
      .then(r => setPriceData(r.data))
      .catch(() => {});
  }, [api, currency]);

  const paymentUnavailable = priceData?.payment_method === "unavailable";

  const handlePurchase = async () => {
    if (loading) return; // belt-and-braces against double-submit beyond the disabled button alone
    if (paymentUnavailable) { setError("Payments are temporarily unavailable. Please try again shortly."); return; }
    if (!buyerName.trim() || !buyerEmail.trim()) { setError("Please enter your name and email."); return; }
    if (!buyerEmail.includes("@")) { setError("Please enter a valid email address."); return; }
    setError(""); setLoading(true);
    try {
      const res = await axios.post(`${api}/purchase/initialize`, {
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

  const displayPrice = priceData?.formatted || "₦300,000";
  const showingConverted = priceData?.display_currency && priceData.display_currency !== "NGN" && priceData.display_amount_formatted;

  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="purchase-section">
      <div className="mx-auto max-w-5xl px-4 py-14 md:px-8 md:py-20">

        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
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
                        ? "bg-amber-300 text-black"
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
                  <Check size={13} weight="bold" className="flex-none text-amber-300" />
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
                className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-4 py-3 font-mono text-sm text-white placeholder-white/25 outline-none transition focus:border-amber-300/40 focus:bg-white/[0.08]"
              />
              <input
                data-testid="purchase-email"
                type="email"
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-4 py-3 font-mono text-sm text-white placeholder-white/25 outline-none transition focus:border-amber-300/40 focus:bg-white/[0.08]"
              />
              {error && (
                <div className="text-sm text-rose-400 font-mono" data-testid="purchase-error">{error}</div>
              )}
              <button
                data-testid="purchase-btn"
                onClick={handlePurchase}
                disabled={loading || paymentUnavailable}
                className="mt-1 w-full inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-6 py-4 text-[14px] font-extrabold text-black transition hover:bg-amber-200 disabled:opacity-50">
                <ShoppingCart size={17} weight="bold" />
                {loading ? "Redirecting…" : paymentUnavailable ? "Payments Unavailable" : `Pay ${displayPrice} Now`}
              </button>
            </div>

            <div className="mt-5 flex items-center justify-center gap-5 border-t border-white/[0.06] pt-5">
              <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
                <ShieldCheck size={13} /> Secured by Nomba
              </div>
              <div className="flex items-center gap-1.5 text-white/25 text-[11px]">
                <Lightning size={13} /> Instant delivery
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
