import React from "react";

export default function Footer() {
  return (
    <footer className="bg-[#07080B] border-t border-white/[0.06]" data-testid="footer">
      <div className="mx-auto max-w-7xl px-6 md:px-8 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-gold-300/15 flex items-center justify-center">
              <span className="font-mono text-[8px] font-bold text-gold-200">XA</span>
            </div>
            <div>
              <span className="text-[13px] font-semibold text-white/70">XauCloud</span>
              <span className="ml-2 font-mono text-[10px] text-white/28">Published release · M10 production</span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <a href="/command" className="text-[11px] text-white/35 hover:text-white/70 font-mono transition-colors tracking-wider">COMMAND</a>
            <a href="https://www.mql5.com/en/market/product/188838" target="_blank" rel="noopener noreferrer"
              data-testid="footer-mql5-link"
              className="text-[11px] text-white/35 hover:text-white/70 font-mono transition-colors tracking-wider">MQL5 MARKET</a>
            <a href="/admin" className="text-[11px] text-white/20 hover:text-white/45 font-mono transition-colors tracking-wider" data-testid="admin-link">ADMIN</a>
            <span className="text-[11px] text-white/20">Trading involves significant risk of loss.</span>
          </div>
        </div>

        <div className="mt-6 border-t border-white/[0.05] pt-6 flex flex-col items-center gap-3">
          <a
            href="https://x.com/ghostcdev?s=11"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex items-center gap-3 rounded-2xl border border-gold-300/30 bg-gradient-to-r from-gold-300/[0.10] via-gold-200/[0.06] to-gold-300/[0.10] px-5 py-3 shadow-[0_0_24px_rgba(212,175,55,0.12)] transition-all duration-300 hover:border-gold-300/55 hover:shadow-[0_0_36px_rgba(212,175,55,0.22)] hover:from-gold-300/[0.16] hover:via-gold-200/[0.10] hover:to-gold-300/[0.16]"
          >
            {/* Soft inner glow */}
            <span className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.08),transparent_70%)]" />

            <svg viewBox="0 0 24 24" className="relative h-4 w-4 flex-none fill-current text-gold-300 drop-shadow-[0_0_6px_rgba(212,175,55,0.6)]" xmlns="http://www.w3.org/2000/svg">
              <path d="M18.901 2H22l-6.771 7.738L23.193 22h-6.237l-4.886-7.427L5.572 22H2.471l7.243-8.278L1.807 2h6.395l4.417 6.744L18.901 2Zm-1.092 18h1.716L7.268 3.895H5.427L17.809 20Z"/>
            </svg>

            <span className="relative flex flex-col">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold-300/60">Built by</span>
              <span className="bg-gradient-to-r from-gold-200 via-yellow-100 to-gold-300 bg-clip-text text-[15px] font-black tracking-tight text-transparent drop-shadow-[0_0_8px_rgba(212,175,55,0.4)] group-hover:from-white group-hover:via-gold-100 group-hover:to-gold-200 transition-all duration-300">
                Emriz
              </span>
            </span>

            <svg viewBox="0 0 24 24" className="relative ml-1 h-3.5 w-3.5 flex-none fill-none stroke-gold-300/50 stroke-2 group-hover:stroke-gold-300 transition" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
