import React from "react";

export default function Footer() {
  return (
    <footer className="bg-[#111] border-t border-gray-200" data-testid="footer">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-white/10 rounded-full flex items-center justify-center">
              <span className="font-mono text-[8px] font-bold text-white tracking-wider">MZ</span>
            </div>
            <span className="text-sm text-white/40">XauAI Sniper v4.5.9</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/admin" className="text-[10px] text-white/20 hover:text-white/50 font-mono transition-colors tracking-wider" data-testid="admin-link">ADMIN</a>
            <span className="text-[10px] text-white/20">Trading involves significant risk of loss.</span>
          </div>
        </div>
        <div className="section-line mt-8 mb-6" style={{background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)'}} />
        <div className="flex items-center justify-center">
          <div className="emriz-badge inline-flex items-center gap-2 px-6 py-3 rounded-full" data-testid="emriz-badge">
            <span className="emriz-text font-mono text-sm font-semibold tracking-[0.2em]">made by emriz.eth</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
