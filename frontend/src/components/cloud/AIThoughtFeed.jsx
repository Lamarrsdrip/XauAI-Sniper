import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import {
  Brain, CheckCircle2, XCircle, AlertTriangle, TrendingUp, TrendingDown,
  Clock3, ChevronDown, ChevronUp, Sparkles, ShieldQuestion, Activity,
  Search, Pause, ShieldAlert, Target, LifeBuoy,
} from "lucide-react";
import { API } from "@/lib/api";

// ─── Axios (mirrors CloudDashboard's commandAxios — kept local since this
// file is meant to be a self-contained, droppable panel) ───────────────────
const feedAxios = axios.create({ baseURL: API, withCredentials: true });

// ─── Style tokens (matches CloudDashboard's dark/glass aesthetic) ─────────
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";
const TONE = {
  bullish: { border: "border-emerald-400/20", bg: "bg-emerald-300/[0.05]", text: "text-emerald-300", icon: TrendingUp },
  success: { border: "border-emerald-400/20", bg: "bg-emerald-300/[0.05]", text: "text-emerald-300", icon: CheckCircle2 },
  bearish: { border: "border-rose-400/20", bg: "bg-rose-300/[0.05]", text: "text-rose-300", icon: TrendingDown },
  danger:  { border: "border-rose-400/20", bg: "bg-rose-300/[0.05]", text: "text-rose-300", icon: XCircle },
  warning: { border: "border-gold-300/20", bg: "bg-gold-300/[0.05]", text: "text-gold-200", icon: AlertTriangle },
  neutral: { border: "border-white/[0.08]", bg: "bg-white/[0.02]", text: "text-white/70", icon: Brain },
};
const toneOf = (t) => TONE[t] || TONE.neutral;
const FRESH_DECISION_MS = 24 * 60 * 60 * 1000;
const MAX_LIVE_DECISION_CARDS = 20;
const NO_FRESH_DECISION_TEXT = "No fresh AI decision yet. Waiting for the next completed M10 evaluation.";

const tsMs = (iso) => {
  if (!iso) return NaN;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : NaN;
};

const isFreshDecision = (card) => {
  const ms = tsMs(card?.ts);
  if (!Number.isFinite(ms)) return false;
  const age = Date.now() - ms;
  return age >= 0 && age <= FRESH_DECISION_MS;
};

const freshCards = (items = []) => (
  items
    .filter(isFreshDecision)
    .sort((a, b) => tsMs(b.ts) - tsMs(a.ts))
    .slice(0, MAX_LIVE_DECISION_CARDS)
);

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

const repeatText = (card) => {
  const count = Number(card?.repeat_count || 1);
  if (count <= 1) return "";
  const times = [card.ts, ...(card.repeated_at || [])].map(tsMs).filter(Number.isFinite);
  const spanMs = times.length > 1 ? Math.max(...times) - Math.min(...times) : 15 * 60 * 1000;
  const minutes = Math.max(1, Math.round(spanMs / 60000));
  return `Repeated ${count} times in last ${minutes} minute${minutes === 1 ? "" : "s"}.`;
};

