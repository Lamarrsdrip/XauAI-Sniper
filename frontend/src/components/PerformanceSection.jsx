import React from "react";
import { Link } from "react-router-dom";

const fmt = (v, digits = 1) => (v == null || Number.isNaN(v) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const shortDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function StatCard({ label, value, accent, testId }) {
  return (
    <div className="min-w-0 rounded-[20px] border border-white/[0.08] bg-white/[0.04] p-4 sm:p-5" data-testid={testId}>
      <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{label}</div>
      <div className={`break-words font-mono text-xl font-black sm:text-2xl ${accent || "text-white"}`}>{value ?? "--"}</div>
    </div>
  );
}

const DISCLAIMER = "First-party trading records, not independently verified. Trading involves risk. Past results do not guarantee future performance.";

function RecentTrades({ trades }) {
  if (!Array.isArray(trades) || trades.length === 0) return null;
  const rows = trades.slice(0, 10);
  return (
    <div className="mt-4" data-testid="performance-recent-trades">
      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">Recent Trades</div>
      <div className="overflow-hidden rounded-[12px] border border-white/[0.08] bg-white/[0.02]">
        {rows.map((t, i) => (
          <div
            key={t.ticket ?? i}
            className={`flex items-center gap-2.5 px-3 py-1 font-mono text-[10.5px] leading-tight ${i !== rows.length - 1 ? "border-b border-white/[0.05]" : ""}`}
          >
            <span className="w-[62px] shrink-0 text-white/40">{t.date || "--"}</span>
            <span className="w-[30px] shrink-0 text-white/70">{t.direction || "--"}</span>
            <span className="w-[52px] shrink-0 text-right text-white/70">{t.price != null ? fmt(t.price, 1) : "--"}</span>
            <span className={`w-[46px] shrink-0 text-right font-semibold ${t.net_result >= 0 ? "text-emerald-300" : "text-rose-400"}`}>
              {t.net_result >= 0 ? "+" : "-"}
              {Math.abs(t.net_result ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
              t.outcome === "WIN" ? "bg-emerald-400/10 text-emerald-300" : t.outcome === "LOSS" ? "bg-rose-500/10 text-rose-300" : "bg-white/[0.06] text-white/50"
            }`}>
              {t.outcome || "--"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Wrapper({ children }) {
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
        {children}
      </div>
    </div>
  );
}

export default function PerformanceSection({ data }) {
  // status comes straight from the server (unavailable | collecting | active)
  // -- the frontend never infers "no data yet" vs "the API failed" from
  // absence alone, since those are different situations that need
  // different messaging (see audits/performance_reset/01_current_system_audit.md).
  const status = data?.status;

  if (!data || status === "unavailable") {
    return (
      <Wrapper>
        <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-6 text-[13px] text-white/45" data-testid="performance-unavailable">
          Performance temporarily unavailable.
        </div>
      </Wrapper>
    );
  }

  const sufficient_data = data?.sufficient_data === true;
  const started = shortDate(data?.epoch_started_at);

  if (status === "collecting" || !sufficient_data) {
    return (
      <Wrapper>
        <div className="rounded-[20px] border border-amber-300/20 bg-amber-300/[0.06] p-6" data-testid="performance-collecting">
          <div className="font-mono text-[13px] font-bold text-amber-200">Forward tracking active</div>
          <div className="mt-2 font-mono text-2xl font-black">
            {data.total_trades} closed trade{data.total_trades === 1 ? "" : "s"}{started ? ` since ${started}` : ""}
          </div>
          <p className="mt-2 text-[13px] text-white/50">
            Collecting enough data to calculate stable performance metrics. Ratios shown only after {data?.minimum_sample || 20} closed trades.
          </p>
        </div>
        <RecentTrades trades={data?.recent_trades} />
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-white/35">
          <span>First-party forward EA journal</span>
          {started && <><span className="text-white/15">·</span><span>Started: {started}</span></>}
          {data?.ea_version && <><span className="text-white/15">·</span><span>Build: {data.ea_version}</span></>}
        </div>
        <p className="mt-2 max-w-xl text-[12px] leading-5 text-white/40">{DISCLAIMER}</p>
        <Link to="/performance" className="mt-4 inline-block text-[12px] text-white/45 hover:text-white transition">View full performance →</Link>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="performance-metrics">
        <StatCard testId="stat-win-rate" label="Win Rate" value={`${fmt(data.win_rate, 1)}%`} accent="text-emerald-300" />
        <StatCard
          testId="stat-profit-factor"
          label="Profit Factor"
          value={data.profit_factor_state === "ok" ? fmt(data.profit_factor, 2) : data.profit_factor_state === "not_established" ? "Not established" : "Collecting data"}
        />
        <StatCard testId="stat-closed-trades" label="Closed Trades" value={data.total_trades} />
        <StatCard testId="stat-max-drawdown" label="Max Balance Drawdown" value={`${fmt(data.max_balance_drawdown_pct, 2)}%`} accent="text-rose-400" />
      </div>

      <RecentTrades trades={data.recent_trades} />

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-white/35">
        <span>First-party forward EA journal</span>
        {started && <><span className="text-white/15">·</span><span>Started: {started}</span></>}
        {data?.last_trade_at && <><span className="text-white/15">·</span><span>Current through: {shortDate(data.last_trade_at)}</span></>}
        {data?.ea_version && <><span className="text-white/15">·</span><span>Build: {data.ea_version}</span></>}
      </div>
      <p className="mt-2 max-w-xl text-[12px] leading-5 text-white/40">{DISCLAIMER}</p>
      <Link to="/performance" className="mt-4 inline-block text-[12px] text-white/45 hover:text-white transition" data-testid="view-full-performance">
        View full performance →
      </Link>
    </Wrapper>
  );
}
