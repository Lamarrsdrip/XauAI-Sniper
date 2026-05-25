import React from "react";
import { Crosshair, DownloadSimple, TrendUp, TrendDown, Cloud, List } from "@phosphor-icons/react";
import XauAiLogo from "./cloud/XauAiLogo";

const NAV = [
  { id: "overview", label: "Home" },
  { id: "broker", label: "Broker" },
  { id: "purchase", label: "Buy" },
  { id: "how-it-works", label: "System" },
  { id: "performance", label: "Results" },
  { id: "download", label: "Download" },
];

export default function Header({ activeSection, onNavigate, goldPrice }) {
  const up = goldPrice?.change >= 0;

  return (
    <header data-testid="main-header" className="sticky top-0 z-50 border-b border-white/10 bg-[#07090d]/[0.88] text-white backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 md:px-8">
        <button
          type="button"
          onClick={() => onNavigate("overview")}
          className="flex min-w-0 items-center gap-3"
          data-testid="header-brand"
        >
          <XauAiLogo size={34} className="flex-none shadow-lg shadow-amber-500/10" />
          <span className="min-w-0">
            <span className="block truncate font-heading text-base font-semibold tracking-tight">XauAI Sniper</span>
            <span className="block truncate font-mono text-[9px] uppercase tracking-[0.24em] text-amber-200/55">Master v5.8.32</span>
          </span>
        </button>

        <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 lg:flex">
          {NAV.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`nav-${item.id}`}
                onClick={() => onNavigate(item.id)}
                className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                  active ? "bg-white text-[#090b10]" : "text-white/60 hover:bg-white/[0.08] hover:text-white"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {goldPrice && (
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-2 md:flex" data-testid="gold-ticker">
              <Crosshair size={14} className="text-amber-300" weight="bold" />
              <span className="font-mono text-xs font-bold" data-testid="gold-bid-price">{goldPrice.bid?.toFixed(2)}</span>
              <span className={`flex items-center gap-1 font-mono text-[11px] font-bold ${up ? "text-emerald-300" : "text-red-300"}`} data-testid="gold-change">
                {up ? <TrendUp size={12} weight="bold" /> : <TrendDown size={12} weight="bold" />}
                {up ? "+" : ""}{goldPrice.change?.toFixed(2)}
              </span>
            </div>
          )}
          <a href="/cloud" data-testid="nav-cloud-link" className="inline-flex items-center gap-1.5 rounded-full bg-emerald-300 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-[#06110c] transition hover:bg-emerald-200">
            <Cloud size={14} weight="fill" /> Cloud
          </a>
          <button onClick={() => onNavigate("download")} className="hidden rounded-full bg-amber-300 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wider text-black transition hover:bg-amber-200 sm:inline-flex">
            <DownloadSimple size={14} weight="bold" /> EA
          </button>
          <button aria-label="Open menu" className="rounded-full border border-white/10 p-2 text-white/70 lg:hidden">
            <List size={18} weight="bold" />
          </button>
        </div>
      </div>
    </header>
  );
}
