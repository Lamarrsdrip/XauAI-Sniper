import React, { useEffect, useState } from "react";
import axios from "axios";
import { ChartLineUp, Coin, Gauge, Target, TrendDown } from "@phosphor-icons/react";
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

function StatCard({ icon: Icon, label, value, tone }) {
  const toneText = { green: "text-emerald-300", red: "text-rose-300", neutral: "text-white" }[tone] || "text-white";
  return (
    <div className="border-t border-white/[0.09] py-4">
      <div className="mb-2 flex items-center gap-1.5 text-white/32">
        <Icon size={12} weight="bold" />
        <span className="font-mono text-[8px] uppercase tracking-[0.16em]">{label}</span>
      </div>
      <div className={`font-mono text-lg font-black ${toneText}`}>{value}</div>
    </div>
  );
}

function TradeRow({ trade }) {
  const win = trade.result === "WIN";
  return (
    <div className="grid gap-2 border-b border-white/[0.07] py-3.5 last:border-0 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-[11.5px] font-bold text-white/82">
          <span>{trade.direction}</span>
          <span className={win ? "text-emerald-300" : "text-rose-300"}>{trade.result}</span>
        </div>
        <div className="mt-1 font-mono text-[9.5px] text-white/34">
          {shortDate(trade.open_time?.slice(0, 10))} · Entry <span className="text-white/55">{fmt(trade.entry_price, 2)}</span> → Exit <span className="text-white/55">{fmt(trade.exit_price, 2)}</span>
        </div>
      </div>
      <div className={`font-mono text-[11.5px] font-bold sm:text-right ${win ? "text-emerald-300" : "text-rose-300"}`}>
        <div>{signed(trade.pips)} pips</div>
        <div className="mt-0.5 text-[9.5px] font-semibold text-white/35">{signed(trade.profit_usd, 2)} USD</div>
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
  const trades = (data?.trades || []).slice(0, 6);

  return (
    <div className="bg-[#07080B] border-t border-white/[0.06] text-white" data-testid="gold-replay-section">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-[#F3C969]">
              30-Day Replay · Real tick data
            </div>
            <h2 className="mt-4 max-w-md font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              30-Day Real Gold Replay.
            </h2>
            {meta && (
              <p className="mt-4 max-w-md text-[13px] leading-6 text-white/45">
                {meta.symbol} {meta.timeframe}, {shortDate(meta.period_start)} – {shortDate(meta.period_end)}. MetaTrader 5 Strategy Tester replay against real historical tick data ({meta.history_quality}, {meta.ticks?.toLocaleString()} ticks).
              </p>
            )}
            <Link
              to="/performance"
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-[#F3C969]/35 px-5 py-2.5 text-[12px] font-bold text-white transition hover:bg-[#F3C969]/[0.06]"
            >
              View replay report <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div>
            {error && !data && (
              <div className="border-y border-white/[0.08] py-6 text-[13px] text-white/45">
                Replay data temporarily unavailable.
              </div>
            )}

            {data?.status === "unavailable" && (
              <div className="border-y border-white/[0.08] py-6 text-[13px] text-white/45">
                No replay has been published yet. Check back soon.
              </div>
            )}

            {summary && (
              <div className="grid grid-cols-2 gap-x-5 sm:grid-cols-3" data-testid="gold-replay-totals">
                <StatCard icon={ChartLineUp} label="Net Profit" value={signed(summary.net_profit_usd, 2)} tone={summary.net_profit_usd >= 0 ? "green" : "red"} />
                <StatCard icon={Target} label="Profit Factor" value={fmt(summary.profit_factor, 2)} tone="neutral" />
                <StatCard icon={Coin} label="Total Trades" value={fmt(summary.total_trades, 0)} tone="neutral" />
                <StatCard icon={Gauge} label="Wins / Losses" value={`${summary.wins}W / ${summary.losses}L`} tone="neutral" />
                <StatCard icon={Target} label="Win Rate" value={`${fmt(summary.win_rate_pct, 2)}%`} tone="green" />
                <StatCard icon={TrendDown} label="Equity Relative DD" value={`${fmt(summary.equity_relative_drawdown_pct, 2)}%`} tone="red" />
              </div>
            )}

            {summary && (
              <p className="mt-3 font-mono text-[10px] leading-5 text-white/34">
                Verified price movement: {signed(summary.total_gold_moves, 2)} Gold · {signed(summary.total_pips)} pips. Balance maximal drawdown: ${fmt(summary.max_balance_drawdown_usd, 2)} ({fmt(summary.max_balance_drawdown_pct, 2)}%).
              </p>
            )}

            {trades.length > 0 && (
              <div className="mt-4 border-y border-white/[0.08]" data-testid="gold-replay-trades">
                {trades.map((t, i) => <TradeRow key={i} trade={t} />)}
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 max-w-2xl text-[11px] leading-5 text-white/28">
          {meta?.disclaimer || "Backtest replay, not independently verified, and not a guarantee of future performance. Trading involves risk."}
        </p>
      </div>
    </div>
  );
}
