import React from "react";
import { ArrowRight, CheckCircle2, ShieldCheck, Smartphone, Sparkles } from "lucide-react";

function MiniStat({ label, value, tone = "white" }) {
  const cls = tone === "green" ? "text-[#2FD3A0]" : tone === "gold" ? "text-[#F3C969]" : "text-white";
  return (
    <div>
      <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/58">{label}</div>
      <div className={`mt-1 text-[13px] font-black ${cls}`}>{value}</div>
    </div>
  );
}

// Product preview — deliberately labelled illustrative. The gold quote can be
// live; account figures are UI examples and are never presented as performance.
function ProductPreview({ goldPrice }) {
  const hasQuote = goldPrice?.available === true && Number.isFinite(goldPrice?.bid);
  const price = hasQuote ? goldPrice.bid.toFixed(2) : "—";
  return (
    <div className="relative mx-auto w-full max-w-[410px] lg:mx-0" data-testid="hero-live-visual">
      <div className="pointer-events-none absolute -inset-10 rounded-[48px] bg-[radial-gradient(55%_55%_at_58%_18%,rgba(243,201,105,.20),transparent)]" />
      <div className="relative overflow-hidden rounded-[30px] border border-white/[0.10] bg-[#0A0B0F] shadow-[0_40px_110px_rgba(0,0,0,.6)]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#2FD3A0]" style={{ boxShadow: "0 0 0 4px rgba(47,211,160,.12)" }} />
            <span className="text-[11px] font-semibold text-white/82">XauCloud Command Center</span>
          </div>
          <span className="rounded-full bg-[#F3C969]/10 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[0.14em] text-[#F3C969]">Product preview</span>
        </div>

        <div className="p-4">
          <div className="rounded-2xl bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,.12),transparent_48%),#101117] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/58">Connected market</div>
                <div className="mt-1 text-[18px] font-black">XAUUSD</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/58">Gold bid</div>
                <div className="mt-1 font-mono text-[16px] font-black text-[#F3C969]">{price}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4">
              <MiniStat label="Bot" value="Monitoring" tone="green" />
              <MiniStat label="Risk" value="Defined" tone="gold" />
              <MiniStat label="Control" value="Remote" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/[0.035] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-white/82"><Sparkles className="h-3.5 w-3.5 text-[#F3C969]" /> AI Brain</div>
              <div className="mt-2 text-[10.5px] leading-4 text-white/68">Evidence, blockers and decisions in plain English.</div>
            </div>
            <div className="rounded-2xl bg-white/[0.035] p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-white/82"><Smartphone className="h-3.5 w-3.5 text-[#F3C969]" /> Mobile control</div>
              <div className="mt-2 text-[10.5px] leading-4 text-white/68">Monitor the EA, support and learning from your phone.</div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.04] px-3 py-2.5 text-[10.5px] text-white/72">
            <ShieldCheck className="h-4 w-4 flex-none text-[#2FD3A0]" />
            No martingale · defined risk · automated position management
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HeroSection({ goldPrice }) {
  return (
    <div className="relative overflow-hidden bg-[#06070A] text-white" data-testid="hero-section">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_58%_at_48%_-10%,rgba(243,201,105,0.16),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_38%_42%_at_92%_18%,rgba(47,211,160,0.055),transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-14 pt-12 md:px-8 md:pb-20 md:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[1.08fr_.92fr]">
          <div className="text-center lg:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#F3C969]/20 bg-[#F3C969]/[0.07] px-3.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2FD3A0]" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#F3C969]">XAUUSD automation · MetaTrader 5</span>
              </div>
              <a href="https://www.mql5.com/en/market/product/188838" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-white/[0.11] bg-white/[0.04] px-3.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-white/78 transition hover:bg-white/[0.08]">
                Available on MQL5 ↗
              </a>
            </div>

            <h1 className="mt-6 font-heading text-[2.75rem] font-semibold leading-[1.01] tracking-[-0.035em] sm:text-6xl lg:text-[4.15rem]" data-testid="hero-title" style={{ textWrap: "balance" }}>
              A professional operating layer for
              <span className="block bg-gradient-to-r from-[#FFF0BE] via-[#F3C969] to-[#BE8525] bg-clip-text text-transparent">automated Gold trading.</span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-[15px] leading-7 text-white/76 lg:mx-0">
              XauCloud combines a Gold-focused MT5 Expert Advisor with a mobile Command Center for live monitoring, AI decision visibility, risk controls, analytics, support and trader education.
            </p>

            <div className="mx-auto mt-6 grid max-w-xl gap-2 text-left sm:grid-cols-2 lg:mx-0">
              {[
                "Automated XAUUSD execution and trade management",
                "Risk-aware sizing and protective controls",
                "Command Center visibility from phone or desktop",
                "Support, Forex Academy and market intelligence",
              ].map((x) => (
                <div key={x} className="flex items-start gap-2 rounded-xl bg-white/[0.025] px-3 py-2.5">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-[#F3C969]" />
                  <span className="text-[11.5px] leading-4 text-white/76">{x}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
              <a href="#purchase" data-testid="hero-buy-btn"
                className="inline-flex min-w-[170px] items-center justify-center gap-2 rounded-full bg-[#F3C969] px-7 py-3.5 text-[13.5px] font-extrabold text-black transition hover:brightness-105">
                Get XauCloud <ArrowRight className="h-4 w-4" />
              </a>
              <a href="/command"
                className="inline-flex min-w-[170px] items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.045] px-7 py-3.5 text-[13.5px] font-semibold text-white transition hover:bg-white/[0.08]">
                Explore Command Center
              </a>
            </div>

            <div className="mt-6 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/58">
              Trading involves risk · Historical results are not guarantees · You remain in control
            </div>
          </div>

          <ProductPreview goldPrice={goldPrice} />
        </div>
      </div>
    </div>
  );
}
