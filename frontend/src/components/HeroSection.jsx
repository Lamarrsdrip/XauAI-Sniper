import React from "react";
import { ArrowUpRight, PlayCircle } from "lucide-react";

export default function HeroSection() {
  return (
    <div className="relative overflow-hidden border-b border-[#e3e9e2] bg-[radial-gradient(ellipse_at_92%_12%,#e5f3ed_0%,#fcfdfb_54%,#ffffff_100%)] text-[#162e2f]" data-testid="hero-section">
      <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full border border-[#cab383]/25 md:h-[34rem] md:w-[34rem]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-9 px-5 pb-12 pt-12 md:grid-cols-[1.12fr_.88fr] md:gap-12 md:px-8 md:pb-20 md:pt-20">
        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#dcd3c0] bg-white px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#654c21]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#b18d45]"/> XAUUSD · MetaTrader 5 technology
          </div>
          <h1 className="max-w-[690px] font-heading text-[2.65rem] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-[3.7rem] lg:text-[4.35rem]" data-testid="hero-title">
            More control over <span className="text-[#9b7840]">gold trading.</span>
          </h1>
          <p className="mt-6 max-w-[535px] text-[15px] leading-[1.85] text-[#425956]">
            XauCloud brings automated XAUUSD execution, risk controls and a connected Command Center into one trading workflow. Review actual trading records before deciding.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#purchase" className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full bg-[#15282a] px-7 text-sm font-bold text-white shadow-sm transition hover:bg-[#294043]" data-testid="hero-buy-btn">Buy XauCloud <ArrowUpRight size={17}/></a>
            <a href="#purchase" className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full border border-[#c8b68b] bg-white px-7 text-sm font-bold text-[#3a3426] transition hover:border-[#977842]">Start 3-Day Trial</a>
          </div>
          <p className="mt-6 text-[11px] leading-5 text-[#51625e]">Trading involves substantial risk, including loss of capital. No performance is guaranteed.</p>
        </div>
        <div className="relative overflow-hidden rounded-[28px] border border-[#deded4] bg-white px-4 pb-5 pt-5 shadow-[0_22px_70px_rgba(37,45,41,0.08)] sm:px-6 sm:pt-6" data-testid="hero-video-card">
          <div className="flex items-start justify-between gap-3 border-b border-[#ecebe3] pb-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#795719]">XauCloud in action</span>
              <h2 className="mt-1 font-heading text-[19px] font-semibold tracking-tight text-[#15352e]">See how it works</h2>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f4eee0] text-[#8b6829]"><PlayCircle size={21}/></span>
          </div>
          <div className="mx-auto mt-5 w-full max-w-[255px] overflow-hidden rounded-[22px] border border-[#e4e8e2] bg-[#0b1916] shadow-[0_14px_34px_rgba(14,33,27,.18)]">
            <div className="relative aspect-[9/16]">
              <iframe
                title="XauCloud product demonstration — play directly on this page"
                src="https://www.youtube-nocookie.com/embed/guOB0N2y-N0?playsinline=1&rel=0"
                className="absolute inset-0 h-full w-full border-0"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
          <div className="mt-4 text-center">
            <p className="text-[12px] leading-5 text-[#4e625a]">Tap play to watch the XauCloud walkthrough here.</p>
            <a href="https://youtube.com/shorts/guOB0N2y-N0" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#78581e] hover:underline">Watch on YouTube if playback is unavailable <ArrowUpRight size={13}/></a>
          </div>
        </div>
      </div>
    </div>
  );
}
