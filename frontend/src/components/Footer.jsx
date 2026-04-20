import React from "react";

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#080A0F]" data-testid="footer">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-[#D4AF37] flex items-center justify-center">
              <span className="font-mono text-[8px] font-bold text-black tracking-wider">MZ</span>
            </div>
            <span className="text-sm text-white/25">XauAI Sniper v3.1</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/admin" className="text-[10px] text-white/10 hover:text-white/30 font-mono transition-colors tracking-wider" data-testid="admin-link">ADMIN</a>
            <span className="text-[10px] text-white/15">Trading involves significant risk of loss.</span>
          </div>
        </div>
        <div className="mt-8 pt-8 section-line" />
        <div className="flex items-center justify-center mt-6">
          <div className="emriz-badge inline-flex items-center gap-2 px-6 py-3" data-testid="emriz-badge">
            <span className="emriz-text font-heading text-sm font-semibold tracking-[0.25em]">made by emriz.eth</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
