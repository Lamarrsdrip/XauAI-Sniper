import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";

const RESULT_STYLE = {
  WIN: { border: "border-l-emerald-400", text: "text-emerald-300", bg: "bg-emerald-300/[0.04]" },
  LOSS: { border: "border-l-rose-400", text: "text-rose-300", bg: "bg-rose-300/[0.04]" },
  BREAK_EVEN: { border: "border-l-white/25", text: "text-white/50", bg: "bg-white/[0.02]" },
};

const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const signed = (v, digits = 1) => (v == null ? "--" : `${Number(v) >= 0 ? "+" : ""}${fmt(v, digits)}`);

function shortDateTime(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StatChip({ label, value, accent }) {
  return (
    <div className="min-w-0 rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-3 sm:p-4">
      <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">{label}</div>
      <div className={`truncate font-mono text-lg font-black sm:text-xl ${accent || "text-white"}`}>{value}</div>
    </div>
  );
}

function SignalCard({ signal }) {
  const style = RESULT_STYLE[signal.result] || RESULT_STYLE.BREAK_EVEN;
  const resultText = signal.result_pips != null
    ? `${signed(signal.result_pips)} pips · ${signed(signal.result_gold_moves, 2)} Gold moves · ${signed(signal.result_r, 2)}R`
    : signal.result_r != null ? `${signed(signal.result_r, 2)}R` : "--";
  return (
    <div className={`min-w-0 rounded-xl border border-white/[0.06] border-l-4 ${style.border} ${style.bg} p-3.5`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="font-mono text-[12px] font-bold">
          {signal.direction} · <span className={style.text}>{signal.result.replace("_", "-")}</span>
        </span>
        <span className="font-mono text-[10px] text-white/30">{shortDateTime(signal.closed_at)}</span>
      </div>
      <div className="mt-1.5 text-[11px] text-white/45">
        Entry <span className="font-mono text-white/70">{fmt(signal.entry_price, 2)}</span>
        {" · "}{signal.direction === "BUY" ? "TP1" : "TP1"} <span className="font-mono text-white/70">{fmt(signal.take_profit_1, 2)}</span>
        {" · "}SL <span className="font-mono text-white/70">{fmt(signal.stop_loss, 2)}</span>
      </div>
      <div className={`mt-1.5 font-mono text-[12px] font-semibold ${style.text}`}>Result: {resultText}</div>
      {signal.confidence_pct != null && (
        <div className="mt-1 text-[10px] text-white/30">{Math.round(signal.confidence_pct)}% confidence{signal.setup_type ? ` · ${signal.setup_type.replace(/_/g, " ").toLowerCase()}` : ""}</div>
      )}
    </div>
  );
}

export default function OutlookPerformanceSection({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      axios.get(`${api}/outlook/public-performance`)
        .then((r) => { if (!cancelled) { setData(r.data); setError(false); } })
        .catch(() => { if (!cancelled) setError(true); });
    };
    load();
    // No cache to invalidate server-side, so a short client poll is how
    // the public page picks up a signal that just resolved without the
    // visitor needing to reload -- "within seconds" per the owner spec.
    const t = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, [api]);

  const signals = data?.signals || [];
  const stats = data?.stats;

  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="outlook-performance-section">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
            Market Outlook
          </span>
          <h2 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="outlook-performance-title">
            XauCloud Market Outlook Performance
          </h2>
          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-white/45">
            These results track completed Market Outlook signals and are separate from automated EA account performance.
          </p>
        </div>

        {error && !data && (
          <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-6 text-[13px] text-white/45">
            Outlook performance temporarily unavailable.
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="outlook-performance-stats">
            <StatChip label="Win Rate" value={stats.win_rate != null ? `${Math.round(stats.win_rate * 100)}%` : "--"} accent="text-emerald-300" />
            <StatChip label="Wins / Losses" value={`${stats.wins} / ${stats.losses}`} />
            <StatChip label="Total R" value={stats.total_r != null ? `${signed(stats.total_r, 2)}R` : "--"} />
            <StatChip label="Total Gold Moves" value={stats.total_gold_moves != null ? signed(stats.total_gold_moves, 2) : "--"} />
          </div>
        )}

        {signals.length > 0 && (
          <div className="mt-5 space-y-2" data-testid="outlook-performance-signals">
            {signals.map((s) => <SignalCard key={s.id} signal={s} />)}
          </div>
        )}

        {data && signals.length === 0 && !error && (
          <div className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-6 text-[13px] text-white/45">
            No completed Market Outlook signals yet. Check back soon.
          </div>
        )}

        <p className="mt-4 max-w-xl text-[12px] leading-5 text-white/40">
          Advisory Market Outlook tracking, not independently verified. Trading involves risk. Past results do not guarantee future performance.
        </p>
        <Link to="/ai-market-outlook" className="mt-4 inline-block text-[12px] text-white/45 hover:text-white transition">
          View full Market Outlook →
        </Link>
        <div className="mt-2">
          <Link to="/performance" className="text-[11px] text-white/30 hover:text-white/60 transition">
            Looking for automated EA account performance instead? →
          </Link>
        </div>
      </div>
    </div>
  );
}
