import React, { useState, useEffect } from "react";
import axios from "axios";
import { CurrencyNgn, ShoppingCart, ShieldCheck, Lightning, Check } from "@phosphor-icons/react";

export default function PurchaseSection({ api }) {
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [priceData, setPriceData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get(`${api}/purchase/price`).then(r => setPriceData(r.data)).catch(() => {});
  }, [api]);

  const handlePurchase = async () => {
    if (!buyerName.trim() || !buyerEmail.trim()) { setError("Please enter your name and email."); return; }
    if (!buyerEmail.includes("@")) { setError("Please enter a valid email address."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await axios.post(`${api}/purchase/initialize`, {
        buyer_name: buyerName,
        buyer_email: buyerEmail,
        origin_url: window.location.origin,
      });
      if (res.data.authorization_url) {
        window.location.href = res.data.authorization_url;
      }
    } catch (e) {
      const msg = e.response?.data?.detail || "Payment failed to initialize. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const displayPrice = priceData?.formatted || "\u20a6300,000";
  const nairaAmount = priceData?.price_naira || 300000;

  return (
    <div className="bg-[hsl(0,0%,4%)] text-white border-t border-border" data-testid="purchase-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 border border-white/20 mb-6">
              <CurrencyNgn size={12} weight="bold" className="text-[hsl(43,74%,49%)]" />
              <span className="text-xs font-mono font-medium tracking-[0.15em] text-white/70">PAY WITH NAIRA</span>
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black tracking-tight mb-4" data-testid="purchase-title">
              Get Your License
              <br /><span className="text-[hsl(43,74%,49%)]">Start Trading Today</span>
            </h2>
            <p className="text-white/60 text-base leading-relaxed mb-8 max-w-lg">
              Purchase your AI Sniper EA license PIN instantly with Paystack. Pay with your card, bank transfer, or USSD.
              Your unique PIN is generated automatically after payment.
            </p>
            <div className="space-y-3 mb-8">
              {["Unique license PIN generated instantly after payment", "Full access to AI Sniper EA v2.0 with ML pattern learning",
                "All strategy modes: Trend, Range, Breakout", "Lifetime license - no monthly fees", "Free updates and improvements",
                "AI that learns and improves with every trade"
              ].map((f, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Check size={16} weight="bold" className="text-[hsl(43,74%,49%)] flex-shrink-0" />
                  <span className="text-sm text-white/80">{f}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2 mb-2">
              <span className="font-mono text-5xl font-black text-[hsl(43,74%,49%)]" data-testid="display-price">{displayPrice}</span>
              <span className="text-white/40 text-sm mb-2">NGN / one-time</span>
            </div>
            <p className="text-xs text-white/40 font-mono">Powered by Paystack - Card, Bank Transfer, USSD</p>
          </div>

          {/* Right */}
          <div className="bg-white/5 border border-white/10 p-8" data-testid="purchase-form">
            <h3 className="font-heading text-lg font-bold mb-6 text-white">Complete Your Purchase</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-white/70 block mb-1.5">Your Name</label>
                <input data-testid="purchase-name" type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="John Doe"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(43,74%,49%)] placeholder-white/30" />
              </div>
              <div>
                <label className="text-sm font-medium text-white/70 block mb-1.5">Email Address</label>
                <input data-testid="purchase-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} placeholder="john@example.com"
                  className="w-full px-4 py-3 bg-white/5 border border-white/20 text-white font-mono text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(43,74%,49%)] placeholder-white/30" />
              </div>
              {error && <div className="text-[hsl(348,83%,47%)] text-sm" data-testid="purchase-error">{error}</div>}
              <button data-testid="purchase-btn" onClick={handlePurchase} disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-[hsl(43,74%,49%)] text-[hsl(0,0%,4%)] font-black text-sm tracking-wide hover:-translate-y-[1px] transition-transform duration-150 shadow-[3px_3px_0px_hsl(43,74%,35%)] disabled:opacity-50">
                <ShoppingCart size={18} weight="bold" />
                {loading ? "REDIRECTING TO PAYSTACK..." : `PAY ${displayPrice} NOW`}
              </button>
              <div className="flex items-center justify-center gap-4 pt-2">
                <div className="flex items-center gap-1.5 text-white/40 text-xs"><ShieldCheck size={14} /><span>Paystack secured</span></div>
                <div className="flex items-center gap-1.5 text-white/40 text-xs"><Lightning size={14} /><span>Instant PIN delivery</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
