import React from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export default function HeroSection() {
  return (
    <div className="relative overflow-hidden bg-[#06070A] text-white" data-testid="hero-section">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.08]" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20">
        <div className="grid items-center gap-14">
          <div className="text-left">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#F3C969]/20 bg-[#F3C969]/[0.06] px-3.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2FD3A0]" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#F3C969]">XAUUSD automation · MetaTrader 5</span>
              </div>
              <a
                href="https://www.mql5.com/en/market/product/188838"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-white/[0.10] px-3.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/62 transition hover:border-white/20 hover:text-white"
              >
                Available on MQL5 ↗
              </a>
            </div>

            <h1
              className="mt-7 max-w-3xl font-heading text-[2.85rem] font-semibold leading-[0.98] tracking-[-0.04em] sm:text-6xl lg:text-[4.25rem]"
              data-testid="hero-title"
            >
              Professional automation for
              <span className="block text-[#F3C969]">XAUUSD trading.</span>
            </h1>

            <p className="mt-6 max-w-xl text-[15px] leading-7 text-white/64">
              XauCloud combines a Gold-focused MT5 Expert Advisor with a professional Command Center for monitoring, decision visibility, risk controls, analytics, support and trader education.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#purchase"
                data-testid="hero-buy-btn"
                className="inline-flex min-w-[170px] items-center justify-center gap-2 rounded-full bg-[#F3C969] px-7 py-3.5 text-[13.5px] font-extrabold text-black transition hover:brightness-105"
              >
                Get XauCloud <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="/command"
                className="inline-flex min-w-[190px] items-center justify-center gap-2 rounded-full border border-[#F3C969]/35 bg-transparent px-7 py-3.5 text-[13.5px] font-semibold text-white transition hover:bg-[#F3C969]/[0.06]"
              >
                Explore Command Center
              </a>
            </div>

            <div className="mt-9 grid max-w-xl grid-cols-2 gap-x-7 gap-y-4">
              {[
                "Automated XAUUSD execution",
                "Risk-aware position controls",
                "Command Center visibility",
                "Support & Forex Academy",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 border-t border-white/[0.08] pt-3">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-[#F3C969]" />
                  <span className="text-[11px] leading-4 text-white/60">{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-7 font-mono text-[9px] uppercase tracking-[0.13em] text-white/34">
              Trading involves risk · Historical results are not guarantees · You remain in control
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
