import React, { useState } from "react";
import { TrendUp, TrendDown, Crosshair, List, X } from "@phosphor-icons/react";
import XauAiLogo from "./cloud/XauAiLogo";

const NAV = [
  { id: "overview",    label: "Home"        },
  { id: "performance", label: "Performance" },
  { id: "purchase",    label: "Pricing"     },
  { id: "faq",         label: "FAQ"         },
];

export default function Header({ activeSection, onNavigate, goldPrice }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const quoteAvailable = goldPrice?.available === true && Number.isFinite(goldPrice?.bid);
  const up = quoteAvailable && goldPrice?.change >= 0;

  return (
    <>
      <header data-testid="main-header" className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#060609]/92 text-white backdrop-blur-2xl">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between gap-3 px-4 md:px-8">

          <button type="button" onClick={() => { onNavigate("overview"); setMobileOpen(false); }}
            className="flex min-w-0 items-center gap-2.5" data-testid="header-brand">
            <XauAiLogo size={30} className="flex-none" />
            <span className="font-heading text-[15px] font-semibold tracking-tight">XauCloud</span>
          </button>

          <nav className="hidden items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] p-1 lg:flex">
            {NAV.map((item) => {
              const active = activeSection === item.id;
              return (
                <button key={item.id} type="button" data-testid={`nav-${item.id}`} onClick={() => onNavigate(item.id)}
                  className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-all ${active ? "bg-white text-[#060609]" : "text-white/50 hover:text-white hover:bg-white/[0.06]"}`}>
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {quoteAvailable && (
              <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-black/30 px-3 py-1.5 md:flex" data-testid="gold-ticker">
                <Crosshair size={11} className="text-amber-300" weight="bold" />
                <span className="font-mono text-[12px] font-bold" data-testid="gold-bid-price">{goldPrice.bid?.toFixed(2)}</span>
                <span className={`flex items-center gap-0.5 font-mono text-[11px] font-semibold ${up ? "text-emerald-400" : "text-red-400"}`} data-testid="gold-change">
                  {up ? <TrendUp size={10} weight="bold" /> : <TrendDown size={10} weight="bold" />}
                  {up ? "+" : ""}{goldPrice.change?.toFixed(2)}
                </span>
              </div>
            )}
            <button onClick={() => onNavigate("purchase")}
              className="rounded-full bg-amber-300 px-4 py-1.5 text-[12px] font-bold text-black transition hover:bg-amber-200">
              Buy Now
            </button>
            <a href="/command"
              className="hidden rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-1.5 text-[12px] font-semibold text-white/70 transition hover:text-white hover:bg-white/[0.08] sm:inline-flex items-center gap-1.5">
              Command
            </a>
            <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="rounded-full border border-white/[0.08] p-2 text-white/60 lg:hidden">
              <List size={16} weight="bold" />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#060609]/98 text-white backdrop-blur-2xl lg:hidden">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
            <span className="font-heading text-base font-semibold">Menu</span>
            <button onClick={() => setMobileOpen(false)} className="rounded-full border border-white/[0.08] p-2 text-white/60">
              <X size={16} weight="bold" />
            </button>
          </div>
          <nav className="flex flex-col gap-1 p-4">
            {NAV.map((item) => (
              <button key={item.id} onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                className="rounded-2xl px-4 py-3.5 text-left text-[15px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white">
                {item.label}
              </button>
            ))}
            <div className="mt-4 flex flex-col gap-2.5">
              <button onClick={() => { onNavigate("purchase"); setMobileOpen(false); }}
                className="rounded-2xl bg-amber-300 px-4 py-3.5 text-center text-sm font-bold text-black">
                Buy Now
              </button>
              <a href="/command" className="rounded-2xl border border-white/[0.1] bg-white/[0.04] px-4 py-3.5 text-center text-sm font-semibold text-white/70">
                Command Center
              </a>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
