import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import {
  TrendUp, TrendDown, Target, Clock, ChartLineUp, Gauge, CaretDown,
  ArrowUp, ArrowDown, Coin, Percent, Trophy, Flag, ArrowsClockwise,
} from "@phosphor-icons/react";

// ─── Premium redesign (owner spec, 2026-08-04) ─────────────────────────────
// Compact, information-dense signal cards; no client-side fabrication --
// every number rendered here comes straight from the API response
// (GET /outlook/public-performance, now with limit/avg-win-loss/best-worst
// added server-side -- see market_outlook_routes.py). No longer imported
// on the public homepage (owner decision, see App.js) -- kept as a
// standalone component in case it's wanted again later.

const RESULT_STYLE = {
  WIN:  { card: "border-emerald-400/25 bg-gradient-to-br from-emerald-950/40 to-[#0a1410]", text: "text-emerald-300", badge: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30", accent: "#34d399" },
  LOSS: { card: "border-rose-400/25 bg-gradient-to-br from-rose-950/40 to-[#160a0d]", text: "text-rose-300", badge: "bg-rose-400/15 text-rose-300 border-rose-400/30", accent: "#fb7185" },
  // Root-cause fix (2026-08-05): signal.result can now genuinely be
  // PARTIAL_PROFIT/BREAK_EVEN (see market_outlook_routes.py's
  // _outlook_to_signal_card) -- these must never fall back to the LOSS
  // (red) style just because they aren't a clean WIN.
  PARTIAL_PROFIT: { card: "border-sky-400/25 bg-gradient-to-br from-sky-950/40 to-[#0a0f16]", text: "text-sky-300", badge: "bg-sky-400/15 text-sky-300 border-sky-400/30", accent: "#38bdf8" },
  BREAK_EVEN: { card: "border-teal-400/25 bg-gradient-to-br from-teal-950/40 to-[#0a1614]", text: "text-teal-300", badge: "bg-teal-400/15 text-teal-300 border-teal-400/30", accent: "#2dd4bf" },
};

const DIRECTION_FILTERS = ["All", "BUY", "SELL"];
const RESULT_FILTERS = ["All", "WIN", "LOSS", "PARTIAL_PROFIT", "BREAK_EVEN"];
const DATE_FILTERS = ["All time", "Today", "Last 7 days", "Last 30 days"];

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-none rounded-full px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide transition-all duration-200 ${
        active
          ? "bg-gold-300 text-black shadow-[0_0_0_1px_rgba(212,175,55,0.4)]"
          : "border border-white/[0.1] bg-white/[0.03] text-white/45 hover:border-white/25 hover:text-white/80"
      }`}
    >
      {children}
    </button>
  );
}

function AnimatedNumber({ value, decimals = 0, suffix = "", prefix = "" }) {
  // Lightweight count-up animation, no new dependency -- rAF-driven, skips
  // straight to the final value if the browser prefers reduced motion.
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (value == null || Number.isNaN(Number(value))) { setDisplay(null); return; }
    const target = Number(value);
    const prefersReduced = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) { setDisplay(target); return; }
    let frame;
    const start = performance.now();
    const duration = 700;
    const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  if (display == null) return <span>--</span>;
  return <span>{prefix}{display.toFixed(decimals)}{suffix}</span>;
}

function StatCard({ icon: Icon, label, value, decimals = 0, suffix = "", prefix = "", tone = "neutral", index = 0 }) {
  const toneText = { green: "text-emerald-300", red: "text-rose-300", neutral: "text-white" }[tone] || "text-white";
  return (
    <div
      className="anim-fade-up rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 transition-colors hover:border-white/[0.16]"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-white/35">
        <Icon size={12} weight="bold" />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]">{label}</span>
      </div>
      <div className={`font-mono text-lg font-black sm:text-xl ${toneText}`}>
        {value == null ? "--" : <AnimatedNumber value={value} decimals={decimals} suffix={suffix} prefix={prefix} />}
      </div>
    </div>
  );
}

function ConfidenceBadge({ pct }) {
  if (pct == null) return null;
  // Thresholds are a display convention only (not a statistic) -- the
  // underlying confidence_pct is always the real value from the backend.
  const tier = pct >= 75 ? { label: "High Confidence", cls: "text-emerald-300" }
    : pct >= 50 ? { label: "Medium Confidence", cls: "text-gold-200" }
    : { label: "Low Confidence", cls: "text-white/45" };
  return (
    <span className={`font-mono text-[9px] font-bold uppercase tracking-wide ${tier.cls}`}>
      {Math.round(pct)}% {tier.label}
    </span>
  );
}

function shortDateTime(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const signed = (v, digits = 1) => (v == null ? "--" : `${Number(v) >= 0 ? "+" : ""}${fmt(v, digits)}`);

// Compact redesign (owner spec, 2026-08-04): ~30-40% shorter than the first
// pass -- Entry/SL/TP1 collapsed onto one inline row instead of a 3-column
// grid with stacked labels, the result line is plain text instead of a
// bordered/padded box, and the confidence badge lost its pill chrome. Same
// fields, same real data, just denser -- this is a performance page users
// scan quickly, not a single hero card.
function SignalCard({ signal, index }) {
  const style = RESULT_STYLE[signal.result] || RESULT_STYLE.BREAK_EVEN;
  const DirIcon = signal.direction === "BUY" ? ArrowUp : ArrowDown;
  const tpDetail = signal.result === "WIN" && signal.highest_tp_reached
    ? ` · TP${signal.highest_tp_reached}` : "";
  return (
    <div
      className={`anim-fade-up min-w-0 rounded-xl border ${style.card} px-3 py-2.5`}
      style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <DirIcon size={11} weight="bold" className={style.text} />
          <span className={`font-mono text-[11px] font-black ${style.text}`}>{signal.direction}</span>
          <span className={`rounded-full border px-1.5 py-[1px] font-mono text-[8px] font-black uppercase tracking-wide ${style.badge}`}>
            {signal.result}{tpDetail}
          </span>
        </div>
        <span className="flex-none font-mono text-[9px] text-white/30">{shortDateTime(signal.closed_at)}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[9px] text-white/30">
        <span>Entry <span className="text-[11px] font-semibold text-white/80">{fmt(signal.entry_price, 2)}</span></span>
        <span>SL <span className="text-[11px] font-semibold text-white/80">{fmt(signal.stop_loss, 2)}</span></span>
        <span>TP1 <span className="text-[11px] font-semibold text-white/80">{fmt(signal.take_profit_1, 2)}</span></span>
      </div>

      <div className={`mt-1.5 font-mono text-[11px] font-bold leading-tight ${style.text}`}>
        {signal.result_pips != null
          ? `${signed(signal.result_pips)} pips · ${signed(signal.result_gold_moves, 2)} Gold moves · ${signed(signal.result_r, 2)}R`
          : signal.result_r != null ? `${signed(signal.result_r, 2)}R` : "--"}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {signal.confidence_pct != null ? <ConfidenceBadge pct={signal.confidence_pct} /> : <span />}
        {signal.setup_type && (
          <span className="truncate font-mono text-[9px] text-white/30">
            {signal.setup_type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        )}
      </div>
    </div>
  );
}

const INITIAL_LIMIT = 20;
const LOAD_MORE_STEP = 20;

export default function OutlookPerformanceSection({ api }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [loadingMore, setLoadingMore] = useState(false);
  const [directionFilter, setDirectionFilter] = useState("All");
  const [resultFilter, setResultFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("All time");

  useEffect(() => {
    let cancelled = false;
    const load = (isBackground) => {
      if (!isBackground) setLoadingMore(true);
      axios.get(`${api}/outlook/public-performance`, { params: { limit } })
        .then((r) => { if (!cancelled) { setData(r.data); setError(false); } })
        .catch(() => { if (!cancelled) setError(true); })
        .finally(() => { if (!cancelled) setLoadingMore(false); });
    };
    load(false);
    // No cache to invalidate server-side, so a short client poll is how the
    // public page picks up a signal that just resolved without the visitor
    // needing to reload -- "within seconds" per the owner spec.
    const t = setInterval(() => load(true), 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, [api, limit]);

  const allSignals = useMemo(() => data?.signals || [], [data]);
  const stats = data?.stats;

  const filteredSignals = useMemo(() => {
    const now = Date.now();
    const cutoffs = {
      "Today": now - 24 * 60 * 60 * 1000,
      "Last 7 days": now - 7 * 24 * 60 * 60 * 1000,
      "Last 30 days": now - 30 * 24 * 60 * 60 * 1000,
    };
    return allSignals.filter((s) => {
      if (directionFilter !== "All" && s.direction !== directionFilter) return false;
      if (resultFilter !== "All" && s.result !== resultFilter) return false;
      if (dateFilter !== "All time") {
        const t = new Date(s.closed_at).getTime();
        if (!Number.isFinite(t) || t < cutoffs[dateFilter]) return false;
      }
      return true;
    });
  }, [allSignals, directionFilter, resultFilter, dateFilter]);

  const filtersActive = directionFilter !== "All" || resultFilter !== "All" || dateFilter !== "All time";

  return (
    <div className="bg-[#07080B] border-t border-white/[0.06] text-white" data-testid="outlook-performance-section">
      <style>{`
        @keyframes xauFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .anim-fade-up { animation: xauFadeUp 0.45s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .anim-fade-up { animation: none; } }
      `}</style>
      <div className="mx-auto max-w-5xl px-4 py-11 md:px-8 md:py-16">
        <div className="mb-6">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-300/20 bg-gold-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-gold-200">
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
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="outlook-performance-stats">
              <StatCard index={0} icon={Percent} label="Win Rate" value={stats.win_rate != null ? stats.win_rate * 100 : null} decimals={0} suffix="%" tone="green" />
              <StatCard index={1} icon={ChartLineUp} label="Total Pips" value={stats.total_pips} decimals={1} suffix=" pips" tone={stats.total_pips >= 0 ? "green" : "red"} />
              <StatCard index={2} icon={Coin} label="Total Gold Moves" value={stats.total_gold_moves} decimals={2} tone={stats.total_gold_moves >= 0 ? "green" : "red"} />
              <StatCard index={3} icon={Gauge} label="Avg Result" value={stats.average_pips} decimals={1} suffix=" pips" tone={stats.average_pips >= 0 ? "green" : "red"} />
              <StatCard index={4} icon={TrendUp} label="Avg Win" value={stats.average_win_pips} decimals={1} suffix=" pips" tone="green" />
              <StatCard index={5} icon={TrendDown} label="Avg Loss" value={stats.average_loss_pips} decimals={1} suffix=" pips" tone="red" />
              <StatCard index={6} icon={Trophy} label="Best Trade" value={stats.best_trade_pips} decimals={1} suffix=" pips" tone="green" />
              <StatCard index={7} icon={Target} label="Worst Trade" value={stats.worst_trade_pips} decimals={1} suffix=" pips" tone="red" />
            </div>
            {/* Wins/Losses shown as its own strip -- "15/3" isn't a single
                number, so it doesn't fit the count-up stat card shape. */}
            <div className="mt-2.5 flex items-center gap-1.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 font-mono text-[11px] text-white/50" data-testid="outlook-performance-wl">
              <Flag size={12} className="text-white/30" />
              <span className="text-emerald-300 font-bold">{stats.wins} wins</span>
              <span className="text-white/20">·</span>
              <span className="text-rose-300 font-bold">{stats.losses} losses</span>
              <span className="text-white/20">·</span>
              {stats.count} completed signal{stats.count === 1 ? "" : "s"} tracked
            </div>
          </>
        )}

        {allSignals.length > 0 && (
          <div className="sticky top-[60px] z-10 -mx-4 mt-6 flex flex-wrap items-center gap-1.5 border-y border-white/[0.06] bg-[#07080B]/95 px-4 py-2.5 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border sm:px-3">
            {DIRECTION_FILTERS.map((f) => (
              <Chip key={`dir-${f}`} active={directionFilter === f} onClick={() => setDirectionFilter(f)}>{f}</Chip>
            ))}
            <span className="mx-0.5 h-4 w-px bg-white/10" />
            {RESULT_FILTERS.map((f) => (
              <Chip key={`res-${f}`} active={resultFilter === f} onClick={() => setResultFilter(f)}>{f}</Chip>
            ))}
            <span className="mx-0.5 h-4 w-px bg-white/10" />
            {DATE_FILTERS.map((f) => (
              <Chip key={`date-${f}`} active={dateFilter === f} onClick={() => setDateFilter(f)}>{f}</Chip>
            ))}
          </div>
        )}

        {allSignals.length > 0 && (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2" data-testid="outlook-performance-signals">
            {filteredSignals.map((s, i) => <SignalCard key={s.id} signal={s} index={i} />)}
            {filteredSignals.length === 0 && (
              <div className="col-span-full rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-6 text-center text-[13px] text-white/45">
                No signals match these filters{filtersActive ? " -- try widening them." : "."}
              </div>
            )}
          </div>
        )}

        {allSignals.length > 0 && allSignals.length >= limit && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setLimit((l) => l + LOAD_MORE_STEP)}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-5 py-2.5 font-mono text-[11px] font-bold uppercase tracking-wide text-white/60 transition hover:border-gold-300/30 hover:text-gold-200 disabled:opacity-50"
            >
              {loadingMore ? <ArrowsClockwise size={13} className="animate-spin" /> : <CaretDown size={13} />}
              {loadingMore ? "Loading…" : "Load older signals"}
            </button>
          </div>
        )}

        {data && allSignals.length === 0 && !error && (
          <div className="mt-6 rounded-[20px] border border-white/[0.08] bg-white/[0.03] p-6 text-[13px] text-white/45">
            No completed Market Outlook signals yet. Check back soon.
          </div>
        )}

        <p className="mt-6 max-w-xl text-[12px] leading-5 text-white/40">
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
