import React from "react";

const money = (v = 0) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function StatCard({ label, value, accent }) {
  return (
    <div className="min-w-0 rounded-[20px] border border-white/[0.08] bg-white/[0.04] p-4 sm:p-6">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">{label}</div>
      <div className={`break-words font-mono text-base font-black sm:text-2xl ${accent || "text-white"}`}>{value ?? "--"}</div>
    </div>
  );
}

export default function PerformanceSection({ data }) {
  const sufficient = data?.sufficient_data === true;
  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="performance-section">
      <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">

        <div className="mb-10">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
            Performance
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="performance-title">
            First-party journal results.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/45">
            Metrics come from EA-reported closed trades and are not independently verified. Ratios are shown only after {data?.minimum_sample || 20} closed trades.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="performance-metrics">
          <StatCard label="Total Trades"  value={data?.total_trades} />
          <StatCard label="Profit Factor" value={sufficient ? (data?.profit_factor?.toFixed?.(2) ?? data?.profit_factor) : "Insufficient data"} accent="text-amber-200" />
          <StatCard label="Avg Win"       value={sufficient && data?.avg_win  != null ? money(data.avg_win)  : "Insufficient data"} accent="text-emerald-300" />
          <StatCard label="Avg Loss"      value={sufficient && data?.avg_loss != null ? money(data.avg_loss) : "Insufficient data"} accent="text-rose-400" />
        </div>

      </div>
    </div>
  );
}
