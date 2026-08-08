import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Archive } from "@phosphor-icons/react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Seo from "@/components/Seo";
import { API } from "@/lib/api";

const fmt = (v, digits = 2) => (v == null || Number.isNaN(v) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits }));
const money = (v) => (v == null ? "--" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const dateStr = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function ArchivedPeriodCard({ period }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6" data-testid="historical-period-card">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-lg font-semibold">{period.period_name}</h3>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-white/40">Read-only</span>
      </div>
      <p className="mt-1 font-mono text-[12px] text-white/40">
        {dateStr(period.epoch_started_at)} – {dateStr(period.epoch_ended_at) || "present"}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/30">Win Rate</div>
          <div className="mt-1 font-mono text-lg font-black text-emerald-300">{period.win_rate != null ? `${fmt(period.win_rate, 1)}%` : "--"}</div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/30">Profit Factor</div>
          <div className="mt-1 font-mono text-lg font-black text-gold-200">
            {period.profit_factor_state === "ok" ? fmt(period.profit_factor, 2) : period.profit_factor_state === "not_established" ? "N/E" : "--"}
          </div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/30">Closed Trades</div>
          <div className="mt-1 font-mono text-lg font-black">{period.total_trades}</div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/30">Max Balance DD</div>
          <div className="mt-1 font-mono text-lg font-black text-rose-400">{fmt(period.max_balance_drawdown_pct, 2)}%</div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
        <span className="font-mono text-[11px] text-white/30">Net: {money(period.net_profit)}</span>
        <Link to={`/performance?period_id=${encodeURIComponent(period.period_id)}`} className="text-[12px] text-white/50 hover:text-white transition">
          View full detail →
        </Link>
      </div>
    </div>
  );
}

export default function PerformanceHistoryPage() {
  const [periods, setPeriods] = useState([]);
  const [state, setState] = useState("loading");

  useEffect(() => {
    fetch(`${API}/performance/historical`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setPeriods(d?.periods || []);
        setState("ok");
      })
      .catch(() => setState("unavailable"));
  }, []);

  return (
    <div className="min-h-screen bg-[#060609] text-white">
      <Seo
        title="XauCloud Performance Archive — Historical Gold Trading Results"
        description="Every prior XauCloud reporting period, preserved exactly as recorded — read-only, never deleted, never rewritten."
        path="/performance/history"
      />
      <Header activeSection="" onNavigate={() => {}} goldPrice={null} />
      <div className="mx-auto max-w-4xl px-4 py-11 md:px-8 md:py-16">
        <Link to="/" className="inline-flex items-center gap-2 text-[13px] text-white/45 hover:text-white transition">
          <ArrowLeft size={14} weight="bold" /> Back to XauCloud
        </Link>

        <span className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">
          <Archive size={12} className="inline -mt-0.5 mr-1" /> Historical Archive
        </span>
        <h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">Preserved performance periods.</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-white/55">
          Every prior reporting period is preserved exactly as recorded — read-only, never deleted, never rewritten. The
          homepage shows only the current forward period; everything before it lives here for transparency and technical review.
        </p>

        <div className="mt-10 space-y-5">
          {state === "loading" && <p className="text-sm text-white/40">Loading…</p>}
          {state === "unavailable" && <p className="text-sm text-white/40">Historical archive temporarily unavailable.</p>}
          {state === "ok" && periods.length === 0 && <p className="text-sm text-white/40">No archived periods yet.</p>}
          {periods.map((p) => (
            <ArchivedPeriodCard key={p.period_id} period={p} />
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
}