// ─── One conversational "thought" card ─────────────────────────────────────
function ThoughtCard({ card }) {
  const [advanced, setAdvanced] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const tone = toneOf(card.tone);
  const Icon = tone.icon;
  const adv = card.advanced || {};
  const repeated = repeatText(card);

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
            {repeated && (
              <div className="mt-1 text-[10px] text-white/30">
                {repeated}
              </div>
            )}
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

const VERDICT_STYLE = {
  YES:  "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  NO:   "border-rose-400/25 bg-rose-400/10 text-rose-300",
  WAIT: "border-gold-300/25 bg-gold-300/10 text-gold-200",
};
const HEALTH_STYLE = {
  healthy:     { label: "Healthy",     cls: "text-emerald-300" },
  pullback:    { label: "Pullback",    cls: "text-sky-300" },
  warning:     { label: "Warning",     cls: "text-gold-200" },
  danger:      { label: "Danger",      cls: "text-rose-300" },
  invalidated: { label: "Invalidated", cls: "text-rose-300" },
  HEALTHY:     { label: "HEALTHY",     cls: "text-emerald-300" },
  PULLBACK:    { label: "PULLBACK",    cls: "text-sky-300" },
  WARNING:     { label: "WARNING",     cls: "text-gold-200" },
  DANGER:      { label: "DANGER",      cls: "text-rose-300" },
  INVALIDATED: { label: "INVALIDATED", cls: "text-rose-300" },
};
const money2 = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}$${Number(v).toFixed(2)}`);
const num2 = (v) => (v == null || v === "" ? "—" : Number(v).toFixed(2));
const pct0 = (v) => (v == null || v === "" ? "—" : `${Math.round(Number(v))}%`);
const lots2 = (v) => (v == null || v === "" ? "—" : Number(v).toFixed(2));
const ageText = (minutes) => {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) return "—";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem ? `${h}h ${rem}m` : `${h}h`;
};

// ─── Current Trade panel — "Open Trade Thinking" ───────────────────────────
export function CurrentTradePanel({ opinion, onForceClose }) {
  if (!opinion || !opinion.open) {
    return (
      <div className="rounded-3xl border border-white/[0.07] bg-[#0d0e13] p-5" data-testid="current-trade-panel">
        <div className={`mb-3 flex items-center gap-2 ${MONO_LABEL}`}>
          <Sparkles className="h-3.5 w-3.5" /> Open Trade Thinking
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/15 p-4 text-[13px] text-white/50">
          No open trade
        </div>
      </div>
    );
  }
  const verdict = opinion.would_enter_again || "WAIT";
  const health = HEALTH_STYLE[opinion.thesis_health] || null;
  const inRecovery = opinion.recovery_mode === "ACTIVE";
  const failedRecovery = opinion.recovery_mode === "FAILED_NO_FORCED_EXIT";
  const decision = opinion.current_bot_decision || opinion.next_action || "WAIT";
  const direction = (opinion.direction || "—").toUpperCase();
  const pendingMessage = opinion.message || "";
  const ticket = opinion.ticket ? String(opinion.ticket) : "";
  const symbol = opinion.symbol || "XAUUSD";
  const canForceClose = Boolean(onForceClose && ticket);
  const forceCloseClick = () => {
    if (!canForceClose) return;
    onForceClose({
      action: "FORCE_CLOSE_TRADE",
      label: "Force Close Ticket",
      detail: `Close only ticket ${ticket} on ${symbol}. The EA will reject the command if that ticket is not open, belongs to another symbol, or was not opened by this EA magic number.`,
      tone: "red",
      dangerous: true,
      icon: XCircle,
      payload: {
        ticket,
        symbol,
        direction,
        reason: "USER_FORCE_CLOSE_TRADE",
      },
    });
  };

  return (
    <div className="rounded-3xl border border-violet-400/20 bg-violet-300/[0.05] p-5" data-testid="current-trade-panel">
      <div className={`mb-4 flex items-center justify-between gap-2 ${MONO_LABEL} text-violet-300`}>
        <span className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Open Trade Thinking</span>
        <span className="flex items-center gap-2">
          {canForceClose && (
            <button
              type="button"
              onClick={forceCloseClick}
              className="rounded-full border border-rose-300/25 bg-rose-400/10 px-2.5 py-1 text-[10px] font-black normal-case tracking-normal text-rose-200 transition hover:border-rose-300/45 hover:bg-rose-400/15"
            >
              Force close
            </button>
          )}
          {health && <span className={`normal-case tracking-normal text-[11px] font-bold ${health.cls}`}>{health.label}</span>}
        </span>
      </div>

      {inRecovery && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-gold-300/25 bg-gold-300/[0.08] p-3.5 text-[12px] text-gold-100">
          <LifeBuoy className="h-4 w-4 flex-none text-gold-300" />
          <span>Recovery Mode active — reached {Math.round(opinion.recovery_worst_pct || 0)}% of the way to SL, now watching for a genuine reclaim before deciding anything.</span>
        </div>
      )}
      {failedRecovery && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3.5 text-[12px] text-white/55">
          <LifeBuoy className="h-4 w-4 flex-none text-white/40" />
          <span>Recovery stalled after a near-SL event — not force-exiting, still riding normal SL management.</span>
        </div>
      )}
      {pendingMessage && (
        <div className="mb-4 rounded-2xl border border-gold-300/20 bg-gold-300/[0.07] p-3.5 text-[12px] leading-5 text-gold-100">
          {pendingMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Opinion label="Ticket" value={ticket || "—"} />
        <Opinion label="Symbol" value={symbol || "—"} />
        <Opinion label="Direction" value={direction} />
        <Opinion label="Lot size" value={lots2(opinion.lot_size)} />
        <Opinion label="Entry price" value={num2(opinion.entry_price)} />
        <Opinion label="Current price" value={num2(opinion.current_price)} />
        <Opinion label="SL" value={num2(opinion.sl)} />
        <Opinion label="TP" value={num2(opinion.tp)} />
        <Opinion label="Floating P/L" value={money2(opinion.floating_pl)} />
        <Opinion label="Peak profit" value={money2(opinion.peak_profit)} />
        <Opinion label="Protected" value={money2(opinion.protected_profit)} />
        <Opinion label="Trade age" value={ageText(opinion.trade_age_minutes)} />
        <Opinion label="Setup type" value={opinion.setup_type || "—"} />
        <Opinion label="Grade" value={opinion.grade || "—"} />
        <Opinion label="AI confidence" value={pct0(opinion.ai_confidence ?? opinion.confidence)} />
        <Opinion label="Hold probability" value={pct0(opinion.hold_probability)} />
        <Opinion label="Exit probability" value={pct0(opinion.exit_probability)} />
        <Opinion label="Current Bot Decision" value={decision} />
      </div>

      {(opinion.distance_to_sl != null || opinion.distance_to_tp != null) && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Opinion label="Distance to SL" value={opinion.distance_to_sl != null ? opinion.distance_to_sl.toFixed(2) : "—"} />
          <Opinion label="Distance to TP" value={opinion.distance_to_tp != null ? opinion.distance_to_tp.toFixed(2) : "—"} />
        </div>
      )}

      {opinion.current_reason && (
        <div className="mt-4">
          <div className={MONO_LABEL}>Reason</div>
          <p className="mt-1 text-[13px] leading-5 text-white/70">{opinion.current_reason}</p>
        </div>
      )}
      {opinion.entry_reason && (
        <div className="mt-4">
          <div className={MONO_LABEL}>Why It Entered</div>
          <p className="mt-1 text-[13px] leading-5 text-white/70">{opinion.entry_reason}</p>
        </div>
      )}
      {opinion.hold_reason && (
        <div className="mt-3">
          <div className={MONO_LABEL}>Why It's Holding</div>
          <p className="mt-1 text-[13px] leading-5 text-white/70">{opinion.hold_reason}</p>
        </div>
      )}
      {opinion.protect_reason && (
        <div className="mt-3">
          <div className={MONO_LABEL}>Protection</div>
          <p className="mt-1 text-[13px] leading-5 text-white/70">{opinion.protect_reason}</p>
        </div>
      )}
      {opinion.exit_trigger_reason && (
        <div className="mt-3">
          <div className={MONO_LABEL}>What Would Make It Close</div>
          <p className="mt-1 text-[13px] leading-5 text-white/70">{opinion.exit_trigger_reason}</p>
        </div>
      )}
      {opinion.what_would_keep_holding && (
        <div className="mt-3">
          <div className={MONO_LABEL}>What Keeps It Holding</div>
          <p className="mt-1 text-[13px] leading-5 text-white/70">{opinion.what_would_keep_holding}</p>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white/80">
          <ShieldQuestion className="h-4 w-4 text-violet-300" />
          Would I enter this trade again right now?
        </div>
        <span className={`rounded-full border px-3 py-1 text-[12px] font-black ${VERDICT_STYLE[verdict] || VERDICT_STYLE.WAIT}`}>
          {verdict}
        </span>
      </div>
      {verdict !== "YES" && opinion.would_enter_again_reason && (
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

// ─── Current Bot Decision — the always-live "what is it doing right now"
// panel, sourced from the unconditional 60s heartbeat so it can never go
// stale the way the old feed-only view could when the bot was idle/blocked
// for a long stretch. ──────────────────────────────────────────────────────
const BOT_STATUS_META = {
  SCANNING:          { label: "Scanning",          icon: Search,      tone: "neutral" },
  WAITING:           { label: "Waiting",            icon: Clock3,      tone: "neutral" },
  BLOCKED:           { label: "Blocked",            icon: Pause,       tone: "warning" },
  ENTERING:          { label: "Entering",           icon: TrendingUp,  tone: "success" },
  MANAGING_TRADE:    { label: "Managing open trade", icon: Activity,   tone: "bullish" },
  PROTECTING_PROFIT: { label: "Protecting profit",  icon: ShieldAlert, tone: "success" },
  HOLDING:           { label: "Holding",            icon: Target,      tone: "neutral" },
  PREPARING_EXIT:    { label: "Preparing exit",     icon: LifeBuoy,    tone: "warning" },
  EXITING:           { label: "Exiting",            icon: XCircle,     tone: "danger" },
};

function BotDecisionPanel({ status }) {
  if (!status || !status.available) return null;
  const meta = BOT_STATUS_META[status.category] || { label: status.category, icon: Brain, tone: "neutral" };
  const tone = toneOf(meta.tone);
  const Icon = meta.icon;
  return (
    <div className={`rounded-3xl border ${tone.border} ${tone.bg} p-5`} data-testid="bot-decision-panel">
      <div className={`mb-3 flex items-center justify-between gap-2 ${MONO_LABEL}`}>
        <span className="flex items-center gap-2"><Brain className="h-3.5 w-3.5" /> Live Bot Thought</span>
        {status.stale && (
          <span className="normal-case tracking-normal text-[10px] font-bold text-rose-300">no update in {Math.floor((status.age_sec || 0) / 60)}m — check connection</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-2xl border ${tone.border} bg-black/20`}>
          <Icon className={`h-5 w-5 ${tone.text}`} />
        </div>
        <div className="min-w-0">
          <div className={`text-[18px] font-bold ${tone.text}`}>{meta.label}</div>
          <div className="text-[11px] text-white/35">{clock(status.ts)} · {relTime(status.ts)}</div>
        </div>
      </div>
      {status.status_text && (
        <p className="mt-4 text-[13px] leading-5 text-white/75">{status.status_text}</p>
      )}
      {status.reason && status.reason !== status.status_text && (
        <p className="mt-2 text-[12px] leading-5 text-white/45">{status.reason}</p>
      )}
    </div>
  );
}

