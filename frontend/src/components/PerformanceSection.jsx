import React from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendUp, TrendDown, Crosshair, Lightning } from "@phosphor-icons/react";

export default function PerformanceSection({ data }) {
  if (!data) return null;
  return (
    <div className="border-t border-gray-100" data-testid="performance-section">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-24">
        <div className="mb-12">
          <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-gray-400 bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full">BACKTEST RESULTS</span>
          <h2 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight mt-6 text-[#111]" data-testid="performance-title">Performance Analytics</h2>
          <p className="text-gray-500 mt-2">Sample backtest metrics from historical XAUUSD data.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10" data-testid="performance-metrics">
          <MetricCard label="TOTAL TRADES" value={data.total_trades} testId="metric-total-trades" />
          <MetricCard label="SHARPE RATIO" value={data.sharpe_ratio?.toFixed(2)} testId="metric-sharpe" />
          <MetricCard label="BEST WEEK" value={`+${data.best_week}%`} positive testId="metric-best-week" />
          <MetricCard label="WORST WEEK" value={`${data.worst_week}%`} negative testId="metric-worst-week" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
          <div className="bg-white border border-gray-200 rounded-3xl p-6" data-testid="equity-chart">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-gray-400 mb-6">EQUITY CURVE</h4>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data.equity_curve}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, fontFamily: "JetBrains Mono", fontSize: 11, color: "#111" }} formatter={(v) => [`$${v.toLocaleString()}`, "Equity"]} />
                <Area type="monotone" dataKey="equity" stroke="#10B981" fill="url(#greenGrad)" strokeWidth={2} />
                <defs><linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.15} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white border border-gray-200 rounded-3xl p-6" data-testid="weekly-chart">
            <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-gray-400 mb-6">WEEKLY RETURNS</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.weekly_data}>
                <XAxis dataKey="week" tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono", fill: "#9CA3AF" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, fontFamily: "JetBrains Mono", fontSize: 11 }} formatter={(v) => [`${v}%`, "Return"]} />
                <Bar dataKey="return" radius={[6,6,0,0]}>
                  {data.weekly_data?.map((e, i) => <Cell key={i} fill={e.return >= 0 ? "#10B981" : "#EF4444"} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden" data-testid="strategy-breakdown">
          <div className="px-6 py-4 border-b border-gray-100"><h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-gray-400">STRATEGY PERFORMANCE</h4></div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-100">
            {data.strategy_breakdown?.map((s) => {
              const icons = { Trend: TrendUp, Range: Lightning, Breakout: Crosshair };
              const Icon = icons[s.strategy] || TrendUp;
              return (
                <div key={s.strategy} className="p-6" data-testid={`strategy-${s.strategy.toLowerCase()}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <Icon size={16} weight="duotone" className="text-[#C5A059]" />
                    <span className="text-xs font-bold tracking-[0.12em] text-[#111]">{s.strategy.toUpperCase()}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div><div className="text-[10px] text-gray-400 mb-1 font-mono">Trades</div><div className="font-mono text-lg font-bold text-[#111]">{s.trades}</div></div>
                    <div><div className="text-[10px] text-gray-400 mb-1 font-mono">Win Rate</div><div className="font-mono text-lg font-bold text-[#111]">{s.win_rate}%</div></div>
                    <div><div className="text-[10px] text-gray-400 mb-1 font-mono">Profit</div><div className="font-mono text-lg font-bold text-[#111]">{s.profit_share}%</div></div>
                  </div>
                  <div className="mt-4 h-1 bg-gray-100 rounded-full w-full"><div className="h-full bg-[#C5A059] rounded-full" style={{ width: `${s.win_rate}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        {data.monthly_returns && (
          <div className="mt-6 bg-white border border-gray-200 rounded-3xl overflow-hidden" data-testid="monthly-returns">
            <div className="px-6 py-4 border-b border-gray-100"><h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-gray-400">MONTHLY PERFORMANCE</h4></div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100">
                <th className="text-left px-6 py-3 text-[10px] font-mono font-bold tracking-[0.12em] text-gray-400">MONTH</th>
                <th className="text-right px-6 py-3 text-[10px] font-mono font-bold tracking-[0.12em] text-gray-400">RETURN</th>
                <th className="text-right px-6 py-3 text-[10px] font-mono font-bold tracking-[0.12em] text-gray-400">TRADES</th>
              </tr></thead>
              <tbody>{data.monthly_returns?.map((m) => (
                <tr key={m.month} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3 font-medium text-[#111]">{m.month}</td>
                  <td className={`px-6 py-3 text-right font-mono font-bold ${m.return >= 0 ? "text-emerald-600" : "text-red-500"}`}>{m.return >= 0 ? "+" : ""}{m.return}%</td>
                  <td className="px-6 py-3 text-right font-mono text-gray-400">{m.trades}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, positive, negative, testId }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 card-hover" data-testid={testId}>
      <div className="text-[10px] font-mono font-bold tracking-[0.15em] text-gray-400 mb-3">{label}</div>
      <div className={`font-mono text-2xl font-bold ${positive ? "text-emerald-600" : negative ? "text-red-500" : "text-[#111]"}`}>{value}</div>
    </div>
  );
}
