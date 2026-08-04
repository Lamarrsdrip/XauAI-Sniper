import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChartLineUp, Clock } from "@phosphor-icons/react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { API } from "@/lib/api";

const fmt = (v, digits = 2) => (v == null || Number.isNaN(v) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const money = (v) => (v == null ? "--" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const dateStr = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.05] py-2.5 text-[13px] last:border-0">
      <span className="text-white/45">{label}</span>
      <span className="font-mono font-semibold text-white">{value}</span>
    </div>
  );
}

function OutcomePill({ outcome }) {
  const cls = { WIN: "bg-emerald-400/10 text-emerald-300", LOSS: "bg-rose-500/10 text-rose-300", BE: "bg-white/[0.06] text-white/50" }[outcome] || "bg-white/[0.06] text-white/50";
  return <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${cls}`}>{outcome}</span>;
}

export default function PerformancePage() {
  const [searchParams] = useSearchParams();
  const periodId = searchParams.get("period_id");
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | unavailable

  useEffect(() => {
    const url = periodId ? `${API}/performance/full?period_id=${encodeURIComponent(periodId)}` : `${API}/performance/full`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || d.status === "unavailable") { setState("unavailable"); return; }
        setData(d);
        setState("ok");
      })
      .catch(() => setState("unavailable"));
  }, [periodId]);

  return (
    <div className="min-h-screen bg-[#060609] text-white">
      <Seo
        title="XauCloud Performance — Live Gold Trading Bot Results"
        description="Full performance history for the XauCloud automated Gold (XAUUSD) trading Expert Advisor on MetaTrader 5."
        path="/performance"
      />
      <Header activeSection="" onNavigate={() => {}} goldPrice={null} />
      <div className="mx-auto max-w-4xl px-4 py-14 md:px-8 md:py-20">
        <Link to="/" className="inline-flex items-center gap-2 text-[13px] text-white/45 hover:text-white transition">
          <ArrowLeft size={14} weight="bold" /> Back to XauCloud
        </Link>

        <span className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
          Full Performance
        </span>

        {state === "loading" && <p className="mt-6 text-sm text-white/40">Loading…</p>}

        {state === "unavailable" && (
          <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-sm text-white/50">
            Performance temporarily unavailable.
          </div>
        )}

        {state === "ok" && data && (
          <>
            <h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="performance-page-title">
              {data.period_name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-white/40">
              <Clock size={13} />
              Started {dateStr(data.epoch_started_at)}
              {data.epoch_ended_at && <> · Archived {dateStr(data.epoch_ended_at)}</>}
              {data.last_trade_at && <> · Current through {dateStr(data.last_trade_at)}</>}
              {data.ea_version && <> · Build {data.ea_version}</>}
            </p>

            {!data.sufficient_data && (
              <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-5">
                <div className="font-mono text-sm font-bold text-amber-200">Forward tracking active</div>
                <div className="mt-1 text-[13px] text-white/60">
                  {data.total_trades} closed trade{data.total_trades === 1 ? "" : "s"} since {dateStr(data.epoch_started_at)}. Collecting enough data to
                  calculate stable performance metrics ({data.minimum_sample} needed).
                </div>
              </div>
            )}

            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Row label="Win Rate" value={data.win_rate != null ? `${fmt(data.win_rate, 1)}%` : "--"} />
              <Row label="Profit Factor" value={data.profit_factor_state === "ok" ? fmt(data.profit_factor, 2) : data.profit_factor_state === "not_established" ? "Not established" : "Collecting data"} />
              <Row label="Closed Trades" value={data.total_trades} />
              <Row label="Wins" value={data.wins} />
              <Row label="Losses" value={data.losses} />
              <Row label="Break-Even" value={data.break_even} />
              <Row label="Gross Profit" value={money(data.gross_profit)} />
              <Row label="Gross Loss" value={money(-Math.abs(data.gross_loss))} />
              <Row label="Net Result" value={money(data.net_profit)} />
              <Row label="Avg Win" value={money(data.avg_win)} />
              <Row label="Avg Loss" value={money(data.avg_loss)} />
              <Row label="Best Trade" value={money(data.largest_win)} />
              <Row label="Worst Trade" value={money(data.largest_loss)} />
              <Row label="Max Balance Drawdown" value={`${fmt(data.max_balance_drawdown_pct, 2)}%`} />
              <Row label="Drawdown (amount)" value={money(-Math.abs(data.max_balance_drawdown_usd))} />
              <Row label="Consecutive Wins" value={data.longest_winning_streak} />
              <Row label="Consecutive Losses" value={data.longest_losing_streak} />
              <Row label="Date Range" value={dateStr(data.first_trade_at) && dateStr(data.last_trade_at) ? `${dateStr(data.first_trade_at)} – ${dateStr(data.last_trade_at)}` : "--"} />
              <Row label="Dataset Source" value="First-party EA journal" />
            </div>

            {Array.isArray(data.recent_trades) && data.recent_trades.length > 0 && (
              <div className="mt-10">
                <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">Recent Trades</h2>
                <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
                  <table className="w-full min-w-[480px] text-left font-mono text-[12px]">
                    <thead>
                      <tr className="border-b border-white/[0.08] text-white/35">
                        <th className="px-4 py-2.5 font-medium">Date</th>
                        <th className="px-4 py-2.5 font-medium">Direction</th>
                        <th className="px-4 py-2.5 font-medium">Price</th>
                        <th className="px-4 py-2.5 font-medium">Result</th>
                        <th className="px-4 py-2.5 font-medium">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_trades.map((t, i) => (
                        <tr key={t.ticket ?? i} className="border-b border-white/[0.04] last:border-0">
                          <td className="px-4 py-2.5 text-white/60">{t.date || "--"}</td>
                          <td className="px-4 py-2.5 text-white/80">{t.direction || "--"}</td>
                          <td className="px-4 py-2.5 text-white/80">{t.price != null ? fmt(t.price, 1) : "--"}</td>
                          <td className={`px-4 py-2.5 font-semibold ${t.net_result >= 0 ? "text-emerald-300" : "text-rose-400"}`}>{money(t.net_result)}</td>
                          <td className="px-4 py-2.5"><OutcomePill outcome={t.outcome} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-white/[0.06] pt-6">
              <Link to="/performance/history" className="inline-flex items-center gap-1.5 text-[13px] text-white/50 hover:text-white transition">
                <ChartLineUp size={14} /> View historical archive
              </Link>
            </div>

            <p className="mt-6 max-w-xl text-[12px] leading-5 text-white/35">
              First-party trading records, not independently verified. Trading involves risk. Past results do not guarantee future performance.
            </p>
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
