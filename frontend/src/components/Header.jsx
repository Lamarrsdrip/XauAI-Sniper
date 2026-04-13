import React from "react";
import {
  Crosshair,
  ChartLine,
  GearSix,
  DownloadSimple,
  BookOpen,
  CpuIcon,
} from "@phosphor-icons/react";

const NAV_ITEMS = [
  { id: "overview", label: "OVERVIEW", icon: Crosshair },
  { id: "architecture", label: "SYSTEM", icon: CpuIcon },
  { id: "performance", label: "PERFORMANCE", icon: ChartLine },
  { id: "configurator", label: "CONFIGURE", icon: GearSix },
  { id: "download", label: "DOWNLOAD", icon: DownloadSimple },
  { id: "installation", label: "INSTALL", icon: BookOpen },
];

export default function Header({ activeSection, onNavigate }) {
  return (
    <header
      data-testid="main-header"
      className="sticky top-0 z-50 bg-background border-b border-border"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-7 h-7 bg-primary flex items-center justify-center">
              <span className="font-mono text-xs font-bold text-primary-foreground">
                AU
              </span>
            </div>
            <div>
              <span className="font-heading font-bold text-sm tracking-tight text-foreground">
                AI SNIPER
              </span>
              <span className="text-xs text-muted-foreground ml-2 font-mono">
                v2.0
              </span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  data-testid={`nav-${item.id}`}
                  onClick={() => onNavigate(item.id)}
                  className={`px-3 py-2 text-xs font-medium tracking-[0.1em] transition-colors duration-150 flex items-center gap-1.5 border-b-2 ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon size={14} weight={isActive ? "fill" : "regular"} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Status */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[hsl(142,71%,45%)] pulse-dot" />
              <span className="text-xs font-mono text-muted-foreground">
                READY
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
