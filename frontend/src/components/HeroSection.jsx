import React from "react";
import { ArrowDown, Brain, ChartLineUp, ShieldCheck, Lightning, CloudArrowUp, Sparkle } from "@phosphor-icons/react";

const FEATURES = [
  { label: "AI Director", value: "Claude + GPT", tone: "text-violet-300", bg: "bg-violet-300/10 border-violet-300/20" },
  { label: "ML Warm-Start", value: "Instant authority", tone: "text-sky-300", bg: "bg-sky-300/10 border-sky-300/20" },
  { label: "Adaptive Exits", value: "Chandelier trail", tone: "text-emerald-300", bg: "bg-emerald-300/10 border-emerald-300/20" },
  { label: "Hive Mind", value: "Global win rate", tone: "text-amber-200", bg: "bg-amber-300/10 border-amber-300/20" },
];

export default function HeroSection({ performance }) {
  const stats = [
    { label: "Backtest WR",   value: performance?.win_rate      ? `${performance.win_rate}%`      : "--", icon: ChartLineUp, tone: "text-emerald-300" },
    { label: "Profit factor", value: performance?.profit_factor  ? `${performance.profit_factor}`  : "--", icon: Lightning,   tone: "text-amber-200"  },
    { label: "Max DD",        value: performance?.max_drawdown   ? `${performance.max_drawdown}%`  : "--", icon: ShieldCheck,  tone: "text-sky-300"    },
    { label: "Bot rating",    value: "90/100",                                                              icon: Brain,        tone: "text-violet-300" },
  ];

  return (
    <div className="relative overflow-hidden bg-[#060609] text-white" data-testid="hero-section">
      {/* Subtle background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(197,160,89,0.12),transparent_45%),radial-gradient(ellipse_at_80%_0%,rgba(52,211,153,0.08),transparent_40%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-12 md:px-8 md:pb-20 md:pt-16">

        {/* Top badge row */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/25 bg-violet-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-violet-200">
            <Sparkle size={11} weight="fill" /> AI Director — v6.4.2
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
            XAUUSD · M5 · MT5
          </span>
          <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
            Rated 90/100
          </span>
        </div>

        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          {/* Left: Copy */}
          <div>
            <h1 className="max-w-3xl font-heading text-[2.8rem] font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-6xl" data-testid="hero-title">
              The gold EA with a real AI making every decision.
            </h1>

            <p className="mt-5 max-w-xl text-[15px] leading-7 text-white/60">
              XauAI Sniper v6.4.2 runs on your MT5 with a full AI Director — Claude Sonnet and GPT jointly decide every entry, position size, and exit. ML cloud warm-start loads pattern history on the first tick. Adaptive Chandelier exits trail winners without giving back gains.
            </p>

            <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FEATURES.map((f) => (
                <div key={f.label} className={`rounded-2xl border px-3 py-3 ${f.bg}`}>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">{f.label}</div>
                  <div className={`mt-1.5 text-[12px] font-bold ${f.tone}`}>{f.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a href="#download" data-testid="hero-download-btn"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-6 py-3.5 text-[13px] font-extrabold text-black transition hover:bg-amber-200">
                <ArrowDown size={15} weight="bold" /> Download v6.4.2
              </a>
              <a href="/command" data-testid="hero-cloud-btn"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.05] px-6 py-3.5 text-[13px] font-semibold text-white transition hover:bg-white/[0.09]">
                <CloudArrowUp size={15} weight="bold" /> Command Center
              </a>
            </div>

            <p className="mt-4 text-[11px] leading-5 text-white/30">
              Trading is risky. Start on demo. Use account-sized risk only.
            </p>
          </div>

          {/* Right: Terminal preview */}
          <div>
            <div className="overflow-hidden rounded-[26px] border border-white/[0.09] bg-[#0c0d11] shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-white/30">Master terminal</div>
                  <div className="mt-0.5 text-[14px] font-semibold">XAUUSD AI Sniper v6.4.2</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">Live</span>
                </div>
              </div>

              <div className="p-4 space-y-3">
                {/* Status grid */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["AI Director", "Claude ✓ GPT ✓",   "text-violet-300"],
                    ["ML warm-start", "124 patterns",    "text-sky-300"   ],
                    ["Regime",       "Trending up",      "text-emerald-300"],
                    ["Exit mode",    "Chandelier 2.8×",  "text-amber-200" ],
                  ].map(([label, value, tone]) => (
                    <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
                      <div className="font-mono text-[9px] uppercase tracking-widest text-white/30">{label}</div>
                      <div className={`mt-1 font-mono text-[12px] font-bold ${tone}`}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* AI reasoning log */}
                <div className="rounded-xl border border-white/[0.07] bg-black/30 p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">AI Director reasoning</span>
                    <span className="rounded-full bg-violet-300/10 px-2 py-0.5 font-mono text-[9px] font-bold text-violet-200">confidence 87%</span>
                  </div>
                  <div className="space-y-1.5 font-mono text-[11px] leading-[1.6] text-white/52">
                    <p><span className="text-emerald-300">ALLOW</span> · HTF consensus BULL, A-grade pullback</p>
                    <p><span className="text-violet-200">CLAUDE</span> · "Strong HTF structure, hold runners"</p>
                    <p><span className="text-amber-200">ML</span> · 18/20 matching samples WR 67%</p>
                  </div>
                </div>

                {/* Equity bars */}
                <div className="h-16 rounded-xl border border-white/[0.07] bg-[linear-gradient(180deg,rgba(16,185,129,0.06),transparent)] px-3 py-2.5">
                  <div className="flex h-full items-end justify-between gap-0.5">
                    {[42, 38, 55, 49, 68, 72, 61, 78, 88, 82, 91, 95, 89, 100].map((h, i) => (
                      <span key={i} className="w-full rounded-t bg-gradient-to-t from-emerald-400/50 to-amber-200/60" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="hero-stats">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur"
                data-testid={`hero-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="mb-2.5 flex items-center gap-2">
                  <Icon size={13} weight="duotone" className={s.tone} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">{s.label}</span>
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
