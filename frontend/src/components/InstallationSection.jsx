import React from "react";
import { CheckCircle, Warning, NumberCircleOne, NumberCircleTwo, NumberCircleThree, NumberCircleFour, NumberCircleFive, NumberCircleSix, NumberCircleSeven, NumberCircleEight } from "@phosphor-icons/react";

const STEP_ICONS = [
  NumberCircleOne, NumberCircleTwo, NumberCircleThree, NumberCircleFour,
  NumberCircleFive, NumberCircleSix, NumberCircleSeven, NumberCircleEight,
];

export default function InstallationSection({ data }) {
  if (!data) return null;

  return (
    <div className="bg-background border-t border-border" data-testid="installation-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-4">
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
              INSTALLATION GUIDE
            </span>
          </div>
          <h2
            className="font-heading text-2xl sm:text-3xl font-bold tracking-tight"
            data-testid="installation-title"
          >
            Setup Instructions
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Follow these steps to install and configure the AI Sniper EA on your
            MetaTrader 5 terminal.
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          {data.steps?.map((step, i) => {
            const Icon = STEP_ICONS[i] || NumberCircleOne;
            return (
              <div
                key={step.step}
                className="border border-border bg-card p-5 flex items-start gap-4 metric-card"
                data-testid={`install-step-${step.step}`}
              >
                <Icon
                  size={28}
                  weight="duotone"
                  className="text-primary flex-shrink-0 mt-0.5"
                />
                <div>
                  <h4 className="font-heading text-sm font-bold mb-1">
                    {step.title}
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Requirements */}
          <div className="border border-border bg-card" data-testid="requirements-list">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                REQUIREMENTS
              </h4>
            </div>
            <div className="p-5">
              <ul className="space-y-3">
                {data.requirements?.map((req, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle
                      size={16}
                      weight="fill"
                      className="text-[hsl(142,71%,45%)] flex-shrink-0 mt-0.5"
                    />
                    <span className="text-sm">{req}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Warnings */}
          <div className="border border-border bg-card" data-testid="warnings-list">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                IMPORTANT WARNINGS
              </h4>
            </div>
            <div className="p-5">
              <ul className="space-y-3">
                {data.warnings?.map((warn, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Warning
                      size={16}
                      weight="fill"
                      className="text-primary flex-shrink-0 mt-0.5"
                    />
                    <span className="text-sm">{warn}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Backtesting Guide */}
        <div className="mt-8 border border-border bg-card" data-testid="backtest-guide">
          <div className="px-5 py-4 border-b border-border bg-muted/30">
            <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
              BACKTESTING GUIDE
            </h4>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h5 className="text-sm font-bold mb-2">Strategy Tester Setup</h5>
                <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>Open Strategy Tester (Ctrl+R)</li>
                  <li>Select XauCloud.io</li>
                  <li>Set symbol: XAUUSD</li>
                  <li>Open an XAUUSD M10 chart and confirm the selected Decision Mode in the journal</li>
                  <li>Select date range (min 6 months)</li>
                </ol>
              </div>
              <div>
                <h5 className="text-sm font-bold mb-2">Recommended Settings</h5>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  <li className="font-mono text-xs">Model: Every tick based on real ticks</li>
                  <li className="font-mono text-xs">Deposit: $10,000</li>
                  <li className="font-mono text-xs">Leverage: 1:100</li>
                  <li className="font-mono text-xs">Optimization: Slow complete</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-bold mb-2">Key Metrics to Watch</h5>
                <ul className="text-sm text-muted-foreground space-y-1.5">
                  <li>Profit Factor &gt; 1.5</li>
                  <li>Max Drawdown &lt; 5%</li>
                  <li>Win Rate &gt; 60%</li>
                  <li>Sharpe Ratio &gt; 1.0</li>
                  <li>Recovery Factor &gt; 3.0</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
