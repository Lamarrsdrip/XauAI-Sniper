import React from "react";

export default function Footer() {
  return (
    <footer className="bg-[#060609] border-t border-white/[0.06]" data-testid="footer">
      <div className="mx-auto max-w-7xl px-6 md:px-8 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-amber-300/15 flex items-center justify-center">
              <span className="font-mono text-[8px] font-bold text-amber-200">XA</span>
            </div>
            <div>
              <span className="text-[13px] font-semibold text-white/70">XauAI Sniper</span>
              <span className="ml-2 font-mono text-[10px] text-white/28">v6.3.6 · AI Director</span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <a href="/command" className="text-[11px] text-white/35 hover:text-white/70 font-mono transition-colors tracking-wider">COMMAND</a>
            <a href="/admin" className="text-[11px] text-white/20 hover:text-white/45 font-mono transition-colors tracking-wider" data-testid="admin-link">ADMIN</a>
            <span className="text-[11px] text-white/20">Trading involves significant risk of loss.</span>
          </div>
        </div>

        <div className="mt-6 border-t border-white/[0.05] pt-5 flex items-center justify-center">
          <span className="font-mono text-[11px] tracking-[0.25em] text-white/22">made by emriz.eth</span>
        </div>
      </div>
    </footer>
  );
}
