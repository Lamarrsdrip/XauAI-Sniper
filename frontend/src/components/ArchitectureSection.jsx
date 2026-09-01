import React, { useState } from "react";
import { Cpu, ArrowsClockwise, TrendUp, ShieldCheck, Crosshair, ChartBar } from "@phosphor-icons/react";

const MODULE_ICONS = {
  "Market Analysis Engine": TrendUp,
  "AI Adaptive Decision Engine": Cpu,
  "Strategy Engine": Crosshair,
  "Risk Management System": ShieldCheck,
  "Trade Execution Engine": ArrowsClockwise,
  "Performance Tracking": ChartBar,
};

export default function ArchitectureSection({ data }) {
  const [activeModule, setActiveModule] = useState(0);

  if (!data) return null;

  const currentModule = data.modules[activeModule];
  const Icon = MODULE_ICONS[currentModule.name] || Cpu;

  return (
    <div className="bg-background border-t border-border" data-testid="architecture-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-4">
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
              SYSTEM ARCHITECTURE
            </span>
          </div>
          <h2
            className="font-heading text-2xl sm:text-3xl font-bold tracking-tight"
            data-testid="architecture-title"
          >
            Six-Module Trading Engine
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Modular architecture designed for adaptability and robustness across
            all market conditions.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Module selector */}
          <div className="lg:col-span-4">
            <div className="border border-border divide-y divide-border">
              {data.modules.map((mod, i) => {
                const ModIcon = MODULE_ICONS[mod.name] || Cpu;
                const isActive = i === activeModule;
                return (
                  <button
                    key={mod.name}
                    data-testid={`module-btn-${i}`}
                    onClick={() => setActiveModule(i)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors duration-150 ${
                      isActive
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-muted border-l-2 border-l-transparent"
                    }`}
                  >
                    <ModIcon
                      size={18}
                      weight={isActive ? "fill" : "regular"}
                      className={isActive ? "text-primary" : "text-muted-foreground"}
                    />
                    <span
                      className={`text-sm font-medium ${
                        isActive ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {mod.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Module detail */}
          <div className="lg:col-span-8">
            <div className="border border-border p-6" data-testid="module-detail">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-10 h-10 bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={20} weight="fill" className="text-primary" />
                </div>
                <div>
                  <h3 className="font-heading text-xl font-semibold tracking-tight">
                    {currentModule.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {currentModule.description}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {currentModule.components.map((comp, i) => (
                  <div
                    key={comp}
                    className="flex items-center gap-3 px-4 py-3 bg-muted/50 border border-border"
                    data-testid={`component-${i}`}
                  >
                    <div className="w-5 h-5 border border-primary/40 flex items-center justify-center flex-shrink-0">
                      <span className="font-mono text-[10px] font-bold text-primary">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <span className="text-sm font-medium">{comp}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Architecture image */}
            <div className="border border-border mt-4 overflow-hidden">
              <img
                src="https://static.prod-images.emergentagent.com/jobs/a0d76eb0-1956-4da1-ad00-cd40d1b3f75f/images/808f94dadb0b008e2dd42ec3026977b7f488b77ccf61fd454e1eeb22466e72c0.png"
                alt="System Architecture"
                className="w-full h-48 object-cover"
                data-testid="architecture-image"
              />
            </div>

            {/* Smart Filters */}
            {data.filters && (
              <div className="mt-4">
                <h4 className="text-sm font-bold tracking-[0.1em] text-muted-foreground mb-3">
                  SMART FILTERS
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {data.filters.map((f) => (
                    <div
                      key={f.name}
                      className="px-3 py-2 border border-border bg-card"
                      data-testid={`filter-${f.name.toLowerCase().replace(/\s/g, "-")}`}
                    >
                      <div className="text-xs font-bold tracking-[0.1em] text-primary mb-1">
                        {f.name.toUpperCase()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {f.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
