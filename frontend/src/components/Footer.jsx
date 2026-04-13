import React from "react";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-[hsl(0,0%,4%)] text-white" data-testid="footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-[hsl(43,74%,49%)] flex items-center justify-center">
              <span className="font-mono text-[9px] font-bold text-black">MZ</span>
            </div>
            <span className="text-sm font-medium text-white/60">
              XauAI Sniper v2.0 — XAUUSD Trading System
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/admin" className="text-xs text-white/20 hover:text-white/40 font-mono transition-colors" data-testid="admin-link">
              Admin
            </a>
            <span className="text-xs text-white/30">
              Risk Disclosure: Trading involves significant risk of loss.
            </span>
          </div>
        </div>
        <div className="mt-6 pt-6 border-t border-white/10 flex items-center justify-center">
          <div className="emriz-badge inline-flex items-center gap-2 px-5 py-2.5" data-testid="emriz-badge">
            <span className="emriz-text font-heading text-sm font-bold tracking-[0.2em]">
              made by emriz.eth
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
