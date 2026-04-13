import React from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { TrendUp, TrendDown, Crosshair, Lightning } from "@phosphor-icons/react";

export default function PerformanceSection({ data }) {
  if (!data) return null;

  return (
    <div
      className="bg-muted/30 border-t border-border"
      data-testid="performance-section"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-4">
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
              BACKTEST RESULTS
            </span>
          </div>
          <h2
            className="font-heading text-2xl sm:text-3xl font-bold tracking-tight"
            data-testid="performance-title"
          >
            Performance Analytics
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Sample backtest metrics from historical XAUUSD data. Results may vary
            based on broker conditions and market environment.
          </p>
        </div>

        {/* Metric Cards Grid */}
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-border mb-8"
          data-testid="performance-metrics"
        >
          <MetricCard
            label="TOTAL TRADES"
            value={data.total_trades}
            testId="metric-total-trades"
          />
          <MetricCard
            label="SHARPE RATIO"
            value={data.sharpe_ratio?.toFixed(2)}
            testId="metric-sharpe"
          />
          <MetricCard
            label="BEST WEEK"
            value={`+${data.best_week}%`}
            positive
            testId="metric-best-week"
          />
          <MetricCard
            label="WORST WEEK"
            value={`${data.worst_week}%`}
            negative
            testId="metric-worst-week"
            noBorderRight
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Equity Curve */}
          <div className="border border-border bg-card p-5" data-testid="equity-chart">
            <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground mb-4">
              EQUITY CURVE
            </h4>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.equity_curve}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(0,0%,90%)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                  stroke="hsl(0,0%,70%)"
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                  stroke="hsl(0,0%,70%)"
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(0,0%,100%)",
                    border: "1px solid hsl(0,0%,85%)",
                    borderRadius: 0,
                    fontFamily: "JetBrains Mono",
                    fontSize: 12,
                  }}
                  formatter={(v) => [`$${v.toLocaleString()}`, "Equity"]}
                />
                <Area
                  type="monotone"
                  dataKey="equity"
                  stroke="hsl(43,74%,49%)"
                  fill="hsl(43,74%,49%)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Weekly Returns */}
          <div className="border border-border bg-card p-5" data-testid="weekly-chart">
            <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground mb-4">
              WEEKLY RETURNS
            </h4>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.weekly_data}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(0,0%,90%)"
                  vertical={false}
                />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                  stroke="hsl(0,0%,70%)"
                />
                <YAxis
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }}
                  stroke="hsl(0,0%,70%)"
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(0,0%,100%)",
                    border: "1px solid hsl(0,0%,85%)",
                    borderRadius: 0,
                    fontFamily: "JetBrains Mono",
                    fontSize: 12,
                  }}
                  formatter={(v) => [`${v}%`, "Return"]}
                />
                <Bar dataKey="return" radius={0}>
                  {data.weekly_data?.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={
                        entry.return >= 0
                          ? "hsl(142,71%,45%)"
                          : "hsl(348,83%,47%)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Strategy Breakdown */}
        <div className="border border-border bg-card" data-testid="strategy-breakdown">
          <div className="px-5 py-4 border-b border-border">
            <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
              STRATEGY PERFORMANCE BREAKDOWN
            </h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border">
            {data.strategy_breakdown?.map((s) => {
              const icons = {
                Trend: TrendUp,
                Range: Lightning,
                Breakout: Crosshair,
              };
              const Icon = icons[s.strategy] || TrendUp;
              return (
                <div key={s.strategy} className="p-5" data-testid={`strategy-${s.strategy.toLowerCase()}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Icon size={16} weight="bold" className="text-primary" />
                    <span className="text-sm font-bold tracking-wide">
                      {s.strategy.toUpperCase()} MODE
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        Trades
                      </div>
                      <div className="font-mono text-lg font-bold">
                        {s.trades}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        Win Rate
                      </div>
                      <div className="font-mono text-lg font-bold">
                        {s.win_rate}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">
                        Profit %
                      </div>
                      <div className="font-mono text-lg font-bold">
                        {s.profit_share}%
                      </div>
                    </div>
                  </div>
                  {/* Win rate bar */}
                  <div className="mt-3 h-1 bg-muted w-full">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${s.win_rate}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Intelligence Metrics */}
        {data.ai_features && (
          <div className="mt-6 border border-border bg-card" data-testid="ai-metrics">
            <div className="px-5 py-4 border-b border-border">
              <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
                AI / MACHINE LEARNING METRICS
              </h4>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-border">
              {[
                { label: "CLASSIFICATION ACCURACY", value: `${data.ai_features.market_classification_accuracy}%` },
                { label: "AVG CONFIDENCE (WINS)", value: data.ai_features.avg_confidence_on_wins },
                { label: "AVG CONFIDENCE (LOSSES)", value: data.ai_features.avg_confidence_on_losses },
                { label: "PATTERNS LEARNED", value: data.ai_features.pattern_memory_size?.toLocaleString() },
                { label: "ADAPTATION CYCLES", value: data.ai_features.adaptation_cycles },
                { label: "LEARNING RATE", value: data.ai_features.learning_rate_current },
              ].map((m) => (
                <div key={m.label} className="p-4">
                  <div className="text-[10px] font-bold tracking-[0.1em] text-muted-foreground mb-1">{m.label}</div>
                  <div className="font-mono text-lg font-bold text-foreground">{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Monthly Returns */}
        <div className="mt-6 border border-border bg-card" data-testid="monthly-returns">
          <div className="px-5 py-4 border-b border-border">
            <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">
              MONTHLY PERFORMANCE
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-3 text-xs font-bold tracking-[0.1em] text-muted-foreground">
                    MONTH
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-bold tracking-[0.1em] text-muted-foreground">
                    RETURN
                  </th>
                  <th className="text-right px-5 py-3 text-xs font-bold tracking-[0.1em] text-muted-foreground">
                    TRADES
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.monthly_returns?.map((m) => (
                  <tr key={m.month} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-medium">{m.month}</td>
                    <td
                      className={`px-5 py-3 text-right font-mono font-bold ${
                        m.return >= 0
                          ? "text-[hsl(142,71%,45%)]"
                          : "text-[hsl(348,83%,47%)]"
                      }`}
                    >
                      {m.return >= 0 ? "+" : ""}
                      {m.return}%
                    </td>
                    <td className="px-5 py-3 text-right font-mono">
                      {m.trades}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, positive, negative, testId, noBorderRight }) {
  return (
    <div
      className={`p-5 metric-card ${noBorderRight ? "" : "border-r border-border"}`}
      data-testid={testId}
    >
      <div className="text-xs font-medium tracking-[0.15em] text-muted-foreground mb-2">
        {label}
      </div>
      <div
        className={`font-mono text-2xl font-bold ${
          positive
            ? "text-[hsl(142,71%,45%)]"
            : negative
            ? "text-[hsl(348,83%,47%)]"
            : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
