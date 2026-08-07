import React, { useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

const FAQ = [
  {
    q: "What is XauCloud?",
    a: "An automated Expert Advisor for MetaTrader 5 that trades Gold (XAUUSD). It analyzes the market, qualifies setups, and manages approved trades on your behalf.",
  },
  {
    q: "Which platform and symbol does it use?",
    a: "MetaTrader 5, Gold (XAUUSD) only. Use a broker whose exact XAUUSD symbol, spread, and execution you've verified on demo — compatibility is broker-specific.",
  },
  {
    q: "Does it use martingale or grid?",
    a: "No. Position sizing comes from your account risk settings and a defined stop loss. It never averages down or multiplies lot size to recover a loss.",
  },
  {
    q: "Do I need a VPS?",
    a: "A VPS keeps MT5 running continuously and is recommended. It isn't required to get started, and free remote VPS activation is included after purchase.",
  },
  {
    q: "Are profits guaranteed?",
    a: "No. XauCloud is designed to trade with discipline and defined risk, but no trading system can guarantee profit. Start on demo and risk only what you can afford to lose.",
  },
];

export default function FaqSection() {
  const [open, setOpen] = useState(null);

  return (
    <div className="bg-[#07080B] border-t border-white/[0.06] text-white" data-testid="faq-section">
      <div className="mx-auto max-w-2xl px-4 py-14 md:px-8 md:py-20">

        <div className="mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-gold-200">
            FAQ
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="faq-title">
            Common questions.
          </h2>
        </div>

        <div className="space-y-2">
          {FAQ.map((item, i) => (
            <div key={item.q} className="rounded-2xl border border-white/[0.08] bg-white/[0.03]" data-testid={`faq-${i}`}>
              <button
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                onClick={() => setOpen(open === i ? null : i)}
                data-testid={`faq-btn-${i}`}>
                <span className="text-[15px] font-medium text-white/85">{item.q}</span>
                {open === i
                  ? <CaretUp size={14} className="flex-none text-white/30" />
                  : <CaretDown size={14} className="flex-none text-white/30" />}
              </button>
              {open === i && (
                <div className="px-5 pb-5">
                  <p className="text-[13px] leading-6 text-white/50">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
