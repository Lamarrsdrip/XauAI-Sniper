import React, { useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

const FAQ = [
  {
    q: "Which broker is supported?",
    a: "Trade.com is our official partner and recommended broker. The EA works on any MT5 broker that supports XAUUSD with a 5-digit quote.",
  },
  {
    q: "Does it work on funded accounts?",
    a: "Yes. The risk engine respects prop firm rules — drawdown limits, daily loss limits, and consistency targets are all configurable.",
  },
  {
    q: "Can I use my own VPS?",
    a: "Yes. Any Windows VPS with MT5 installed works. We recommend a VPS close to your broker's server for the lowest latency.",
  },
  {
    q: "Is support included?",
    a: "All license holders get WhatsApp support and free remote VPS activation. We'll help you set everything up.",
  },
  {
    q: "When will I receive my license?",
    a: "Your unique PIN is generated and emailed instantly after payment is confirmed — usually within 60 seconds.",
  },
];

export default function HowItWorksSection() {
  const [open, setOpen] = useState(null);

  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="how-it-works-section">
      <div className="mx-auto max-w-3xl px-4 py-20 md:px-8 md:py-28">

        <div className="mb-10">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
            FAQ
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="how-it-works-title">
            Common questions.
          </h2>
        </div>

        <div className="space-y-2" data-testid="faq-section">
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
