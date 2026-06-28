import React from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const money = (v = 0) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function StatCard({ label, value, accent }) {
  return (
    <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.04] p-6">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">{label}</div>
      <div className={`font-mono text-2xl font-black ${accent || "text-white"}`}>{value ?? "--"}</div>
    </div>
  );
}

const chartTooltip = {
  contentStyle: { background: "#0c0d11", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, fontFamily: "JetBrains Mono", fontSize: 11, color: "#fff" },
};

export default function PerformanceSection({ data }) {
  const hasTrades = (data?.total_trades || 0) > 0;

  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="performance-section">
      <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">

        <div className="mb-12">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
            Performance
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="performance-title">
            Real results. Verified metrics.
          </h2>
          <p className="mt-2 text-sm text-white/40">
            {hasTrades ? "Live bot journal data." : "No verified trades logged yet — connect your bot to start."}
          </p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="performance-metrics">
          <StatCard label="Total Trades"  value={data?.total_trades} />
          <StatCard label="Profit Factor" value={data?.profit_factor?.toFixed?.(2) ?? data?.profit_factor} accent="text-amber-200" />
          <StatCard label="Avg Win"       value={data?.avg_win != null ? money(data.avg_win) : "--"}  accent="text-emerald-300" />
          <StatCard label="Avg Loss"      value={data?.avg_loss != null ? money(data.avg_loss) : "--"} accent="text-rose-400" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-6" data-testid="equity-chart">
            <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">Equity Curve</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data?.equity_curve}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip {...chartTooltip} formatter={(v) => [`$${v.toLocaleString()}`, "Equity"]} />
                <defs>
                  <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="equity" stroke="#10B981" strokeWidth={2} fill="url(#eqGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-6" data-testid="weekly-chart">
            <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">Weekly Returns</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data?.weekly_data}>
                <XAxis dataKey="week" tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fontFamily: "JetBrains Mono", fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip {...chartTooltip} formatter={(v) => [money(v), "P/L"]} />
                <Bar dataKey="return" radius={[6, 6, 0, 0]}>
                  {data?.weekly_data?.map((e, i) => (
                    <Cell key={i} fill={e.return >= 0 ? "#10B981" : "#EF4444"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}
