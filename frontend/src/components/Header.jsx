import React from "react";
import {
  Crosshair,
  ChartLine,
  GearSix,
  DownloadSimple,
  BookOpen,
  CpuIcon,
  Key,
  Question,
  TrendUp,
  TrendDown,
} from "@phosphor-icons/react";

const NAV_ITEMS = [
  { id: "overview", label: "OVERVIEW", icon: Crosshair },
  { id: "how-it-works", label: "HOW IT WORKS", icon: Question },
  { id: "architecture", label: "SYSTEM", icon: CpuIcon },
  { id: "performance", label: "PERFORMANCE", icon: ChartLine },
  { id: "configurator", label: "CONFIGURE", icon: GearSix },
  { id: "pins", label: "LICENSES", icon: Key },
  { id: "download", label: "DOWNLOAD", icon: DownloadSimple },
  { id: "installation", label: "INSTALL", icon: BookOpen },
];

export default function Header({ activeSection, onNavigate, goldPrice }) {
  const priceUp = goldPrice?.change >= 0;

  return (
    <header data-testid="main-header" className="sticky top-0 z-50 bg-background border-b border-border">
      <div className="max-w-7xl mx-auto px-4 md:px-8 lg:px-12">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-7 h-7 bg-primary flex items-center justify-center">
              <span className="font-mono text-xs font-bold text-primary-foreground">AU</span>
            </div>
            <div>
              <span className="font-heading font-bold text-sm tracking-tight text-foreground">AI SNIPER</span>
              <span className="text-xs text-muted-foreground ml-2 font-mono">v2.0</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  data-testid={`nav-${item.id}`}
                  onClick={() => onNavigate(item.id)}
                  className={`px-2.5 py-2 text-[10px] font-medium tracking-[0.08em] transition-colors duration-150 flex items-center gap-1 border-b-2 ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={12} weight={isActive ? "fill" : "regular"} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Gold Price Ticker + Status */}
          <div className="flex items-center gap-4">
            {goldPrice && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 border border-border bg-card" data-testid="gold-ticker">
                <span className="text-[10px] font-bold tracking-[0.1em] text-muted-foreground">XAUUSD</span>
                <span className="font-mono text-sm font-bold text-foreground" data-testid="gold-bid-price">
                  {goldPrice.bid?.toFixed(2)}
                </span>
                <div className={`flex items-center gap-0.5 ${priceUp ? "text-[hsl(142,71%,45%)]" : "text-[hsl(348,83%,47%)]"}`}>
                  {priceUp ? <TrendUp size={12} weight="bold" /> : <TrendDown size={12} weight="bold" />}
                  <span className="font-mono text-xs font-bold" data-testid="gold-change">
                    {priceUp ? "+" : ""}{goldPrice.change?.toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[hsl(142,71%,45%)] pulse-dot" />
              <span className="text-xs font-mono text-muted-foreground">LIVE</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
