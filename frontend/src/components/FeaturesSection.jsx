import React from "react";
import { Target, ShieldCheck, ChartLine, CloudArrowUp } from "@phosphor-icons/react";

const CARDS = [
  {
    icon: Target,
    title: "Gold-specialized intelligence",
    body: "Built around XAUUSD market behavior — structure, trend, momentum, and volatility — rather than a generic multi-symbol signal.",
    tone: "text-gold-300",
    border: "border-gold-300/20",
    glow: "bg-gold-300/[0.07]",
  },
  {
    icon: ShieldCheck,
    title: "Risk calculated before execution",
    body: "Position size comes from your account balance, stop distance, and broker constraints — never a fixed lot size guessed in advance.",
    tone: "text-sky-300",
    border: "border-sky-300/20",
    glow: "bg-sky-300/[0.07]",
  },
  {
    icon: ChartLine,
    title: "Active trade management",
    body: "Once a trade is open, XauCloud manages stops, protects profit as it builds, and handles the exit — no manual babysitting required.",
    tone: "text-emerald-300",
    border: "border-emerald-300/20",
    glow: "bg-emerald-300/[0.07]",
  },
  {
    icon: CloudArrowUp,
    title: "Command Center visibility",
    body: "See bot status, signals, and open positions from your phone in plain language — no raw logs to decode.",
    tone: "text-violet-300",
    border: "border-violet-300/20",
    glow: "bg-violet-300/[0.07]",
  },
];

export default function FeaturesSection() {
  return (
    <div className="bg-[#07080B] border-t border-white/[0.06]" data-testid="features-section">
      <div className="mx-auto max-w-6xl px-4 py-11 md:px-8 md:py-16">

        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-gold-200">
            Features
          </span>
          <h2 className="mt-3.5 max-w-lg font-heading text-[1.7rem] font-semibold tracking-tight text-white sm:text-4xl">
            Built around Gold, not guesswork.
          </h2>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.title} className={`flex items-start gap-3.5 rounded-2xl border ${card.border} ${card.glow} p-4`}>
                <div className={`inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border ${card.border} bg-black/20`}>
                  <Icon size={20} weight="duotone" className={card.tone} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-heading text-[15px] font-semibold text-white">{card.title}</h3>
                  <p className="mt-1 text-[13px] leading-[1.5] text-white/65">{card.body}</p>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
