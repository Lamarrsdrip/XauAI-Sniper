import React from "react";
import {
  Crosshair, ChartLine, DownloadSimple, Question, TrendUp, TrendDown,
  ShoppingCart, Wrench, Handshake,
} from "@phosphor-icons/react";

const NAV_ITEMS = [
  { id: "overview", label: "HOME", icon: Crosshair },
  { id: "broker", label: "BROKER", icon: Handshake },
  { id: "purchase", label: "BUY", icon: ShoppingCart },
  { id: "how-it-works", label: "SYSTEM", icon: Question },
  { id: "performance", label: "RESULTS", icon: ChartLine },
  { id: "setup-guide", label: "SETUP", icon: Wrench },
  { id: "download", label: "DOWNLOAD", icon: DownloadSimple },
];

export default function Header({ activeSection, onNavigate, goldPrice }) {
  const priceUp = goldPrice?.change >= 0;

  return (
    <header data-testid="main-header" className="sticky top-0 z-50 bg-[#050505]/80 backdrop-blur-xl border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 lg:px-12">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 flex-shrink-0 cursor-pointer group" onClick={() => onNavigate("overview")}>
            <div className="w-8 h-8 bg-[#D4AF37] flex items-center justify-center">
              <span className="font-mono text-[10px] font-bold text-black tracking-wider">MZ</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-heading font-semibold text-sm tracking-tight text-white group-hover:text-[#D4AF37] transition-colors">XauAI Sniper</span>
              <span className="text-[10px] text-white/30 font-mono border border-white/10 px-1.5 py-0.5">v3.1</span>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-0">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              const isBuy = item.id === "purchase";
              return (
                <button key={item.id} data-testid={`nav-${item.id}`} onClick={() => onNavigate(item.id)}
                  className={`relative px-3 py-2 text-[10px] font-medium tracking-[0.12em] transition-all duration-200 flex items-center gap-1.5 ${
                    isBuy ? "text-[#D4AF37] font-bold" : isActive ? "text-white" : "text-white/40 hover:text-white/70"
                  }`}>
                  <Icon size={12} weight={isActive || isBuy ? "fill" : "regular"} />
                  {item.label}
                  {isActive && <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-[#D4AF37]" />}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-4">
            {goldPrice && (
              <div className="hidden sm:flex items-center gap-3 px-4 py-2 border border-white/[0.06] bg-white/[0.02]" data-testid="gold-ticker">
                <span className="text-[10px] font-bold tracking-[0.15em] text-white/30">XAUUSD</span>
                <span className="font-mono text-sm font-bold text-white" data-testid="gold-bid-price">{goldPrice.bid?.toFixed(2)}</span>
                <div className={`flex items-center gap-0.5 ${priceUp ? "text-[#00C853]" : "text-[#FF3D00]"}`}>
                  {priceUp ? <TrendUp size={12} weight="bold" /> : <TrendDown size={12} weight="bold" />}
                  <span className="font-mono text-[11px] font-bold" data-testid="gold-change">{priceUp ? "+" : ""}{goldPrice.change?.toFixed(2)}</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00C853] pulse-dot" />
              <span className="text-[10px] font-mono text-white/40 tracking-wider">LIVE</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
