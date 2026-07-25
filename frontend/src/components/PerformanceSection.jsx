import React from "react";

const money = (v = 0) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const shortDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

function StatCard({ label, value, accent }) {
  return (
    <div className="min-w-0 rounded-[20px] border border-white/[0.08] bg-white/[0.04] p-4 sm:p-5">
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</div>
      <div className={`break-words font-mono text-xl font-black sm:text-2xl ${accent || "text-white"}`}>{value ?? "--"}</div>
    </div>
  );
}

export default function PerformanceSection({ data }) {
  const sufficient = data?.sufficient_data === true;
  const from = shortDate(data?.first_trade_at);
  const to = shortDate(data?.last_trade_at);
  const dateRange = from && to ? (from === to ? from : `${from} – ${to}`) : null;

  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="performance-section">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">

        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
            Performance
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="performance-title">
            First-party journal results.
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="performance-metrics">
          <StatCard label="Win Rate" value={sufficient ? `${data.win_rate}%` : "Insufficient data"} accent="text-emerald-300" />
          <StatCard label="Profit Factor" value={sufficient ? (data?.profit_factor?.toFixed?.(2) ?? data?.profit_factor) : "Insufficient data"} accent="text-amber-200" />
          <StatCard label="Closed Trades" value={data?.total_trades ?? "--"} />
          <StatCard label="Max Drawdown" value={sufficient && data?.max_drawdown != null ? money(-Math.abs(data.max_drawdown)) : "Insufficient data"} accent="text-rose-400" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-white/35">
          <span>First-party EA journal</span>
          {dateRange && <><span className="text-white/15">·</span><span>{dateRange}</span></>}
          {data?.ea_version && <><span className="text-white/15">·</span><span>{data.ea_version}</span></>}
        </div>
        <p className="mt-2 max-w-xl text-[12px] leading-5 text-white/40">
          First-party trading records, not independently verified. Trading involves risk of loss. Ratios shown only after {data?.minimum_sample || 20} closed trades.
        </p>

      </div>
    </div>
  );
}
