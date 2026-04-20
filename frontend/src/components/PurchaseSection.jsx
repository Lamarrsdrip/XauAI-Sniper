import React, { useState, useEffect } from "react";
import axios from "axios";
import { ShoppingCart, ShieldCheck, Lightning, Check } from "@phosphor-icons/react";

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
        buyer_name: buyerName, buyer_email: buyerEmail, origin_url: window.location.origin,
      });
      if (res.data.authorization_url) window.location.href = res.data.authorization_url;
    } catch (e) {
      setError(e.response?.data?.detail || "Payment failed to initialize. Please try again.");
    } finally { setLoading(false); }
  };

  const displayPrice = priceData?.formatted || "\u20a6300,000";

  return (
    <div className="border-t border-white/[0.06] relative noise-overlay" data-testid="purchase-section">
      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#D4AF37]/20 bg-[#D4AF37]/5 mb-8">
              <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#D4AF37]">LIFETIME LICENSE</span>
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-medium tracking-tight mb-4 text-white" data-testid="purchase-title">
              Get Your License.
              <br /><span className="gold-gradient-text">Start Trading Today.</span>
            </h2>
            <p className="text-white/40 text-base leading-relaxed mb-8 max-w-lg">
              Pay once with Paystack. Your unique PIN is generated instantly.
              Card, bank transfer, or USSD accepted.
            </p>
            <div className="space-y-3 mb-10">
              {["GPT-5.2 AI analyzes every trade before execution",
                "Live news avoidance — skips NFP, CPI, FOMC events",
                "Machine learning improves with every trade",
                "Auto break-even + trailing stop protection",
                "Weekly profit target — rests when goal is hit",
                "Lifetime license — free updates forever"
              ].map((f) => (
                <div key={f} className="flex items-center gap-3">
                  <Check size={14} weight="bold" className="text-[#D4AF37] flex-shrink-0" />
                  <span className="text-sm text-white/60">{f}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-3">
              <span className="font-mono text-5xl font-bold text-white" data-testid="display-price">{displayPrice}</span>
              <span className="text-white/20 text-sm mb-2 font-mono">NGN / one-time</span>
            </div>
          </div>

          <div className="border border-white/[0.08] bg-[#0E1118] p-8 glow-card" data-testid="purchase-form">
            <h3 className="font-heading text-lg font-medium mb-6 text-white">Complete Your Purchase</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono tracking-[0.1em] text-white/40 block mb-2">YOUR NAME</label>
                <input data-testid="purchase-name" type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="John Doe"
                  className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] text-white font-mono text-sm focus:outline-none focus:border-[#D4AF37]/50 placeholder-white/20 transition-colors" />
              </div>
              <div>
                <label className="text-xs font-mono tracking-[0.1em] text-white/40 block mb-2">EMAIL ADDRESS</label>
                <input data-testid="purchase-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} placeholder="john@example.com"
                  className="w-full px-4 py-3 bg-white/[0.03] border border-white/[0.08] text-white font-mono text-sm focus:outline-none focus:border-[#D4AF37]/50 placeholder-white/20 transition-colors" />
              </div>
              {error && <div className="text-[#FF3D00] text-sm font-mono" data-testid="purchase-error">{error}</div>}
              <button data-testid="purchase-btn" onClick={handlePurchase} disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 bg-[#D4AF37] text-black font-bold text-sm tracking-wide hover:bg-[#F5D76E] transition-colors duration-200 disabled:opacity-50 btn-gold">
                <ShoppingCart size={18} weight="bold" />
                {loading ? "REDIRECTING..." : `PAY ${displayPrice} NOW`}
              </button>
              <div className="flex items-center justify-center gap-6 pt-3">
                <div className="flex items-center gap-1.5 text-white/20 text-[11px]"><ShieldCheck size={14} /><span>Paystack secured</span></div>
                <div className="flex items-center gap-1.5 text-white/20 text-[11px]"><Lightning size={14} /><span>Instant delivery</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
