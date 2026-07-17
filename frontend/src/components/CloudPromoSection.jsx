import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, RadioTower, Smartphone, Terminal } from "lucide-react";
import XauAiLogo from "./cloud/XauAiLogo";

export default function CloudPromoSection() {
  return (
    <section className="relative overflow-hidden bg-[#050505] text-white" data-testid="cloud-promo-section">
      <div className="pointer-events-none absolute inset-0 opacity-60"
           style={{ background: "radial-gradient(900px 360px at 70% 30%, rgba(212,175,55,0.12), transparent 60%)" }} />
      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/20 bg-[#D4AF37]/10 px-3 py-1 font-mono text-[10px] tracking-wider text-[#D4AF37] sm:mb-6 sm:text-xs">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#D4AF37]" />
              COMMAND CENTER · PHONE MONITOR
            </div>

            <h2 className="mb-4 text-3xl font-bold leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
              Run XAU AI Sniper on your MT5. <span className="text-[#D4AF37]">Watch it from your phone.</span>
            </h2>

            <p className="mb-3 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg">
              The product is a licensed MT5 EA. You install it on your own terminal or VPS, then the Command Center shows heartbeat, status, open trades, blocks, errors, and safe remote command acknowledgements.
            </p>
            <p className="mb-6 max-w-xl text-sm text-white/50 sm:mb-8 sm:text-base">
              Your trading account stays with your broker. The dashboard is for visibility and PIN-protected control, not copy trading.
            </p>

            <div className="mb-6 grid gap-3 sm:mb-8 sm:grid-cols-2 sm:gap-4">
              {[
                ["Licensed EA", "Download, install on MT5, activate with your license key."],
                ["Remote control center", "Pause new trades, resume, close all, force sync, and track EA acknowledgements."],
                ["Live heartbeat", "See Algo Trading, MT5 connection, broker, equity, spread, and last action."],
                ["Activity intelligence", "Trades, blocks, exits, sync events, errors, and report markers in one feed."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-white/90">
                    <Check className="h-4 w-4 text-[#D4AF37]" /> {title}
                  </div>
                  <p className="text-sm leading-6 text-white/55">{body}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link to="/command" className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#D4AF37] px-6 py-3 font-semibold text-black transition-colors hover:bg-[#E5C558]" data-testid="cloud-promo-cta">
                Open Command Center
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a href="#download" className="rounded-full border border-white/15 px-6 py-3 text-center text-white/85 transition-colors hover:bg-white/5" data-testid="cloud-promo-pricing">
                Download EA
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-[#D4AF37]/20 via-transparent to-transparent blur-3xl" />
            <div className="relative rounded-2xl border border-[#D4AF37]/20 bg-gradient-to-br from-white/5 to-white/[0.02] p-6 backdrop-blur-sm sm:rounded-3xl sm:p-8">
              <div className="mb-4 rounded-lg border border-sky-300/20 bg-sky-300/[0.06] px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-sky-200">
                Illustrative preview · no live account data
              </div>
              <div className="mb-5 flex items-center gap-3">
                <XauAiLogo size={36} solid />
                <div>
                  <div className="text-lg font-bold leading-none">Command Center</div>
                  <div className="mt-1 font-mono text-[10px] tracking-widest text-white/40">MONITOR · CONTROL · REPORT</div>
                </div>
                <div className="ml-auto flex items-center gap-1.5 rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-1 font-mono text-[10px] text-sky-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-300" />
                  PREVIEW
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { icon: Terminal, k:"MT5", v:"Connection appears here" },
                  { icon: RadioTower, k:"HEARTBEAT", v:"Version and mode appear here" },
                  { icon: Smartphone, k:"PHONE", v:"PWA status appears here" },
                ].map(({ icon: Icon, k, v }) => (
                  <div key={k} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-3">
                    <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-white/40">
                      <Icon className="h-4 w-4 text-[#D4AF37]" /> {k}
                    </div>
                    <div className="text-sm font-mono text-white/90">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 border-t border-white/5 pt-5">
                <div className="font-mono text-[10px] tracking-widest text-white/40">LAST ACTION</div>
                <div className="mt-2 text-sm text-white/75">Acknowledged command results appear here.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
