import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Brain, CheckCircle2, XCircle, AlertTriangle, TrendingUp, TrendingDown,
  Clock3, ChevronDown, ChevronUp, Sparkles, ShieldQuestion,
} from "lucide-react";
import { API } from "@/lib/api";

// ─── Axios (mirrors CloudDashboard's commandAxios — kept local since this
// file is meant to be a self-contained, droppable panel) ───────────────────
const feedAxios = axios.create({ baseURL: API, withCredentials: true });
feedAxios.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cloud_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ─── Style tokens (matches CloudDashboard's dark/glass aesthetic) ─────────
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";
const TONE = {
  bullish: { border: "border-emerald-400/20", bg: "bg-emerald-300/[0.05]", text: "text-emerald-300", icon: TrendingUp },
  success: { border: "border-emerald-400/20", bg: "bg-emerald-300/[0.05]", text: "text-emerald-300", icon: CheckCircle2 },
  bearish: { border: "border-rose-400/20", bg: "bg-rose-300/[0.05]", text: "text-rose-300", icon: TrendingDown },
  danger:  { border: "border-rose-400/20", bg: "bg-rose-300/[0.05]", text: "text-rose-300", icon: XCircle },
  warning: { border: "border-amber-300/20", bg: "bg-amber-300/[0.05]", text: "text-amber-200", icon: AlertTriangle },
  neutral: { border: "border-white/[0.08]", bg: "bg-white/[0.02]", text: "text-white/70", icon: Brain },
};
const toneOf = (t) => TONE[t] || TONE.neutral;

const relTime = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return "just now";
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const clock = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// ─── One conversational "thought" card ─────────────────────────────────────
function ThoughtCard({ card }) {
  const [advanced, setAdvanced] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const tone = toneOf(card.tone);
  const Icon = tone.icon;
  const adv = card.advanced || {};

  return (
    <div className={`rounded-3xl border ${tone.border} ${tone.bg} p-5`} data-testid="ai-thought-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-2xl border ${tone.border} bg-black/20`}>
            <Icon className={`h-4.5 w-4.5 ${tone.text}`} />
          </div>
          <div>
            <div className={`text-[15px] font-bold ${tone.text}`}>{card.headline}</div>
            <div className="text-[11px] text-white/35">{clock(card.ts)} · {relTime(card.ts)}</div>
          </div>
        </div>
        {card.grade && (
          <span className="rounded-full border border-white/[0.1] bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] font-bold text-white/70">
            {card.grade}
          </span>
        )}
      </div>

      {/* Bias / confidence row */}
      {(card.bias || card.confidence != null) && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {card.bias && (
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <div className={MONO_LABEL}>Market Bias</div>
              <div className={`mt-1 text-[16px] font-bold ${card.bias === "Bullish" ? "text-emerald-300" : "text-rose-300"}`}>
                {card.bias}
              </div>
            </div>
          )}
          {card.confidence != null && (
            <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <div className={MONO_LABEL}>Confidence</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[16px] font-bold text-white">{card.confidence}%</span>
                {card.confidence_delta ? (
                  <span className={`text-[11px] font-semibold ${card.confidence_delta > 0 ? "text-emerald-300" : "text-rose-300"}`}>
                    {card.confidence_delta > 0 ? "▲" : "▼"} {Math.abs(card.confidence_delta)}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decision */}
      {card.decision_text && (
        <div className="mt-4">
          <div className={MONO_LABEL}>Decision</div>
          <div className="mt-1 text-[15px] font-semibold text-white">{card.decision_text}</div>
        </div>
      )}

      {/* Reasons — plain English bullets, never raw variables */}
      {card.reason_bullets && card.reason_bullets.length > 0 && (
        <div className="mt-4">
          <div className={MONO_LABEL}>Reason</div>
          <ul className="mt-1.5 space-y-1">
            {card.reason_bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-5 text-white/75">
                <span className="text-white/30">•</span><span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action / result */}
      {card.action_text && (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/15 p-3 text-[12px] italic text-white/55">
          {card.action_text}
        </div>
      )}
      {card.result_usd != null && (
        <div className="mt-4">
          <div className={MONO_LABEL}>Result</div>
          <div className={`mt-1 text-2xl font-black ${card.result_usd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {card.result_usd >= 0 ? "+" : ""}${card.result_usd.toFixed(2)}
          </div>
        </div>
      )}

      {/* Simple / Advanced toggle */}
      <div className="mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4">
        <button onClick={() => setAdvanced(false)}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${!advanced ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/60"}`}>
          Simple
        </button>
        <button onClick={() => setAdvanced(true)}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition ${advanced ? "bg-white/[0.1] text-white" : "text-white/35 hover:text-white/60"}`}>
          Advanced
        </button>
      </div>

      {advanced && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {adv.regime && <AdvChip label="Regime" value={adv.regime} />}
          {adv.session && <AdvChip label="Session" value={adv.session} />}
          {adv.score != null && <AdvChip label="Setup score" value={Number(adv.score).toFixed(2)} />}
          {adv.module && <AdvChip label="Module" value={adv.module} />}
          {adv.market_bias && <AdvChip label="Signal dir" value={adv.market_bias} />}
          {adv.symbol && <AdvChip label="Symbol" value={adv.symbol} />}
        </div>
      )}

      {/* Developer Details — the actual raw telemetry escape hatch */}
      <button onClick={() => setDevOpen(v => !v)}
        className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/[0.05] bg-black/10 px-3 py-2 text-[11px] font-mono text-white/30 transition hover:text-white/50">
        Developer Details
        {devOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {devOpen && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-white/[0.05] bg-black/30 p-3 font-mono text-[10px] leading-4 text-white/45">
{JSON.stringify(adv, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AdvChip({ label, value }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/10 px-2.5 py-2">
      <div className="font-mono text-[9px] uppercase tracking-wider text-white/30">{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-semibold text-white/75" title={String(value)}>{value}</div>
    </div>
  );
}

// ─── Vertical decision timeline ─────────────────────────────────────────────
function DecisionTimeline({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded-3xl border border-white/[0.07] bg-[#0d0e13] p-5">
      <div className={`mb-4 flex items-center gap-2 ${MONO_LABEL}`}>
        <Clock3 className="h-3.5 w-3.5" /> Timeline
      </div>
      <div className="space-y-0">
        {items.map((it, i) => {
          const tone = toneOf(it.tone);
          return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`h-2.5 w-2.5 flex-none rounded-full ${tone.text.replace("text-", "bg-")}`} />
                {i < items.length - 1 && <span className="w-px flex-1 bg-white/[0.08]" />}
              </div>
              <div className="min-w-0 pb-5">
                <div className="font-mono text-[11px] text-white/35">{clock(it.ts)}</div>
                <div className="mt-0.5 text-[13px] font-medium text-white/80">{it.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Current Trade panel ────────────────────────────────────────────────────
function CurrentTradePanel({ opinion }) {
  if (!opinion || !opinion.open) return null;
  const yes = opinion.would_enter_again;
  return (
    <div className="rounded-3xl border border-violet-400/20 bg-violet-300/[0.05] p-5" data-testid="current-trade-panel">
      <div className={`mb-4 flex items-center gap-2 ${MONO_LABEL} text-violet-300`}>
        <Sparkles className="h-3.5 w-3.5" /> Current AI Opinion
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Opinion label="Bias" value={opinion.current_bias || "—"} />
        <Opinion label="Confidence" value={opinion.confidence != null ? `${opinion.confidence}%` : "—"} />
        <Opinion label="Hold probability" value={opinion.hold_probability != null ? `${opinion.hold_probability}%` : "—"} />
        <Opinion label="Exit probability" value={opinion.exit_probability != null ? `${opinion.exit_probability}%` : "—"} />
      </div>
      {opinion.entry_reason && (
        <div className="mt-4">
          <div className={MONO_LABEL}>Entry Reason</div>
          <p className="mt-1 text-[13px] leading-5 text-white/70">{opinion.entry_reason}</p>
        </div>
      )}
      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white/80">
          <ShieldQuestion className="h-4 w-4 text-violet-300" />
          Would I enter this trade again right now?
        </div>
        <span className={`rounded-full border px-3 py-1 text-[12px] font-black ${yes ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-rose-400/25 bg-rose-400/10 text-rose-300"}`}>
          {yes === null ? "—" : yes ? "YES" : "NO"}
        </span>
      </div>
      {yes === false && opinion.would_enter_again_reason && (
        <p className="mt-2 text-[12px] italic text-white/45">{opinion.would_enter_again_reason}</p>
      )}
    </div>
  );
}

function Opinion({ label, value }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
      <div className={MONO_LABEL}>{label}</div>
      <div className="mt-1 text-[15px] font-bold text-white">{value}</div>
    </div>
  );
}

// ─── Top-level export: the full AI Trading Assistant feed ─────────────────
// compact=true renders a single-card teaser (used on the Home page) that
// links into the full experience on the Trading tab, instead of duplicating
// the raw "Bot Decision Feed" log card that used to live there.
export default function AIThoughtFeed({ linked, compact = false, onOpenFull }) {
  const [cards, setCards] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [opinion, setOpinion] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!linked) { setLoading(false); return; }
    try {
      const [feedR, opR] = await Promise.all([
        feedAxios.get("/cloud/monitor/decision-feed", { params: { limit: compact ? 1 : 30 } }),
        compact ? Promise.resolve({ data: null }) : feedAxios.get("/cloud/monitor/current-opinion"),
      ]);
      setCards(feedR.data.cards || []);
      setTimeline(feedR.data.timeline || []);
      setOpinion(opR.data);
    } catch { /* keep last-known state on transient failure */ }
    finally { setLoading(false); }
  }, [linked, compact]);

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 8000); return () => clearInterval(id); }, [fetchAll]);

  if (!linked) return null;

  if (compact) {
    return (
      <div className="space-y-3" data-testid="ai-thought-feed-compact">
        <div className={`flex items-center justify-between gap-2 ${MONO_LABEL}`}>
          <span className="flex items-center gap-2"><Brain className="h-3.5 w-3.5" /> AI Trading Assistant</span>
          {onOpenFull && <button onClick={onOpenFull} className="normal-case tracking-normal text-white/45 hover:text-white transition text-[11px] font-semibold">Open full feed →</button>}
        </div>
        {loading ? (
          <div className="rounded-2xl border border-white/[0.07] bg-[#0d0e13] p-6 text-center text-[12px] text-white/35">Reading the AI's thinking…</div>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.07] bg-[#0d0e13] p-6 text-center text-[12px] text-white/35">No AI activity yet.</div>
        ) : (
          <ThoughtCard card={cards[0]} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ai-thought-feed">
      <CurrentTradePanel opinion={opinion} />
      <div className={`flex items-center gap-2 ${MONO_LABEL}`}>
        <Brain className="h-3.5 w-3.5" /> AI Trading Assistant
      </div>
      {loading ? (
        <div className="rounded-3xl border border-white/[0.07] bg-[#0d0e13] p-8 text-center text-[13px] text-white/35">
          Reading the AI's thinking…
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-3xl border border-white/[0.07] bg-[#0d0e13] p-8 text-center text-[13px] text-white/35">
          No AI activity yet. As soon as the bot starts analyzing the market, you'll see its thinking here — in plain English, not logs.
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((c) => <ThoughtCard key={c.id || `${c.ticket}-${c.ts}`} card={c} />)}
        </div>
      )}
      <DecisionTimeline items={timeline} />
    </div>
  );
}
