import React from "react";
import { MagnifyingGlass, Funnel, Lightning } from "@phosphor-icons/react";

const STEPS = [
  {
    icon: MagnifyingGlass,
    title: "Analyze",
    body: "Reads Gold structure, trend, momentum, and volatility across multiple timeframes before considering a setup.",
  },
  {
    icon: Funnel,
    title: "Qualify",
    body: "Waits until the bot's required conditions — structure, risk, margin, spread, and broker checks — all line up.",
  },
  {
    icon: Lightning,
    title: "Execute & Manage",
    body: "Sizes the position from your risk settings, opens the trade, and manages protection and exits automatically.",
  },
];

export default function HowItWorksSection() {
  return (
    <div className="bg-[#07080B] border-t border-white/[0.06] text-white" data-testid="how-it-works-section">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">

        <div className="mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-gold-200">
            How it works
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="how-it-works-title">
            Three steps, every time.
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl border border-gold-300/20 bg-gold-300/[0.08]">
                  <Icon size={18} weight="duotone" className="text-gold-300" />
                </div>
                <span className="font-mono text-[11px] font-bold text-white/25">0{i + 1}</span>
              </div>
              <h3 className="mb-2 font-heading text-[16px] font-semibold text-white">{title}</h3>
              <p className="text-[13px] leading-6 text-white/50">{body}</p>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
