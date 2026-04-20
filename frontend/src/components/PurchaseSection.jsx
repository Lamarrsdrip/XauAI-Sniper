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
    axios.get(`${api}/purchase/price`).then(r => setPriceData(r.data)).catch((err) => { console.error("Price load failed:", err); });
  }, [api]);

  const handlePurchase = async () => {
    if (!buyerName.trim() || !buyerEmail.trim()) { setError("Please enter your name and email."); return; }
    if (!buyerEmail.includes("@")) { setError("Please enter a valid email address."); return; }
    setError(""); setLoading(true);
    try {
      const res = await axios.post(`${api}/purchase/initialize`, { buyer_name: buyerName, buyer_email: buyerEmail, origin_url: window.location.origin });
      if (res.data.authorization_url) window.location.href = res.data.authorization_url;
    } catch (e) { setError(e.response?.data?.detail || "Payment failed. Please try again."); }
    finally { setLoading(false); }
  };

  const displayPrice = priceData?.formatted || "\u20a6300,000";

  return (
    <div className="bg-[#F8F9FA] border-t border-gray-100" data-testid="purchase-section">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#C5A059] bg-[#C5A059]/10 border border-[#C5A059]/20 px-3 py-1.5 rounded-full">LIFETIME LICENSE</span>
            <h2 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight mt-6 mb-4 text-[#111]" data-testid="purchase-title">
              Get Your License.<br /><span className="gold-gradient-text">Start Trading Today.</span>
            </h2>
            <p className="text-gray-500 text-base leading-relaxed mb-8 max-w-lg">
              Pay once with Paystack. Your unique PIN is generated instantly. Card, bank transfer, or USSD.
            </p>
            <div className="space-y-3 mb-10">
              {["GPT-5.2 AI analyzes every trade before execution", "Live news avoidance — skips NFP, CPI, FOMC events",
                "Machine learning improves with every trade", "Auto break-even + trailing stop protection",
                "Weekly profit target — rests when goal is hit", "Lifetime license — free updates forever"
              ].map((f) => (
                <div key={f} className="flex items-center gap-3">
                  <Check size={14} weight="bold" className="text-[#C5A059] flex-shrink-0" />
                  <span className="text-sm text-gray-600">{f}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-3">
              <span className="font-mono text-5xl font-bold text-[#111]" data-testid="display-price">{displayPrice}</span>
              <span className="text-gray-400 text-sm mb-2 font-mono">NGN / one-time</span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-3xl p-8 shadow-sm glow-card" data-testid="purchase-form">
            <h3 className="font-heading text-lg font-medium mb-6 text-[#111]">Complete Your Purchase</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono tracking-[0.1em] text-gray-400 block mb-2">YOUR NAME</label>
                <input data-testid="purchase-name" type="text" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="John Doe"
                  className="w-full px-4 py-3 bg-[#F8F9FA] border border-gray-200 rounded-xl text-[#111] font-mono text-sm focus:outline-none focus:border-[#111] placeholder-gray-300 transition-colors" />
              </div>
              <div>
                <label className="text-xs font-mono tracking-[0.1em] text-gray-400 block mb-2">EMAIL ADDRESS</label>
                <input data-testid="purchase-email" type="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} placeholder="john@example.com"
                  className="w-full px-4 py-3 bg-[#F8F9FA] border border-gray-200 rounded-xl text-[#111] font-mono text-sm focus:outline-none focus:border-[#111] placeholder-gray-300 transition-colors" />
              </div>
              {error && <div className="text-red-500 text-sm font-mono" data-testid="purchase-error">{error}</div>}
              <button data-testid="purchase-btn" onClick={handlePurchase} disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#C5A059] text-white rounded-full px-6 py-4 font-bold text-sm tracking-wide hover:bg-[#b38f4d] transition-colors disabled:opacity-50">
                <ShoppingCart size={18} weight="bold" />
                {loading ? "REDIRECTING..." : `PAY ${displayPrice} NOW`}
              </button>
              <div className="flex items-center justify-center gap-6 pt-3">
                <div className="flex items-center gap-1.5 text-gray-300 text-[11px]"><ShieldCheck size={14} /><span>Paystack secured</span></div>
                <div className="flex items-center gap-1.5 text-gray-300 text-[11px]"><Lightning size={14} /><span>Instant delivery</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
