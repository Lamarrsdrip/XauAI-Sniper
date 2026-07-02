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
              <span className="ml-2 font-mono text-[10px] text-white/28">v6.7.0 · Let Trades Breathe</span>
            </div>
          </div>

          <div className="flex items-center gap-5">
            <a href="/command" className="text-[11px] text-white/35 hover:text-white/70 font-mono transition-colors tracking-wider">COMMAND</a>
            <a href="/admin" className="text-[11px] text-white/20 hover:text-white/45 font-mono transition-colors tracking-wider" data-testid="admin-link">ADMIN</a>
            <span className="text-[11px] text-white/20">Trading involves significant risk of loss.</span>
          </div>
        </div>

        <div className="mt-6 border-t border-white/[0.05] pt-6 flex flex-col items-center gap-3">
          <a
            href="https://www.instagram.com/emriz.eth?igsh=MW43N25nMW94NGtqdQ%3D%3D&utm_source=qr"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-gradient-to-r from-amber-300/[0.10] via-amber-200/[0.06] to-amber-300/[0.10] px-5 py-3 shadow-[0_0_24px_rgba(212,175,55,0.12)] transition-all duration-300 hover:border-amber-300/55 hover:shadow-[0_0_36px_rgba(212,175,55,0.22)] hover:from-amber-300/[0.16] hover:via-amber-200/[0.10] hover:to-amber-300/[0.16]"
          >
            {/* Soft inner glow */}
            <span className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.08),transparent_70%)]" />

            <svg viewBox="0 0 24 24" className="relative h-4 w-4 flex-none fill-current text-amber-300 drop-shadow-[0_0_6px_rgba(212,175,55,0.6)]" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>

            <span className="relative flex flex-col">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-300/60">designed &amp; built by</span>
              <span className="bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 bg-clip-text text-[15px] font-black tracking-tight text-transparent drop-shadow-[0_0_8px_rgba(212,175,55,0.4)] group-hover:from-white group-hover:via-amber-100 group-hover:to-amber-200 transition-all duration-300">
                emriz.eth
              </span>
            </span>

            <svg viewBox="0 0 24 24" className="relative ml-1 h-3.5 w-3.5 flex-none fill-none stroke-amber-300/50 stroke-2 group-hover:stroke-amber-300 transition" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
