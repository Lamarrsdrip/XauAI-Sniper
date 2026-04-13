import React from "react";
import { ArrowDown, Lightning, ShieldCheck, ChartLineUp } from "@phosphor-icons/react";

export default function HeroSection({ performance }) {
  const stats = [
    {
      label: "WIN RATE",
      value: performance?.win_rate ? `${performance.win_rate}%` : "--",
      icon: ChartLineUp,
    },
    {
      label: "PROFIT FACTOR",
      value: performance?.profit_factor ? `${performance.profit_factor}` : "--",
      icon: Lightning,
    },
    {
      label: "MAX DRAWDOWN",
      value: performance?.max_drawdown ? `${performance.max_drawdown}%` : "--",
      icon: ShieldCheck,
    },
    {
      label: "AVG WEEKLY",
      value: performance?.weekly_return_avg
        ? `+${performance.weekly_return_avg}%`
        : "--",
      icon: ChartLineUp,
    },
  ];

  return (
    <div className="relative overflow-hidden" data-testid="hero-section">
      {/* Hero content */}
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 pt-16 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left */}
          <div>
            <div className="animate-fade-up">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-6">
                <div className="w-1.5 h-1.5 bg-primary" />
                <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
                  MT5 EXPERT ADVISOR
                </span>
              </div>
            </div>

            <h1
              className="font-heading text-4xl sm:text-5xl font-black tracking-tight leading-none mb-4 animate-fade-up delay-100"
              data-testid="hero-title"
            >
              AI SNIPER
              <br />
              <span className="text-[hsl(43,74%,49%)]">XAUUSD</span>
            </h1>

            <p className="text-base leading-relaxed text-muted-foreground max-w-lg mb-8 animate-fade-up delay-200">
              Professional-grade adaptive trading system with machine learning
              that gets smarter with every trade. Multi-strategy engine with AI
              market classification, institutional risk management, and
              sniper-precision execution for Gold markets.
            </p>

            <div className="flex items-center gap-3 animate-fade-up delay-300">
              <a
                href="#download"
                data-testid="hero-download-btn"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold text-sm tracking-wide hover:-translate-y-[1px] transition-transform duration-150 shadow-[2px_2px_0px_hsl(0,0%,4%)]"
              >
                <ArrowDown size={16} weight="bold" />
                DOWNLOAD EA
              </a>
              <a
                href="#architecture"
                data-testid="hero-explore-btn"
                className="inline-flex items-center gap-2 px-6 py-3 border border-border text-foreground font-medium text-sm tracking-wide hover:border-foreground transition-colors duration-150"
              >
                EXPLORE SYSTEM
              </a>
            </div>
          </div>

          {/* Right – Hero image */}
          <div className="relative animate-fade-up delay-400">
            <div className="border border-border overflow-hidden">
              <img
                src="https://static.prod-images.emergentagent.com/jobs/a0d76eb0-1956-4da1-ad00-cd40d1b3f75f/images/3217ec4cb52b267ea0d9a14cebe330f75fc24b5035af66c21126a90c2724288d.png"
                alt="AI Sniper Trading System"
                className="w-full h-auto object-cover"
                data-testid="hero-image"
              />
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-border mt-12 animate-fade-up delay-500"
          data-testid="hero-stats"
        >
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className={`p-5 ${
                  i < stats.length - 1 ? "border-r border-border" : ""
                } metric-card`}
                data-testid={`hero-stat-${s.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon
                    size={14}
                    weight="bold"
                    className="text-muted-foreground"
                  />
                  <span className="text-xs font-medium tracking-[0.15em] text-muted-foreground">
                    {s.label}
                  </span>
                </div>
                <div className="font-mono text-2xl font-bold text-foreground">
                  {s.value}
                </div>
              </div>
            );
          })}
        </div>

        {/* Disclaimer */}
        <div className="mt-4 px-1">
          <p className="text-xs text-muted-foreground font-mono">
            * Sample backtest metrics. Past performance does not guarantee future
            results. Always test on a demo account first.
          </p>
        </div>
      </div>
    </div>
  );
}
