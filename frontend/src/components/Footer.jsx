import React from "react";

export default function Footer() {
  return (
    <footer
      className="border-t border-border bg-background"
      data-testid="footer"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-primary flex items-center justify-center">
              <span className="font-mono text-[9px] font-bold text-primary-foreground">
                AU
              </span>
            </div>
            <span className="text-sm font-medium text-muted-foreground">
              AI Sniper EA v2.0 — Professional XAUUSD Trading System
            </span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-xs text-muted-foreground font-mono">
              MQL5 / MT5
            </span>
            <span className="text-xs text-muted-foreground">
              Risk Disclosure: Trading involves significant risk of loss.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
