import React from "react";
import { ArrowUpRight, ShieldCheck, Activity, MonitorSmartphone } from "lucide-react";

export default function HeroSection() {
  return (
    <div className="relative overflow-hidden border-b border-[#e7e4dc] bg-[#f7f6f2] text-[#162126]" data-testid="hero-section">
      <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full border border-[#cab383]/25 md:h-[34rem] md:w-[34rem]" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-9 px-5 pb-12 pt-12 md:grid-cols-[1.12fr_.88fr] md:gap-12 md:px-8 md:pb-20 md:pt-20">
        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#dcd3c0] bg-white px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6c6045]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#b18d45]"/> XAUUSD · MetaTrader 5 technology
          </div>
          <h1 className="max-w-[690px] font-heading text-[2.65rem] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-[3.7rem] lg:text-[4.35rem]" data-testid="hero-title">
            More control over <span className="text-[#9b7840]">gold trading.</span>
          </h1>
          <p className="mt-6 max-w-[535px] text-[15px] leading-[1.85] text-[#576368]">
            XauCloud brings automated XAUUSD execution, risk controls and a connected Command Center into one trading workflow. Review actual trading records before deciding.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#purchase" className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full bg-[#15282a] px-7 text-sm font-bold text-white shadow-sm transition hover:bg-[#294043]" data-testid="hero-buy-btn">Buy XauCloud <ArrowUpRight size={17}/></a>
            <a href="#purchase" className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-full border border-[#c8b68b] bg-white px-7 text-sm font-bold text-[#3a3426] transition hover:border-[#977842]">Start 3-Day Trial</a>
          </div>
          <p className="mt-6 text-[11px] leading-5 text-[#758082]">Trading involves substantial risk, including loss of capital. No performance is guaranteed.</p>
        </div>
        <div className="relative overflow-hidden rounded-[28px] border border-[#d9d6cf] bg-white p-5 shadow-[0_22px_70px_rgba(37,45,41,0.08)] sm:p-7" aria-label="Command Center feature overview">
          <div className="flex items-center justify-between border-b border-[#eeeae1] pb-5">
            <div><span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#a8894c]">XauCloud</span><h2 className="mt-1 font-heading text-xl font-semibold tracking-tight text-[#152729]">Command Center</h2></div>
            <span className="rounded-full bg-[#f4f2ec] p-3"><MonitorSmartphone className="h-5 w-5 text-[#92713d]"/></span>
          </div>
          <div className="mt-5 grid gap-3">
            <div className="flex items-center gap-4 rounded-2xl bg-[#f7f7f4] px-4 py-4"><Activity className="h-5 w-5 text-[#937340]"/><div><div className="text-sm font-bold text-[#263435]">Live bot visibility</div><div className="mt-0.5 text-xs text-[#718082]">See account telemetry and execution activity</div></div></div>
            <div className="flex items-center gap-4 rounded-2xl bg-[#f7f7f4] px-4 py-4"><ShieldCheck className="h-5 w-5 text-[#937340]"/><div><div className="text-sm font-bold text-[#263435]">Risk-aware controls</div><div className="mt-0.5 text-xs text-[#718082]">Review decisions and manage operations</div></div></div>
          </div>
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#eeeae1] pt-5">
            <span className="text-xs text-[#6b7678]">Access your real dashboard</span><a href="/command" className="inline-flex items-center gap-1 text-xs font-bold text-[#83632f] hover:underline">Open Command Center <ArrowUpRight size={13}/></a>
          </div>
          <p className="mt-3 text-[10px] text-[#8a9290]">Product overview; not a simulated balance or fabricated profit display.</p>
        </div>
      </div>
    </div>
  );
}
