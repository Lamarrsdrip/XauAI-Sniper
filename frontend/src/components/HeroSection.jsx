import React from "react";

// App-preview that mirrors the new Command Center Home (equity hero + position
// module) so the marketing hero shows the actual premium app, not a generic
// widget. Uses the real live Gold quote (GET /gold/price) for the entry price;
// the equity/P&L figures are an illustrative preview, not a promise.
function AppPreview({ goldPrice }) {
  const q = goldPrice?.available === true && Number.isFinite(goldPrice?.bid);
  const price = q ? goldPrice.bid.toFixed(2) : "4251.22";
  return (
    <div className="relative mx-auto w-full max-w-[360px] lg:mx-0" data-testid="hero-live-visual">
      <div className="pointer-events-none absolute -inset-8 rounded-[44px] bg-[radial-gradient(60%_55%_at_62%_18%,rgba(243,201,105,.18),transparent)]" />
      <div className="relative rounded-[26px] border border-white/[0.09] bg-[#0C0D12] p-4 shadow-[0_34px_90px_rgba(0,0,0,.55)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-[7px] w-[7px] rounded-full bg-[#2FD3A0]" style={{ boxShadow: "0 0 0 3px rgba(47,211,160,.16)" }} />
            <span className="text-[11px] font-semibold text-white/55">Command Center · Live</span>
          </div>
          <span className="rounded-md bg-[#F3C969]/12 px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#F3C969]">GOLD</span>
        </div>

        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-[.14em] text-white/40">Equity</div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div className="text-[30px] font-black leading-none tracking-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
              $3,133<span className="text-[20px] text-white/45">.29</span>
            </div>
            <svg width="92" height="36" viewBox="0 0 92 36" preserveAspectRatio="none" className="flex-none">
              <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2FD3A0" stopOpacity=".28" /><stop offset="1" stopColor="#2FD3A0" stopOpacity="0" /></linearGradient></defs>
              <path d="M0,27 L12,25 L24,28 L36,20 L48,22 L60,14 L74,16 L92,8 L92,36 L0,36 Z" fill="url(#hg)" />
              <path d="M0,27 L12,25 L24,28 L36,20 L48,22 L60,14 L74,16 L92,8" fill="none" stroke="#2FD3A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#2FD3A0]/12 px-2 py-0.5 text-[12px] font-semibold text-[#2FD3A0]">▲ +$176.67 today</div>
        </div>

        <div className="mt-4 rounded-xl bg-white/[0.03] p-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold">XAUUSD</span>
            <span className="rounded bg-[#F0616D]/14 px-1.5 py-0.5 text-[10px] font-bold text-[#F0616D]">SELL</span>
            <span className="ml-auto text-[15px] font-black text-[#2FD3A0]" style={{ fontVariantNumeric: "tabular-nums" }}>+$176.20</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/45" style={{ fontVariantNumeric: "tabular-nums" }}>
            <span>Entry {price}</span>
            <span className="text-[#F3C969]">◆ Protected +$110</span>
          </div>
        </div>

        <div className="mt-4 flex items-center">
          {["Analyze", "Qualify", "Execute"].map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center gap-1">
                <span className="h-[6px] w-[6px] rounded-full bg-[#F3C969]/70" />
                <span className="text-[9px] uppercase tracking-[.12em] text-white/35">{s}</span>
              </div>
              {i < 2 && <span className="mx-2 h-px flex-1 bg-white/10" />}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function HeroSection({ goldPrice }) {
  return (
    <div className="relative overflow-hidden bg-[#07080B] text-white" data-testid="hero-section">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_62%_54%_at_50%_-8%,rgba(243,201,105,0.14),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_40%_at_88%_10%,rgba(47,211,160,0.06),transparent)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-12 pt-11 md:px-8 md:pb-16 md:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.12fr_0.88fr]">
          <div className="text-center lg:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#F3C969]/20 bg-[#F3C969]/[0.08] px-3.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2FD3A0]" />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#F3C969]">AI Gold Trading · MetaTrader 5</span>
              </div>
              <a href="https://www.mql5.com/en/market/product/188838" target="_blank" rel="noopener noreferrer" data-testid="hero-mql5-badge"
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3.5 py-1.5 transition hover:bg-white/[0.09]">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">On MQL5 Market ↗</span>
              </a>
            </div>

            <h1 className="mt-6 font-heading text-[2.6rem] font-semibold leading-[1.03] tracking-tight sm:text-6xl" data-testid="hero-title" style={{ textWrap: "balance" }}>
              Gold, traded with<br /><span className="bg-gradient-to-r from-[#FCE3A0] via-[#F3C969] to-[#C9962E] bg-clip-text text-transparent">machine discipline.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-7 text-white/55 lg:mx-0">
              XauCloud watches XAUUSD around the clock, waits for a qualified setup, sizes each trade from your own risk, and manages it to the exit — all inside MetaTrader 5, all visible from a premium Command Center on your phone.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <a href="#purchase" data-testid="hero-buy-btn"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F3C969] px-8 py-3.5 text-[14px] font-extrabold text-black transition hover:brightness-105">
                Get XauCloud
              </a>
              <a href="/command" data-testid="hero-perf-btn"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-8 py-3.5 text-[14px] font-semibold text-white transition hover:bg-white/[0.09]">
                Open Command Center
              </a>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/30 lg:justify-start">
              <span>Gold-only</span><span className="text-white/15">·</span><span>No martingale</span><span className="text-white/15">·</span><span>Defined stop loss</span><span className="text-white/15">·</span><span>Lifetime license</span>
            </div>
          </div>

          <AppPreview goldPrice={goldPrice} />
        </div>
      </div>
    </div>
  );
}
