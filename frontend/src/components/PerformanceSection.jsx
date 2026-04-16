import React from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendUp, TrendDown, Crosshair, Lightning } from "@phosphor-icons/react";

export default function PerformanceSection({ data }) {
  if (!data) return null;

  return (
    <div className="border-t border-white/[0.06]" data-testid="performance-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-24">
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] bg-white/[0.03] mb-4">
            <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-white/40">BACKTEST RESULTS</span>
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl font-medium tracking-tight text-white" data-testid="performance-title">Performance Analytics</h2>
          <p className="text-white/40 mt-2 max-w-2xl">Sample backtest metrics from historical XAUUSD data.</p>
        </div>

        {/* Metrics bento */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-white/[0.06] mb-10" data-testid="performance-metrics">
          <MetricCard label="TOTAL TRADES" value={data.total_trades} testId="metric-total-trades" />
          <MetricCard label="SHARPE RATIO" value={data.sharpe_ratio?.toFixed(2)} testId="metric-sharpe" />
          <MetricCard label="BEST WEEK" value={`+${data.best_week}%`} positive testId="metric-best-week" />
          <MetricCard label="WORST WEEK" value={`${data.worst_week}%`} negative testId="metric-worst-week" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1px] bg-white/[0.06] mb-10">
          <div className="bg-[#050505] p-6" data-testid="equity-chart">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/30 mb-6">EQUITY CURVE</h4>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.equity_curve}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.2)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.2)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "#0C0C0C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 0, fontFamily: "JetBrains Mono", fontSize: 11, color: "#fff" }} formatter={(v) => [`$${v.toLocaleString()}`, "Equity"]} />
                <Area type="monotone" dataKey="equity" stroke="#D4AF37" fill="url(#goldGradient)" strokeWidth={1.5} />
                <defs>
                  <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                  </linearGradient>
                </defs>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-[#050505] p-6" data-testid="weekly-chart">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/30 mb-6">WEEKLY RETURNS</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.weekly_data}>
                <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.2)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.2)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: "#0C0C0C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 0, fontFamily: "JetBrains Mono", fontSize: 11, color: "#fff" }} formatter={(v) => [`${v}%`, "Return"]} />
                <Bar dataKey="return" radius={0}>
                  {data.weekly_data?.map((entry, index) => (
                    <Cell key={index} fill={entry.return >= 0 ? "#00C853" : "#FF3D00"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Strategy Breakdown */}
        <div className="border border-white/[0.06] bg-[#0C0C0C]" data-testid="strategy-breakdown">
          <div className="px-6 py-4 border-b border-white/[0.06]">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/30">STRATEGY PERFORMANCE</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
            {data.strategy_breakdown?.map((s) => {
              const icons = { Trend: TrendUp, Range: Lightning, Breakout: Crosshair };
              const Icon = icons[s.strategy] || TrendUp;
              return (
                <div key={s.strategy} className="p-6" data-testid={`strategy-${s.strategy.toLowerCase()}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <Icon size={16} weight="duotone" className="text-[#D4AF37]" />
                    <span className="text-xs font-bold tracking-[0.15em] text-white/70">{s.strategy.toUpperCase()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div><div className="text-[10px] text-white/30 mb-1 font-mono">Trades</div><div className="font-mono text-lg font-bold text-white">{s.trades}</div></div>
                    <div><div className="text-[10px] text-white/30 mb-1 font-mono">Win Rate</div><div className="font-mono text-lg font-bold text-white">{s.win_rate}%</div></div>
                    <div><div className="text-[10px] text-white/30 mb-1 font-mono">Profit</div><div className="font-mono text-lg font-bold text-white">{s.profit_share}%</div></div>
                  </div>
                  <div className="mt-4 h-[2px] bg-white/[0.06] w-full">
                    <div className="h-full bg-[#D4AF37] transition-all duration-700" style={{ width: `${s.win_rate}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Metrics */}
        {data.ai_features && (
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-[1px] bg-white/[0.06]" data-testid="ai-metrics">
            {[
              { label: "CLASSIFICATION", value: `${data.ai_features.market_classification_accuracy}%` },
              { label: "AVG CONF (WIN)", value: data.ai_features.avg_confidence_on_wins },
              { label: "AVG CONF (LOSS)", value: data.ai_features.avg_confidence_on_losses },
              { label: "PATTERNS", value: data.ai_features.pattern_memory_size?.toLocaleString() },
              { label: "ADAPT CYCLES", value: data.ai_features.adaptation_cycles },
              { label: "LEARN RATE", value: data.ai_features.learning_rate_current },
            ].map((m) => (
              <div key={m.label} className="bg-[#050505] p-5">
                <div className="text-[9px] font-mono font-bold tracking-[0.15em] text-white/25 mb-2">{m.label}</div>
                <div className="font-mono text-lg font-bold text-white">{m.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Monthly Returns */}
        <div className="mt-6 border border-white/[0.06] bg-[#0C0C0C]" data-testid="monthly-returns">
          <div className="px-6 py-4 border-b border-white/[0.06]">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/30">MONTHLY PERFORMANCE</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-6 py-3 text-[10px] font-mono font-bold tracking-[0.15em] text-white/25">MONTH</th>
                  <th className="text-right px-6 py-3 text-[10px] font-mono font-bold tracking-[0.15em] text-white/25">RETURN</th>
                  <th className="text-right px-6 py-3 text-[10px] font-mono font-bold tracking-[0.15em] text-white/25">TRADES</th>
                </tr>
              </thead>
              <tbody>
                {data.monthly_returns?.map((m) => (
                  <tr key={m.month} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3 font-medium text-white/70">{m.month}</td>
                    <td className={`px-6 py-3 text-right font-mono font-bold ${m.return >= 0 ? "text-[#00C853]" : "text-[#FF3D00]"}`}>
                      {m.return >= 0 ? "+" : ""}{m.return}%
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-white/40">{m.trades}</td>
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

function MetricCard({ label, value, positive, negative, testId }) {
  return (
    <div className="bg-[#050505] p-6 metric-card" data-testid={testId}>
      <div className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/25 mb-3">{label}</div>
      <div className={`font-mono text-2xl font-bold ${positive ? "text-[#00C853]" : negative ? "text-[#FF3D00]" : "text-white"}`}>{value}</div>
    </div>
  );
}
