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
    <div className="relative overflow-hidden noise-overlay" data-testid="hero-section">
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a00] via-[#050505] to-[#0a0500]" />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#D4AF37]/[0.03] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-[#D4AF37]/[0.02] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-8 lg:px-12 pt-24 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="flex items-center gap-3 mb-8 animate-fade-up">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] bg-white/[0.03]">
                <div className="w-1.5 h-1.5 bg-[#D4AF37]" />
                <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-white/50">MT5 EXPERT ADVISOR</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#D4AF37]/30 bg-[#D4AF37]/[0.08]">
                <Brain size={12} weight="fill" className="text-[#D4AF37]" />
                <span className="text-[10px] font-mono font-bold tracking-[0.15em] text-[#D4AF37]">POWERED BY GPT-5.2</span>
              </div>
            </div>

            <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-medium tracking-tighter leading-[0.95] mb-6 animate-fade-up delay-100" data-testid="hero-title">
              XauAI
              <br />
              <span className="gold-gradient-text">Sniper</span>
              <span className="text-white/15 text-2xl ml-3 font-mono">v3.1</span>
            </h1>

            <p className="text-base lg:text-lg leading-relaxed text-white/50 max-w-xl mb-6 animate-fade-up delay-200">
              The first Gold trading bot with <span className="text-white/80 font-medium">real AI analysis</span>.
              GPT-5.2 evaluates every trade before execution. Machine learning
              adapts to market patterns. News avoidance protects during volatility.
            </p>

            <div className="flex flex-wrap gap-x-6 gap-y-2 mb-10 animate-fade-up delay-300">
              {["GPT-5.2 AI Brain", "Live News Filter", "ML Pattern Memory", "Auto Risk Control"].map((f) => (
                <div key={f} className="flex items-center gap-1.5">
                  <div className="w-1 h-1 bg-[#D4AF37]" />
                  <span className="text-xs text-white/40 font-mono tracking-wide">{f}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-4 animate-fade-up delay-400">
              <a href="#purchase" data-testid="hero-download-btn"
                className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#D4AF37] text-black font-semibold text-sm tracking-wide hover:bg-white transition-colors duration-200">
                <ArrowDown size={16} weight="bold" />
                GET STARTED
              </a>
              <a href="#how-it-works" data-testid="hero-explore-btn"
                className="inline-flex items-center gap-2 px-7 py-3.5 border border-white/20 text-white/80 font-medium text-sm tracking-wide hover:border-[#D4AF37] hover:text-[#D4AF37] transition-all duration-200">
                EXPLORE SYSTEM
              </a>
            </div>
          </div>

          {/* Right side — AI preview card */}
          <div className="hidden lg:block animate-fade-up delay-500">
            <div className="border border-white/[0.06] bg-[#0C0C0C] p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#D4AF37]/[0.03] rounded-full blur-[60px]" />
              <div className="flex items-center gap-2 mb-4">
                <Brain size={16} weight="duotone" className="text-[#D4AF37]" />
                <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#D4AF37]">AI ANALYSIS PREVIEW</span>
              </div>
              <div className="space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <span className="text-white/30">Market</span>
                  <span className="text-white/70">XAUUSD — BULLISH</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <span className="text-white/30">EMA 50/200</span>
                  <span className="text-[#00C853]">Aligned UP</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <span className="text-white/30">RSI(14)</span>
                  <span className="text-white/70">54.2</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <span className="text-white/30">News Check</span>
                  <span className="text-[#00C853]">Clear</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                  <span className="text-white/30">GPT-5.2</span>
                  <span className="text-[#D4AF37] font-bold">BUY — 78% confidence</span>
                </div>
                <div className="mt-3 p-3 bg-[#D4AF37]/[0.05] border border-[#D4AF37]/20">
                  <p className="text-[11px] text-white/50 italic leading-relaxed">
                    "Strong bullish momentum with H1 trend confirmation. RSI healthy, no overbought risk. News calendar clear. Recommend BUY with default risk."
                  </p>
                  <p className="text-[10px] text-[#D4AF37] mt-2 font-bold">— GPT-5.2 AI Engine</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats bento */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-white/[0.06] mt-20 animate-fade-up delay-600" data-testid="hero-stats">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="bg-[#050505] p-6 metric-card" data-testid={`hero-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={14} weight="duotone" className="text-[#D4AF37]" />
                  <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-white/30">{s.label}</span>
                </div>
                <div className="font-mono text-2xl font-bold text-white">{s.value}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 px-1 animate-fade-up delay-700">
          <p className="text-[10px] text-white/20 font-mono tracking-wide">
            * Sample backtest metrics. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </div>
  );
}
