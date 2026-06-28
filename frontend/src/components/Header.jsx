import React, { useState } from "react";
import { Crosshair, DownloadSimple, TrendUp, TrendDown, Cloud, List, X } from "@phosphor-icons/react";
import XauAiLogo from "./cloud/XauAiLogo";

const NAV = [
  { id: "overview",    label: "Home"       },
  { id: "broker",      label: "Broker"     },
  { id: "purchase",    label: "Buy"        },
  { id: "how-it-works",label: "System"     },
  { id: "performance", label: "Results"    },
  { id: "download",    label: "Download"   },
];

export default function Header({ activeSection, onNavigate, goldPrice }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const up = goldPrice?.change >= 0;

  return (
    <>
      <header data-testid="main-header" className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#060609]/90 text-white backdrop-blur-2xl">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between gap-3 px-4 md:px-8">

          {/* Brand */}
          <button type="button" onClick={() => { onNavigate("overview"); setMobileOpen(false); }} className="flex min-w-0 items-center gap-2.5" data-testid="header-brand">
            <XauAiLogo size={32} className="flex-none shadow-lg shadow-amber-500/10" />
            <span className="min-w-0">
              <span className="block truncate font-heading text-[15px] font-semibold tracking-tight">XauAI Sniper</span>
              <span className="block truncate font-mono text-[9px] uppercase tracking-[0.22em] text-amber-200/50">v6.3.6 · AI Director</span>
            </span>
          </button>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 lg:flex">
            {NAV.map((item) => {
              const active = activeSection === item.id;
              return (
                <button key={item.id} type="button" data-testid={`nav-${item.id}`} onClick={() => onNavigate(item.id)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${active ? "bg-white text-[#060609]" : "text-white/55 hover:text-white hover:bg-white/[0.06]"}`}>
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {goldPrice && (
              <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-black/30 px-3 py-1.5 md:flex" data-testid="gold-ticker">
                <Crosshair size={12} className="text-amber-300" weight="bold" />
                <span className="font-mono text-[12px] font-bold" data-testid="gold-bid-price">{goldPrice.bid?.toFixed(2)}</span>
                <span className={`flex items-center gap-0.5 font-mono text-[11px] font-semibold ${up ? "text-emerald-400" : "text-red-400"}`} data-testid="gold-change">
                  {up ? <TrendUp size={11} weight="bold" /> : <TrendDown size={11} weight="bold" />}
                  {up ? "+" : ""}{goldPrice.change?.toFixed(2)}
                </span>
              </div>
            )}
            <a href="/command" data-testid="nav-cloud-link"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-3 py-1.5 text-[12px] font-bold text-black transition hover:bg-emerald-300">
              <Cloud size={13} weight="fill" /> Command
            </a>
            <button onClick={() => onNavigate("download")}
              className="hidden rounded-full bg-amber-300 px-3 py-1.5 text-[12px] font-bold text-black transition hover:bg-amber-200 sm:inline-flex items-center gap-1">
              <DownloadSimple size={13} weight="bold" /> EA
            </button>
            <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="rounded-full border border-white/[0.08] p-2 text-white/60 lg:hidden">
              <List size={16} weight="bold" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#060609]/98 text-white backdrop-blur-2xl lg:hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
            <span className="font-heading text-base font-semibold">Navigation</span>
            <button onClick={() => setMobileOpen(false)} className="rounded-full border border-white/[0.08] p-2 text-white/60">
              <X size={16} weight="bold" />
            </button>
          </div>
          <nav className="flex flex-col gap-1 p-4">
            {NAV.map((item) => (
              <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                className="rounded-2xl px-4 py-3.5 text-left text-[15px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white transition">
                {item.label}
              </button>
            ))}
            <div className="mt-4 flex flex-col gap-2">
              <a href="/command" className="rounded-2xl bg-emerald-400 px-4 py-3.5 text-center text-sm font-bold text-black">Open Command Center</a>
              <button onClick={() => { onNavigate("download"); setMobileOpen(false); }} className="rounded-2xl bg-amber-300 px-4 py-3.5 text-sm font-bold text-black">Download EA v6.3.6</button>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
