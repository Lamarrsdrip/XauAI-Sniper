import React, { useState } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

const FAQ = [
  {
    q: "Which broker is supported?",
    a: "Use an MT5 broker whose exact XAUUSD symbol, contract size, tick economics, volume step, stops, margin, spread, and execution behavior you have verified on demo. Compatibility is broker-specific.",
  },
  {
    q: "Does it work on funded accounts?",
    a: "Only if the specific firm's written rules allow EAs and the configured risk, holding, news, drawdown, and consistency behavior complies. Obtain approval and prove the exact setup on demo first.",
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
    a: "A unique PIN is issued after Paystack confirms payment. Email delivery requires the configured mail provider; if delivery is delayed, support can verify the transaction and resend it.",
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
