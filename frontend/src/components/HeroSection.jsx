import React from "react";
import { ArrowDown, Brain, ChartLineUp, ShieldCheck, Lightning, Pulse, CloudArrowUp } from "@phosphor-icons/react";

export default function HeroSection({ performance }) {
  const stats = [
    { label: "Backtest WR", value: performance?.win_rate ? `${performance.win_rate}%` : "--", icon: ChartLineUp, tone: "text-emerald-300" },
    { label: "Profit factor", value: performance?.profit_factor ? `${performance.profit_factor}` : "--", icon: Lightning, tone: "text-amber-200" },
    { label: "Max DD", value: performance?.max_drawdown ? `${performance.max_drawdown}%` : "--", icon: ShieldCheck, tone: "text-sky-300" },
    { label: "Master EA", value: "v5.8.32", icon: Brain, tone: "text-violet-300" },
  ];

  return (
    <div className="relative overflow-hidden bg-[#07090d] text-white" data-testid="hero-section">
      <div className="absolute inset-0">
        <img
          src="https://static.prod-images.emergentagent.com/jobs/d4562f89-eddf-4449-aed8-4236c30b6dde/images/9fc66b22efe10478c08b0f89c90815192ec833fb8b7bdcad47afaafe5168470a.png"
          alt=""
          className="h-full w-full object-cover opacity-[0.18] mix-blend-screen"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,9,13,0.74),#07090d_78%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(52,211,153,0.18),transparent_30%),radial-gradient(circle_at_82%_18%,rgba(245,158,11,0.16),transparent_28%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20">
        <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-200">
                <Pulse size={12} weight="fill" /> Adaptive Smart-Guard
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/60">
                XAUUSD · M5 · MT5
              </span>
            </div>

            <h1 className="max-w-4xl font-heading text-5xl font-semibold leading-[0.94] tracking-tight sm:text-6xl lg:text-7xl" data-testid="hero-title">
              Gold trading control, built like a modern risk desk.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-white/68 md:text-lg">
              XauAI Sniper combines trend logic, volatility-aware exits, cloud copy flow, and the latest v5.8.32 architecture audit so gold can hold clean 10-30 minute moves while still avoiding late chase entries and unsafe cloud desync.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#download" data-testid="hero-download-btn" className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-6 py-3.5 text-sm font-extrabold text-black transition hover:bg-amber-200">
                <ArrowDown size={17} weight="bold" /> Download v5.8.32
              </a>
              <a href="/cloud" data-testid="hero-cloud-btn" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.08] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.12]">
                <CloudArrowUp size={17} weight="bold" /> Open Cloud
              </a>
            </div>

            <p className="mt-4 max-w-xl text-xs leading-5 text-white/42">
              Trading is risky. Start on demo, backtest your broker data, and use account-sized risk.
            </p>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-[28px] border border-white/[0.12] bg-[#0c1118]/[0.88] shadow-2xl shadow-black/[0.45] backdrop-blur">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/40">Master terminal</div>
                  <div className="mt-1 font-semibold">XAUUSD AI Sniper v5.8.32</div>
                </div>
                <div className="rounded-full bg-emerald-300 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#06110c]">Live</div>
              </div>

              <div className="p-5">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Regime", "Trend down", "text-sky-200"],
                    ["Guard", "Soft retest", "text-emerald-300"],
                    ["Risk", "Account-sized", "text-amber-200"],
                    ["Cloud", "Fanout ready", "text-violet-200"],
                  ].map(([label, value, tone]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">{label}</div>
                      <div className={`mt-2 font-mono text-sm font-bold ${tone}`}>{value}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-white/35">Smart-Guard reasoning</span>
                    <span className="rounded-full bg-emerald-300/10 px-2 py-1 font-mono text-[9px] font-bold text-emerald-200">transparent logs</span>
                  </div>
                  <div className="space-y-2 font-mono text-[11px] leading-5 text-white/58">
                    <p><span className="text-emerald-300">SOFT</span> · B-grade pullback allowed with reduced risk</p>
                    <p><span className="text-sky-300">CHECK</span> · samples, decayed expectancy, adaptive XAU confirmation</p>
                    <p><span className="text-amber-200">RETEST</span> · inactivity relaxation prevents all-day paralysis</p>
                  </div>
                </div>

                <div className="mt-4 h-24 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(245,158,11,0.04))] px-4 py-3">
                  <div className="flex h-full items-end justify-between gap-1">
                    {[36, 42, 38, 54, 49, 67, 72, 62, 76, 88, 81, 94, 89, 100].map((h, i) => (
                      <span key={i} className="w-full rounded-t bg-gradient-to-t from-emerald-400/55 to-amber-200" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="hero-stats">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-4 backdrop-blur" data-testid={`hero-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="mb-3 flex items-center gap-2">
                  <Icon size={15} weight="duotone" className={s.tone} />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{s.label}</span>
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
