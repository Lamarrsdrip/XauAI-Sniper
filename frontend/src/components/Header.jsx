import React, { useState } from "react";
import { TrendUp, TrendDown, Crosshair, List, X } from "@phosphor-icons/react";
import XauAiLogo from "./cloud/XauAiLogo";

const NAV = [
  { id: "how-it-works", label: "How It Works" },
  { id: "performance",  label: "Performance"   },
  { id: "purchase",     label: "Pricing"       },
];

export default function Header({ activeSection, onNavigate, goldPrice }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const quoteAvailable = goldPrice?.available === true && Number.isFinite(goldPrice?.bid);
  const up = quoteAvailable && goldPrice?.change >= 0;

  return (
    <>
      <header data-testid="main-header" className="sticky top-0 z-50 border-b border-[#e1e9e5] bg-white/95 text-[#183133] shadow-[0_1px_12px_rgba(16,45,40,0.04)] backdrop-blur-2xl">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between gap-3 px-4 md:px-8">

          <button type="button" onClick={() => { onNavigate("overview"); setMobileOpen(false); }}
            className="flex min-w-0 items-center gap-2.5" data-testid="header-brand">
            <XauAiLogo size={30} className="flex-none" />
            <span className="font-heading text-[15px] font-semibold tracking-tight">XauCloud</span>
          </button>

          <nav className="hidden items-center gap-0.5 rounded-full border border-[#dfe8e2] bg-[#f3f7f5] p-1 lg:flex">
            {NAV.map((item) => {
              const active = activeSection === item.id;
              return (
                <button key={item.id} type="button" data-testid={`nav-${item.id}`} onClick={() => onNavigate(item.id)}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${active ? "bg-[#183d3b] text-white shadow-sm" : "text-[#3c514e] hover:text-[#183d3b] hover:bg-white"}`}>
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {quoteAvailable && (
              <div className="hidden items-center gap-2 rounded-full border border-[#d8e6e0] bg-[#f7faf8] px-3 py-1.5 md:flex" data-testid="gold-ticker">
                <Crosshair size={11} className="text-[#8c661d]" weight="bold" />
                <span className="font-mono text-[13px] font-bold" data-testid="gold-bid-price">{goldPrice.bid?.toFixed(2)}</span>
                <span className={`flex items-center gap-0.5 font-mono text-[11px] font-semibold ${up ? "text-emerald-700" : "text-rose-700"}`} data-testid="gold-change">
                  {up ? <TrendUp size={10} weight="bold" /> : <TrendDown size={10} weight="bold" />}
                  {up ? "+" : ""}{goldPrice.change?.toFixed(2)}
                </span>
              </div>
            )}
            <button onClick={() => onNavigate("purchase")}
              className="rounded-full bg-[#183d3b] px-4 py-2 text-[13px] font-bold text-white transition hover:bg-[#275851] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#183d3b]">
              Buy Now
            </button>
            <a href="https://www.mql5.com/en/market/product/188838" target="_blank" rel="noopener noreferrer"
              data-testid="header-mql5-link"
              className="hidden rounded-full border border-[#d8e2dc] bg-white px-4 py-2 text-[13px] font-semibold text-[#334e4b] transition hover:text-[#102e2e] hover:bg-[#f2f7f3] sm:inline-flex items-center gap-1.5">
              MQL5 Market
            </a>
            <a href="/command"
              className="hidden rounded-full border border-[#d8e2dc] bg-white px-4 py-2 text-[13px] font-semibold text-[#334e4b] transition hover:text-[#102e2e] hover:bg-[#f2f7f3] sm:inline-flex items-center gap-1.5">
              Command
            </a>
            <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="rounded-full border border-[#cbd8d2] bg-[#f6f9f7] p-2 text-[#1b4240] lg:hidden">
              <List size={16} weight="bold" />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#fbfcfa]/98 text-[#183133] backdrop-blur-2xl lg:hidden">
          <div className="flex items-center justify-between border-b border-[#dfe8e3] px-5 pb-4 pt-safe-top">
            <span className="font-heading text-base font-semibold">Menu</span>
            <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-[#ccdcd5] bg-white text-[#24423e]">
              <X size={18} weight="bold" />
            </button>
          </div>
          <nav className="flex flex-col gap-1 p-4">
            {NAV.map((item) => (
              <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                className="rounded-2xl px-4 py-3.5 text-left text-[15px] font-medium text-[#304b48] transition hover:bg-[#eef4f0] hover:text-[#122e2b]">
                {item.label}
              </button>
            ))}
            <div className="mt-4 flex flex-col gap-2.5">
              <button onClick={() => { onNavigate("purchase"); setMobileOpen(false); }}
                className="rounded-2xl bg-[#183d3b] px-4 py-3.5 text-center text-sm font-bold text-white">
                Buy Now
              </button>
              <a href="/command" className="rounded-2xl border border-[#cbdcd4] bg-white px-4 py-3.5 text-center text-sm font-semibold text-[#304b48]">
                Command Center
              </a>
              <a href="https://www.mql5.com/en/market/product/188838" target="_blank" rel="noopener noreferrer"
                className="rounded-2xl border border-[#cbdcd4] bg-white px-4 py-3.5 text-center text-sm font-semibold text-[#304b48]">
                View on MQL5 Market
              </a>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
