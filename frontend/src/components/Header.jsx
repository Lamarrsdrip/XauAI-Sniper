import React from "react";
import { Crosshair, ChartLine, DownloadSimple, Question, TrendUp, TrendDown, ShoppingCart, Wrench, Handshake } from "@phosphor-icons/react";

const NAV = [
  { id: "overview", label: "HOME", icon: Crosshair },
  { id: "broker", label: "BROKER", icon: Handshake },
  { id: "purchase", label: "BUY", icon: ShoppingCart },
  { id: "how-it-works", label: "SYSTEM", icon: Question },
  { id: "performance", label: "RESULTS", icon: ChartLine },
  { id: "setup-guide", label: "SETUP", icon: Wrench },
  { id: "download", label: "DOWNLOAD", icon: DownloadSimple },
];

export default function Header({ activeSection, onNavigate, goldPrice }) {
  const up = goldPrice?.change >= 0;
  return (
    <header data-testid="main-header" className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 cursor-pointer group" onClick={() => onNavigate("overview")}>
            <div className="w-8 h-8 bg-[#111] rounded-full flex items-center justify-center">
              <span className="font-mono text-[9px] font-bold text-white tracking-wider">MZ</span>
            </div>
            <span className="font-heading font-semibold text-sm tracking-tight text-[#111] group-hover:text-[#C5A059] transition-colors">XauAI Sniper</span>
            <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded-full">v4.5.5</span>
          </div>

          <nav className="hidden lg:flex items-center gap-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              return (
                <button key={item.id} data-testid={`nav-${item.id}`} onClick={() => onNavigate(item.id)}
                  className={`px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] rounded-full transition-all flex items-center gap-1.5 ${
                    active ? "bg-[#111] text-white" : "text-gray-500 hover:text-[#111] hover:bg-gray-100"
                  }`}>
                  <Icon size={13} weight={active ? "fill" : "regular"} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-4">
            {goldPrice && (
              <div className="hidden sm:flex items-center gap-3 bg-[#111] text-white px-4 py-2 rounded-full" data-testid="gold-ticker">
                <span className="text-[10px] font-bold tracking-[0.12em] text-gray-400">XAUUSD</span>
                <span className="font-mono text-sm font-bold" data-testid="gold-bid-price">{goldPrice.bid?.toFixed(2)}</span>
                <div className={`flex items-center gap-0.5 ${up ? "text-emerald-400" : "text-red-400"}`}>
                  {up ? <TrendUp size={12} weight="bold" /> : <TrendDown size={12} weight="bold" />}
                  <span className="font-mono text-[11px] font-bold" data-testid="gold-change">{up ? "+" : ""}{goldPrice.change?.toFixed(2)}</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" />
              <span className="text-[10px] font-mono text-gray-400 tracking-wider">LIVE</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
