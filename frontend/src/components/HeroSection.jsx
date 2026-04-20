import React from "react";
import { ArrowDown, ChartLineUp, Lightning, ShieldCheck, Brain } from "@phosphor-icons/react";

export default function HeroSection({ performance }) {
  const stats = [
    { label: "WIN RATE", value: performance?.win_rate ? `${performance.win_rate}%` : "--", icon: ChartLineUp },
    { label: "PROFIT FACTOR", value: performance?.profit_factor ? `${performance.profit_factor}` : "--", icon: Lightning },
    { label: "MAX DRAWDOWN", value: performance?.max_drawdown ? `${performance.max_drawdown}%` : "--", icon: ShieldCheck },
    { label: "AVG WEEKLY", value: performance?.weekly_return_avg ? `+${performance.weekly_return_avg}%` : "--", icon: ChartLineUp },
  ];

  return (
    <div className="relative overflow-hidden bg-[#F8F9FA]" data-testid="hero-section">
      <div className="absolute inset-0 opacity-[0.04]">
        <img src="https://static.prod-images.emergentagent.com/jobs/d4562f89-eddf-4449-aed8-4236c30b6dde/images/9fc66b22efe10478c08b0f89c90815192ec833fb8b7bdcad47afaafe5168470a.png" alt="" className="w-full h-full object-cover" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 pt-20 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="flex items-center gap-3 mb-8 animate-fade-up">
              <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-gray-400 bg-white border border-gray-200 px-3 py-1.5 rounded-full">MT5 EXPERT ADVISOR</span>
              <span className="text-[10px] font-mono font-bold tracking-[0.12em] text-[#C5A059] bg-[#C5A059]/10 border border-[#C5A059]/20 px-3 py-1.5 rounded-full flex items-center gap-1.5">
                <Brain size={12} weight="fill" /> POWERED BY GPT-5.2
              </span>
            </div>

            <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight leading-[1] mb-6 text-[#111] animate-fade-up delay-100" data-testid="hero-title">
              XauAI<br /><span className="gold-gradient-text">Sniper</span>
            </h1>

            <p className="text-base lg:text-lg leading-relaxed text-gray-500 max-w-xl mb-8 animate-fade-up delay-200">
              The first Gold trading bot with <span className="text-[#111] font-semibold">real AI analysis</span>.
              GPT-5.2 evaluates every trade. Machine learning adapts. News filter protects.
            </p>

            <div className="flex items-center gap-4 animate-fade-up delay-300">
              <a href="#purchase" data-testid="hero-download-btn"
                className="inline-flex items-center gap-2 bg-[#111] text-white rounded-full px-8 py-4 font-semibold text-sm tracking-wide hover:bg-gray-800 transition-colors">
                <ArrowDown size={16} weight="bold" /> GET STARTED
              </a>
              <a href="#how-it-works" data-testid="hero-explore-btn"
                className="inline-flex items-center gap-2 bg-white text-[#111] border border-gray-200 rounded-full px-8 py-4 font-medium text-sm tracking-wide hover:border-gray-400 hover:bg-gray-50 transition-all">
                EXPLORE SYSTEM
              </a>
            </div>
          </div>

          <div className="hidden lg:block animate-fade-up delay-400">
            <div className="bg-white border border-gray-200 rounded-3xl p-8 shadow-sm card-hover">
              <div className="flex items-center gap-2 mb-6">
                <Brain size={18} weight="duotone" className="text-[#C5A059]" />
                <span className="text-[11px] font-mono font-bold tracking-[0.15em] text-gray-400">AI ANALYSIS PREVIEW</span>
              </div>
              <div className="space-y-0 font-mono text-xs divide-y divide-gray-100">
                {[["Market", "XAUUSD — BULLISH", "text-[#111]"],
                  ["EMA 50/200", "Aligned UP", "text-emerald-600"],
                  ["RSI(14)", "54.2", "text-[#111]"],
                  ["News Check", "Clear", "text-emerald-600"],
                  ["GPT-5.2", "BUY — 78% confidence", "text-[#C5A059] font-bold"],
                ].map(([k, v, c]) => (
                  <div key={k} className="flex items-center justify-between py-3">
                    <span className="text-gray-400">{k}</span>
                    <span className={c}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-4 bg-[#F8F9FA] rounded-2xl border border-gray-100">
                <p className="text-[11px] text-gray-500 italic leading-relaxed">
                  "Strong bullish momentum with H1 trend confirmation. RSI healthy, no overbought risk. Recommend BUY with default risk."
                </p>
                <p className="text-[10px] text-[#C5A059] mt-2 font-mono font-bold">— GPT-5.2 AI Engine</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-20 animate-fade-up delay-500" data-testid="hero-stats">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-6 card-hover" data-testid={`hero-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={14} weight="duotone" className="text-[#C5A059]" />
                  <span className="text-[10px] font-mono font-medium tracking-[0.15em] text-gray-400">{s.label}</span>
                </div>
                <div className="font-mono text-2xl font-bold text-[#111]">{s.value}</div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-300 font-mono tracking-wide mt-4 px-1">* Sample backtest metrics. Past performance does not guarantee future results.</p>
      </div>
    </div>
  );
}
