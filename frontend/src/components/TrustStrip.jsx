import React from "react";
import { Target, Robot, Scales, ProhibitInset, ArrowSquareOut } from "@phosphor-icons/react";

const FACTS = [
  { icon: Target, label: "Built exclusively for XAUUSD" },
  { icon: Robot, label: "Fully automated execution" },
  { icon: Scales, label: "Account-relative risk sizing" },
  { icon: ProhibitInset, label: "No grid or martingale" },
];

const MQL5_MARKET_URL = "https://www.mql5.com/en/market/product/188838";

export default function TrustStrip() {
  return (
    <div className="bg-[#060609] border-t border-white/[0.06]" data-testid="trust-strip">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {FACTS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <Icon size={16} weight="duotone" className="flex-none text-gold-300" />
              <span className="text-[12px] font-medium leading-4 text-white/65">{label}</span>
            </div>
          ))}
        </div>

        <a
          href={MQL5_MARKET_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="mql5-market-badge"
          className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-gold-300/25 bg-gold-300/[0.06] px-4 py-3 text-[12px] font-semibold text-gold-200 transition hover:border-gold-300/45 hover:bg-gold-300/[0.10]"
        >
          <span>Also listed &amp; verified on the official MQL5 Market</span>
          <ArrowSquareOut size={14} weight="bold" />
        </a>
      </div>
    </div>
  );
}
