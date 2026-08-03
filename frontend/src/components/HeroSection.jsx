import React from "react";
import { ShieldCheck, TrendUp, TrendDown, Crosshair, Circle } from "@phosphor-icons/react";

const PIPELINE = ["Analyze", "Qualify", "Execute"];

/** Compact live-data visual, not a fabricated screenshot -- the gold price
 * shown is the same real live quote already fetched in App.js for the
 * header ticker (GET /gold/price). No trade/P&L numbers are invented here. */
function LiveVisual({ goldPrice }) {
  const quoteAvailable = goldPrice?.available === true && Number.isFinite(goldPrice?.bid);
  const up = quoteAvailable && goldPrice?.change >= 0;
  return (
    <div className="mx-auto w-full max-w-sm rounded-[28px] border border-white/[0.1] bg-white/[0.04] p-5 backdrop-blur lg:mx-0" data-testid="hero-live-visual">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">XauCloud · Live</span>
        </div>
        <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-amber-200">Gold Mode</span>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair size={16} weight="bold" className="text-amber-300" />
          <span className="font-mono text-lg font-black text-white">XAUUSD</span>
        </div>
        {quoteAvailable ? (
          <div className="text-right">
            <div className="font-mono text-lg font-black text-white">{goldPrice.bid.toFixed(2)}</div>
            <div className={`flex items-center justify-end gap-0.5 font-mono text-[11px] font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
              {up ? <TrendUp size={10} weight="bold" /> : <TrendDown size={10} weight="bold" />}
              {up ? "+" : ""}{goldPrice.change?.toFixed(2)}
            </div>
          </div>
        ) : (
          <span className="font-mono text-[11px] text-white/30">Waiting for quote…</span>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        {PIPELINE.map((stage, i) => (
          <React.Fragment key={stage}>
            <div className="flex flex-col items-center gap-1.5">
              <Circle size={7} weight="fill" className="text-amber-300/70" />
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">{stage}</span>
            </div>
            {i < PIPELINE.length - 1 && <span className="h-px flex-1 bg-white/[0.08]" />}
          </React.Fragment>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/20 px-3.5 py-2.5">
        <ShieldCheck size={14} weight="fill" className="flex-none text-emerald-300" />
        <span className="text-[11px] leading-4 text-white/55">Risk sized and stop loss set before every entry.</span>
      </div>
    </div>
  );
}

export default function HeroSection({ goldPrice }) {
  return (
    <div className="relative overflow-hidden bg-[#060609] text-white" data-testid="hero-section">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_-5%,rgba(197,160,89,0.15),transparent)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-14 pt-14 md:px-8 md:pb-20 md:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
          <div className="text-center lg:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">Gold-Only MT5 Expert Advisor</span>
              </div>
              <a href="https://www.mql5.com/en/market/product/188838" target="_blank" rel="noopener noreferrer"
                data-testid="hero-mql5-badge"
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3.5 py-1.5 transition hover:bg-white/[0.09]">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">Listed on MQL5 Market ↗</span>
              </a>
            </div>

            <h1 className="mt-5 font-heading text-4xl font-semibold leading-[1.06] tracking-tight sm:text-5xl lg:text-6xl" data-testid="hero-title">
              Gold Trading,<br />Automated With Discipline.
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-7 text-white/55 lg:mx-0">
              XauCloud watches XAUUSD around the clock, waits for a qualified setup, sizes the position from your risk settings, and manages the trade automatically inside MetaTrader 5.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <a href="#purchase" data-testid="hero-buy-btn"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-8 py-3.5 text-[14px] font-extrabold text-black transition hover:bg-amber-200">
                Get XauCloud
              </a>
              <a href="#performance" data-testid="hero-perf-btn"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-8 py-3.5 text-[14px] font-semibold text-white transition hover:bg-white/[0.09]">
                See Performance
              </a>
            </div>

            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/30">
              MT5 · Gold-only · No martingale · Defined stop loss
            </p>
          </div>

          <LiveVisual goldPrice={goldPrice} />
        </div>
      </div>
    </div>
  );
}
