import React from "react";

export default function Footer() {
  return (
    <footer className="bg-[#eef4f0] border-t border-[#dce7df] text-[#193532]" data-testid="footer">
      <div className="mx-auto max-w-7xl px-6 md:px-8 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-[#e8ddc3] flex items-center justify-center">
              <span className="font-mono text-[10px] font-bold text-[#715321]">XA</span>
            </div>
            <div>
              <span className="text-[13px] font-semibold text-[#203d38]">XauCloud</span>
              <span className="ml-2 font-mono text-[12px] text-[#546963]">Published release · M10 production</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <a href="/command" className="text-[12px] text-[#36564f] hover:text-[#163e37] font-mono transition-colors tracking-wider">COMMAND</a>
            <a href="https://www.mql5.com/en/market/product/188838" target="_blank" rel="noopener noreferrer"
              data-testid="footer-mql5-link"
              className="text-[12px] text-[#36564f] hover:text-[#163e37] font-mono transition-colors tracking-wider">MQL5 MARKET</a>
            <a href="/admin" className="text-[12px] text-[#566b63] hover:text-[#1b443d] font-mono transition-colors tracking-wider" data-testid="admin-link">ADMIN</a>
            <span className="text-[12px] text-[#4d635c]">Trading involves significant risk of loss.</span>
          </div>
        </div>

        <nav aria-label="Company, contact and legal information" className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-t border-[#d5e0d9] pt-6">
          {[["About", "/about"], ["Contact", "/contact"], ["Terms", "/terms"], ["Privacy", "/privacy"], ["Trading risks", "/risk"]].map(([label, href]) =>
            <a key={href} href={href} className="text-[12px] font-medium text-[#36564f] transition hover:text-[#74541f]">{label}</a>)}
        </nav>
        <div className="mt-5 border-t border-[#d5e0d9] pt-6 flex flex-col items-center gap-3">
          <a
            href="https://x.com/ghostcdev?s=11"
            target="_blank"
            rel="noopener noreferrer"
            className="group relative flex items-center gap-3 rounded-2xl border border-[#d9c18e] bg-gradient-to-r from-[#fffaf0] via-[#fffdf8] to-[#f7ecd2] px-5 py-3 shadow-[0_0_24px_rgba(212,175,55,0.12)] transition-all duration-300 hover:border-[#b59550] hover:shadow-[0_0_36px_rgba(212,175,55,0.22)] hover:from-[#fbebc8] hover:via-white hover:to-[#f1dfb1]"
          >
            {/* Soft inner glow */}
            <span className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.08),transparent_70%)]" />

            <svg viewBox="0 0 24 24" className="relative h-4 w-4 flex-none fill-current text-[#6b4a1b]" xmlns="http://www.w3.org/2000/svg">
              <path d="M18.901 2H22l-6.771 7.738L23.193 22h-6.237l-4.886-7.427L5.572 22H2.471l7.243-8.278L1.807 2h6.395l4.417 6.744L18.901 2Zm-1.092 18h1.716L7.268 3.895H5.427L17.809 20Z"/>
            </svg>

            <span className="relative flex flex-col">
              <span className="font-mono text-[12px] uppercase tracking-[0.25em] text-[#725525]">Built by</span>
              <span className="font-mono text-[11px] font-medium lowercase tracking-wide text-[#2c483a] group-hover:text-[#725525] transition-all duration-300">
                emriz.eth
              </span>
            </span>

            <svg viewBox="0 0 24 24" className="relative ml-1 h-3.5 w-3.5 flex-none fill-none stroke-[#725525] stroke-2 group-hover:stroke-[#2c483a] transition" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
