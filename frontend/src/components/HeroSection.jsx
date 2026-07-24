import React from "react";
import { ChartLineUp, ShieldCheck, Lightning, Brain, Crosshair, Shuffle } from "@phosphor-icons/react";

const HIGHLIGHTS = [
  { icon: Crosshair,  label: "Finds Rule-Qualified Setups"        },
  { icon: ShieldCheck, label: "Smart Risk Management"              },
  { icon: Lightning,   label: "Fully Automated Trading"            },
  { icon: Shuffle,     label: "Adapts to Changing Market Conditions" },
];

export default function HeroSection({ performance }) {
  const sufficient = performance?.sufficient_data === true;
  const stats = [
    { label: "Journal Trades", value: performance?.total_trades ?? "--", icon: ChartLineUp, tone: "text-emerald-300" },
    { label: "Win Rate", value: sufficient ? `${performance.win_rate}%` : "Insufficient", icon: Lightning, tone: "text-amber-200" },
    { label: "Profit Factor", value: sufficient ? `${performance.profit_factor}` : "Insufficient", icon: ShieldCheck, tone: "text-sky-300" },
    { label: "Data Source", value: "EA Journal", icon: Brain, tone: "text-violet-300" },
  ];

  return (
    <div className="relative overflow-hidden bg-[#060609] text-white" data-testid="hero-section">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_-5%,rgba(197,160,89,0.15),transparent)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 pb-24 pt-20 text-center md:px-8 md:pb-32 md:pt-28">

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">XAUUSD · M10 Evidence · Optional M30 · MT5</span>
        </div>

        <h1 className="font-heading text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl" data-testid="hero-title">
          AI Gold Trading.<br className="hidden sm:block" /> Built for Consistency.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-7 text-white/50">
          XauCloud is an advanced AI trading bot built exclusively for Gold (XAUUSD).<br className="hidden sm:block" />
          It analyzes market structure, trend strength, volatility, and momentum —<br className="hidden sm:block" />
          then executes only rule-qualified candidates through explicit risk, structure, margin, spread, and broker checks. Trading losses remain possible.
        </p>

        {/* Highlight badges */}
        <div className="mx-auto mt-7 flex max-w-2xl flex-wrap items-center justify-center gap-2">
          {HIGHLIGHTS.map(({ icon: Icon, label }) => (
            <div key={label}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-2">
              <Icon size={13} weight="duotone" className="text-amber-300 flex-none" />
              <span className="text-[12px] font-medium text-white/65">{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href="#purchase" data-testid="hero-buy-btn"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-8 py-3.5 text-[14px] font-extrabold text-black transition hover:bg-amber-200">
            Buy Now
          </a>
          <a href="#performance" data-testid="hero-perf-btn"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-8 py-3.5 text-[14px] font-semibold text-white transition hover:bg-white/[0.09]">
            View Performance
          </a>
        </div>

        <p className="mt-5 text-[11px] text-white/20">
          Start on demo. Trading involves risk of loss. Performance is first-party EA journal data, not independently verified.
        </p>

        <div className="mt-14 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="hero-stats">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur"
                data-testid={`hero-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="mb-2.5 flex items-center justify-center gap-1.5">
                  <Icon size={12} weight="duotone" className={s.tone} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{s.label}</span>
                </div>
                <div className="break-words font-mono text-base font-black sm:text-xl">{s.value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
