import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Cloud, X, Check } from "lucide-react";
import XauAiLogo from "./cloud/XauAiLogo";

/**
 * Promo banner shown on the main DIY landing page that funnels visitors who
 * DON'T want to install MT5 / rent a VPS over to XauAi Cloud (managed).
 * Sits between the EA Purchase section and How-It-Works on the homepage.
 */
export default function CloudPromoSection() {
  return (
    <section className="relative bg-[#050505] text-white overflow-hidden" data-testid="cloud-promo-section">
      {/* Subtle gold radial glow */}
      <div className="absolute inset-0 pointer-events-none opacity-60"
           style={{ background: "radial-gradient(900px 360px at 70% 30%, rgba(212,175,55,0.12), transparent 60%)" }} />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-14 items-center">
          {/* Left: copy */}
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37] text-[10px] sm:text-xs font-mono tracking-wider mb-4 sm:mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-pulse" />
              MANAGED ALTERNATIVE · NO INSTALL
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.05] mb-4">
              Don't want to install MT5 <br className="hidden sm:block" />
              or rent a VPS? <span className="text-[#D4AF37]">We've got you.</span>
            </h2>

            <p className="text-base sm:text-lg text-white/70 mb-3 leading-relaxed max-w-xl">
              Skip the technical setup entirely. <span className="text-white">XauAi Cloud</span> hosts the trading
              engine for you — connect your broker account once, and we trade gold on your behalf, 24/7,
              from secure servers.
            </p>
            <p className="text-sm sm:text-base text-white/50 mb-6 sm:mb-8 max-w-xl">
              Your funds <span className="text-white/80">stay safely with your broker</span>. We only execute trades.
            </p>

            {/* Comparison strip */}
            <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
              <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl">
                <div className="text-[10px] font-mono tracking-widest text-white/40 mb-2">DIY (BUY PIN)</div>
                <ul className="space-y-1.5 text-sm text-white/70">
                  <li className="flex gap-2"><X className="w-4 h-4 text-white/30 mt-0.5 flex-none" /> Install MT5 yourself</li>
                  <li className="flex gap-2"><X className="w-4 h-4 text-white/30 mt-0.5 flex-none" /> Rent a VPS ($5–10/mo)</li>
                  <li className="flex gap-2"><X className="w-4 h-4 text-white/30 mt-0.5 flex-none" /> Configure the EA</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-none" /> One-time PIN, lifetime use</li>
                </ul>
              </div>
              <div className="p-4 bg-[#D4AF37]/[0.06] border border-[#D4AF37]/30 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] font-mono tracking-widest text-[#D4AF37]">XAUAI CLOUD</div>
                  <span className="text-[9px] font-mono tracking-widest text-[#D4AF37] bg-[#D4AF37]/15 px-2 py-0.5 rounded-full">EASIEST</span>
                </div>
                <ul className="space-y-1.5 text-sm text-white/85">
                  <li className="flex gap-2"><Check className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-none" /> No MT5 install</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-none" /> No VPS</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-none" /> Connect broker account once</li>
                  <li className="flex gap-2"><Check className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-none" /> 7-day free trial</li>
                </ul>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link to="/cloud" className="px-6 py-3 bg-[#D4AF37] text-black font-semibold rounded-full hover:bg-[#E5C558] transition-colors inline-flex items-center justify-center gap-2 group" data-testid="cloud-promo-cta">
                Try XauAi Cloud free
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link to="/cloud#pricing" className="px-6 py-3 border border-white/15 rounded-full hover:bg-white/5 transition-colors text-center text-white/85" data-testid="cloud-promo-pricing">
                See pricing
              </Link>
            </div>
            <div className="text-xs text-white/40 mt-3 flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5" /> No payment required to start. Pause anytime.
            </div>
          </div>

          {/* Right: visual */}
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-[#D4AF37]/20 via-transparent to-transparent blur-3xl" />
            <div className="relative bg-gradient-to-br from-white/5 to-white/[0.02] border border-[#D4AF37]/20 rounded-2xl sm:rounded-3xl p-6 sm:p-8 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-5">
                <XauAiLogo size={36} solid />
                <div>
                  <div className="font-bold text-lg leading-none">XauAi Cloud</div>
                  <div className="text-[10px] text-white/40 font-mono tracking-widest mt-1">MANAGED · 24/7</div>
                </div>
                <div className="ml-auto flex items-center gap-1.5 text-[10px] font-mono text-green-400 bg-green-400/10 px-2 py-1 rounded-full border border-green-400/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  LIVE
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { k:"YOUR BROKER", v:"Trade.com · MT5", ok:true },
                  { k:"CLOUD EXECUTOR", v:"vps-eu-1 · 14 ms", ok:true },
                  { k:"OPEN POSITIONS", v:"2 · XAUUSD", ok:true },
                  { k:"NEXT EXECUTION", v:"on next signal", ok:true },
                ].map((r,i)=>(
                  <div key={i} className="flex items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl">
                    <div className="text-[10px] sm:text-xs font-mono tracking-widest text-white/40">{r.k}</div>
                    <div className="text-sm font-mono text-white/90">{r.v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-5 border-t border-white/5 flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono text-white/40 tracking-widest">TODAY'S P&L</div>
                  <div className="text-2xl sm:text-3xl font-bold text-green-400 font-mono">+$847.32</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-mono text-white/40 tracking-widest">UPTIME</div>
                  <div className="text-2xl sm:text-3xl font-bold text-[#D4AF37] font-mono">99.9%</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
