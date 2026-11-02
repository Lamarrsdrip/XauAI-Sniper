import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { TrendUp, TrendDown, Gauge, Coin, ChartLineUp } from "@phosphor-icons/react";

// ─── Real closed-trade results, grouped by day (owner spec, 2026-08-04) ───
// Replaces the Outlook advisory section pulled off the homepage. Every
// number here comes from GET /performance/daily-results, which is built
// from real trade_journal records (the actual bot's real closed trades),
// the same eligibility/dedup rules and pip/Gold-move conversion used
// everywhere else on the site. No fabrication, no client-side estimation.

const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const signed = (v, digits = 1) => (v == null ? "--" : `${Number(v) >= 0 ? "+" : ""}${fmt(v, digits)}`);

function shortDate(dateStr) {
  if (!dateStr) return "--";
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function TotalCard({ icon: Icon, label, value, tone }) {
  const toneText = { green: "text-emerald-700", red: "text-rose-700", neutral: "text-[#1c3032]" }[tone] || "text-[#1c3032]";
  return (
    <div className="rounded-2xl border border-[#e1e1db] bg-[#f8f8f4] p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[#6c7776]">
        <Icon size={12} weight="bold" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]">{label}</span>
      </div>
      <div className={`font-mono text-lg font-black sm:text-xl ${toneText}`}>{value}</div>
    </div>
  );
}

function DayRow({ day }) {
  const positive = day.net_gold_moves >= 0;
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${positive ? "border-emerald-700/15 bg-emerald-50" : "border-rose-700/15 bg-rose-50"}`}>
      <div className="min-w-0">
        <div className="font-mono text-[12px] font-bold text-[#6c7776]">{shortDate(day.date)}</div>
        <div className="mt-0.5 font-mono text-[10px] text-[#6c7776]">
          {day.trades} trade{day.trades === 1 ? "" : "s"} · {day.wins}W / {day.losses}L{day.breakeven ? ` / ${day.breakeven}BE` : ""} · {day.account_count} acct{day.account_count === 1 ? "" : "s"}
        </div>
      </div>
      <div className={`flex-none text-right font-mono text-[12px] font-bold ${positive ? "text-emerald-700" : "text-rose-700"}`}>
        <div>{signed(day.net_pips)} pips</div>
        <div className="text-[10px] font-semibold text-[#6c7776]">{signed(day.net_gold_moves, 2)} Gold moves</div>
      </div>
    </div>
  );
}

export default function DailyTradingResultsSection({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${api}/performance/daily-results`, { params: { days: 30 } })
      .then((r) => { if (!cancelled) { setData(r.data); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [api]);

  const days = useMemo(() => data?.days || [], [data]);
  const totals = data?.totals;

  return (
    <div className="bg-[#ffffff] border-t border-[#e5e3dd] text-[#1c3032]" data-testid="daily-trading-results-section">
      <div className="mx-auto max-w-5xl px-5 py-12 md:px-8 md:py-16">
        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dccaa6] bg-[#f7f1e5] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#90713e]">
            Real Trading Results
          </span>
          <h2 className="mt-4 font-heading text-[1.85rem] font-semibold tracking-tight sm:text-[2.45rem]">
            XauCloud Daily Trading Results
          </h2>
          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-[#6c7776]">
            Real closed trades reported by XauCloud EAs across connected accounts, grouped by day in pips and Gold moves. First-party trading records, not independently verified.
          </p>
          {data?.status === "ok" && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#90713e]/55">
              Aggregated from {data.account_count || 0} connected XauCloud account{data.account_count === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {error && !data && (
          <div className="rounded-[20px] border border-[#e1e1db] bg-[#f8f8f4] p-6 text-[13px] text-[#6c7776]">
            Trading results temporarily unavailable.
          </div>
        )}

        {totals && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="daily-results-totals">
            {totals.net_usd_available && totals.net_usd != null ? (
              <TotalCard icon={ChartLineUp} label="Net P/L (This Month)" value={`${totals.net_usd >= 0 ? "+" : "-"}$${fmt(Math.abs(totals.net_usd), 2)}`} tone={totals.net_usd >= 0 ? "green" : "red"} />
            ) : (
              <TotalCard icon={ChartLineUp} label="Net P/L (This Month)" value="$--" tone="neutral" />
            )}
            <TotalCard icon={Coin} label="Total Gold Moves" value={signed(totals.net_gold_moves, 2)} tone={totals.net_gold_moves >= 0 ? "green" : "red"} />
            <TotalCard icon={Gauge} label="Total Pips" value={signed(totals.net_pips)} tone={totals.net_pips >= 0 ? "green" : "red"} />
            <TotalCard icon={totals.net_gold_moves >= 0 ? TrendUp : TrendDown} label="Trades / W-L" value={`${totals.trades} · ${totals.wins}-${totals.losses}`} tone="neutral" />
          </div>
        )}

        {days.length > 0 && (
          <div className="mt-5 space-y-2" data-testid="daily-results-days">
            {days.map((d) => <DayRow key={d.date} day={d} />)}
          </div>
        )}

        {data?.status === "ok" && days.length === 0 && (
          <div className="mt-6 rounded-[20px] border border-[#e1e1db] bg-[#f8f8f4] p-6 text-[13px] text-[#6c7776]">
            No closed trades in the last 30 days yet.
          </div>
        )}

        <p className="mt-6 max-w-xl text-[12px] leading-5 text-[#6c7776]">
          First-party trading records, not independently verified. Trading involves risk. Past results do not guarantee future performance.
        </p>
      </div>
    </div>
  );
}
