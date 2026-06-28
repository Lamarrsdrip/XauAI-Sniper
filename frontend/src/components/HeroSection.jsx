import React from "react";
import { ArrowDown, ChartLineUp, ShieldCheck, Lightning, Brain } from "@phosphor-icons/react";

export default function HeroSection({ performance }) {
  const stats = [
    { label: "Win Rate",      value: performance?.win_rate     ? `${performance.win_rate}%`     : "--", icon: ChartLineUp, tone: "text-emerald-300" },
    { label: "Profit Factor", value: performance?.profit_factor ? `${performance.profit_factor}` : "--", icon: Lightning,   tone: "text-amber-200"  },
    { label: "Max Drawdown",  value: performance?.max_drawdown  ? `${performance.max_drawdown}%` : "--", icon: ShieldCheck,  tone: "text-sky-300"    },
    { label: "AI Rating",     value: "90 / 100",                                                         icon: Brain,        tone: "text-violet-300" },
  ];

  return (
    <div className="relative overflow-hidden bg-[#060609] text-white" data-testid="hero-section">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,rgba(197,160,89,0.14),transparent)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 pb-20 pt-20 text-center md:px-8 md:pb-28 md:pt-28">

        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">XAUUSD · M5 · MT5</span>
        </div>

        <h1 className="font-heading text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl" data-testid="hero-title">
          AI Gold Trading.<br className="hidden sm:block" /> Built for Consistency.
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-[16px] leading-7 text-white/55">
          Trade XAUUSD with an adaptive AI engine that scans the market and executes automatically.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href="#purchase" data-testid="hero-buy-btn"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-7 py-3.5 text-[14px] font-extrabold text-black transition hover:bg-amber-200">
            Buy Now
          </a>
          <a href="#performance" data-testid="hero-perf-btn"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-7 py-3.5 text-[14px] font-semibold text-white transition hover:bg-white/[0.09]">
            <ArrowDown size={14} weight="bold" /> View Performance
          </a>
        </div>

        <p className="mt-5 text-[11px] text-white/25">
          Start on demo. Trading involves risk of loss.
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
                <div className="font-mono text-xl font-black">{s.value}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
