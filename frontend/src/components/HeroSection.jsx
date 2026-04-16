import React from "react";
import { ArrowDown, ChartLineUp, Lightning, ShieldCheck } from "@phosphor-icons/react";

export default function HeroSection({ performance }) {
  const stats = [
    { label: "WIN RATE", value: performance?.win_rate ? `${performance.win_rate}%` : "--", icon: ChartLineUp },
    { label: "PROFIT FACTOR", value: performance?.profit_factor ? `${performance.profit_factor}` : "--", icon: Lightning },
    { label: "MAX DRAWDOWN", value: performance?.max_drawdown ? `${performance.max_drawdown}%` : "--", icon: ShieldCheck },
    { label: "AVG WEEKLY", value: performance?.weekly_return_avg ? `+${performance.weekly_return_avg}%` : "--", icon: ChartLineUp },
  ];

  return (
    <div className="relative overflow-hidden noise-overlay" data-testid="hero-section">
      {/* Background texture */}
      <div className="absolute inset-0 z-0">
        <img
          src="https://images.pexels.com/photos/7505924/pexels-photo-7505924.jpeg"
          alt="" className="w-full h-full object-cover opacity-[0.06]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505] via-transparent to-[#050505]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 md:px-8 lg:px-12 pt-24 pb-20">
        <div className="max-w-3xl">
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] bg-white/[0.03] mb-8">
              <div className="w-1.5 h-1.5 bg-[#D4AF37]" />
              <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-white/50">
                MT5 EXPERT ADVISOR
              </span>
            </div>
          </div>

          <h1 className="font-heading text-5xl sm:text-6xl lg:text-7xl font-medium tracking-tighter leading-[0.95] mb-6 animate-fade-up delay-100" data-testid="hero-title">
            XauAI
            <br />
            <span className="gold-gradient-text">Sniper</span>
          </h1>

          <p className="text-base lg:text-lg leading-relaxed text-white/50 max-w-xl mb-10 animate-fade-up delay-200">
            AI-powered Gold trading engine that learns from every trade globally.
            Multi-strategy intelligence with institutional risk management.
          </p>

          <div className="flex items-center gap-4 animate-fade-up delay-300">
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

        {/* Stats bento grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-white/[0.06] mt-20 animate-fade-up delay-500" data-testid="hero-stats">
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

        <div className="mt-4 px-1 animate-fade-up delay-600">
          <p className="text-[10px] text-white/20 font-mono tracking-wide">
            * Sample backtest metrics. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </div>
  );
}
