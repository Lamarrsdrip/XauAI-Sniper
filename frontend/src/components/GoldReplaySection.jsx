import React, { useEffect, useState } from "react";
import axios from "axios";
import { ChartLineUp, Coin, Gauge, Target, TrendDown } from "@phosphor-icons/react";

// ─── Real 30-day MT5 Strategy Tester replay (owner spec, 2026-08-05) ───
// Every number here comes from GET /performance/gold-replay, which serves a
// checked-in snapshot generated directly from a real MetaTrader 5 Strategy
// Tester report -- the production EA replayed against real historical
// XAUUSD tick data (100% real ticks, not modeled/simulated). Refreshed
// manually (monthly) by re-running the actual MT5 Strategy Tester -- never
// computed or estimated here. See audits/xaucloud/30day_gold_replay_20260805/
// for the original MT5-generated report this snapshot was built from.

const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const signed = (v, digits = 1) => (v == null ? "--" : `${Number(v) >= 0 ? "+" : ""}${fmt(v, digits)}`);

function shortDate(dateStr) {
  if (!dateStr) return "--";
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function StatCard({ icon: Icon, label, value, tone }) {
  const toneText = { green: "text-emerald-300", red: "text-rose-300", neutral: "text-white" }[tone] || "text-white";
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-white/35">
        <Icon size={12} weight="bold" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]">{label}</span>
      </div>
      <div className={`font-mono text-lg font-black sm:text-xl ${toneText}`}>{value}</div>
    </div>
  );
}

function TradeRow({ trade }) {
  const win = trade.result === "WIN";
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${win ? "border-emerald-400/20 bg-emerald-400/[0.04]" : "border-rose-400/20 bg-rose-400/[0.04]"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-[12px] font-bold text-white/85">
          <span>{trade.direction}</span>
          <span className={win ? "text-emerald-300" : "text-rose-300"}>{trade.result}</span>
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-white/35">
          {shortDate(trade.open_time?.slice(0, 10))} · Entry <span className="text-white/60">{fmt(trade.entry_price, 2)}</span> → Exit <span className="text-white/60">{fmt(trade.exit_price, 2)}</span>
        </div>
      </div>
      <div className={`flex-none text-right font-mono text-[12px] font-bold ${win ? "text-emerald-300" : "text-rose-300"}`}>
        <div>{signed(trade.pips)} pips</div>
        <div className="text-[10px] font-semibold text-white/40">{signed(trade.profit_usd, 2)} USD</div>
      </div>
    </div>
  );
}

export default function GoldReplaySection({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${api}/performance/gold-replay`)
      .then((r) => { if (!cancelled) { setData(r.data); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [api]);

  const meta = data?.meta;
  const summary = data?.summary;
  const trades = data?.trades || [];

  return (
    <div className="bg-[#07080B] text-white" data-testid="gold-replay-section">
      <div className="mx-auto max-w-5xl px-4 pt-11 md:px-8 md:pt-16">
        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/20 bg-sky-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-sky-200">
            Real 30-Day Backtest
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            30-Day Real Gold Replay
          </h2>
          {meta && (
            <p className="mt-3 max-w-2xl text-[13px] leading-5 text-white/45">
              {meta.symbol} {meta.timeframe}, {shortDate(meta.period_start)} – {shortDate(meta.period_end)}. Real MetaTrader 5 Strategy Tester replay against real historical tick data ({meta.history_quality}, {meta.ticks?.toLocaleString()} ticks) -- not a simulation. {meta.update_cadence}
            </p>
          )}
        </div>

        {error && !data && (
          <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-6 text-[13px] text-white/45">
            Replay data temporarily unavailable.
          </div>
        )}

        {data?.status === "unavailable" && (
          <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-6 text-[13px] text-white/45">
            No replay has been published yet. Check back soon.
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5" data-testid="gold-replay-totals">
            <StatCard icon={ChartLineUp} label="Net Profit" value={signed(summary.net_profit_usd, 2)} tone={summary.net_profit_usd >= 0 ? "green" : "red"} />
            <StatCard icon={Target} label="Profit Factor" value={fmt(summary.profit_factor, 2)} tone="neutral" />
            <StatCard icon={Coin} label="Total Gold Moves" value={signed(summary.total_gold_moves, 2)} tone={summary.total_gold_moves >= 0 ? "green" : "red"} />
            <StatCard icon={Gauge} label="Total Pips" value={signed(summary.total_pips)} tone={summary.total_pips >= 0 ? "green" : "red"} />
            <StatCard icon={TrendDown} label="Max Drawdown" value={`${fmt(summary.max_equity_drawdown_pct, 2)}%`} tone="red" />
          </div>
        )}

        {summary && (
          <p className="mt-3 font-mono text-[11px] text-white/40">
            {summary.total_trades} trades · {summary.wins}W / {summary.losses}L ({fmt(summary.win_rate_pct, 1)}% win rate)
          </p>
        )}

        {trades.length > 0 && (
          <div className="mt-5 max-h-[520px] space-y-2 overflow-y-auto pr-1" data-testid="gold-replay-trades">
            {trades.map((t, i) => <TradeRow key={i} trade={t} />)}
          </div>
        )}

        <p className="mt-6 max-w-xl text-[12px] leading-5 text-white/40">
          {meta?.disclaimer || "Backtest replay, not independently verified, and not a guarantee of future performance. Trading involves risk."}
        </p>
      </div>
    </div>
  );
}