// ─── Top-level export: the full AI Trading Assistant feed ─────────────────
// compact=true renders a single-card teaser (used on the Home page) that
// links into the full experience on the Trading tab, instead of duplicating
// the raw "Bot Decision Feed" log card that used to live there.
export default function AIThoughtFeed({ linked, compact = false, onOpenFull, onForceClose }) {
  const [cards, setCards] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [opinion, setOpinion] = useState(null);
  const [botStatus, setBotStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!linked) { setLoading(false); return; }
    try {
      const bust = Date.now();
      const [feedR, opR, statusR] = await Promise.all([
        feedAxios.get("/cloud/monitor/decision-feed", { params: { limit: compact ? 20 : 20, _t: Date.now() } }),
        compact ? Promise.resolve({ data: null }) : feedAxios.get("/cloud/monitor/current-opinion", { params: { _t: bust } }),
        compact ? Promise.resolve({ data: null }) : feedAxios.get("/cloud/monitor/bot-status", { params: { _t: bust } }),
      ]);
      const fresh = freshCards(feedR.data.cards || []);
      setCards(fresh);
      setTimeline(fresh.map((c) => ({ ts: c.ts, label: c.decision_text || c.headline, tone: c.tone })));
      setOpinion(opR.data);
      setBotStatus(statusR.data);
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
          <div className="rounded-2xl bg-[#0C0D12] p-6 text-center text-[12px] text-white/35">Reading the AI's thinking…</div>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl bg-[#0C0D12] p-6 text-center text-[12px] text-white/35">{NO_FRESH_DECISION_TEXT}</div>
        ) : (
          <ThoughtCard card={cards[0]} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ai-thought-feed">
      <BotDecisionPanel status={botStatus} />
      <CurrentTradePanel opinion={opinion} onForceClose={onForceClose} />
      <div className={`flex items-center gap-2 ${MONO_LABEL}`}>
        <Brain className="h-3.5 w-3.5" /> Recent Decisions
      </div>
      {loading ? (
        <div className="rounded-3xl border border-white/[0.07] bg-[#0d0e13] p-8 text-center text-[13px] text-white/35">
          Reading the AI's thinking…
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-3xl border border-white/[0.07] bg-[#0d0e13] p-8 text-center text-[13px] text-white/35">
          {NO_FRESH_DECISION_TEXT}
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
