import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { TrendUp, TrendDown, Gauge, Coin, ChartLineUp } from "@phosphor-icons/react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const signed = (v, digits = 1) => (v == null ? "--" : `${Number(v) >= 0 ? "+" : ""}${fmt(v, digits)}`);

function shortDate(dateStr) {
  if (!dateStr) return "--";
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function TotalCard({ icon: Icon, label, value, tone }) {
  const toneText = { green: "text-emerald-300", red: "text-rose-300", neutral: "text-white" }[tone] || "text-white";
  return (
    <div className="border-t border-white/[0.09] py-4 sm:px-1">
      <div className="mb-2 flex items-center gap-1.5 text-white/32">
        <Icon size={12} weight="bold" />
        <span className="font-mono text-[8px] uppercase tracking-[0.17em]">{label}</span>
      </div>
      <div className={`font-mono text-lg font-black sm:text-xl ${toneText}`}>{value}</div>
    </div>
  );
}

function DayRow({ day }) {
  const positive = day.net_gold_moves >= 0;
  return (
    <div className="grid gap-2 border-b border-white/[0.07] py-3.5 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="font-mono text-[12px] font-bold text-white/84">{shortDate(day.date)}</div>
        <div className="mt-1 font-mono text-[9.5px] text-white/34">
          {day.trades} trade{day.trades === 1 ? "" : "s"} · {day.wins}W / {day.losses}L{day.breakeven ? ` / ${day.breakeven}BE` : ""} · {day.account_count} acct{day.account_count === 1 ? "" : "s"}
        </div>
      </div>
      <div className={`font-mono text-[12px] font-bold sm:text-right ${positive ? "text-emerald-300" : "text-rose-300"}`}>
        <div>{signed(day.net_pips)} pips</div>
        <div className="mt-0.5 text-[9.5px] font-semibold text-white/35">{signed(day.net_gold_moves, 2)} Gold moves</div>
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

  const days = useMemo(() => (data?.days || []).slice(0, 6), [data]);
  const totals = data?.totals;

  return (
    <div className="bg-[#07080B] border-t border-white/[0.06] text-white" data-testid="daily-trading-results-section">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-[#F3C969]">
              Performance · Real trading results
            </div>
            <h2 className="mt-4 max-w-md font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              Recent XauCloud trading performance.
            </h2>
            <p className="mt-4 max-w-md text-[13px] leading-6 text-white/45">
              Real closed trades reported by connected XauCloud EAs, grouped by day in pips and Gold moves. First-party trading records, not independently verified.
            </p>
            {data?.status === "ok" && (
              <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                Aggregated from {data.account_count || 0} connected XauCloud account{data.account_count === 1 ? "" : "s"}
              </p>
            )}
            <Link
              to="/performance"
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-[#F3C969]/35 px-5 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#F3C969]/[0.06]"
            >
              View full performance <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div>
            {error && !data && (
              <div className="border-y border-white/[0.08] py-6 text-[13px] text-white/45">
                Trading results temporarily unavailable.
              </div>
            )}

            {totals && (
              <div className="grid grid-cols-2 gap-x-5 sm:grid-cols-4" data-testid="daily-results-totals">
                {totals.net_usd_available && totals.net_usd != null ? (
                  <TotalCard icon={ChartLineUp} label="Net P/L (30d)" value={`${totals.net_usd >= 0 ? "+" : "-"}$${fmt(Math.abs(totals.net_usd), 2)}`} tone={totals.net_usd >= 0 ? "green" : "red"} />
                ) : (
                  <TotalCard icon={ChartLineUp} label="Net P/L (30d)" value="$--" tone="neutral" />
                )}
                <TotalCard icon={Coin} label="Gold Moves" value={signed(totals.net_gold_moves, 2)} tone={totals.net_gold_moves >= 0 ? "green" : "red"} />
                <TotalCard icon={Gauge} label="Pips" value={signed(totals.net_pips)} tone={totals.net_pips >= 0 ? "green" : "red"} />
                <TotalCard icon={totals.net_gold_moves >= 0 ? TrendUp : TrendDown} label="Trades / W-L" value={`${totals.trades} · ${totals.wins}-${totals.losses}`} tone="neutral" />
              </div>
            )}

            {days.length > 0 && (
              <div className="mt-3 border-y border-white/[0.08]" data-testid="daily-results-days">
                {days.map((d) => <DayRow key={d.date} day={d} />)}
              </div>
            )}

            {data?.status === "ok" && days.length === 0 && (
              <div className="mt-4 border-y border-white/[0.08] py-6 text-[13px] text-white/45">
                No closed trades in the last 30 days yet.
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 max-w-2xl text-[11px] leading-5 text-white/28">
          First-party trading records, not independently verified. Trading involves risk. Past results do not guarantee future performance.
        </p>
      </div>
    </div>
  );
}
