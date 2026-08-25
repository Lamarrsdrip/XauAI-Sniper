import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Activity, BarChart3, Bot, Brain, CheckCircle2, ChevronDown, CircleDollarSign,
  Clock3, Copy, Flame, Gauge, History, Home, KeyRound, LineChart, Loader2,
  LogOut, Menu, Pause, Play, RefreshCw, Settings, Shield,
  SlidersHorizontal, TerminalSquare, TrendingUp, Wifi, XCircle, AlertTriangle, Search, Zap,
  Bell, GraduationCap, HelpCircle, Download, User, BookOpen, MessageCircle, ShieldCheck, Rocket, ArrowLeft, ChevronRight, Target,
  Trophy, Eye, Lock, Check,
} from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";
import AIThoughtFeed from "./AIThoughtFeed";
import AIMarketOutlookCard from "./AIMarketOutlookCard";
import M10VsOutlookCard, { M10_DECISION_LABELS, M30_LIFECYCLE_LABELS, humanEnumLabel } from "./M10VsOutlookCard";
import M10EngineCard, { normalizeSubscriberM10Evidence } from "./M10EngineCard";
import NotificationCenterPanel, { NotificationBell } from "./NotificationCenter";
import { signalAxios, SignalCard, RecentSignalsCard, planSummary, relTime, formatDate as fmtDate } from "./SubscriberSignalCards";
import { PaymentMethodModal } from "../BankTransferFlow";
import { useSignalCheckout, useBotCheckout } from "@/lib/signalCheckout";
import { API } from "@/lib/api";
import * as UI from "@/lib/ui";
import * as AK from "@/lib/appkit";
import { webPushSupported, webPushStatus, enableWebPush, disableWebPush, testWebPush } from "@/lib/webpush";
import { brokerBrand } from "@/lib/brokerDisplay";

// Map the legacy tone vocabulary used by helpers below (green/red/amber/blue/
// violet) onto the XauCloud design-system tones so screens read consistently.
const DS_TONE = { green: "profit", red: "loss", amber: "warn", blue: "info", violet: "gold", neutral: "neutral" };
const dsTone = (t) => DS_TONE[t] || "neutral";

// ─── Axios ───────────────────────────────────────────────────────────────────
const commandAxios = axios.create({ baseURL: API, withCredentials: true });

// ─── Constants ───────────────────────────────────────────────────────────────
const NAV = [
  ["home",      "Home",      Home      ],
  ["trading",   "Trading",   LineChart ],
  ["analytics", "Analytics", BarChart3 ],
  ["activity",  "Activity",  Activity  ],
];
const MORE_NAV = [
  ["intelligence", "AI Brain",  Brain,            "AI Director decisions, ML state, blocks"],
  ["control",      "Control",   SlidersHorizontal, "Bot on/off & Prop Firm protection"     ],
  ["license",      "License",   KeyRound,          "License binding and key management"    ],
  ["settings",     "Settings",  Settings,          "Account and app settings"              ],
];
const FILTERS = [
  ["all","All"],["entries","Entries"],["blocks","Blocks"],["exits","Exits"],
  ["risk","Risk"],["ai","AI"],["errors","Errors"],["overrides","Overrides"],
];
// The old customer-facing "Remote commands" card wall (Pause / Resume / Stop /
// Close all / Force sync / manual open) was removed 2026-08-08 — the single
// customer control authority is now the Bot ON/OFF toggle (BotControlCard),
// which itself queues PAUSE_NEW_TRADES / RESUME_TRADING through the SAME
// backend command infra (cloud_bot_commands + EA acknowledgement). No backend
// command capability was removed; only the duplicate old UI surface.
const PF_GROUPS = [
  { label: "Account", fields: [
    { key: "starting_balance", label: "Starting balance", kind: "money", step: "1", min: 0,
      note: "Your prop account's original balance. Total drawdown is measured from this number." },
  ]},
  { label: "Loss limits", fields: [
    { key: "daily_loss_pct", label: "Daily loss limit", kind: "pct", step: "0.1", min: 0.5, max: 20,
      note: "The most your account may lose in a single day before the bot stops opening new trades." },
    { key: "max_loss_pct", label: "Maximum total loss", kind: "pct", step: "0.1", min: 0.5, max: 30,
      note: "The overall drawdown ceiling for the whole account or challenge." },
    { key: "safety_buffer_pct", label: "Safety buffer", kind: "pct", step: "0.1", min: 0, max: 10,
      note: "The bot locks trading this far before the firm's stated limit, to absorb calculation differences. Keep this above zero." },
  ]},
  { label: "Risk", fields: [
    { key: "risk_per_trade_pct", label: "Risk per trade", kind: "pct", step: "0.01", min: 0.01, max: 2,
      note: "Risk taken on each individual trade, sized from your stop distance." },
    { key: "max_basket_risk_pct", label: "Maximum basket risk", kind: "pct", step: "0.01", min: 0.01, max: 4,
      note: "The combined risk allowed across all open positions at once." },
  ]},
];
const pfFmt = (kind, v) => kind === "money"
  ? `$${Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
  : `${Number(v || 0)}%`;
const DEFAULT_PROP = {
  enabled:false, starting_balance:0, daily_loss_pct:4, max_loss_pct:8,
  safety_buffer_pct:0.5, risk_per_trade_pct:0.15, max_basket_risk_pct:0.75,
  allow_retest_add:true, retest_add_lot_multi:0.25,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const money = (v) => Number(v||0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2});
const pct   = (v) => `${Number(v||0).toFixed(2)}%`;

const relativeTime = (iso) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s) || s < 0) return "just now";
  if (s < 60)    return `${Math.floor(s)}s ago`;
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
};
const severityTone = (sev) => {
  const s = String(sev||"INFO").toUpperCase();
  if (["CRITICAL","ERROR"].includes(s))   return "red";
  if (["WARNING","BLOCK"].includes(s))    return "amber";
  if (["TRADE","ENTRY","COMMAND"].includes(s))    return "green";
  if (["OVERRIDE"].includes(s))           return "violet";
  if (["EXIT","SYNC"].includes(s))        return "blue";
  return "neutral";
};

const eventDetails = (event) => event?.details || {};
const eventCategory = (event) => {
  const d = eventDetails(event);
  const raw = String(event?.event_category || d.event_category || "").toLowerCase();
  if (raw) return raw;
  const text = `${event?.event_type||""} ${event?.severity||""} ${event?.message||""} ${d.module||""} ${d.reason||""}`.toUpperCase();
  if (/OVERRIDE|LOSS_CLOSE_BLOCKED|IGNORED/.test(text)) return "overrides";
  if (/TRADE_EXECUTED|ENTRY|FIRE|PYR/.test(text) || ["TRADE","ENTRY"].includes(String(event?.severity||"").toUpperCase())) return "entries";
  if (/BLOCK|VETO/.test(text)) return "blocks";
  if (/EXIT|CLOSE|CLOSED/.test(text) || String(event?.severity||"").toUpperCase()==="EXIT") return "exits";
  if (/ERROR|FAILED|CRITICAL/.test(text)) return "errors";
  if (/RISK|LOT|GROWTH|LOCK|DRAWDOWN|MARGIN/.test(text)) return "risk";
  if (/AI|DIRECTOR|ML|BRAIN|CONFIDENCE/.test(text)) return "ai";
  return "info";
};
const getEventField = (event, key, fallback="") => {
  const d = eventDetails(event);
  return event?.[key] ?? d?.[key] ?? fallback;
};
const getEventTicket = (event) => String(getEventField(event, "ticket", "") || getEventField(event, "posId", "") || getEventField(event, "position_id", ""));
const getEventDecision = (event) => getEventField(event, "decision", "") || event?.message || "Decision recorded";
const getEventReason = (event) => getEventField(event, "reason", "") || event?.message || "";
const yesNo = (v) => v === undefined || v === null || v === "" ? "" : v ? "YES" : "NO";
const eventRepeatText = (event) => {
  const count = Number(event?.repeat_count || 1);
  if (count <= 1) return "";
  return `Repeated ${count - 1} times in last 15 minutes.`;
};
const eventMatchesSearch = (event, term) => {
  const q = String(term||"").trim().toLowerCase();
  if (!q) return true;
  const d = eventDetails(event);
  return [
    event?.event_type, event?.severity, event?.symbol, event?.message, event?.ts,
    event?.module, event?.decision, event?.reason, event?.blocked_by, event?.ticket,
    event?.final_decision, event?.final_blocker, event?.pipeline_stage, event?.broker_retcode,
    d.module, d.decision, d.reason, d.blocked_by, d.ticket, d.symbol,
    d.close_reason_exact, d.closed_by_module, d.position_direction,
    d.final_decision, d.final_blocker, d.pipeline_stage, d.broker_retcode,
  ].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
};
const latestDecisionEvent = (events=[]) => events.find(e => /entries|blocks|exits|risk|ai|errors|overrides/.test(eventCategory(e))) || events[0];
// v6.25.2 owner directive 2026-07-17 -- AI confidence/market bias/verdict are
// posted by the EA on /cloud/monitor/activity (BotActivityReq.ai_confidence /
// .market_bias), never on the heartbeat payload (BotHeartbeatReq has no such
// fields, and the EA's heartbeat WebRequest body never sends them either) --
// heartbeat.ai_confidence was therefore always undefined and every "AI" tile
// permanently showed 0/"Neutral"/"Waiting" with nothing telling the operator
// this was a wiring gap rather than the AI still warming up. Find the newest
// activity event that actually carries a real ai_confidence value instead.
// 30 min: generous vs. the EA's ~10 min M10 decision cadence, but bounded --
// an ai_confidence value from hours/days ago must never display as current.
const AI_FIELDS_STALE_MIN = 30;
const latestAiFieldsEvent = (events=[]) => events.find(e => {
  const v = getEventField(e, "ai_confidence", null);
  if (v === null || v === undefined || v === "") return false;
  const ageMin = e.ts ? (Date.now() - new Date(e.ts).getTime()) / 60000 : Infinity;
  return ageMin <= AI_FIELDS_STALE_MIN;
}) || null;
const weightedEventCount = (events=[]) => events.reduce((sum,e)=>sum + Number(e.repeat_count||1), 0);

// ─── Design tokens ───────────────────────────────────────────────────────────
// Exchange-style flush panel (borderless raised block) — replaces the old
// floating bordered card so remaining `${CARD}` usages read as dense panels.
const CARD = "rounded-2xl bg-[#0C0D12]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

function pill(tone) {
  const m = { green:"bg-emerald-400/12 text-emerald-300 border-emerald-400/20", red:"bg-red-500/12 text-red-300 border-red-400/20", amber:"bg-gold-300/12 text-gold-200 border-gold-300/20", blue:"bg-sky-300/12 text-sky-200 border-sky-300/20", neutral:"bg-white/[0.06] text-white/50 border-white/[0.08]", violet:"bg-violet-300/12 text-violet-200 border-violet-300/20" };
  return `border rounded-full px-2.5 py-0.5 text-[10px] font-bold ${m[tone]||m.neutral}`;
}
function cardTone(tone) {
  // Borderless flush tints — match the exchange-style panels (no floating
  // bordered tiles). Default is the plain panel surface.
  const m = { green:"bg-emerald-300/[0.07]", red:"bg-red-500/[0.07]", amber:"bg-gold-300/[0.07]", blue:"bg-sky-300/[0.07]", violet:"bg-violet-300/[0.07]" };
  return `rounded-2xl ${m[tone]||"bg-[#0C0D12]"}`;
}

// ─── Shared components ────────────────────────────────────────────────────────
function Metric({ label, value, detail, icon:Icon, tone="amber" }) {
  return (
    <div className={`${cardTone(tone)} p-4 min-w-0 overflow-hidden`}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className={MONO_LABEL}>{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5 opacity-40" />}
      </div>
      <div className="break-words font-mono text-[1.35rem] font-black leading-none tracking-tight">{value}</div>
      {detail && <div className="mt-1.5 break-words text-[11px] leading-4 text-white/40">{detail}</div>}
    </div>
  );
}

function Card({ title, subtitle, children, action, className="" }) {
  return (
    <section className={`${CARD} ${className}`}>
      {(title||action) && (
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] leading-5 text-white/42">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

function Empty({ title, body, icon:Icon=Bot }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-8 text-center">
      <Icon className="mx-auto mb-3 h-6 w-6 text-gold-300/60" />
      <div className="text-[14px] font-semibold">{title}</div>
      <p className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-white/38">{body}</p>
    </div>
  );
}

// ─── Bot-required gate ──────────────────────────────────────────────────────
// The ONE Command Center product rule (2026-08-25): a customer who hasn't
// bought the XauCloud bot still sees every normal page/nav item -- only the
// functionality that genuinely requires their own connected MT5/EA is
// locked, in place, with a real in-app purchase CTA (never a homepage
// redirect -- see useBotCheckout). This is the shared locked-state building
// block for both a compact Home teaser card and a full locked page.
// `onLinkLicense` covers the customer who already owns a XauCloud bot
// license (bought before this account existed, or bought separately) --
// without it, their only path forward here was the anonymous purchase
// flow, which would have sold them a license they already have. Every
// bot-locked surface offers both: buy new, or link what you already own.
function BotRequiredGate({ title = "XauCloud Bot Required", body, bullets = [], onBuyBot, onLinkLicense }) {
  return (
    <div className="rounded-2xl bg-panel p-5" data-testid="bot-required-gate">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold text-white/90">
        <Lock className="h-4 w-4 text-gold-300" /> {title}
      </div>
      <p className="mt-2 text-[12.5px] leading-5 text-white/50">{body}</p>
      {bullets.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[12px] text-white/55">
              <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-gold-300" /> {b}
            </li>
          ))}
        </ul>
      )}
      <button onClick={onBuyBot} className="no-select mt-4 w-full rounded-xl bg-gold-300 py-2.5 text-[12.5px] font-black text-black" data-testid="bot-required-gate-cta">
        Get XauCloud Bot
      </button>
      {onLinkLicense && (
        <button onClick={onLinkLicense} className="no-select mt-2 w-full rounded-xl bg-white/[0.06] py-2.5 text-[12px] font-bold text-white/70 hover:bg-white/[0.1]" data-testid="bot-required-gate-link-license">
          Already own XauCloud? Link license
        </button>
      )}
    </div>
  );
}

const BOT_FEATURE_BULLETS = ["Automated XAUUSD execution", "Your live MT5 positions", "Personal bot analytics", "Risk controls", "Bot activity and monitoring"];

/** Full-page version -- used for whole nav tabs (Trading, Analytics, AI Brain, Control) that are entirely personal-bot data. The nav item itself always stays visible and reachable; only what's behind it is locked. */
function BotRequiredPage({ title, sub, onBuyBot, onLinkLicense }) {
  return (
    <AK.Screen>
      <AK.ScreenHeader title={title} sub={sub || "Requires the XauCloud automated trading bot"} />
      <BotRequiredGate
        body="This feature connects directly to your personal XauCloud trading bot and MT5 account."
        bullets={BOT_FEATURE_BULLETS}
        onBuyBot={onBuyBot}
        onLinkLicense={onLinkLicense}
      />
    </AK.Screen>
  );
}

function Sparkline({ points=[], tone="#d4af37", height="h-20" }) {
  const vals = points.length ? points : [0,0,0,0,0];
  const mn = Math.min(...vals), mx = Math.max(...vals), span = mx-mn||1;
  const d = vals.map((v,i) => {
    const x = (i/Math.max(vals.length-1,1))*100;
    const y = 36 - ((v-mn)/span)*30;
    return `${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 40" className={`w-full overflow-visible ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.18" />
          <stop offset="100%" stopColor={tone} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={`${d} L100,40 L0,40 Z`} fill="url(#sg)" />
      <path d={d} fill="none" stroke={tone} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EventRow({ event, onForceOpen }) {
  const tone = severityTone(event.severity);
  const d = eventDetails(event);
  const dotColor = { red:"bg-red-400", amber:"bg-gold-300", green:"bg-emerald-400", blue:"bg-sky-300", violet:"bg-violet-300", neutral:"bg-white/30" }[tone]||"bg-white/30";
  const module = getEventField(event, "module", "");
  const decision = getEventDecision(event);
  const reason = getEventReason(event);
  const ticket = getEventTicket(event);
  const allowed = getEventField(event, "allowed", getEventField(event, "trade_allowed", undefined));
  const candidateAllowed = getEventField(event, "candidate_allowed", undefined);
  const finalAllowed = getEventField(event, "final_execution_allowed", undefined);
  const finalDecision = getEventField(event, "final_decision", "");
  const finalBlocker = getEventField(event, "final_blocker", getEventField(event, "blocked_by", ""));
  const openTradeCalled = getEventField(event, "open_trade_called", undefined);
  const repeat = eventRepeatText(event);

  // Force Open eligibility: a real, recent blocked candidate with a usable
  // direction + setup. Staleness (15min) and the remaining hard-safety
  // checks are enforced authoritatively server-side (backend + EA) — this
  // is just "don't even show the button for something obviously unusable."
  const direction = getEventField(event, "signal_direction", "");
  const setupName = event.setup || getEventField(event, "setup", "") || module;
  const grade = event.grade || getEventField(event, "grade", "");
  const symbol = event.symbol || d.symbol || getEventField(event, "symbol", "XAUUSD");
  const signalPriceRaw = getEventField(event, "signal_price",
    getEventField(event, "price", getEventField(event, "entry_price", "")));
  const signalPrice = Number(signalPriceRaw);
  const scoreRaw = getEventField(event, "score", "");
  const score = Number(scoreRaw);
  const eventAgeMin = event.ts ? (Date.now() - new Date(event.ts).getTime()) / 60000 : Infinity;
  const canForceOpen = Boolean(
    onForceOpen && String(event.severity).toUpperCase() === "BLOCK" &&
    /BUY|SELL/i.test(direction) && setupName && eventAgeMin <= 15
  );
  const forceOpenClick = () => {
    const candleTime = event.ts ? new Date(event.ts).getTime() / 1000 : Date.now() / 1000;
    onForceOpen({
      action: "FORCE_OPEN_TRADE",
      label: "Force Open Trade",
      detail: `This trade was blocked by: ${finalBlocker || reason || "soft filter"}. You are manually overriding the bot's soft filter. Hard risk and broker safety still apply — the EA will re-check spread, margin, stops, and your risk cap at current price before opening anything.`,
      tone: "amber",
      dangerous: true,
      icon: AlertTriangle,
      payload: {
        direction: /BUY/i.test(direction) ? "BUY" : "SELL",
        symbol,
        setup: setupName,
        grade: grade || "B",
        original_blocker: finalBlocker || reason || "UNKNOWN",
        candle_time: candleTime,
        signal_price: Number.isFinite(signalPrice) ? signalPrice : undefined,
        score: Number.isFinite(score) ? score : undefined,
        event_time: event.ts || "",
        signal_id: event.id || "",
      },
    });
  };
  const facts = [
    ["Symbol", symbol],
    ["Mode", getEventField(event, "mode", "")],
    ["Bias", getEventField(event, "market_bias", "")],
    ["Signal", getEventField(event, "signal_direction", "")],
    ["AI", getEventField(event, "ai_confidence", "")],
    ["Score", getEventField(event, "score", "")],
    ["Candidate", yesNo(candidateAllowed)],
    ["Final", finalAllowed === undefined ? yesNo(allowed) : yesNo(finalAllowed)],
    ["Decision", finalDecision],
    ["FinalBlocker", finalBlocker],
    ["OpenTrade", yesNo(openTradeCalled)],
    ["Retcode", getEventField(event, "broker_retcode", "")],
    ["Ticket", ticket],
    ["P/L", getEventField(event, "profit", "")],
    ["Close", getEventField(event, "close_reason_exact", "")],
  ].filter(([,v]) => v !== undefined && v !== null && String(v) !== "");
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <span className={`mt-[6px] h-2 w-2 flex-none rounded-full ${dotColor}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={MONO_LABEL}>{event.severity||"INFO"} · {event.event_type||"EVENT"}{module?` · ${module}`:""}</span>
          <span className="flex-none text-[10px] text-white/30">{relativeTime(event.ts)}</span>
        </div>
        <div className="mt-1 break-words text-[13px] leading-5 text-white/78">{decision}</div>
        {reason && reason !== decision && <div className="mt-1 break-words text-[12px] leading-5 text-white/45">{reason}</div>}
        {getEventField(event, "blocked_by", "") && <div className="mt-1 text-[12px] text-gold-200/80">Blocked by: {getEventField(event, "blocked_by", "")}</div>}
        {facts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {facts.slice(0,10).map(([k,v])=>(
              <span key={`${k}-${v}`} className="rounded-full border border-white/[0.06] bg-black/20 px-2 py-0.5 text-[10px] text-white/45">{k}: {String(v)}</span>
            ))}
          </div>
        )}
        {repeat && <div className="mt-2 text-[11px] font-semibold text-violet-200">{repeat}</div>}
        {canForceOpen && (
          <button onClick={forceOpenClick} data-testid="force-open-trade-button"
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-gold-300/25 bg-gold-300/10 px-3 py-1.5 text-[11px] font-bold text-gold-200 transition hover:bg-gold-300/20">
            <Zap className="h-3 w-3" /> Force Open Trade
          </button>
        )}
      </div>
    </div>
  );
}

function DecisionSummaryCard({ events=[], heartbeat={}, setActive, title="Latest bot decision" }) {
  const event = latestDecisionEvent(events);
  const d = eventDetails(event);
  const allowed = event ? getEventField(event, "allowed", getEventField(event, "trade_allowed", undefined)) : undefined;
  const finalAllowed = event ? getEventField(event, "final_execution_allowed", undefined) : undefined;
  const finalDecision = event ? getEventField(event, "final_decision", "") : "";
  const finalBlocker = event ? getEventField(event, "final_blocker", getEventField(event, "blocked_by", "")) : "";
  const tone = event ? severityTone(event.severity) : "neutral";
  const displayAllowed = finalAllowed === undefined ? allowed : finalAllowed;
  return (
    <Card
      title={title}
      subtitle="Clean M10 decision feed from the EA, deduplicated before it reaches this screen."
      action={setActive && <button onClick={()=>setActive("activity")} className="rounded-full border border-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-white/55 hover:text-white">Open feed</button>}
    >
      {event ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={pill(tone)}>{event.severity||"INFO"}</span>
            <span className={pill(eventCategory(event)==="overrides"?"violet":"neutral")}>{event.event_type||"DECISION"}</span>
            {getEventField(event, "module", "") && <span className={pill("neutral")}>{getEventField(event, "module", "")}</span>}
            <span className="ml-auto text-[10px] text-white/30">{relativeTime(event.ts)}</span>
          </div>
          <div className="text-[17px] font-black leading-tight">{getEventDecision(event)}</div>
          <div className="text-[12px] leading-5 text-white/45">{getEventReason(event) || event.message}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Final" value={displayAllowed===undefined?"—":displayAllowed?"YES":"NO"} detail={finalDecision || finalBlocker || "Execution result"} icon={Shield} tone={displayAllowed===false?"amber":displayAllowed===true?"green":"neutral"} />
            <Metric label="Bias" value={getEventField(event,"market_bias","—")||"—"} detail={event.symbol||heartbeat.symbol||"XAUUSD"} icon={Activity} tone="blue" />
            <Metric label="AI" value={getEventField(event,"ai_confidence","—")||"—"} detail="Confidence" icon={Brain} tone="violet" />
            <Metric label="Score" value={getEventField(event,"score","—")||"—"} detail={getEventField(event,"signal_direction","")||"Signal"} icon={Gauge} tone="amber" />
          </div>
          {eventRepeatText(event) && <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.05] p-3 text-[12px] text-violet-100">{eventRepeatText(event)}</div>}
        </div>
      ) : (
        <Empty title="Waiting for decision feed" body="The EA will publish one clean M10 decision event after the next completed M10 scan." icon={Activity} />
      )}
    </Card>
  );
}

function DecisionStats({ events=[] }) {
  const counts = ["entries","blocks","exits","risk","ai","errors","overrides"].reduce((acc,key)=>{
    acc[key] = weightedEventCount(events.filter(e=>eventCategory(e)===key));
    return acc;
  }, {});
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Metric label="Entries" value={counts.entries||0} detail="Allowed/fired" icon={TrendingUp} tone="green" />
      <Metric label="Blocks" value={counts.blocks||0} detail="Rejected signals" icon={Shield} tone={counts.blocks?"amber":"neutral"} />
      <Metric label="Exits" value={counts.exits||0} detail="Close decisions" icon={History} tone="blue" />
      <Metric label="Overrides" value={counts.overrides||0} detail="Safety bypasses" icon={AlertTriangle} tone={counts.overrides?"violet":"neutral"} />
      <Metric label="Risk" value={counts.risk||0} detail="Lot/risk decisions" icon={Gauge} tone="amber" />
      <Metric label="AI" value={counts.ai||0} detail="AI/ML events" icon={Brain} tone="violet" />
      <Metric label="Errors" value={counts.errors||0} detail="Faults" icon={XCircle} tone={counts.errors?"red":"neutral"} />
      <Metric label="Total" value={weightedEventCount(events)} detail="Deduped events" icon={Activity} tone="blue" />
    </div>
  );
}

function DecisionHistory({ events=[] }) {
  const grouped = events.reduce((acc,event)=>{
    const ticket = getEventTicket(event);
    if (!ticket) return acc;
    if (!acc[ticket]) acc[ticket] = [];
    acc[ticket].push(event);
    return acc;
  }, {});
  const rows = Object.entries(grouped)
    .map(([ticket,items])=>[ticket, items.sort((a,b)=>new Date(a.ts)-new Date(b.ts))])
    .sort((a,b)=>new Date(b[1][b[1].length-1]?.ts||0)-new Date(a[1][a[1].length-1]?.ts||0))
    .slice(0,5);
  return (
    <Card title="Decision History" subtitle="Per-trade chain: entry, lot choice, hold/exit attempts, blocked exits, and final close reason.">
      {rows.length ? (
        <div className="space-y-3">
          {rows.map(([ticket,items])=>(
            <div key={ticket} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={MONO_LABEL}>Ticket {ticket}</span>
                <span className="text-[10px] text-white/30">{items.length} decisions</span>
              </div>
              <div className="space-y-2">
                {items.slice(-8).map((e,i)=>(
                  <div key={e.id||i} className="flex gap-2 text-[12px] leading-5">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-gold-300/70" />
                    <div className="min-w-0">
                      <span className="text-white/75">{getEventDecision(e)}</span>
                      {getEventReason(e) && getEventReason(e)!==getEventDecision(e) && <span className="text-white/35"> · {getEventReason(e)}</span>}
                      <span className="text-white/25"> · {relativeTime(e.ts)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No trade decision history yet" body="When events include a ticket, the Command Center will group the complete decision chain here." icon={History} />
      )}
    </Card>
  );
}

function CopyBtn({ value, label="Copy" }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(()=>setDone(false),1500); } catch {}
  };
  return (
    <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold text-white/60 hover:text-white transition">
      <Copy className="h-3 w-3" /> {done?"Copied!":label}
    </button>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={value} onClick={()=>onChange(!value)}
      className={`relative h-7 w-12 flex-none rounded-full transition-colors duration-200 ${value?"bg-emerald-400":"bg-white/12"}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all duration-200 ${value?"left-[22px]":"left-0.5"}`} />
    </button>
  );
}

function CommandModal({ command, onCancel, onSubmit, busy, message, licenseKey }) {
  const [key, setKey] = useState(licenseKey||"");
  useEffect(()=>{ if(licenseKey) setKey(licenseKey); },[licenseKey]);
  if (!command) return null;
  const Icon = command.icon;
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/80 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-8 backdrop-blur-md sm:items-center sm:pb-0" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-[28px] border border-white/[0.09] bg-[#0d0e13] p-5 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className={`mb-4 inline-flex rounded-2xl p-3 ${cardTone(command.tone)}`}>
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-xl font-bold">{command.label}</h3>
        <p className="mt-1.5 text-[13px] leading-5 text-white/50">{command.detail}</p>
        {command.dangerous && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-400/20 bg-red-500/[0.08] p-3 text-[12px] text-red-200">
            <AlertTriangle className="h-4 w-4 flex-none mt-0.5 text-red-400" />
            High-impact command. EA must acknowledge before the dashboard marks it executed.
          </div>
        )}
        <div className="mt-4">
          <label className={`block mb-1.5 ${MONO_LABEL}`}>License key</label>
          <input value={key} onChange={e=>setKey(e.target.value.toUpperCase())} placeholder="ASE-XXXX-XXXX"
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-gold-300/40" />
        </div>
        {message && <div className="mt-3 rounded-xl border border-gold-300/20 bg-gold-300/[0.07] p-3 text-[12px] text-gold-200">{message}</div>}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button onClick={onCancel} className="rounded-xl border border-white/[0.08] bg-white/[0.04] py-3 text-[13px] font-semibold text-white/60 hover:text-white transition">Cancel</button>
          <button onClick={()=>onSubmit(key)} disabled={busy}
            className={`rounded-xl py-3 text-[13px] font-bold disabled:opacity-50 ${command.tone==="red"?"bg-red-400 text-black":"bg-gold-300 text-black"}`}>
            {busy?"Queueing…":"Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────
function useAuthGuard() {
  // Authentication is checked by the HttpOnly-cookie-backed /auth/me call
  // in fetchAll. No script-readable bearer token is used.
}

function AppShell({ active, setActive, children, logout, statusText, online, eaVersion, notifOpen, setNotifOpen }) {
  const moreActive = ["more", "education", "support", "patterns", "intelligence", "control", "license", "settings"].includes(active);

  return (
    <div className="min-h-screen bg-[#050507] pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-white" data-testid="bot-monitor-dashboard">
      <InstallAppPrompt />

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(212,175,55,0.09),transparent_40%),radial-gradient(ellipse_at_10%_0%,rgba(16,185,129,0.06),transparent_35%)]" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#050507]/90 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pb-3 pt-safe-top">
          <Link to="/command/dashboard" className="flex min-w-0 items-center gap-2.5">
            <XauAiLogo size={30} className="flex-none" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold leading-none">XauCloud</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-gold-300/55">Command · {eaVersion || "Waiting"}</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <div className={`hidden rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:flex items-center gap-1.5 ${online?"border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300":"border-red-400/20 bg-red-400/[0.06] text-red-300"}`}>
              {online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              {statusText}
            </div>
            <NotificationBell onClick={() => setNotifOpen(true)} />
            <button onClick={logout} className="rounded-full border border-white/[0.07] bg-white/[0.03] p-2 text-white/45 hover:text-white transition">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <NotificationCenterPanel open={notifOpen} onClose={() => setNotifOpen(false)} />

      {/* Page content */}
      <main className="relative z-10 mx-auto max-w-5xl overflow-x-hidden px-4 py-5 pb-8">
        {children}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] border-t border-white/[0.07] bg-[#050507]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-sm items-center justify-around px-3 py-2">
          {NAV.map(([id,label,Icon])=>{
            const a = active===id;
            return (
              <button key={id} onClick={()=>setActive(id)}
                className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-5 py-2 transition-all ${a?"bg-gold-300 text-black":"text-white/38 hover:text-white/70"}`}>
                <Icon className="h-[18px] w-[18px]" />
                <span className="text-[10px] font-semibold tracking-tight">{label}</span>
              </button>
            );
          })}
          <button onClick={()=>setActive("more")}
            className={`no-select flex min-w-0 flex-col items-center gap-1 rounded-2xl px-5 py-2 transition-all ${moreActive?"bg-gold-300 text-black":"text-white/38 hover:text-white/70"}`}>
            <Menu className="h-[18px] w-[18px]" />
            <span className="text-[10px] font-semibold tracking-tight">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

// ─── Main controller ──────────────────────────────────────────────────────────
// The ONE Command Center shell (2026-08-25) -- every signed-in user renders
// this exact same component: same AppShell, same nav, same page router. The
// only thing that changes per user is `ownsBot`, computed below from the
// `entitlement` prop the default export at the bottom of this file fetches
// once from GET /cloud/entitlement. `ownsBot` decides, per nav tab, whether
// a genuinely bot-personal page (Trading/Analytics/AI Brain/Control) renders
// for real or as a BotRequiredPage lock, and swaps Home's personal-bot
// widgets for the subscriber-safe Market Outlook/10-Minute Engine/Recent
// Signals cards plus a single purchase teaser. It never renders a second,
// smaller dashboard component -- see the CRITICAL PRODUCT RULE this
// replaced (previously: entitlement.bot_license selected between this
// function and a separate, smaller, now-deleted signal-only dashboard).
function LicensedCloudDashboard({ entitlement, entFailed }) {
  useAuthGuard();
  const navigate = useNavigate();
  // Fail-safe (unchanged from the previous router): a transient entitlement
  // fetch failure never locks anything for an existing customer.
  const ownsBot = entFailed || Boolean(entitlement?.bot_license);
  const botCheckout = useBotCheckout(API);
  const [botCheckoutMe, setBotCheckoutMe] = useState(null);
  const [botLifetimePriceKobo, setBotLifetimePriceKobo] = useState(null);
  useEffect(() => {
    if (ownsBot) return;
    commandAxios.get("/cloud/auth/me").then((r) => setBotCheckoutMe(r.data)).catch(() => {});
    commandAxios.get("/cloud/billing").then((r) => setBotLifetimePriceKobo(r.data?.plans?.bot_lifetime?.price_kobo ?? null)).catch(() => {});
  }, [ownsBot]);
  const [active, setActive] = useState("home");
  const [notifOpen, setNotifOpen] = useState(false);
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState(null);
  const [license, setLicense] = useState(null);
  const [events, setEvents] = useState([]);
  const [commands, setCommands] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [modalCommand, setModalCommand] = useState(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandMsg, setCommandMsg] = useState("");
  const [licenseInput, setLicenseInput] = useState("");
  const [propFirm, setPropFirm] = useState(null);
  const [propFirmForm, setPropFirmForm] = useState(DEFAULT_PROP);
  const [propFirmConfirmed, setPropFirmConfirmed] = useState(false);
  const [propFirmBusy, setPropFirmBusy] = useState(false);
  const propFirmDirty = useRef(false);
  const [analytics, setAnalytics] = useState(null);
  // v6.25.6 XAU-027 (Codex handover) -- stable idempotency key per confirm-
  // dialog instance. Regenerates only when modalCommand itself changes
  // (a genuinely new action/dialog open), so a double-click on the same
  // open confirmation reuses the same key and the backend dedupes it into
  // one queued command instead of two.
  const modalIdempotencyKey = useMemo(
    () => (modalCommand ? (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`) : null),
    [modalCommand]
  );
  const propFirmIdempotencyKey = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [meR, stR, actR, cmdR, licR, pfR, anR] = await Promise.all([
        commandAxios.get("/cloud/auth/me"),
        commandAxios.get("/cloud/monitor/status"),
        commandAxios.get("/cloud/monitor/activity", { params:{ kind:filter, limit:100 } }),
        commandAxios.get("/cloud/command/recent",   { params:{ limit:20 } }),
        commandAxios.get("/cloud/license/status"),
        commandAxios.get("/cloud/prop-firm/config"),
        commandAxios.get("/cloud/performance/analytics").catch(()=>({ data:null })),
      ]);
      setMe(meR.data); setStatus(stR.data);
      setEvents(actR.data.events||[]); setCommands(cmdR.data.commands||[]);
      setLicense(licR.data); setPropFirm(pfR.data);
      setAnalytics(anR.data);
      if (!propFirmDirty.current && pfR.data?.requested)
        setPropFirmForm({ ...DEFAULT_PROP, ...pfR.data.requested });
      if (licR.data?.license?.activation_key) setLicenseInput(licR.data.license.activation_key);
    } catch (err) {
      if (err.response?.status===401) navigate("/command/login");
    } finally { setLoading(false); }
  }, [filter, navigate]);

  useEffect(()=>{ fetchAll(); const id=setInterval(fetchAll,8000); return()=>clearInterval(id); },[fetchAll]);

  const linkLicense = async () => {
    setCommandMsg("");
    try { await commandAxios.post("/cloud/license/link",{ license_key:licenseInput }); setCommandMsg("License linked. Waiting for EA heartbeat."); fetchAll(); }
    catch (e) { setCommandMsg(e.response?.data?.detail||"License link failed"); }
  };

  const queueCommand = async (licenseKey) => {
    if (!modalCommand) return;
    setCommandBusy(true); setCommandMsg("");
    try {
      const body = { action:modalCommand.action, pin:licenseKey, confirm:true, idempotency_key: modalIdempotencyKey };
      if (modalCommand.payload) body.payload = modalCommand.payload;
      const r = await commandAxios.post("/cloud/command/request", body);
      setCommandMsg(r.data.duplicate
        ? `Already queued ${modalCommand.label}: ${r.data.command_id}`
        : `Queued ${modalCommand.label}: ${r.data.command_id}`);
      setModalCommand(null); fetchAll();
    } catch (e) { setCommandMsg(e.response?.data?.detail||"Command failed"); }
    finally { setCommandBusy(false); }
  };

  const applyPropFirm = async () => {
    if (!propFirmConfirmed) { setCommandMsg("Confirm you've checked these values against your prop firm's rules."); return; }
    setPropFirmBusy(true); setCommandMsg("");
    // Stable across a double-click of this exact confirmed submission; a
    // fresh key is only minted once this attempt actually completes (or
    // the form is marked dirty again below), so a genuinely new edit gets
    // its own dedupe identity rather than colliding with a stale one.
    if (!propFirmIdempotencyKey.current) {
      propFirmIdempotencyKey.current = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    }
    try {
      const r = await commandAxios.post("/cloud/command/request",{ action:"UPDATE_PROP_FIRM_CONFIG", pin:licenseInfo.activation_key, confirm:true, payload:propFirmForm, idempotency_key: propFirmIdempotencyKey.current });
      setCommandMsg(r.data.duplicate ? `Prop Firm Mode already queued: ${r.data.command_id}` : `Prop Firm Mode queued: ${r.data.command_id}`);
      setPropFirmConfirmed(false); propFirmDirty.current=false; propFirmIdempotencyKey.current=null; fetchAll();
    } catch (e) { setCommandMsg(e.response?.data?.detail||"Update failed"); }
    finally { setPropFirmBusy(false); }
  };

  const logout = async () => {
    try { await commandAxios.post("/cloud/auth/logout"); } catch {}
    navigate("/command");
  };

  const heartbeat   = status?.heartbeat || {};
  const licenseInfo = license?.license || status?.license || {};
  const online      = Boolean(status && !status.offline && heartbeat.account_number);
  const tradingOk   = Boolean(heartbeat.algo_trading && heartbeat.trading_allowed && heartbeat.mt5_connected);
  const statusText  = online ? humanBotState(heartbeat.bot_state, heartbeat.open_positions||0, tradingOk, online) : "NO HEARTBEAT";
  // Customer-facing product identity -- ALWAYS from the authoritative
  // release manifest via status.release, never the raw heartbeat.ea_version
  // (an internal EA build/experiment string, e.g.
  // "V6.25.24_M10_FIXED10SL_EXPERIMENT"). The raw value remains available
  // as internalBuildName for Support Diagnostics only (SettingsPage).
  const eaVersion         = status?.release?.public_display_name || "XauCloud";
  const internalBuildName = heartbeat.ea_version || licenseInfo.ea_version || status?.license?.ea_version || "";
  const productionStatus  = status?.production_status || null;
  // v6.25.3 owner directive 2026-07-17 (Phase 7A P0) -- this used to be
  // `[base-d*1.4, base-d, base-d*0.55, base-d*0.2, equity]`, a made-up
  // 5-point interpolation from the CURRENT balance/equity/daily_pnl, not
  // real trade history. Now sourced from GET /cloud/performance/analytics'
  // real cumulative equity curve (built from actual EA-reported closed
  // trades). Empty until enough verified trades exist -- Sparkline renders
  // a flat line rather than a fabricated shape, and hasSufficientAnalytics
  // below lets pages show "Not enough verified data" explicitly.
  const equityPoints = useMemo(() => {
    if (!analytics?.sufficient_data || !Array.isArray(analytics.equity_curve)) return [];
    return analytics.equity_curve.map((p) => Number(p.cumulative_profit || 0));
  }, [analytics]);
  const hasSufficientAnalytics = Boolean(analytics?.sufficient_data);

  if (loading||!me) return (
    <div className="flex min-h-screen items-center justify-center bg-[#050507] text-white">
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-gold-300" />
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">Loading</div>
      </div>
    </div>
  );

  return (
    <AppShell active={active} setActive={setActive} logout={logout} statusText={statusText} online={online} eaVersion={eaVersion} notifOpen={notifOpen} setNotifOpen={setNotifOpen}>
      {active==="home"         && <HomePage status={status} heartbeat={heartbeat} licenseInfo={licenseInfo} online={online} tradingOk={tradingOk} equityPoints={equityPoints} hasSufficientAnalytics={hasSufficientAnalytics} events={events} setActive={setActive} refresh={fetchAll} openCommand={setModalCommand} commands={commands} analytics={analytics} ownsBot={ownsBot} entitlement={entitlement} onBuyBot={botCheckout.open} />}
      {active==="trading"      && (ownsBot ? <TradingPage heartbeat={heartbeat} events={events} online={online} tradingOk={tradingOk} linked={Boolean(license?.linked||status?.license?.linked)} openCommand={setModalCommand} /> : <BotRequiredPage title="Trading" onBuyBot={botCheckout.open} onLinkLicense={() => setActive("license")} />)}
      {active==="analytics"    && (ownsBot ? <AnalyticsPage heartbeat={heartbeat} events={events} equityPoints={equityPoints} analytics={analytics} /> : <BotRequiredPage title="Analytics" onBuyBot={botCheckout.open} onLinkLicense={() => setActive("license")} />)}
      {active==="intelligence" && (ownsBot ? <IntelligencePage heartbeat={heartbeat} events={events} status={status} /> : <BotRequiredPage title="AI Brain" onBuyBot={botCheckout.open} onLinkLicense={() => setActive("license")} />)}
      {active==="activity"     && (ownsBot ? <ActivityPage events={events} filter={filter} setFilter={setFilter} onForceOpen={setModalCommand} /> : <SubscriberActivityPage />)}
      {active==="control"      && (ownsBot ? <ControlPage heartbeat={heartbeat} online={online} commands={commands} openCommand={setModalCommand} commandMsg={commandMsg} licenseKey={licenseInfo.activation_key} linked={Boolean(license?.linked||status?.license?.linked)} setActive={setActive} propFirm={propFirm} propFirmForm={propFirmForm} setPropFirmForm={setPropFirmForm} markDirty={()=>{propFirmDirty.current=true; propFirmIdempotencyKey.current=null;}} propFirmConfirmed={propFirmConfirmed} setPropFirmConfirmed={setPropFirmConfirmed} propFirmBusy={propFirmBusy} applyPropFirm={applyPropFirm} /> : <BotRequiredPage title="Control" onBuyBot={botCheckout.open} onLinkLicense={() => setActive("license")} />)}
      {active==="license"      && <LicensePage license={license} licenseInput={licenseInput} setLicenseInput={setLicenseInput} linkLicense={linkLicense} commandMsg={commandMsg} heartbeat={heartbeat} me={me} status={status} />}
      {active==="billing"      && <BillingPage setActive={setActive} />}
      {active==="settings"     && <SettingsPage me={me} heartbeat={heartbeat} licenseInfo={licenseInfo} logout={logout} status={status} />}
      {active==="more"         && <MorePage setActive={setActive} me={me} status={status} openNotifications={()=>setNotifOpen(true)} logout={logout} />}
      {active==="education"    && <EducationPage setActive={setActive} />}
      {active==="support"      && <SupportCenterPage setActive={setActive} me={me} />}
      {active==="patterns"     && <PatternScannerPage setActive={setActive} events={events} heartbeat={heartbeat} />}
      <CommandModal command={modalCommand} onCancel={()=>setModalCommand(null)} onSubmit={queueCommand} busy={commandBusy} message={commandMsg} licenseKey={licenseInfo.activation_key} />

      {botCheckout.showModal && (
        <PaymentMethodModal
          api={API}
          priceDisplay={billingNaira(botLifetimePriceKobo)}
          buyerName={botCheckoutMe?.full_name || ""}
          buyerEmail={botCheckoutMe?.email || ""}
          subtitle={`${billingNaira(botLifetimePriceKobo)} · ${botCheckoutMe?.email || ""}`}
          onPaystack={() => { botCheckout.closeModal(); botCheckout.payByPaystack(botCheckoutMe?.full_name || "", botCheckoutMe?.email || ""); }}
          onNomba={() => { botCheckout.closeModal(); botCheckout.payByNomba(botCheckoutMe?.full_name || "", botCheckoutMe?.email || ""); }}
          onClose={botCheckout.closeModal}
        />
      )}
      {botCheckout.error && !botCheckout.showModal && (
        <div className="mx-auto mt-4 max-w-md px-4 text-center font-mono text-[12px] text-rose-400">{botCheckout.error}</div>
      )}
    </AppShell>
  );
}

// ─── Home helpers ─────────────────────────────────────────────────────────────
// Investigation note (2026-08-04, ticket 152427437796): this was labelled
// plain "Session" on the dashboard, which reads as if it reflects the bot's
// own trading-session classification -- it does not. It is only ever the
// viewer's browser clock at render time, unrelated to any specific trade or
// to the EA's own SessionTag() (which uses broker server time and different
// hour boundaries, e.g. broker-hour 8 = "LDN" for the EA but this function's
// old boundary put UTC-hour 8 in "London" too -- the two can still diverge
// whenever broker-server time isn't UTC, or simply because this reflects
// "right now" rather than the time of whatever trade the viewer is actually
// looking at). Neither the EA's heartbeat payload nor BotHeartbeatReq
// carries a real broker-session field today, so this cannot be corrected to
// show genuine broker-time session without an EA telemetry change; renamed
// and relabelled instead so it can no longer be mistaken for that.
function getViewerClockSession() {
  const h = new Date().getUTCHours();
  if (h >= 22 || h < 7)  return { label:"Asia",         tone:"blue"    };
  if (h >= 7  && h < 12) return { label:"London",       tone:"amber"   };
  if (h >= 12 && h < 17) return { label:"London / NY",  tone:"green"   };
  if (h >= 17 && h < 22) return { label:"New York",     tone:"amber"   };
  return                         { label:"After Hours",  tone:"neutral" };
}

// v6.25.2 -- reads market_bias from the EA's own latest AI-confidence-bearing
// activity event (see latestAiFieldsEvent below), not from the heartbeat
// object, which never carries this field. Falls back to the raw bot_state
// only as a last resort so this never regresses to a hard crash on no data.
function getMarketBias(aiEvent, hb) {
  const s = String(getEventField(aiEvent, "market_bias", "") || hb?.bot_state || "").toUpperCase();
  if (s.includes("BULL") || s.includes("LONG"))  return { label:"Bullish", tone:"green" };
  if (s.includes("BEAR") || s.includes("SHORT")) return { label:"Bearish", tone:"red"   };
  return                                                 { label:"Neutral", tone:"neutral"};
}

function humanBotState(raw, openTrades, tradingOk, online) {
  if (!online) return "Offline";
  if (openTrades > 0) return "In Position";
  const r = (raw||"").toUpperCase();
  if (r.includes("PAUSE") || r.includes("STOP"))   return "Paused";
  if (r.includes("BLOCK"))                          return "Blocked";
  if (tradingOk)                                    return "Monitoring";
  return "Standby";
}

// ─── Home ─────────────────────────────────────────────────────────────────────
// v6.25.0 — M10 Intelligent Signal Engine + exhaustion-evidence-only +
// smart re-entry transparency. Every value here comes straight from the
// EA's own m10_signal JSON block (backend/server.py BotActivityReq.m10_signal
// -> details.m10_signal on the latest /cloud/monitor/activity event) --
// nothing is recomputed client-side, so this can never show a value the EA
// itself did not actually compute.
function latestM10Signal(events, heartbeat) {
  const candidates = (events || []).filter(e => e?.details?.m10_signal);
  const newest = candidates.reduce((best, e) => {
    const ts = new Date(e.ts || e.timestamp || 0).getTime();
    if (!best || ts > best._ts) return { ...e, _ts: ts };
    return best;
  }, null);
  const latest = newest?.details?.m10_signal;
  if (!latest) return null;

  const accountMatches = !heartbeat?.account_number || !latest.account || String(heartbeat.account_number) === String(latest.account);
  const symbolMatches = !heartbeat?.symbol || !latest.symbol || heartbeat.symbol === latest.symbol;
  return accountMatches && symbolMatches ? latest : null;
}

// M10SignalCard was extracted to M10EngineCard.jsx (2026-08-25 dashboard
// unification fix) so the exact same rich evidence panel can be reused for
// the free/trial/signal-subscriber Home page, not just a bot owner's.

// v6.25.5 — M30 three-M10-evidence consensus mode transparency. Same
// convention as M10SignalCard directly above: every value comes straight
// from the EA's own m30_consensus JSON block (backend/server.py
// BotActivityReq.m30_consensus -> details.m30_consensus), nothing
// recomputed client-side. Renders nothing at all when the EA is running in
// M10-legacy mode (mode_active=false) or has never posted the field --
// this card only ever appears for an account actually running M30 mode.
function M30ConsensusCard({ events, heartbeat }) {
  const candidates = (events || []).filter(e => e?.details?.m30_consensus?.mode_active);
  const newest = candidates.reduce((best, e) => {
    const ts = new Date(e.ts || e.timestamp || 0).getTime();
    if (!best || ts > best._ts) return { ...e, _ts: ts };
    return best;
  }, null);
  const latest = newest?.details?.m30_consensus;
  if (!latest || !latest.mode_active) return null;

  const c = latest.consensus || {};
  const decision = c.decision || "DATA_PENDING";
  const preferredDir = c.preferred_direction || "NONE";
  const decisionTone = decision === "BUY_CANDIDATE" ? "green"
    : decision === "SELL_CANDIDATE" ? "red"
    : decision.startsWith("WAIT_FOR") ? "amber"
    : decision === "DATA_PENDING" ? "blue"
    : "neutral";

  const evidenceRows = [
    ["Newest", latest.m10_evidence_newest],
    ["Middle", latest.m10_evidence_middle],
    ["Oldest", latest.m10_evidence_oldest],
  ].filter(([, ev]) => ev && ev.evidence_id != null);

  return (
    <div className={`${CARD} p-5`} data-testid="m30-consensus-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={MONO_LABEL}>M30 Consensus Mode · {latest.decision_mode || "—"}</div>
        <span className={pill(decisionTone)}>{humanEnumLabel(decision, M10_DECISION_LABELS)}</span>
      </div>

      <p className="mt-3 text-[11px] leading-4 text-white/45">
        Slot {c.slot_close_time || "—"} · preferred direction <span className="text-white/70 font-semibold">{preferredDir}</span>
        {" — "}{c.reason || "waiting for three consecutive complete M10 snapshots"}
      </p>

      {c.data_complete && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-[11px]">
          <div><div className="text-white/35">Weighted buy</div><div className="mt-0.5 font-mono text-white/80">{Number(c.weighted_buy_score || 0).toFixed(1)}</div></div>
          <div><div className="text-white/35">Weighted sell</div><div className="mt-0.5 font-mono text-white/80">{Number(c.weighted_sell_score || 0).toFixed(1)}</div></div>
          <div><div className="text-white/35">Observation wins</div><div className="mt-0.5 font-mono text-white/80">{c.buy_observation_wins ?? 0} buy / {c.sell_observation_wins ?? 0} sell</div></div>
          <div><div className="text-white/35">Persistence</div><div className="mt-0.5 font-mono text-white/80">{Number(c.directional_persistence_pct || 0).toFixed(0)}%</div></div>
        </div>
      )}

      {evidenceRows.length > 0 && (
        <div className="mt-4 space-y-1.5 text-[11px]">
          {evidenceRows.map(([label, ev]) => (
            <div key={label} className="flex items-center justify-between gap-2 text-white/45">
              <span className="text-white/35 w-14 shrink-0">{label}</span>
              <span className="font-mono text-white/70 truncate">#{ev.evidence_id} · buy {Number(ev.buy_case_score || 0).toFixed(0)} / sell {Number(ev.sell_case_score || 0).toFixed(0)} · {ev.decision || "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* v6.25.6 XAU-026 (Codex handover) -- real candidate/timer lifecycle.
          Every value below comes straight from the EA's own m30_consensus.consensus
          block; has_active_candidate is the authoritative gate (0-valued
          timer/price fields are real possible values, not "no candidate"). */}
      <div className="mt-4 pt-4 border-t border-white/[0.06]">
        <div className={MONO_LABEL}>Candidate Lifecycle</div>
        {c.has_active_candidate ? (
          <>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className={pill(c.lifecycle_state === "ENTRY_TIMER_ACTIVE" ? "amber" : "blue")}>
                {humanEnumLabel(c.lifecycle_state, M30_LIFECYCLE_LABELS)}
              </span>
              <span className="text-[10px] text-white/35 font-mono truncate">{c.candidate_id || "—"}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-[11px]">
              <div><div className="text-white/35">Timer</div><div className="mt-0.5 font-mono text-white/80">{Math.round(c.timer_elapsed_seconds ?? 0)}s / {Math.round(c.timer_duration_seconds ?? 0)}s</div></div>
              <div><div className="text-white/35">Remaining</div><div className="mt-0.5 font-mono text-white/80">{Math.round(c.timer_remaining_seconds ?? 0)}s</div></div>
              <div><div className="text-white/35">Origin price</div><div className="mt-0.5 font-mono text-white/80">{c.origin_price != null ? Number(c.origin_price).toFixed(2) : "—"}</div></div>
              {/* v6.26.0: move_r_since_origin arrives from the EA's own raw
                  telemetry JSON as a risk-scaled multiple (representation-
                  only migration, same x100 R-to-pips convention as every
                  other threshold) -- converted at display time since this
                  is a pass-through activity field, never re-picked-apart
                  server-side. */}
              <div><div className="text-white/35">Move since origin</div><div className="mt-0.5 font-mono text-white/80">{c.move_r_since_origin != null ? `${(Number(c.move_r_since_origin) * 100).toFixed(1)} pips` : "—"}</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/35">
              <span className={pill("neutral")}>Structural SL: {(c.structural_sl_status || "").replace(/_/g, " ").toLowerCase() || "unavailable"}</span>
              <span className={pill("neutral")}>Reservation: {(c.reservation_key_status || "").replace(/_/g, " ").toLowerCase() || "unavailable"}</span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[11px] leading-4 text-white/45">
            No active candidate{c.lifecycle_state ? ` — ${humanEnumLabel(c.lifecycle_state, M30_LIFECYCLE_LABELS)}` : ""}.
          </p>
        )}
        {c.last_outcome_result && (
          <p className="mt-2 text-[10px] text-white/35">
            Last resolved: <span className="text-white/60 font-mono">{c.last_outcome_result}</span>
            {c.last_outcome_at ? ` at ${c.last_outcome_at}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// Compact Home "open-position summary" -- owner spec removed the full "Open
// Trade Thinking" dashboard (ticket/entry/SL/TP/peak-profit/hold-probability
// grid + Force Close) from Home entirely. Full detail + Force Close now live
// only under Trading -> Open Trades -> Trade Details (AIThoughtFeed's
// CurrentTradePanel, still mounted there unchanged). This reuses the same
// genuine /cloud/monitor/current-opinion evidence -- no new data source --
// but renders only symbol/direction/P&L/protected status, never the removed
// fields, and never a Force Close control.
// Exchange-style open-position module (Bybit/Binance-tier): symbol · side ·
// running, big floating P&L, entry/current/stop row, protected-floor line,
// tap to full trade detail. Only renders when a trade is genuinely open.
function PositionModule({ linked, online, onDetails }) {
  const [opinion, setOpinion] = useState(null);
  const fetchOpinion = useCallback(async () => {
    if (!linked || !online) return;
    try { const r = await commandAxios.get("/cloud/monitor/current-opinion", { params: { _t: Date.now() } }); setOpinion(r.data); }
    catch { /* keep last-known state */ }
  }, [linked, online]);
  useEffect(() => { fetchOpinion(); const id = setInterval(fetchOpinion, 8000); return () => clearInterval(id); }, [fetchOpinion]);
  if (!linked || !online || !opinion?.open) return null;

  const dir = String(opinion.direction || "").toUpperCase();
  const isBuy = dir === "BUY";
  const pnl = Number(opinion.floating_pl || 0);
  const prot = Number(opinion.protected_profit || 0);
  const entry = opinion.entry_price ?? opinion.entry;
  const current = opinion.current_price ?? opinion.price ?? opinion.current_bid ?? opinion.current;
  const sl = opinion.sl ?? opinion.stop_loss ?? opinion.sl_price;
  const px = (v) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const hasLevels = [entry, current, sl].some((v) => v != null && v !== "");

  return (
    <div className="overflow-hidden rounded-2xl bg-panel" data-testid="home-open-position-summary">
      <div className="flex items-center gap-2 px-4 pt-3.5">
        <span className="text-[15px] font-bold">{opinion.symbol || "XAUUSD"}</span>
        <span className={AK.cx("rounded-md px-1.5 py-0.5 text-[11px] font-bold", isBuy ? "bg-profit/14 text-profit" : "bg-loss/14 text-loss")}>{dir || "—"}</span>
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-wider text-gold-300">Running</span>
      </div>
      <div className={AK.cx("nums px-4 pt-1.5 text-[28px] font-black tracking-tight", pnl >= 0 ? "text-profit" : "text-loss")}>{money(pnl)}</div>
      {hasLevels && (
        <div className="flex px-4 pt-2.5">
          <div className="flex-1"><div className="text-[10px] uppercase tracking-wider text-white/40">Entry</div><div className="nums mt-0.5 text-[13.5px] font-semibold">{px(entry)}</div></div>
          <div className="flex-1"><div className="text-[10px] uppercase tracking-wider text-white/40">Current</div><div className="nums mt-0.5 text-[13.5px] font-semibold">{px(current)}</div></div>
          <div className="flex-1 text-right"><div className="text-[10px] uppercase tracking-wider text-white/40">Stop</div><div className="nums mt-0.5 text-[13.5px] font-semibold">{px(sl)}</div></div>
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between px-4 py-3">
        {prot > 0
          ? <span className="text-[11.5px] text-white/55"><span className="text-gold-300">◆</span> Protected {money(prot)}</span>
          : <span className="text-[11.5px] text-white/40">Managing position</span>}
        {onDetails && <button onClick={onDetails} className="no-select inline-flex items-center text-[12px] font-semibold text-white/50 active:text-white">Details <ChevronRight className="h-4 w-4" /></button>}
      </div>
    </div>
  );
}

// ── New-Home modules (exchange-class, approved concept) ─────────────────────
function AccountStrip({ heartbeat, status, online, onClick }) {
  const tf = status?.production_status?.display_timeframe || "M10";
  return (
    <button onClick={onClick} className="no-select flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-panel px-3 py-2.5 text-left active:bg-white/[0.03]">
      <span className={AK.cx("h-[7px] w-[7px] flex-none rounded-full", online ? "bg-profit" : "bg-white/30")} style={online ? { boxShadow: "0 0 0 3px rgba(47,211,160,.14)" } : undefined} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/50">
        {online
          ? <>Live · <b className="font-semibold text-white/80">Acct {heartbeat.account_number || "—"}</b> · {brokerBrand(heartbeat.broker_server) || "Broker"} · {heartbeat.symbol || "XAUUSD"} · {tf}</>
          : <>Offline · <b className="font-semibold text-white/70">Waiting for EA heartbeat</b></>}
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-white/25" />
    </button>
  );
}

function EquityHero({ online, equity, balance, pnl, pnlPos, points, linked }) {
  const parts = online ? money(equity).replace(/^[-$]*/, "").split(".") : ["—", ""];
  const pctTxt = online && pnl && balance ? `${((pnl / Number(balance)) * 100).toFixed(2)}%` : "";
  return (
    <div className="px-1 pt-1">
      <div className="text-[11px] uppercase tracking-[0.14em] text-white/40">Equity</div>
      <div className="mt-1.5 flex items-end justify-between gap-4">
        <div className="nums text-[34px] font-extrabold leading-none tracking-tight">
          {online ? <>${parts[0]}<span className="text-[24px] text-white/45">.{parts[1] || "00"}</span></> : "—"}
        </div>
        {online && <div className="w-[104px] flex-none"><Sparkline points={points} tone={pnlPos ? "#2FD3A0" : "#F0616D"} height="h-[44px]" /></div>}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-[12.5px]">
        {online ? <>
          <span className={AK.cx("inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold", pnlPos ? "bg-profit/12 text-profit" : "bg-loss/12 text-loss")}>{pnlPos ? "▲" : "▼"} {money(pnl)}</span>
          <span className="text-white/45">{pctTxt ? `${pnlPos ? "+" : ""}${pctTxt} today · ` : ""}Bal {money(balance)}</span>
        </> : <span className="text-white/40">{linked ? "Waiting for EA heartbeat" : "Link your license to go live"}</span>}
      </div>
    </div>
  );
}

function OutlookModule({ outlook, online, onOpen }) {
  const dir = String(outlook?.primary_direction || "NO_VALID_OUTLOOK").toUpperCase();
  const actionable = dir === "BUY" || dir === "SELL";
  const conf = Number(outlook?.confidence_pct || 0);
  const entryLo = outlook?.preferred_entry_zone_low, entryHi = outlook?.preferred_entry_zone_high;
  return (
    <div className="overflow-hidden rounded-2xl bg-panel">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold"><LineChart className="h-4 w-4 text-gold-300" /> AI Market Outlook</div>
        <button onClick={onOpen} className="no-select inline-flex items-center text-[12px] text-white/40 active:text-white/70">View <ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="px-4 pb-4">
        {actionable ? <>
          <div className="flex items-center gap-2.5">
            <span className={AK.cx("rounded-lg px-2.5 py-1 text-[15px] font-bold", dir === "BUY" ? "bg-profit/14 text-profit" : "bg-loss/14 text-loss")}>{dir}</span>
            <span className="text-[12px] text-white/45">XAUUSD · {conf >= 55 ? "execution ready" : "forming"}</span>
            <div className="ml-auto text-right"><div className="nums text-[17px] font-bold">{conf}%</div><div className="text-[10px] uppercase tracking-wider text-white/40">Confidence</div></div>
          </div>
          <div className="mt-3 h-[5px] overflow-hidden rounded bg-[#20242e]"><div className="h-full rounded" style={{ width: `${Math.max(4, Math.min(100, conf))}%`, background: "linear-gradient(90deg,#C9962E,#F3C969)" }} /></div>
          <div className="mt-3 flex gap-6">
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Entry</div><div className="nums mt-0.5 text-[13.5px] font-semibold">{entryLo ?? "—"}{entryHi ? `–${entryHi}` : ""}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Stop</div><div className="nums mt-0.5 text-[13.5px] font-semibold">{outlook?.suggested_sl ?? "—"}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-white/40">Target</div><div className="nums mt-0.5 text-[13.5px] font-semibold">{outlook?.tp1_price ?? "—"}</div></div>
          </div>
        </> : (
          <div className="flex items-center gap-2 py-1 text-[12.5px] text-white/45"><span className="h-[7px] w-[7px] rounded-full bg-gold-300/70" /> No valid setup right now — XauCloud is watching the market.</div>
        )}
      </div>
    </div>
  );
}

function StatChips({ online, ddNum, winRate, spread, openTrades }) {
  const items = [
    ["Open risk", online ? `${Number(ddNum || 0).toFixed(1)}%` : "—"],
    ["Win rate", winRate != null ? `${Number(winRate).toFixed(0)}%` : "—"],
    ["Spread", online ? `${spread ?? "-"}pts` : "—"],
    ["Open", online ? openTrades : "—"],
  ];
  return (
    <div className="native-scroll flex gap-2.5 overflow-x-auto">
      {items.map(([l, v]) => (
        <div key={l} className="min-w-[86px] flex-1 rounded-xl border border-white/[0.07] bg-panel px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-white/40">{l}</div>
          <div className="nums mt-1 text-[15px] font-bold">{v}</div>
        </div>
      ))}
    </div>
  );
}

// Compact Home "recent activity" -- owner spec: Home must show genuine
// recent activity without the removed raw AI-reasoning/blocker feed. Reuses
// the same `events` data HomePage already receives (no new API call),
// filtered to plain-language trade lifecycle events only.
const clockTime = (iso) => { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

// Visible-by-default, internally-scrolling list -- same pattern as the
// public homepage's 30-Day Replay trade list (GoldReplaySection.jsx:
// max-h-[...] + overflow-y-auto). Corrected 2026-08-25: an earlier pass
// collapsed this behind a tap-to-expand accordion, which is explicitly NOT
// what was wanted -- the latest rows must already be visible, with the
// page kept short by a bounded, scrollable container instead of a hidden
// one. No new fetch: reuses the same `events` data HomePage already loads.
function HomeRecentActivity({ events = [], heartbeat, onOpenFull }) {
  const todayStr = new Date().toDateString();
  const closedToday = (events || []).filter((e) => eventCategory(e) === "exits" && new Date(e.ts || e.timestamp || 0).toDateString() === todayStr);
  const wins = closedToday.filter((e) => Number(getEventField(e, "profit", 0)) >= 0).length;
  const losses = closedToday.length - wins;
  const dailyPnl = Number(heartbeat?.daily_pnl || 0);
  const meaningful = (events || []).filter((e) => ["entries", "exits"].includes(eventCategory(e))).slice(0, 20);

  return (
    <AK.Panel>
      <AK.PanelHead title="Closed Trades" onMore={meaningful.length > 0 ? onOpenFull : undefined} />
      <div className="px-4 pb-2">
        {closedToday.length > 0 ? (
          <div className="flex items-center gap-4 text-[11.5px] text-white/50" data-testid="closed-trades-summary">
            <span>Today <span className="font-mono font-bold text-white/85">{closedToday.length}</span></span>
            <span className="font-mono font-bold text-white/85">{wins}W / {losses}L</span>
            <span className={`font-mono font-bold ${dailyPnl >= 0 ? "text-profit" : "text-loss"}`}>{money(dailyPnl)}</span>
          </div>
        ) : (
          <div className="text-[11.5px] text-white/40">No closed trades today</div>
        )}
      </div>
      {meaningful.length === 0 ? (
        <div className="px-4 pb-3.5 text-[12.5px] text-white/40">No closed trades yet.</div>
      ) : (
        <div className="max-h-[320px] overflow-y-auto pb-1.5" data-testid="home-recent-activity">
          {meaningful.map((e, i) => {
            const opened = eventCategory(e) === "entries";
            const sym = e.symbol || getEventField(e, "symbol", "XAUUSD");
            const dir = getEventField(e, "signal_direction", "") || getEventField(e, "position_direction", "");
            const pnlRaw = getEventField(e, "profit", "");
            const hasPnl = pnlRaw !== "" && pnlRaw !== null && pnlRaw !== undefined;
            return (
              <AK.FeedItem key={e.id || i}
                time={clockTime(e.ts)}
                title={opened ? "Trade opened" : "Trade closed"}
                tone={opened ? "gold" : hasPnl ? (Number(pnlRaw) >= 0 ? "profit" : "loss") : "white"}
                detail={`${dir ? dir + " " : ""}${sym}${hasPnl ? ` · ${money(Number(pnlRaw))}` : ""}`}
                last={i === meaningful.length - 1}
              />
            );
          })}
        </div>
      )}
    </AK.Panel>
  );
}

// Simple push on/off toggle, surfaced on the dashboard. First-party (VAPID).
// Bug fix (2026-08-25): this toggle only ever registered the raw browser
// push subscription (device-level). It never set cloud_notification_prefs'
// `tier`, which is the field sendSubscriberSignalNotification/
// sendOutlookNotification actually check before delivering anything --
// with no prefs row at all, delivery silently skips the user forever
// (`if (!prefs) continue`). Only the bot-owner-only Outlook settings page
// ever wrote that field, so a free/trial/subscriber user who enabled this
// exact toggle could never actually receive a signal notification. Now
// mirrors the minimum tier that unlocks delivery (see TIER_RANK in
// notifications.ts) whenever this toggle turns on, and turns it back off
// when disabled, so the toggle's label ("On for this device") is true both
// for the device registration and for actual delivery.
function NotificationPrompt() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (webPushSupported()) webPushStatus().then(setStatus).catch(() => {}); }, []);
  if (!webPushSupported() || !status) return null;
  const set = async (next) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        await enableWebPush(commandAxios);
        await commandAxios.post("/outlook/notifications/prefs", { tier: "HOURLY_ONLY" });
      } else {
        await commandAxios.post("/outlook/notifications/prefs", { tier: "OFF" }).catch(() => {});
        await disableWebPush(commandAxios);
      }
      setStatus(await webPushStatus());
    } catch { /* keep last state */ } finally { setBusy(false); }
  };
  return (
    <AK.Panel>
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex-none rounded-lg bg-gold-300/12 p-2"><Bell className="h-4 w-4 text-gold-300" /></span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold">Push notifications</div>
            <div className="truncate text-[11.5px] text-white/45">{busy ? "Working…" : status.subscribed ? "On for this device" : "Trade, outlook & system alerts"}</div>
          </div>
        </div>
        <Toggle value={Boolean(status.subscribed)} onChange={set} />
      </div>
    </AK.Panel>
  );
}

// ── Bot ON/OFF — real control, not decorative ───────────────────────────────
// Wired to the existing safe remote-command infra: RESUME_TRADING (on) /
// PAUSE_NEW_TRADES (off). OFF stops NEW automatic entries only — the EA keeps
// its heartbeat and keeps managing any already-open position (SL, profit
// floor, runner, emergency protection). We never show "Off" until the EA
// acknowledges: a queued-but-unacked command renders as Pausing…/Resuming…,
// read back from the recent-commands ack status.
function BotControlCard({ heartbeat, online, linked, openTrades, openCommand, commands }) {
  const raw = String(heartbeat.bot_state || "").toUpperCase();
  const paused = raw.includes("PAUSE") || raw.includes("STOP");
  const pending = (commands || []).find(
    (c) => ["PAUSE_NEW_TRADES", "RESUME_TRADING", "STOP_TRADING"].includes(c.action) &&
      ["PENDING", "ACKED"].includes(String(c.status || "").toUpperCase()),
  );
  const turningTo = pending ? (pending.action === "RESUME_TRADING" ? "on" : "off") : null;

  let stateLabel, stateTone, running;
  if (!online) { stateLabel = "EA offline"; stateTone = "neutral"; running = false; }
  else if (turningTo === "off") { stateLabel = "Pausing…"; stateTone = "warn"; running = false; }
  else if (turningTo === "on") { stateLabel = "Resuming…"; stateTone = "profit"; running = true; }
  else if (paused) { stateLabel = "Paused"; stateTone = "warn"; running = false; }
  else { stateLabel = "Running"; stateTone = "profit"; running = true; }

  const turnOff = () => openCommand({
    action: "PAUSE_NEW_TRADES", label: "Turn Bot Off", icon: Pause, tone: "amber", dangerous: false,
    detail: openTrades > 0
      ? `New automatic entries will stop. Your ${openTrades} open position${openTrades > 1 ? "s" : ""} stay protected and managed — stop-loss, profit floor and runner logic keep running until they close naturally.`
      : "New automatic entries will stop. The EA keeps its heartbeat and will still manage any position that opens before it acknowledges.",
  });
  const turnOn = () => openCommand({
    action: "RESUME_TRADING", label: "Turn Bot On", icon: Play, tone: "green", dangerous: false,
    detail: "New valid trades may open again using the normal evidence engine, owner blockers and risk rules. Turning on never forces an immediate trade.",
  });

  const disabled = !online || !linked || Boolean(turningTo);
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className={AK.cx("flex h-9 w-9 flex-none items-center justify-center rounded-xl", running ? "bg-profit/12 text-profit" : online ? "bg-gold-300/12 text-gold-300" : "bg-white/[0.06] text-white/40")}>
        <Bot className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold leading-tight">Trading Bot · {stateLabel}</div>
        <div className="mt-0.5 text-[11.5px] leading-4 text-white/45">
          {running ? "Opening valid trades automatically" : online ? "New entries paused — open trades protected" : "Waiting for EA heartbeat"}
        </div>
      </div>
      <button type="button" role="switch" aria-checked={running} aria-label="Toggle trading bot" disabled={disabled}
        onClick={() => (running ? turnOff() : turnOn())}
        className={AK.cx("relative h-[29px] w-[50px] flex-none rounded-full transition-colors disabled:opacity-40", running ? "bg-gold-300" : "bg-white/[0.14]")}>
        <span className={AK.cx("absolute top-[3px] h-[23px] w-[23px] rounded-full bg-black shadow transition-all", running ? "left-[24px]" : "left-[3px]")} />
      </button>
    </div>
  );
}

// ── Continue Learning (Home) ────────────────────────────────────────────────
function ContinueLearningCard({ academy, setActive }) {
  const total = academy?.required_count || 0;
  const done = academy?.completed_count || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <AK.Panel>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className={MONO_LABEL}>Continue Learning</span>
          <GraduationCap className="h-4 w-4 text-gold-300/60" />
        </div>
        <div className="mt-1.5 text-[14px] font-bold">XauCloud Forex Academy</div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full bg-gold-300" style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
        </div>
        <div className="mt-1.5 text-[11.5px] text-white/45">{pct}% complete · {done}/{total || "—"} lessons</div>
        <button onClick={() => setActive("education")} className="no-select mt-3 w-full rounded-xl bg-white/[0.06] py-2 text-[12px] font-bold text-white/80 transition hover:bg-white/[0.09]">
          {done > 0 ? "Continue Learning" : "Start Learning for Free"}
        </button>
      </div>
    </AK.Panel>
  );
}

// ── Subscriber/trial Home (no bot license) ──────────────────────────────────
// Same Command Center shell, nav and page components as a bot owner --
// this is ONLY the Home page body for a signed-in user who hasn't bought
// the bot. Global XauCloud intelligence (Market Outlook, 10-Minute Engine,
// Recent Signals, Manual Trading, Academy) works exactly the same way it
// does for a bot owner (their entitlement grants the same signal APIs via
// license OR trial OR subscription -- see entitlements.ts). Only "my bot"
// widgets (equity, positions, on/off control) are replaced by one
// BotRequiredGate teaser. See CRITICAL PRODUCT RULE, 2026-08-25.
function SubscriberHomePage({ entitlement, setActive, onBuyBot }) {
  const [localEntitlement, setLocalEntitlement] = useState(entitlement);
  useEffect(() => { setLocalEntitlement(entitlement); }, [entitlement]);

  const [outlook, setOutlook] = useState({ loading: true, data: null, locked: false, unavailable: false, error: "" });
  const [engine, setEngine] = useState({ loading: true, data: null, locked: false, unavailable: false, error: "" });
  const [recent, setRecent] = useState({ loading: true, signals: [], locked: false, error: "" });
  const [academy, setAcademy] = useState(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialError, setTrialError] = useState("");

  const fetchSignal = useCallback((path, setState) => {
    signalAxios.get(path)
      .then((r) => setState({ loading: false, data: r.data, locked: false, unavailable: !r.data.available, error: "" }))
      .catch((e) => {
        if (e.response?.status === 403 && e.response?.data?.reason === "NOT_ENTITLED") {
          setState({ loading: false, data: null, locked: true, unavailable: false, error: "" });
        } else {
          setState({ loading: false, data: null, locked: false, unavailable: false, error: "Could not load this right now." });
        }
      });
  }, []);

  useEffect(() => {
    const load = () => {
      fetchSignal("/cloud/signals/outlook", setOutlook);
      fetchSignal("/cloud/signals/engine", setEngine);
      signalAxios.get("/cloud/signals/recent")
        .then((r) => setRecent({ loading: false, signals: r.data.signals || [], locked: false, error: "" }))
        .catch((e) => {
          if (e.response?.status === 403 && e.response?.data?.reason === "NOT_ENTITLED") setRecent({ loading: false, signals: [], locked: true, error: "" });
          else setRecent({ loading: false, signals: [], locked: false, error: "Could not load recent signals." });
        });
      signalAxios.get("/cloud/academy/progress").then((r) => setAcademy(r.data)).catch(() => {});
    };
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [fetchSignal]);

  const startTrial = async () => {
    setTrialBusy(true); setTrialError("");
    try {
      const r = await signalAxios.post("/cloud/signals/trial/start", {});
      setLocalEntitlement(r.data.entitlement);
      fetchSignal("/cloud/signals/outlook", setOutlook);
      fetchSignal("/cloud/signals/engine", setEngine);
    } catch (e) {
      setTrialError(e.response?.data?.message || e.response?.data?.detail || "Could not start your trial. Please try again.");
    } finally {
      setTrialBusy(false);
    }
  };

  const summary = planSummary(localEntitlement);

  return (
    <div className="space-y-3 pt-1">
      <AK.Panel>
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">Your plan</div>
            <div className="mt-1 text-[16px] font-bold" data-testid="subscriber-plan-title">{summary.title}</div>
            {summary.sub && <div className="mt-1 text-[12px] text-white/45">{summary.sub}</div>}
          </div>
          {summary.showStartTrial && <AK.Button size="sm" onClick={startTrial} disabled={trialBusy} data-testid="subscriber-start-trial">{trialBusy ? "Starting…" : "Start 3-Day Trial"}</AK.Button>}
          {summary.showUpgrade && !summary.showStartTrial && <AK.Button size="sm" onClick={() => setActive("billing")}>Subscribe</AK.Button>}
        </div>
        {trialError && <div className="px-4 pb-3 text-[12px] text-rose-400">{trialError}</div>}
      </AK.Panel>

      <NotificationPrompt />
      <CommandToolsStrip setActive={setActive} />

      {outlook.locked ? (
        <SignalCard title="Market Outlook" icon={LineChart} state={outlook} />
      ) : (
        <AIMarketOutlookCard linked online subscriberSignal={outlook.data?.signal ?? null} subscriberLoading={outlook.loading} subscriberError={Boolean(outlook.error)} />
      )}
      <M10EngineCard
        evidence={normalizeSubscriberM10Evidence(engine.data?.signal)}
        online
        locked={engine.locked}
        unavailable={!engine.loading && !engine.locked && (Boolean(engine.error) || !engine.data?.available)}
        freshnessMeta={engine.data?.signal ? {
          last_evaluated_at: engine.data.signal.last_evaluated_at,
          last_state_change_at: engine.data.signal.last_state_change_at,
          last_actionable_at: engine.data.signal.last_actionable_at,
        } : null}
      />
      <RecentSignalsCard state={recent} scroll />

      {academy && <ContinueLearningCard academy={academy} setActive={setActive} />}

      <BotRequiredGate
        body="Own MT5 execution, live positions and personal analytics by purchasing the XauCloud bot."
        bullets={BOT_FEATURE_BULLETS}
        onBuyBot={onBuyBot}
        onLinkLicense={() => setActive("license")}
      />
    </div>
  );
}

// ── Recent Signals (Activity tab, subscriber/trial) ─────────────────────────
function SubscriberActivityPage() {
  const [recent, setRecent] = useState({ loading: true, signals: [], locked: false, error: "" });
  useEffect(() => {
    const load = () => {
      signalAxios.get("/cloud/signals/recent")
        .then((r) => setRecent({ loading: false, signals: r.data.signals || [], locked: false, error: "" }))
        .catch((e) => {
          if (e.response?.status === 403 && e.response?.data?.reason === "NOT_ENTITLED") setRecent({ loading: false, signals: [], locked: true, error: "" });
          else setRecent({ loading: false, signals: [], locked: false, error: "Could not load recent signals." });
        });
    };
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);
  return (
    <AK.Screen>
      <AK.ScreenHeader title="Recent Signals" sub="XauCloud Market Outlook and 10-Minute Engine history" />
      <RecentSignalsCard state={recent} />
    </AK.Screen>
  );
}

function HomePage({ status, heartbeat, licenseInfo, online, equityPoints, events, setActive, openCommand, commands, analytics, ownsBot = true, entitlement, onBuyBot }) {
  const [homeOutlook, setHomeOutlook] = useState(null);
  const openTrades = online ? Number(status?.open_trades || heartbeat.open_positions || 0) : 0;
  const pnlNum = Number(heartbeat.daily_pnl || 0);
  const pnlPos = pnlNum >= 0;
  const linked = Boolean(licenseInfo.activation_key);

  if (!ownsBot) return <SubscriberHomePage entitlement={entitlement} setActive={setActive} onBuyBot={onBuyBot} />;
  const winRate = analytics?.sufficient_data ? analytics.win_rate : null;
  const ddNum = Number(heartbeat.drawdown || 0);

  return (
    <div className="space-y-3 pt-1">
      {/* Account/connection strip — tap for account & license */}
      <AccountStrip heartbeat={heartbeat} status={status} online={online} onClick={() => setActive("license")} />

      {/* Equity hero — inline P&L + sparkline (portfolio-value pattern) */}
      <EquityHero online={online} equity={heartbeat.equity} balance={heartbeat.balance} pnl={pnlNum} pnlPos={pnlPos} points={equityPoints} linked={linked} />

      {/* Bot toggle */}
      <AK.Panel><BotControlCard heartbeat={heartbeat} online={online} linked={linked} openTrades={openTrades} openCommand={openCommand} commands={commands} /></AK.Panel>

      <NotificationPrompt />

      <CommandToolsStrip setActive={setActive} />

      {/* One market-intelligence module — full evidence/history on tap */}
      <OutlookModule outlook={homeOutlook} online={online} onOpen={() => { window.location.href = "/ai-market-outlook"; }} />

      {/* M10 Signal Engine · Evidence — always on the dashboard (waiting state until a fresh reading) */}
      {linked && <M10EngineCard evidence={latestM10Signal(events, heartbeat)} online={online} />}

      {/* Focused open-position module (only when a trade is live) */}
      <PositionModule linked={linked} online={online} onDetails={() => setActive("trading")} />

      {/* Dense stat chip row — not a box grid */}
      <StatChips online={online} ddNum={ddNum} winRate={winRate} spread={heartbeat.spread} openTrades={openTrades} />

      {/* 2–3 most important events — full timeline on tap */}
      <HomeRecentActivity events={events} heartbeat={heartbeat} onOpenFull={() => setActive("activity")} />

      {!linked && (
        <AK.Panel>
          <AK.Empty icon={KeyRound} title="Connect your license" body="Link your license key once and live MT5 data streams here." action={<AK.Button size="sm" onClick={() => setActive("license")}>Go to License</AK.Button>} />
        </AK.Panel>
      )}

      {/* Post-purchase nudge -- points at the real, existing, backend-
          authoritative setup checklist (Settings > see SetupHealth, fed by
          GET /cloud/monitor/status's setup_checks), rather than duplicating
          it here or inventing a new wizard. Surfaces on Home for a bot
          owner whose license is linked but no EA heartbeat has arrived
          yet -- exactly the "what do I do next after buying" moment. */}
      {linked && !online && (
        <AK.Panel>
          <AK.Empty icon={KeyRound} title="Finish setup"
            body="Your license is linked. Attach the XauCloud EA in MT5 to start streaming live data here."
            action={<AK.Button size="sm" onClick={() => setActive("settings")}>View setup checklist</AK.Button>} />
        </AK.Panel>
      )}

      {/* Hidden fetcher — keeps /outlook/current flowing into OutlookModule
          without rendering the old full card. Detail lives on the Outlook screen. */}
      <div className="hidden"><AIMarketOutlookCard linked={linked} online={online} onOutlookChange={setHomeOutlook} onStatusChange={() => {}} /></div>
    </div>
  );
}

function SetupHealth({ checks=[] }) {
  const ok = checks.filter(c=>c.ok).length;
  return (
    <div data-testid="setup-health">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">Setup Health</h3>
          <p className="mt-0.5 text-[11px] text-white/40">
            {checks.length ? `${ok}/${checks.length} checks passing` : "Waiting for setup status"}
          </p>
        </div>
        {checks.length > 0 && <span className={pill(ok===checks.length?"green":"amber")}>{ok}/{checks.length}</span>}
      </div>
      {checks.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {checks.map(c=>{
            const Icon = c.ok ? CheckCircle2 : XCircle;
            return (
              <div key={c.key||c.label} className={`flex items-start gap-3 rounded-xl border p-3 ${c.ok?"border-emerald-400/15 bg-emerald-300/[0.04]":"border-gold-300/15 bg-gold-300/[0.04]"}`}>
                <Icon className={`mt-0.5 h-4 w-4 flex-none ${c.ok?"text-emerald-400":"text-gold-400"}`} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{c.label}</div>
                  <div className="mt-0.5 break-words text-[11px] leading-4 text-white/40">{c.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/40">
          Setup checks will appear after the authenticated status request completes.
        </div>
      )}
    </div>
  );
}

// ─── Trading ──────────────────────────────────────────────────────────────────
function TradingPage({ heartbeat, events, online, tradingOk, linked, openCommand }) {
  const openTrades = online ? Number(heartbeat.open_positions||0) : 0;
  return (
    <AK.Screen>
      <AK.ScreenHeader title="Trading" sub={online ? `${heartbeat.symbol || "XAUUSD"} · ${heartbeat.timeframe || "M10"}` : "Terminal offline"} />
      {/* Focused open-position module (exchange order style) — top of the terminal */}
      <PositionModule linked={linked} online={online} />
      {/* Compact market strip — dense inline stats, not a metric-card grid */}
      <AK.Panel>
        <div className="grid grid-cols-3 gap-x-3 px-4 py-3.5">
          <AK.Stat label="Open" value={online ? openTrades : "—"} tone={openTrades > 0 ? "gold" : undefined} />
          <AK.Stat label="Spread" value={online ? `${heartbeat.spread ?? "-"}pts` : "—"} />
          <AK.Stat label="Bot" value={humanBotState(heartbeat.bot_state, openTrades, tradingOk, online)} tone={online ? (tradingOk ? "profit" : "gold") : undefined} />
        </div>
      </AK.Panel>
      {/* Human-readable execution feed */}
      <AIThoughtFeed linked={linked} onForceClose={openCommand} />
    </AK.Screen>
  );
}

// ─── Analytics ────────────────────────────────────────────────────────────────
function AnalyticsPage({ heartbeat, events, equityPoints, analytics }) {
  const trades = weightedEventCount(events.filter(e=>eventCategory(e)==="entries"));
  const blocks = weightedEventCount(events.filter(e=>eventCategory(e)==="blocks"));
  const errors = weightedEventCount(events.filter(e=>eventCategory(e)==="errors"));
  const sufficient = Boolean(analytics?.sufficient_data);
  const modules = Object.entries(events.reduce((acc, e) => {
    const mod = getEventField(e, "module", "Unspecified") || "Unspecified";
    acc[mod] = (acc[mod] || 0) + Number(e.repeat_count || 1);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <AK.Screen>
      <AK.ScreenHeader title="Analytics" sub="Verified performance from EA-reported closed trades" />
      {/* Equity — realized P&L headline + curve */}
      <AK.Panel className="p-4">
        <AK.BigStat label="Realized P&L" value={sufficient ? money(analytics.realized_pnl) : "—"}
          tone={sufficient ? (Number(analytics.realized_pnl) >= 0 ? "profit" : "loss") : undefined}
          sub={sufficient ? `${analytics.verified_trade_count} verified trades` : "Not enough verified data yet"} />
        <div className="mt-3"><Sparkline points={equityPoints} tone="#F3C969" height="h-28" /></div>
        {!sufficient && (
          <p className="mt-2 text-[11px] leading-4 text-white/40">
            {analytics?.verified_trade_count ?? 0} of {analytics?.minimum_required ?? 5} closed trades reported. Fills in automatically as your EA reports real closes.
          </p>
        )}
      </AK.Panel>
      {/* Trade quality — dense inline stats, not KPI boxes */}
      <AK.Panel>
        <AK.PanelHead title="Trade quality" />
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-4 pb-4 pt-1">
          <AK.Stat label="Win rate" value={sufficient ? pct(analytics.win_rate) : "—"} tone={sufficient && analytics.win_rate >= 50 ? "profit" : undefined} />
          <AK.Stat label="Profit factor" value={sufficient ? analytics.profit_factor.toFixed(2) : "—"} tone={sufficient ? (analytics.profit_factor >= 1 ? "profit" : "loss") : undefined} />
          <AK.Stat label="Avg result" value={sufficient && analytics.avg_pips != null ? `${analytics.avg_pips.toFixed(1)} pips` : "—"} />
          <AK.Stat label="Max drawdown" value={sufficient ? money(analytics.max_drawdown) : "—"} tone={sufficient && analytics.max_drawdown > 0 ? "gold" : undefined} />
        </div>
      </AK.Panel>
      {/* Live today (unverified heartbeat) */}
      <AK.Panel>
        <AK.PanelHead title="Live · today" />
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-4 pb-4 pt-1">
          <AK.Stat label="Live P&L" value={money(heartbeat.daily_pnl)} tone={Number(heartbeat.daily_pnl || 0) >= 0 ? "profit" : "loss"} />
          <AK.Stat label="Floating DD" value={pct(heartbeat.drawdown)} tone={Number(heartbeat.drawdown || 0) > 5 ? "loss" : "gold"} />
          <AK.Stat label="Trade events" value={trades} />
          <AK.Stat label="Blocks / errors" value={`${blocks}/${errors}`} tone={errors ? "loss" : undefined} />
        </div>
      </AK.Panel>
      {/* Module breakdown — rows, not tiles */}
      {modules.length > 0 && (
        <AK.Panel>
          <AK.PanelHead title="Recent decisions by module" />
          <div>
            {modules.map(([module, count], i) => (
              <AK.Row key={module} label={module} value={count} valueTone="gold" last={i === modules.length - 1} />
            ))}
          </div>
        </AK.Panel>
      )}
    </AK.Screen>
  );
}

// ─── Intelligence ─────────────────────────────────────────────────────────────
function IntelligencePage({ heartbeat, events, status }) {
  const blocks    = events.filter(e=>String(e.severity||"").toUpperCase()==="BLOCK");
  const syncs     = events.filter(e=>String(e.event_type||"").toUpperCase().includes("SYNC"));
  const aiEvents  = events.filter(e=>/AI|DIRECTOR|CLAUDE|GPT|CONFIDENCE/i.test(`${e.event_type} ${e.message}`));
  const mlEvents  = events.filter(e=>/ML|HIVE|PATTERN|LEARNING|WARM/i.test(`${e.event_type} ${e.message}`));
  const latest    = events.find(e=>/BLOCK|VETO|SIGNAL|AI|ML|EXIT|SYNC/i.test(`${e.event_type} ${e.message}`));
  // v6.25.2 owner directive 2026-07-17 -- ai_confidence/market_bias are real
  // EA-posted fields on activity events (BotActivityReq), never on the
  // heartbeat object; heartbeat.ai_confidence was always undefined. See
  // latestAiFieldsEvent above.
  const aiEvent   = latestAiFieldsEvent(events);
  const conf      = Number(getEventField(aiEvent, "ai_confidence", 0)) || 0;
  const verdict   = aiEvent ? (getEventField(aiEvent, "decision", "") || aiEvent.message || "") : "";
  // v6.25.2 -- ml_samples/pattern_count/ml_trusted/hive_verdict have never
  // existed on ANY backend model or EA payload (verified: not in
  // BotHeartbeatReq, not in BotActivityReq, not sent anywhere in the EA's
  // WebRequest bodies) -- there is no real ML/Hive subsystem wired to this
  // dashboard yet. Showing 0/"Learning"/"Neutral" here previously looked
  // like real (if unremarkable) data; that was misleading. Disclose the gap
  // honestly instead of fabricating a value.
  const mlWired   = false;

  return (
    <div className="space-y-4">
      {/* AI Director */}
      <div className="rounded-2xl bg-violet-300/[0.07] p-4">
        <div className={`mb-3 flex items-center gap-2 ${MONO_LABEL} text-violet-300`}>
          <Brain className="h-3.5 w-3.5" /> AI Director · Claude Sonnet + GPT
        </div>
        <div className="text-2xl font-black leading-none">{verdict||latest?.message||"Waiting for next decision"}</div>
        <p className="mt-2 text-[12px] leading-5 text-white/42">
          {latest?`${latest.event_type} · ${relativeTime(latest.ts)}`:"AI Director streams entry/exit reasoning here for every decision."}
        </p>
        {conf>0 && (
          <div className="mt-4 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-violet-400 transition-all duration-500" style={{width:`${conf}%`}} />
            </div>
            <span className="w-10 text-right font-mono text-[13px] font-bold text-violet-200">{conf}%</span>
          </div>
        )}
      </div>

      {/* ML */}
      <div className="rounded-2xl bg-sky-300/[0.07] p-4">
        <div className={`mb-3 flex items-center gap-2 ${MONO_LABEL} text-sky-300`}>
          <Activity className="h-3.5 w-3.5" /> ML Warm-Start · Local patterns + Hive
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            ["Patterns", mlWired?"—":"Not wired yet", "text-white/35"],
            ["Authority", mlWired?"Learning":"Not wired yet", "text-white/35"],
            ["Hive",     mlWired?"Neutral":"Not wired yet", "text-white/35"],
          ].map(([l,v,c])=>(
            <div key={l}>
              <div className={MONO_LABEL}>{l}</div>
              <div className={`mt-1.5 font-mono text-xl font-black ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Regime"    value={getEventField(latest, "regime", "") || getEventField(aiEvent, "regime", "") || "Unknown"} detail={heartbeat.symbol||"XAUUSD"} icon={Activity} tone="blue" />
        <Metric label="Spread"    value={heartbeat.spread?`${heartbeat.spread}pts`:"—"} detail="Live quote" icon={Flame} tone="amber" />
        <Metric label="EPF"       value={heartbeat.epf_state||status?.equity_protection_state||"—"} detail="Equity protection" icon={RefreshCw} tone="amber" />
        <Metric label="Blocks"    value={blocks.length} detail="Recent veto events" icon={Shield} tone={blocks.length?"amber":"green"} />
      </div>

      <Card title="AI Director events" subtitle="Entry confirmations, blocks, disagreements, and exit audits from Claude + GPT.">
        {aiEvents.slice(0,10).length
          ? <div className="space-y-2">{aiEvents.slice(0,10).map((e,i)=><EventRow key={e.id||i} event={e} />)}</div>
          : <Empty title="No AI Director events yet" body="Reasoning, confidence scores, and exit audits will stream here once the EA is running." icon={Brain} />}
      </Card>

      <Card title="ML + Hive events" subtitle="Pattern loads, warm-start, hive verdicts, and learning state changes.">
        {[...mlEvents,...syncs].slice(0,10).length
          ? <div className="space-y-2">{[...mlEvents,...syncs].slice(0,10).map((e,i)=><EventRow key={e.id||i} event={e} />)}</div>
          : <Empty title="ML is quiet" body="Warm-start loads, hive score updates, and pattern learning events will appear here." icon={Activity} />}
      </Card>
    </div>
  );
}

// ─── Activity ─────────────────────────────────────────────────────────────────
// Plain-English event feed. Human headline + short detail per event; the full
// technical row (facts, raw reason, Force Open) opens in a detail sheet on tap.
const activityHeadline = (e) => ({ entries: "Trade opened", exits: "Trade closed", blocks: "Signal skipped", risk: "Risk update", ai: "AI decision", errors: "Error", overrides: "Manual override" }[eventCategory(e)] || "Event");
const activityFeedTone = (e) => {
  const c = eventCategory(e);
  if (c === "entries" || c === "risk" || c === "overrides") return "gold";
  if (c === "errors") return "loss";
  if (c === "ai") return "info";
  if (c === "exits") { const raw = getEventField(e, "profit", ""); return raw === "" ? "white" : (Number(raw) >= 0 ? "profit" : "loss"); }
  return "white";
};
const activityDetail = (e) => {
  const c = eventCategory(e);
  const sym = e.symbol || getEventField(e, "symbol", "XAUUSD");
  const dir = getEventField(e, "signal_direction", "") || getEventField(e, "position_direction", "");
  const raw = getEventField(e, "profit", "");
  if (c === "entries") return `${dir ? dir + " " : ""}${sym}`;
  if (c === "exits") return `${sym}${raw !== "" ? ` · ${money(Number(raw))}` : ""}`;
  return getEventReason(e) || getEventDecision(e) || "";
};
function ActivityPage({ events, filter, setFilter, onForceOpen }) {
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState(null);
  const visibleEvents = useMemo(() => events.filter((e) => eventMatchesSearch(e, search)), [events, search]);
  return (
    <AK.Screen>
      <AK.ScreenHeader title="Activity" sub="Entries, exits, blocks, AI decisions and errors" />
      {/* Filter chips — horizontal scroll */}
      <div className="native-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
        {FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} data-testid={id === "entries" ? "activity-filter-trade" : undefined}
            className={AK.cx("no-select flex-none rounded-lg px-3 py-1.5 text-[12px] font-semibold", filter === id ? "bg-gold-300 text-black" : "bg-white/[0.05] text-white/50 active:text-white")}>
            {label}
          </button>
        ))}
      </div>
      {/* Search */}
      <div className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5">
        <Search className="h-4 w-4 flex-none text-white/30" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ticket, reason, symbol, time"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/25" />
      </div>
      {/* Timeline feed */}
      <AK.Panel>
        {visibleEvents.length ? (
          <div className="py-1.5">
            {visibleEvents.map((e, i) => (
              <AK.FeedItem key={e.id || i} time={clockTime(e.ts)} title={activityHeadline(e)} tone={activityFeedTone(e)} detail={activityDetail(e)} onClick={() => setSel(e)} last={i === visibleEvents.length - 1} />
            ))}
          </div>
        ) : (
          <AK.Empty icon={Activity} title="No matching activity yet" body="Only meaningful decisions from your linked license and MT5 account appear here." />
        )}
      </AK.Panel>
      {/* Full technical detail + Force Open, on tap */}
      <AK.Sheet open={Boolean(sel)} onClose={() => setSel(null)} title="Event details">
        {sel && <EventRow event={sel} onForceOpen={(cmd) => { setSel(null); onForceOpen(cmd); }} />}
      </AK.Sheet>
    </AK.Screen>
  );
}

// ─── Control ──────────────────────────────────────────────────────────────────
function ControlPage({ heartbeat, online, commands, openCommand, commandMsg, licenseKey, linked, setActive, propFirm, propFirmForm, setPropFirmForm, markDirty, propFirmConfirmed, setPropFirmConfirmed, propFirmBusy, applyPropFirm }) {
  const openTrades = online ? Number(heartbeat?.open_positions || 0) : 0;
  const recent = (commands || []).slice(0, 8);

  return (
    <AK.Screen>
      <AK.ScreenHeader title="Bot Control" sub="Turn automated trading on or off, and set your Prop Firm limits" />

      {/* The single customer control authority — Bot ON / OFF (queues
          PAUSE_NEW_TRADES / RESUME_TRADING through the same command infra the
          old Remote Commands card used). */}
      <AK.Panel>
        <BotControlCard heartbeat={heartbeat || {}} online={online} linked={linked} openTrades={openTrades} openCommand={openCommand} commands={commands} />
      </AK.Panel>
      <p className="px-1 text-[11.5px] leading-4 text-white/40">
        Bot <span className="font-semibold text-white/60">OFF</span> stops new automatic entries — open positions stay protected and managed. Bot <span className="font-semibold text-white/60">ON</span> resumes normal entries after the EA acknowledges.
      </p>

      {/* Prop Firm protection — native grouped settings */}
      <PropFirmSection
        online={online} linked={linked} propFirm={propFirm} commandMsg={commandMsg}
        propFirmForm={propFirmForm} setPropFirmForm={setPropFirmForm} markDirty={markDirty}
        propFirmConfirmed={propFirmConfirmed} setPropFirmConfirmed={setPropFirmConfirmed}
        propFirmBusy={propFirmBusy} applyPropFirm={applyPropFirm} setActive={setActive}
      />

      {/* Command history — now reflects Bot ON/OFF + Prop Firm acknowledgements */}
      {recent.length > 0 && (
        <div>
          <AK.Label className="mb-1.5">Recent commands</AK.Label>
          <AK.Panel>
            {recent.map((cmd, i) => (
              <AK.Row key={cmd.id || i}
                label={cmd.label || cmd.action}
                sub={`${relativeTime(cmd.requested_at)} · ${cmd.ack_message || "Waiting for EA"}`}
                right={<span className={pill(cmd.status === "EXECUTED" ? "green" : cmd.status === "FAILED" ? "red" : "amber")}>{cmd.status}</span>}
                last={i === recent.length - 1}
              />
            ))}
          </AK.Panel>
        </div>
      )}
    </AK.Screen>
  );
}

// Native, grouped "Prop Firm Protection" settings (replaces the old long web
// form). Each value is a compact disclosure row that opens a focused bottom
// sheet with a numeric keypad + explanation, so the screen stays short and
// scannable. Backend contract is unchanged: UPDATE_PROP_FIRM_CONFIG is only
// sent on Apply, and the bot stays on its previous config until the EA
// acknowledges (apply_status PENDING → EXECUTED).
function propFirmAck({ online, busy, status }) {
  const s = String(status || "").toUpperCase();
  if (busy) return { label: "Sending to EA…", tone: "gold", spin: true };
  if (s === "NOT_LINKED") return { label: "Link a license first", tone: "neutral" };
  if (["EXECUTED", "APPLIED"].includes(s)) return { label: "Applied by EA", tone: "profit" };
  if (["FAILED", "ERROR", "REJECTED", "SKIPPED"].includes(s)) return { label: "Failed — not applied", tone: "loss" };
  if (["PENDING", "ACKED", "QUEUED", "SENT"].includes(s)) return { label: online ? "Waiting for EA…" : "Queued — EA offline", tone: "gold", spin: online };
  return { label: "Not configured", tone: "neutral" };
}

function PropFirmSection({ online, linked, propFirm, commandMsg, propFirmForm, setPropFirmForm, markDirty, propFirmConfirmed, setPropFirmConfirmed, propFirmBusy, applyPropFirm, setActive }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const applied = propFirm?.applied || {};
  const enabled = Boolean(propFirmForm.enabled);
  const upd = (key, value) => { markDirty(); setPropFirmForm((p) => ({ ...p, [key]: value })); };

  const openEdit = (f) => {
    const raw = f.kind === "multi" ? Math.round(Number(propFirmForm[f.key] || 0) * 100) : (propFirmForm[f.key] ?? "");
    setDraft(String(raw));
    setEditing(f);
  };
  const saveEdit = () => {
    if (!editing) return;
    let v = Number(draft);
    if (!Number.isFinite(v)) v = editing.min ?? 0;
    if (editing.min != null) v = Math.max(editing.min, v);
    if (editing.max != null) v = Math.min(editing.max, v);
    upd(editing.key, editing.kind === "multi" ? v / 100 : v);
    setEditing(null);
  };

  const ack = propFirmAck({ online, busy: propFirmBusy, status: propFirm?.apply_status });
  const retestSuffix = "% of normal";

  return (
    <div className="space-y-2.5">
      <AK.Label>Prop Firm Protection</AK.Label>

      {/* Master switch + live state + (when on) a compact summary strip */}
      <AK.Panel>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className={AK.cx("flex h-9 w-9 flex-none items-center justify-center rounded-xl", enabled ? "bg-gold-300/12 text-gold-300" : "bg-white/[0.06] text-white/40")}>
            <ShieldCheck className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-semibold leading-tight">Prop Firm Protection · {enabled ? "ON" : "OFF"}</div>
            <div className="mt-0.5 text-[11.5px] leading-4 text-white/45">
              {enabled ? "FTMO-style limits — exposure capped before your firm's rules." : "Off — the bot uses your normal risk settings."}
            </div>
          </div>
          <Toggle value={enabled} onChange={(v) => upd("enabled", v)} />
        </div>

        {enabled && (
          <div className="grid grid-cols-4 gap-px border-t border-white/[0.05] bg-white/[0.05]">
            {[
              ["Daily", pfFmt("pct", propFirmForm.daily_loss_pct)],
              ["Total", pfFmt("pct", propFirmForm.max_loss_pct)],
              ["Buffer", pfFmt("pct", propFirmForm.safety_buffer_pct)],
              ["Risk", pfFmt("pct", propFirmForm.risk_per_trade_pct)],
            ].map(([k, v]) => (
              <div key={k} className="bg-[#0C0D12] px-2 py-2.5 text-center">
                <div className="text-[9.5px] uppercase tracking-wider text-white/35">{k}</div>
                <div className="nums mt-0.5 text-[13px] font-bold text-white/85">{v}</div>
              </div>
            ))}
          </div>
        )}
      </AK.Panel>

      {!linked && (
        <p className="px-1 text-[11.5px] leading-4 text-gold-200/80">
          <button onClick={() => setActive("license")} className="font-semibold underline">Link your license</button> to configure and apply Prop Firm limits.
        </p>
      )}

      {/* Grouped setting rows — tap a row to edit in a focused sheet */}
      {enabled && PF_GROUPS.map((group) => (
        <div key={group.label}>
          <AK.Label className="mb-1.5">{group.label}</AK.Label>
          <AK.Panel>
            {group.fields.map((f, i) => (
              <AK.Row key={f.key}
                label={f.label}
                value={pfFmt(f.kind, propFirmForm[f.key])}
                valueTone="white"
                onClick={() => openEdit(f)}
                last={i === group.fields.length - 1}
              />
            ))}
          </AK.Panel>
        </div>
      ))}

      {/* Advanced — optional retest add */}
      {enabled && (
        <div>
          <AK.Label className="mb-1.5">Advanced</AK.Label>
          <AK.Panel>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-white/85">Allow one confirmed retest add</div>
                <div className="mt-0.5 text-[11.5px] text-white/40">One small retest, capped inside the basket risk limit.</div>
              </div>
              <Toggle value={Boolean(propFirmForm.allow_retest_add)} onChange={(v) => upd("allow_retest_add", v)} />
            </div>
            {propFirmForm.allow_retest_add && (
              <AK.Row label="Retest add size"
                value={`${Math.round(Number(propFirmForm.retest_add_lot_multi || 0) * 100)}${retestSuffix}`}
                valueTone="white"
                onClick={() => openEdit({ key: "retest_add_lot_multi", label: "Retest add size", kind: "multi", step: "1", min: 5, max: 50, note: "Size of the retest add, as a percentage of your normal position size." })}
                last
              />
            )}
          </AK.Panel>
        </div>
      )}

      {/* Apply + acknowledgement (always available so you can also push OFF) */}
      <AK.Panel pad>
        <label className="flex items-start gap-3 text-[12px] leading-5 text-white/50 cursor-pointer">
          <input type="checkbox" checked={propFirmConfirmed} onChange={(e) => setPropFirmConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 flex-none accent-gold-300" />
          {enabled
            ? "I've verified these values against my prop firm's rules, and the safety buffer stays above zero."
            : "Turn Prop Firm Protection off on the bot and return to my normal risk settings."}
        </label>
        <button onClick={applyPropFirm} disabled={!linked || !propFirmConfirmed || propFirmBusy}
          className="mt-3.5 w-full rounded-xl bg-gold-300 py-3 text-[13px] font-bold text-black transition hover:bg-gold-200 disabled:opacity-35 disabled:cursor-not-allowed">
          {propFirmBusy ? "Sending to EA…" : enabled ? "Apply limits to EA" : "Apply (turn off) to EA"}
        </button>

        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-white/[0.03] px-3 py-2.5">
          {ack.spin ? <Loader2 className="h-3.5 w-3.5 flex-none animate-spin text-gold-300" /> : <AK.Dot tone={ack.tone} />}
          <div className="min-w-0 flex-1">
            <div className={AK.cx("text-[12.5px] font-semibold", AK.toneText(ack.tone))}>{ack.label}</div>
            {(propFirm?.apply_message || commandMsg) && (
              <div className="mt-0.5 truncate text-[11px] text-white/40">{propFirm?.apply_message || commandMsg}</div>
            )}
          </div>
          <span className={AK.cx("nums flex-none text-[11px] font-semibold", applied.enabled ? "text-profit" : "text-white/35")}>
            EA: {applied.enabled ? "ON" : "OFF"}
          </span>
        </div>
      </AK.Panel>

      {/* Focused edit sheet */}
      <AK.Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.label}>
        {editing && (
          <div>
            <div className="flex items-center rounded-xl bg-white/[0.05] px-3.5 focus-within:ring-1 focus-within:ring-gold-300/40">
              {editing.kind === "money" && <span className="text-[20px] font-bold text-white/40">$</span>}
              <input autoFocus type="number" inputMode="decimal" step={editing.step} min={editing.min} max={editing.max}
                value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                className="nums min-w-0 flex-1 bg-transparent py-3.5 text-[22px] font-bold text-white outline-none" />
              <span className="ml-2 flex-none text-[14px] font-semibold text-white/35">{editing.kind === "money" ? "" : editing.kind === "multi" ? retestSuffix.trim() : "%"}</span>
            </div>
            {editing.note && <p className="mt-3 text-[12.5px] leading-5 text-white/50">{editing.note}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <AK.Button variant="dark" onClick={() => setEditing(null)}>Cancel</AK.Button>
              <AK.Button variant="primary" onClick={saveEdit}>Save</AK.Button>
            </div>
          </div>
        )}
      </AK.Sheet>
    </div>
  );
}

// ─── License ──────────────────────────────────────────────────────────────────
// Licensed EA download -- relocated here from the public marketing homepage
// (2026-07-25 homepage redesign) so the only functional download flow lives
// where a signed-in, licensed customer actually looks for it, instead of on
// the anonymous public page where it always 401'd for a first-time visitor
// anyway. Same backend contract as before: POST /download/request-token
// (cookie-authenticated) -> short-lived signed URL -> GET /download/ea-release.
// iOS/iPadOS can't silently write an .ex5 to disk from the web — a direct
// navigation just dumps the user into the blank "Open in…" system preview.
// So on iOS we open a compact sheet and use the native Web Share sheet
// (Save to Files / AirDrop) when available. Desktop keeps a normal attachment
// download. iPadOS 13+ reports as "MacIntel" but has touch points.
function isIosLike() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
}

function EaDownloadCard({ hasLicense, release }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    commandAxios.get("/download/info").then(r => setInfo(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const available = info?.available !== false;
  const version = info?.version || "Published release";
  const filename = info?.filename || "XauCloud-Bot.ex5";
  const updateAvailable = release?.update_available;

  const requestSignedUrl = async () => {
    const { data } = await commandAxios.post("/download/request-token");
    return `${API}${data.download_url}`;
  };
  const handleDownloadError = (e) => {
    setError(e?.response?.status === 403
      ? "No active license linked to your account yet. Link your license above first."
      : (e?.response?.data?.detail || "Could not start download. Please try again."));
  };

  // Desktop / Windows / Mac: authoritative attachment download (server already
  // sends Content-Disposition: attachment with the resolved filename).
  const desktopDownload = async () => {
    setDownloading(true); setError("");
    try {
      const url = await requestSignedUrl();
      const a = document.createElement("a");
      a.href = url; a.rel = "noopener"; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { handleDownloadError(e); }
    setDownloading(false);
  };

  // iOS/iPadOS: fetch the signed .ex5 and hand it to the native share sheet
  // (Save to Files, AirDrop to the Windows/VPS machine, etc.). Falls back to a
  // plain navigation only if Web Share with files isn't available.
  const iosShare = async () => {
    setDownloading(true); setError("");
    try {
      const url = await requestSignedUrl();
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: "application/octet-stream" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "XauCloud EA", text: filename });
        } else {
          const objUrl = URL.createObjectURL(blob);
          window.location.href = objUrl;
          setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
        }
        setSheetOpen(false);
      } catch {
        window.location.href = url; // last resort: system handler
      }
    } catch (e) { handleDownloadError(e); }
    setDownloading(false);
  };

  const onPrimaryClick = () => (isIosLike() ? setSheetOpen(true) : desktopDownload());

  return (
    <Card title="Download EA">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[13px] font-bold text-white/85">{loading ? "Loading release info…" : `${version}${info?.edition ? ` · ${info.edition}` : ""}`}</div>
          <p className="mt-1 text-[12px] leading-5 text-white/45">License-gated {filename} production build. The server verifies its SHA-256 checksum before every download.</p>
        </div>
        {!loading && (
          <span className={`flex-none rounded-full px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-widest ${info?.stable ? "bg-emerald-300 text-[#06110c]" : "bg-gold-300/80 text-[#1a1400]"}`}>
            {info?.stable ? "Stable" : "Release candidate"}
          </span>
        )}
      </div>

      {updateAvailable && (
        <div className="mt-3 rounded-xl border border-gold-300/30 bg-gold-300/[0.08] p-3">
          <div className="text-[12px] font-bold text-gold-200">XauCloud update available</div>
          <div className="mt-1 text-[11px] leading-4 text-white/50">
            Installed {release.installed_version} · Latest {release.latest_version}
          </div>
          {release.latest_release_notes && (
            <p className="mt-1.5 text-[11px] leading-4 text-white/40">{release.latest_release_notes}</p>
          )}
        </div>
      )}

      {error && <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-[12px] text-rose-300">{error}</div>}
      <button onClick={onPrimaryClick} disabled={downloading || loading || !available || !hasLicense}
        className="mt-4 w-full rounded-xl bg-gold-300 px-5 py-3 text-[13px] font-extrabold text-black transition hover:bg-gold-200 disabled:opacity-40">
        {downloading ? "Preparing download…" : !hasLicense ? "Link a license to download" : !available ? "No release available"
          : updateAvailable ? "Download and install latest version" : "Download latest EA"}
      </button>

      {/* iOS/iPad polished flow */}
      <AK.Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Install XauCloud EA">
        <p className="text-[13px] leading-5 text-white/55">
          The EA runs in <span className="text-white/80">MetaTrader 5</span> on Windows or your Windows VPS — not on the phone itself.
        </p>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-white/[0.04] px-3.5 py-2.5">
          <span className="text-[12px] text-white/45">Latest version</span>
          <span className="nums text-[13px] font-bold text-white/85">{version}</span>
        </div>
        <div className="mt-4 space-y-2.5">
          <AK.Button size="lg" onClick={iosShare} disabled={downloading}>
            <Download className="h-4 w-4" /> {downloading ? "Preparing…" : "Download / share file"}
          </AK.Button>
          <a href="/#how-it-works" target="_blank" rel="noopener noreferrer"
            className="no-select flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.12] px-5 py-3.5 text-[14px] font-bold text-white/85 active:bg-white/[0.05]">
            <BookOpen className="h-4 w-4" /> Installation guide
          </a>
        </div>
        <p className="mt-3 text-[11.5px] leading-4 text-white/35">
          Tip: choose <span className="text-white/55">Save to Files</span> or AirDrop it to your Windows machine, then load it in MT5 → Experts.
        </p>
      </AK.Sheet>
    </Card>
  );
}

function billingNaira(kobo) {
  if (kobo === null || kobo === undefined) return "—";
  const naira = kobo / 100;
  return naira === 0 ? "Free" : `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

// Billing is reachable from Command Center → More → Account → Billing for
// EVERY signed-in user, licensed or not -- GET /cloud/billing already
// returns entitlement + payment history + plans generically off the
// authenticated user, so a lifetime-licensed customer correctly sees their
// bot license status and full payment history here, not just signal
// subscribers (who reach this same Billing page through the identical
// shared Command Center nav).
/** Inline "Check status" for a pending bank-transfer row in payment history -- reuses the existing GET /purchase/bank-transfer/:reference/status endpoint (the same one BankTransferPanel polls while an order is open), no new checkout logic. */
function PendingTransferStatus({ reference }) {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const { data } = await commandAxios.get(`/purchase/bank-transfer/${reference}/status`, { withCredentials: false });
      setStatus(data.status);
    } catch {
      setStatus("UNKNOWN");
    } finally {
      setChecking(false);
    }
  };
  if (status) return <span className="text-[10px] font-bold text-white/45">{status}</span>;
  return (
    <button type="button" onClick={check} disabled={checking} className="no-select text-[10px] font-bold text-gold-300/80 underline underline-offset-2 hover:text-gold-200 disabled:opacity-50">
      {checking ? "Checking…" : "Check status"}
    </button>
  );
}

function BillingPage({ setActive }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    commandAxios.get("/cloud/billing")
      .then((r) => setData(r.data))
      .catch(() => setError("Could not load billing."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const signalCheckout = useSignalCheckout(API);
  const signalPlanMeta = signalCheckout.planId === "SIGNALS_WEEKLY" ? data?.plans?.signals_weekly : data?.plans?.signals_monthly;
  const signalPriceDisplay = billingNaira(signalPlanMeta?.price_kobo);

  // Bot lifetime -- in-app checkout, never a homepage redirect (see
  // useBotCheckout / CRITICAL PRODUCT RULE, 2026-08-25).
  const botCheckout = useBotCheckout(API);
  const [me, setMe] = useState(null);
  useEffect(() => { commandAxios.get("/cloud/auth/me").then((r) => setMe(r.data)).catch(() => {}); }, []);
  const botPriceDisplay = billingNaira(data?.plans?.bot_lifetime?.price_kobo);

  const ent = data?.entitlement;
  const history = data?.payment_history || [];

  return (
    <div className="space-y-4">
      <div className={`${CARD} p-4`}>
        <div className={MONO_LABEL}>Current status</div>
        {!data && !error && <div className="mt-2 text-[12px] text-white/40">Loading…</div>}
        {error && <div className="mt-2 text-[12px] text-rose-400">{error}</div>}
        {ent && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ent.bot_license && <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-[11px] font-bold text-emerald-300">XauCloud Bot — Lifetime license active</span>}
            {ent.bot_license && setActive && (
              <button type="button" onClick={() => setActive("license")} className="no-select rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-white/60 hover:bg-white/[0.1]">
                Manage license
              </button>
            )}
            {!ent.bot_license && ent.source === "trial" && <span className="rounded-full bg-gold-300/15 px-3 py-1 text-[11px] font-bold text-gold-200">Free Signal Trial · {(ent.trial?.days_remaining ?? 0) === 0 ? "Last day" : `${ent.trial?.days_remaining ?? 0} market day${(ent.trial?.days_remaining ?? 0) === 1 ? "" : "s"} left`}</span>}
            {!ent.bot_license && ent.source === "subscription" && (
              <>
                <span className="rounded-full bg-gold-300/15 px-3 py-1 text-[11px] font-bold text-gold-200">{ent.subscription?.plan === "WEEKLY" ? "Weekly Signals" : "Monthly Signals"} · active until {fmtDate(ent.subscription?.expires_at)}</span>
                <button type="button" onClick={() => signalCheckout.openPlan(ent.subscription?.plan === "WEEKLY" ? "SIGNALS_WEEKLY" : "SIGNALS_MONTHLY")} data-testid="renew-subscription-btn"
                  className="no-select rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-bold text-white/60 hover:bg-white/[0.1]">
                  Renew now
                </button>
              </>
            )}
            {!ent.bot_license && ent.source === "none" && <span className="rounded-full bg-white/[0.08] px-3 py-1 text-[11px] font-bold text-white/50">No signal plan active</span>}
          </div>
        )}
        <p className="mt-3 text-[12px] leading-5 text-white/40">
          Your XauCloud bot license and any signal subscription are separate products. A bot license never expires; signal plans are optional and only affect Market Outlook / 10-minute engine access, never MT5 execution.
        </p>
      </div>

      <Card title="Available plans">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { key: "signals_weekly", id: "SIGNALS_WEEKLY", label: "Weekly Signals", sub: "/ week" },
            { key: "signals_monthly", id: "SIGNALS_MONTHLY", label: "Monthly Signals", sub: "/ month" },
          ].map((p) => (
            <button key={p.key} type="button" onClick={() => signalCheckout.openPlan(p.id)}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition hover:border-gold-300/30 hover:bg-white/[0.05]">
              <div className="text-[12px] font-semibold text-white/80">{p.label}</div>
              <div className="mt-1 font-mono text-[16px] font-black text-gold-200">{billingNaira(data?.plans?.[p.key]?.price_kobo)}</div>
              <div className="mt-0.5 text-[10.5px] text-white/35">{p.sub}</div>
            </button>
          ))}
          {ent?.bot_license ? (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="text-[12px] font-semibold text-white/80">XauCloud Bot (Lifetime)</div>
              <div className="mt-1 font-mono text-[16px] font-black text-gold-200">{botPriceDisplay}</div>
              <div className="mt-0.5 text-[10.5px] text-white/35">Already active</div>
            </div>
          ) : (
            <button type="button" onClick={botCheckout.open} data-testid="upgrade-tile-xaucloud-bot-lifetime"
              className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition hover:border-gold-300/30 hover:bg-white/[0.05]">
              <div className="text-[12px] font-semibold text-white/80">XauCloud Bot (Lifetime)</div>
              <div className="mt-1 font-mono text-[16px] font-black text-gold-200">{botPriceDisplay}</div>
              <div className="mt-0.5 text-[10.5px] text-white/35">one-time · lifetime execution</div>
            </button>
          )}
        </div>
        {signalCheckout.error && <div className="mt-3 text-[12px] text-rose-400">{signalCheckout.error}</div>}
        {botCheckout.error && <div className="mt-3 text-[12px] text-rose-400">{botCheckout.error}</div>}
      </Card>

      <Card title="Payment history">
        {history.length === 0 && <div className="text-[12.5px] text-white/35">No payments yet.</div>}
        {history.length > 0 && (
          <div className="divide-y divide-white/[0.06]">
            {history.map((p) => (
              <div key={p.reference} className="flex items-center justify-between gap-3 py-2.5 text-[12px]">
                <div className="min-w-0">
                  <div className="truncate font-mono text-white/70">{p.reference}</div>
                  <div className="text-white/35">{p.plan_id || "BOT_LIFETIME"} · {fmtDate(p.created_at)}</div>
                </div>
                {p.provider === "BANK_TRANSFER" && !/FULFILLED|FAILED|REJECTED|EXPIRED/.test(String(p.payment_status)) ? (
                  <PendingTransferStatus reference={p.reference} />
                ) : (
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${p.payment_status === "FULFILLED" ? "bg-emerald-400/15 text-emerald-300" : /FAILED|REJECTED|EXPIRED/.test(String(p.payment_status)) ? "bg-rose-400/15 text-rose-300" : "bg-white/[0.08] text-white/50"}`}>
                    {p.payment_status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {signalCheckout.showModal && (
        <PaymentMethodModal
          api={API}
          priceDisplay={signalPriceDisplay}
          subtitle={signalPriceDisplay}
          onPaystack={() => { signalCheckout.closeModal(); signalCheckout.payByPaystack(); }}
          onNomba={() => { signalCheckout.closeModal(); signalCheckout.payByNomba(); }}
          onClose={signalCheckout.closeModal}
          bankTransfer={signalCheckout.bankTransferProps}
        />
      )}

      {botCheckout.showModal && (
        <PaymentMethodModal
          api={API}
          priceDisplay={botPriceDisplay}
          buyerName={me?.full_name || ""}
          buyerEmail={me?.email || ""}
          subtitle={`${botPriceDisplay} · ${me?.email || ""}`}
          onPaystack={() => { botCheckout.closeModal(); botCheckout.payByPaystack(me?.full_name || "", me?.email || ""); }}
          onNomba={() => { botCheckout.closeModal(); botCheckout.payByNomba(me?.full_name || "", me?.email || ""); }}
          onClose={botCheckout.closeModal}
        />
      )}
    </div>
  );
}

function LicensePage({ license, licenseInput, setLicenseInput, linkLicense, commandMsg, heartbeat, me, status }) {
  const info = license?.license;
  return (
    <div className="space-y-4">
      {/* Key card */}
      <div className="rounded-2xl bg-gold-300/[0.07] p-4">
        <div className={`mb-2 ${MONO_LABEL} text-gold-300`}>Activation key</div>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 break-words font-mono text-xl font-black">{info?.activation_key||"No license linked"}</div>
          {info?.activation_key && <CopyBtn value={info.activation_key} label="Copy key" />}
        </div>
        <p className="mt-2 text-[12px] leading-5 text-white/42">
          This is your <span className="font-mono text-white/60">InpLicensePIN</span> in MT5. Link it here to connect your bot's heartbeat to this account.
        </p>
        <p className="mt-1 text-[11px] text-white/30">{info?.status||license?.message||"Add the ASE key you received after purchase."}</p>
      </div>

      {/* Link input */}
      <Card title="Link a license key">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input value={licenseInput} onChange={e=>setLicenseInput(e.target.value.toUpperCase())} placeholder="ASE-XXXX-XXXX"
            className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-gold-300/40 placeholder:text-white/25" />
          <button onClick={linkLicense} className="rounded-xl bg-gold-300 px-5 py-2.5 text-[13px] font-bold text-black hover:bg-gold-200 transition">Link license</button>
        </div>
        {commandMsg && <div className="mt-3 rounded-xl border border-gold-300/20 bg-gold-300/[0.07] p-3 text-[12px] text-gold-200">{commandMsg}</div>}
      </Card>

      {/* Binding details */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`${CARD} p-4`}>
          <div className={MONO_LABEL}>License ID</div>
          <div className="mt-2 break-all font-mono text-[12px] font-bold leading-5 text-gold-100">{info?.license_id||"—"}</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/35">{me.email}</span>
            {info?.license_id && <CopyBtn value={info.license_id} label="Copy ID" />}
          </div>
        </div>
        <Metric label="MT5 binding"    value={info?.account_binding||heartbeat.account_number||"Not bound"} detail={brokerBrand(heartbeat.broker_server)||"Waiting for EA"} icon={TerminalSquare} tone={heartbeat.account_number?"green":"amber"} />
        <Metric label="VPS binding"    value={info?.vps_binding||"Not bound"} detail="Optional" icon={Wifi} tone="blue" />
        <Metric label="XauCloud version" value={status?.release?.public_display_name||"Waiting"}
          detail={status?.release?.update_available ? `Update available · latest ${status.release.latest_version}` : `Heartbeat ${relativeTime(heartbeat.last_heartbeat||heartbeat.ts)}`}
          icon={Bot} tone={status?.release?.update_available ? "amber" : (heartbeat.ea_version?"green":"neutral")} />
      </div>

      <EaDownloadCard hasLicense={Boolean(info?.activation_key)} release={status?.release} />
    </div>
  );
}

// First-party Web Push opt-in (per device). Additive to OneSignal.
function PushSettings() {
  const [state, setState] = useState({ supported: true, permission: "default", subscribed: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const refresh = useCallback(async () => { try { setState(await webPushStatus()); } catch { /* ignore */ } }, []);
  useEffect(() => { refresh(); }, [refresh]);
  if (!webPushSupported()) return null;
  // Same bug/fix as NotificationPrompt above: enabling the device
  // subscription alone never turns on actual delivery (the backend checks
  // cloud_notification_prefs.tier, which nothing here used to set).
  const enable = async () => { setBusy(true); setMsg(""); try { await enableWebPush(commandAxios); await commandAxios.post("/outlook/notifications/prefs", { tier: "HOURLY_ONLY" }); setMsg("Push enabled on this device."); await refresh(); } catch (e) { setMsg(e?.message || "Could not enable push."); } finally { setBusy(false); } };
  const disable = async () => { setBusy(true); setMsg(""); try { await commandAxios.post("/outlook/notifications/prefs", { tier: "OFF" }).catch(() => {}); await disableWebPush(commandAxios); setMsg("Push turned off on this device."); await refresh(); } catch (e) { setMsg(e?.message || "Could not turn off push."); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); setMsg(""); try { const r = await testWebPush(commandAxios); setMsg(r?.sent ? "Test sent — check your notifications." : "No active subscription on this device yet."); } catch { setMsg("Could not send test."); } finally { setBusy(false); } };
  return (
    <AK.Panel>
      <AK.PanelHead title="Push notifications" />
      <div className="px-4 pb-4 pt-1">
        <p className="text-[12px] leading-5 text-white/50">First-party XauCloud push — trade, outlook, license and system alerts on this device. No third-party account.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {state.subscribed
            ? <AK.Button variant="dark" size="sm" onClick={disable} disabled={busy}>Turn off on this device</AK.Button>
            : <AK.Button variant="primary" size="sm" onClick={enable} disabled={busy}>{busy ? "Working…" : "Enable push"}</AK.Button>}
          {state.subscribed && <AK.Button variant="outline" size="sm" onClick={test} disabled={busy}>Send test</AK.Button>}
        </div>
        {msg && <div className="mt-3 rounded-lg bg-white/[0.05] px-3 py-2 text-[12px] text-white/60">{msg}</div>}
      </div>
    </AK.Panel>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsPage({ me, heartbeat, licenseInfo, logout, status }) {
  const [diagOpen, setDiagOpen] = useState(false);
  const settingsOnline = Boolean(status && !status.offline && heartbeat.account_number);
  return (
    <div className="space-y-4">
      <Card title="EA Setup & Connection" subtitle="Live setup details for this licensed Command Center account." className="scroll-mt-20">
        <div data-testid="ea-setup-connection">
          <div className={`mb-4 flex items-start gap-3 rounded-xl border p-3 ${settingsOnline?"border-emerald-400/15 bg-emerald-300/[0.04]":"border-gold-300/15 bg-gold-300/[0.04]"}`}>
            {settingsOnline ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-400" /> : <Wifi className="mt-0.5 h-4 w-4 flex-none text-gold-300" />}
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{settingsOnline?"EA connected":"EA offline"}</div>
              <div className="mt-0.5 break-words text-[11px] leading-4 text-white/40">
                Heartbeat {relativeTime(heartbeat.last_heartbeat||heartbeat.ts)}
                {heartbeat.account_number ? ` · MT5 account ${heartbeat.account_number}` : " · waiting for MT5 account"}
                {heartbeat.ea_version ? ` · ${heartbeat.ea_version}` : " · version waiting"}
              </div>
            </div>
          </div>
          <SetupHealth checks={status?.setup_checks||[]} />
        </div>
      </Card>

      <Card title="Account">
        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className={MONO_LABEL}>Command Center account</div>
            <div className="mt-2 text-[14px] font-semibold">{me.full_name||"Trader"}</div>
            <div className="mt-0.5 text-[12px] text-white/40">{me.email}</div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className={MONO_LABEL}>Connected EA</div>
            <div className="mt-2 text-[14px] font-semibold">{heartbeat.ea_version ? (status?.release?.public_display_name || "XauCloud") : "No EA heartbeat yet"}</div>
            <div className="mt-0.5 text-[12px] text-white/40">{brokerBrand(heartbeat.broker_server)||"Broker waiting"}</div>
          </div>
          <button onClick={logout} className="w-full rounded-xl border border-red-400/20 bg-red-500/[0.06] px-4 py-3 text-[13px] font-semibold text-red-300 hover:bg-red-500/[0.1] transition">
            Log out
          </button>
        </div>
      </Card>

      <PushSettings />

      {/* ── Hidden diagnostics ── tap to expand, invisible to normal users */}
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.01]">
        <button onClick={()=>setDiagOpen(d=>!d)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/20">Developer diagnostics</span>
          <span className="font-mono text-[10px] text-white/20">{diagOpen?"▲":"▼"}</span>
        </button>

        {diagOpen && (
          <div className="border-t border-white/[0.05] px-4 pb-4 pt-3 space-y-2">
            {[
              ["Heartbeat",        relativeTime(heartbeat.last_heartbeat||heartbeat.ts)],
              ["Raw bot state",    heartbeat.bot_state||"—"],
              ["AI verdict",       heartbeat.ai_verdict||heartbeat.last_action||"—"],
              ["AI confidence",    heartbeat.ai_confidence?`${heartbeat.ai_confidence}%`:"—"],
              ["ML patterns",      heartbeat.ml_samples||heartbeat.pattern_count||"—"],
              ["ML trusted",       String(heartbeat.ml_trusted||"false")],
              ["Hive verdict",     heartbeat.hive_verdict||"—"],
              ["EPF state",        heartbeat.epf_state||"—"],
              ["EA build (internal)", heartbeat.ea_version||"—"],
              ["Build recognized",    String(status?.release?.reported_build_recognized ?? "—")],
              ["Installed version",   status?.release?.installed_version||"—"],
              ["Latest version",      status?.release?.latest_version||"—"],
              ["Update status",       status?.release?.update_status||"—"],
              ["Latest release date", status?.release?.latest_build_timestamp||"—"],
              ["Reported timeframe",  status?.production_status?.reported_timeframe||"—"],
              ["Timeframe mismatch",  String(status?.production_status?.timeframe_mismatch ?? "—")],
              ["Account",          heartbeat.account_number||"—"],
              ["License status",   licenseInfo?.status||"—"],
              ["License key",      licenseInfo?.activation_key||"—"],
              ["Setup checks",     `${(status?.setup_checks||[]).filter(c=>c.ok).length}/${(status?.setup_checks||[]).length} passing`],
            ].map(([k,v])=>(
              <div key={k} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-2">
                <span className="font-mono text-[10px] text-white/30">{k}</span>
                <span className="font-mono text-[10px] text-white/50 text-right break-all max-w-[55%]">{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Command Center quick tools ───────────────────────────────────────────────
function CommandToolsStrip({ setActive }) {
  const items = [
    [MessageCircle, "Support", "Talk to XauCloud", "support"],
    [GraduationCap, "Learn", "Forex A–Z", "education"],
    [Search, "Patterns", "Chart playbook", "patterns"],
  ];
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="command-tools-strip">
      {items.map(([Icon, label, sub, id]) => (
        <button key={id} onClick={() => setActive(id)}
          className="no-select rounded-2xl bg-[#0C0D12] px-3 py-3 text-left transition active:scale-[0.98] hover:bg-white/[0.055]">
          <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-gold-300/10 text-gold-300">
            <Icon className="h-4 w-4" />
          </span>
          <div className="text-[12.5px] font-semibold">{label}</div>
          <div className="mt-0.5 truncate text-[9.5px] text-white/35">{sub}</div>
        </button>
      ))}
    </div>
  );
}

// ─── More (native grouped hub) ──────────────────────────────────────────────
function MorePage({ setActive, me, status, openNotifications, logout }) {
  const eaVer = status?.release?.public_display_name || "XauCloud";
  const updateAvailable = status?.release?.update_available;
  return (
    <div className="space-y-5" data-testid="more-page">
      <div className="overflow-hidden rounded-[26px] bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,0.16),transparent_38%),linear-gradient(145deg,#111218,#090A0E)] p-5">
        <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-gold-300/60">Command Center</div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.65rem] font-black tracking-tight">More control. Less friction.</h1>
            <p className="mt-1 max-w-md text-[12px] leading-5 text-white/45">
              Support, learning, market-pattern reference and account tools in one place.
            </p>
          </div>
          <div className="hidden rounded-2xl bg-gold-300 px-3 py-2 text-center text-black sm:block">
            <div className="font-mono text-[9px] uppercase">Build</div>
            <div className="text-[11px] font-black">{eaVer}</div>
          </div>
        </div>
      </div>

      <CommandToolsStrip setActive={setActive} />

      <UI.ListGroup label="Account">
        <UI.ListRow icon={KeyRound} label="License" sub="Key, MT5 binding, EA download" onClick={() => setActive("license")} />
        <UI.ListRow icon={CircleDollarSign} label="Billing" sub="Plan, payment history, signal add-ons" onClick={() => setActive("billing")} />
        <UI.ListRow icon={User} label="Account & Security" sub="Profile, connection, log out" onClick={() => setActive("settings")} last />
      </UI.ListGroup>

      <UI.ListGroup label="Trading">
        <UI.ListRow icon={SlidersHorizontal} label="Bot Control" sub="Bot on/off & Prop Firm protection" onClick={() => setActive("control")} />
        <UI.ListRow icon={Brain} label="AI Brain" sub="Decisions, ML state, blocks" onClick={() => setActive("intelligence")} />
        <UI.ListRow icon={Search} label="Pattern Scanner" sub="Real EA context + professional pattern playbook" onClick={() => setActive("patterns")} />
        <UI.ListRow icon={LineChart} label="Market Outlook" sub="Signals, evidence, history" onClick={() => { window.location.href = "/ai-market-outlook"; }} last />
      </UI.ListGroup>

      <UI.ListGroup label="Learn & Support">
        <UI.ListRow icon={GraduationCap} label="Forex Academy" sub="Beginner to advanced — complete trading curriculum" onClick={() => setActive("education")} />
        <UI.ListRow icon={MessageCircle} label="Support Center" sub="Create a ticket and talk with XauCloud support" onClick={() => setActive("support")} />
        <UI.ListRow icon={HelpCircle} label="FAQ" sub="Trading, XauCloud and account questions" onClick={() => setActive("education")} last />
      </UI.ListGroup>

      <UI.ListGroup label="App">
        <UI.ListRow icon={Bell} label="Notifications" sub="Trades, outlook, license, system" onClick={openNotifications} />
        <UI.ListRow icon={Download} label="Downloads & Updates" sub={updateAvailable ? "Update available" : "Latest EA"} onClick={() => setActive("license")} />
        <UI.ListRow icon={ShieldCheck} label="About XauCloud" value={eaVer} last />
      </UI.ListGroup>

      <button onClick={logout} className="no-select w-full rounded-2xl border border-red-400/20 bg-red-500/[0.06] px-4 py-3 text-[13px] font-semibold text-red-300 transition hover:bg-red-500/[0.1]">
        Log out
      </button>

      <p className="pb-2 text-center text-[10px] text-white/25">XauCloud · {eaVer} · xaucloud.io</p>
    </div>
  );
}

// ─── Support Center ──────────────────────────────────────────────────────────
const SUPPORT_CATEGORIES = [
  ["account", "Account"],
  ["license", "License"],
  ["payment", "Payment"],
  ["installation", "Installation"],
  ["trading", "Trading"],
  ["technical", "Technical"],
  ["education", "Education"],
  ["other", "Other"],
];

function SupportStatus({ status }) {
  const raw = String(status || "open").toLowerCase();
  const cls = raw === "closed"
    ? "bg-white/[0.06] text-white/45"
    : raw.includes("waiting")
      ? "bg-gold-300/10 text-gold-200"
      : "bg-emerald-400/10 text-emerald-300";
  return <span className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${cls}`}>{raw.replaceAll("_", " ")}</span>;
}

export function SupportCenterPage({ setActive, me }) {
  const [tickets, setTickets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("technical");
  const [message, setMessage] = useState("");
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const loadTickets = useCallback(async () => {
    try {
      const r = await commandAxios.get("/cloud/support/tickets");
      setTickets(r.data?.tickets || []);
    } catch (e) {
      setNotice(e.response?.data?.detail || "Support is temporarily unavailable.");
    } finally {
      setLoadingTickets(false);
    }
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const openTicket = async (id) => {
    setSelectedId(id); setNotice("");
    try {
      const r = await commandAxios.get(`/cloud/support/tickets/${encodeURIComponent(id)}`);
      setSelected(r.data?.ticket || null);
    } catch (e) {
      setNotice(e.response?.data?.detail || "Could not load this ticket.");
    }
  };

  const submitTicket = async () => {
    if (!subject.trim() || !message.trim() || busy) return;
    setBusy(true); setNotice("");
    try {
      const r = await commandAxios.post("/cloud/support/tickets", {
        subject: subject.trim(), category, message: message.trim(),
      });
      const t = r.data?.ticket;
      setSubject(""); setMessage(""); setNewOpen(false);
      await loadTickets();
      if (t?.id) await openTicket(t.id);
      setNotice("Ticket created. XauCloud support can now see it.");
    } catch (e) {
      setNotice(e.response?.data?.detail || "Could not create the ticket.");
    } finally { setBusy(false); }
  };

  const sendReply = async () => {
    if (!selectedId || !replyText.trim() || busy) return;
    setBusy(true); setNotice("");
    try {
      const r = await commandAxios.post(`/cloud/support/tickets/${encodeURIComponent(selectedId)}/reply`, {
        message: replyText.trim(),
      });
      setSelected(r.data?.ticket || selected);
      setReplyText("");
      await loadTickets();
    } catch (e) {
      setNotice(e.response?.data?.detail || "Could not send your reply.");
    } finally { setBusy(false); }
  };

  if (selected) {
    return (
      <div className="space-y-4" data-testid="support-ticket-detail">
        <button onClick={() => { setSelected(null); setSelectedId(null); }} className="no-select inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/55 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Support Center
        </button>

        <div className="rounded-[24px] bg-[#0C0D12] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">{selected.id}</div>
              <h1 className="mt-1 text-[1.2rem] font-black tracking-tight">{selected.subject}</h1>
              <div className="mt-1 text-[11px] text-white/35">{selected.category} · updated {relativeTime(selected.updated_at)}</div>
            </div>
            <SupportStatus status={selected.status} />
          </div>
        </div>

        <div className="space-y-2">
          {(selected.messages || []).map((m, i) => {
            const mine = m.author_type === "customer";
            return (
              <div key={m.id || i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-[20px] px-4 py-3 ${mine ? "bg-gold-300 text-black" : "bg-[#0C0D12] text-white"}`}>
                  <div className={`mb-1 font-mono text-[8px] uppercase tracking-[0.14em] ${mine ? "text-black/45" : "text-white/30"}`}>
                    {mine ? "You" : "XauCloud Support"} · {relativeTime(m.created_at)}
                  </div>
                  <p className={`whitespace-pre-wrap text-[12.5px] leading-5 ${mine ? "text-black/85" : "text-white/70"}`}>{m.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        <AK.Panel className="p-3">
          <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} maxLength={5000}
            placeholder="Reply to support…"
            className="min-h-[88px] w-full resize-none bg-transparent px-1 text-[13px] leading-5 text-white outline-none placeholder:text-white/25" />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[9px] text-white/25">{replyText.length}/5000</span>
            <AK.Button size="sm" onClick={sendReply} disabled={busy || !replyText.trim()}>
              {busy ? "Sending…" : "Send reply"}
            </AK.Button>
          </div>
        </AK.Panel>
        {notice && <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[11px] text-white/55">{notice}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="support-center-page">
      <button onClick={() => setActive("more")} className="no-select inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/55 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> More
      </button>

      <div className="rounded-[26px] bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,0.16),transparent_42%),#0C0D12] p-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gold-300/12 text-gold-300">
          <MessageCircle className="h-5 w-5" />
        </span>
        <h1 className="mt-4 text-[1.55rem] font-black tracking-tight">Support Center</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-white/45">
          Tell us what happened. Your ticket is available to XauCloud support and the controlled Admin assistant — without exposing your password, tokens or private credentials.
        </p>
        <button onClick={() => setNewOpen((v) => !v)} className="mt-4 rounded-xl bg-gold-300 px-4 py-2.5 text-[12px] font-black text-black">
          {newOpen ? "Cancel" : "New support ticket"}
        </button>
      </div>

      {newOpen && (
        <AK.Panel className="p-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">Create ticket</div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160}
            placeholder="What do you need help with?"
            className="mt-3 w-full rounded-xl bg-white/[0.04] px-3 py-3 text-[13px] text-white outline-none placeholder:text-white/25 focus:ring-1 focus:ring-gold-300/40" />
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {SUPPORT_CATEGORIES.map(([id, label]) => (
              <button key={id} onClick={() => setCategory(id)}
                className={`flex-none rounded-full px-3 py-1.5 text-[10px] font-semibold ${category === id ? "bg-gold-300 text-black" : "bg-white/[0.05] text-white/45"}`}>
                {label}
              </button>
            ))}
          </div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000}
            placeholder="Explain what happened, what you expected, and any error you saw."
            className="mt-3 min-h-[120px] w-full resize-none rounded-xl bg-white/[0.04] px-3 py-3 text-[13px] leading-5 text-white outline-none placeholder:text-white/25 focus:ring-1 focus:ring-gold-300/40" />
          <AK.Button className="mt-3 w-full" onClick={submitTicket} disabled={busy || !subject.trim() || !message.trim()}>
            {busy ? "Creating…" : "Create ticket"}
          </AK.Button>
        </AK.Panel>
      )}

      {notice && <div className="rounded-xl bg-white/[0.04] px-3 py-2 text-[11px] text-white/55">{notice}</div>}

      <UI.SectionLabel className="px-1">Your tickets</UI.SectionLabel>
      {loadingTickets ? (
        <AK.Panel className="p-5"><div className="animate-pulse text-[12px] text-white/35">Loading support…</div></AK.Panel>
      ) : tickets.length ? (
        <div className="overflow-hidden rounded-2xl bg-[#0C0D12]">
          {tickets.map((t, i) => (
            <button key={t.id} onClick={() => openTicket(t.id)}
              className={`no-select flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.035] ${i ? "border-t border-white/[0.055]" : ""}`}>
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white/[0.05] text-gold-300">
                <MessageCircle className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{t.subject}</div>
                <div className="mt-0.5 truncate text-[10px] text-white/35">{t.category} · {relativeTime(t.updated_at)}</div>
              </div>
              <SupportStatus status={t.status} />
              <ChevronRight className="h-4 w-4 flex-none text-white/20" />
            </button>
          ))}
        </div>
      ) : (
        <AK.Panel><AK.Empty icon={MessageCircle} title="No support tickets" body="When you need us, create a ticket here. Your conversation stays attached to your XauCloud account." /></AK.Panel>
      )}

      <p className="text-center text-[10px] leading-4 text-white/25">
        Never send passwords, API keys, recovery codes or payment-card details in a support ticket.
      </p>
    </div>
  );
}

// ─── Forex Academy ───────────────────────────────────────────────────────────
const FOREX_CURRICULUM = [
  {
    id: "foundation", level: "01 · Beginner", icon: GraduationCap, title: "Forex Foundations", sub: "What the market is, who trades it, and why prices move",
    sections: [
      ["What forex actually is", "Foreign exchange is the global market where one currency is exchanged for another. Prices move because banks, funds, companies, governments and traders continuously change what they are willing to buy and sell."],
      ["Currency pairs", "A pair compares two currencies. In EURUSD, EUR is the base and USD is the quote. If EURUSD rises, one euro buys more dollars. Gold is commonly quoted as XAUUSD — the value of one ounce of gold in US dollars."],
      ["Why markets move", "Price responds to changing expectations about interest rates, inflation, growth, risk, liquidity and positioning. Technical patterns matter because they summarize what buyers and sellers are doing — not because a shape magically predicts the future."],
      ["Your first rule", "Treat trading as risk management first and prediction second. You can be wrong often and still survive if losses are small; one oversized loss can erase weeks of good decisions."],
    ],
  },
  {
    id: "quotes", level: "02 · Beginner", icon: Gauge, title: "Quotes, Pips & Lots", sub: "Read price correctly before risking money",
    sections: [
      ["Bid and ask", "You sell at the bid and buy at the ask. The difference is the spread — an immediate transaction cost. Fast markets and illiquid periods can widen it."],
      ["Pips and points", "A pip is a standardized unit of price movement. Brokers may display extra decimal points, so always learn your symbol's contract specification instead of assuming every instrument uses the same point value."],
      ["Lot size", "Position size controls how much money each price movement is worth. A stop distance means nothing without lot size; risk comes from both together."],
      ["Contract specs matter", "Gold contract size, tick value, minimum lot and margin can differ by broker. Check MT5 Symbol Specification before translating a setup into money risk."],
    ],
  },
  {
    id: "orders", level: "03 · Beginner", icon: Target, title: "Orders & Execution", sub: "Market, limit, stop, stop-loss and take-profit",
    sections: [
      ["Market orders", "A market order asks to trade now at the best available price. During volatility the fill can differ from the price you saw — this is slippage."],
      ["Limit orders", "A buy limit sits below current price and a sell limit above. Limits seek a better price but may never fill."],
      ["Stop orders", "A buy stop sits above current price and a sell stop below. They are often used for breakout participation, but false breaks and slippage are real risks."],
      ["SL and TP", "A stop-loss defines where the trade thesis is invalidated. A take-profit is a planned exit. Place them because the market structure requires them, then size the trade to that distance — not the other way around."],
    ],
  },
  {
    id: "margin", level: "04 · Beginner", icon: ShieldCheck, title: "Leverage, Margin & Liquidation Risk", sub: "Understand the amplifier before using it",
    sections: [
      ["Leverage", "Leverage lets you control more market exposure than your deposited cash. It magnifies both gains and losses; it does not improve the quality of a setup."],
      ["Margin", "Margin is collateral reserved to keep leveraged positions open. Free margin falls as positions lose or as you add exposure."],
      ["Margin calls", "If equity falls too far, a broker can restrict or close positions. Never build a strategy that depends on being allowed unlimited room to recover."],
      ["Professional mindset", "Choose position size from your acceptable loss at the stop, then check margin. Never choose the biggest lot your broker permits."],
    ],
  },
  {
    id: "risk", level: "05 · Core Skill", icon: ShieldCheck, title: "Risk Management", sub: "The skill that keeps you in the game",
    sections: [
      ["Risk per trade", "Define the maximum account percentage or cash amount you can lose if the stop is hit. Consistency matters more than chasing a large win."],
      ["R-multiples", "1R is the amount you planned to risk. A +2R winner makes twice that risk; a -1R loss loses the planned risk. R lets you compare trades independent of lot size."],
      ["Drawdown", "Drawdown measures decline from a previous equity peak. Recovery gets mathematically harder as drawdown deepens, which is why preventing large losses matters."],
      ["Correlated risk", "Several trades can be one hidden bet. If instruments respond to the same USD move, total portfolio risk can be much larger than the sum of labels suggests."],
      ["Risk of ruin", "No setup has a 100% win rate. A position size that cannot survive a normal losing streak is too large, even if the recent backtest looked excellent."],
    ],
  },
  {
    id: "structure", level: "06 · Core Skill", icon: LineChart, title: "Market Structure", sub: "Higher highs, lower lows, breaks and transitions",
    sections: [
      ["Trend structure", "Uptrends tend to print higher highs and higher lows; downtrends lower highs and lower lows. Structure is evidence, not a guarantee."],
      ["Break of structure", "A meaningful break occurs when price decisively moves through a structural swing. A wick alone can be a liquidity probe rather than confirmation."],
      ["Change of character", "When the market stops behaving like its prior trend, a transition may be starting. Wait for follow-through before treating every countertrend move as a reversal."],
      ["Context beats labels", "A bullish structure break directly into major resistance is different from the same break after a clean base with room to move."],
    ],
  },
  {
    id: "sr", level: "07 · Core Skill", icon: Target, title: "Support, Resistance & Liquidity", sub: "Where reactions become more likely",
    sections: [
      ["Zones, not laser lines", "Support and resistance are usually areas where order flow changed before. Treat them as zones with tolerance, not exact prices that must hold to the pip."],
      ["Liquidity", "Stops and pending orders cluster around obvious highs, lows and range edges. Price can sweep these areas before choosing direction."],
      ["Role reversal", "Broken resistance can become support and broken support can become resistance, especially when a retest is accepted."],
      ["Confluence", "A level becomes more useful when structure, trend, session timing and risk-to-reward also support the trade."],
    ],
  },
  {
    id: "candles", level: "08 · Core Skill", icon: Activity, title: "Candlesticks & Price Action", sub: "Read what happened inside each bar",
    sections: [
      ["Body and wick", "The body shows the open-to-close move; wicks show extremes rejected or revisited. A long wick is meaningful only relative to nearby structure and recent volatility."],
      ["Engulfing bars", "An engulfing candle can signal decisive order flow when it appears at a meaningful location. In the middle of random chop, it is just another candle."],
      ["Pin bars", "A pin bar shows rejection: price explored one side and closed away from it. Confirmation and location determine whether that rejection is useful."],
      ["Inside bars", "An inside bar represents compression. Breakouts can expand quickly, but both sides may be swept first, so define invalidation before entry."],
    ],
  },
  {
    id: "patterns", level: "09 · Core Skill", icon: Search, title: "Chart Patterns", sub: "Reversals, continuations and failed patterns",
    sections: [
      ["Patterns are behavior", "A pattern is a visual shorthand for repeated order-flow behavior. The best question is not 'what shape is this?' but 'who is trapped, who is defending, and where is invalidation?'"],
      ["Reversal families", "Double tops/bottoms, head-and-shoulders and failed breakouts matter most after an extended move and near a meaningful level."],
      ["Continuation families", "Flags, pennants and tight consolidations can pause a strong move before continuation. Quality falls when the impulse into the pattern was weak."],
      ["Failure is information", "A textbook pattern that breaks the wrong way can create an even stronger move because traders positioned for the obvious outcome are forced to exit."],
    ],
  },
  {
    id: "indicators", level: "10 · Intermediate", icon: Gauge, title: "Indicators Without Indicator Addiction", sub: "Trend, momentum and volatility tools",
    sections: [
      ["Moving averages", "Moving averages smooth price and can describe trend direction or dynamic zones. They lag by design and should not replace price structure."],
      ["RSI", "RSI measures momentum, not automatic reversal. 'Overbought' can stay overbought through a strong trend."],
      ["ATR", "Average True Range estimates recent volatility. It is useful for comparing stop distance and expected movement across different market regimes."],
      ["Use fewer tools", "Several indicators derived from the same price data can create fake confluence. Know what each tool measures and avoid counting the same evidence multiple times."],
    ],
  },
  {
    id: "timeframes", level: "11 · Intermediate", icon: LineChart, title: "Multi-Timeframe Analysis", sub: "Align context, setup and execution",
    sections: [
      ["Top-down thinking", "Use a higher timeframe for broad structure, a working timeframe for the setup, and a lower timeframe only when it genuinely improves execution."],
      ["Avoid timeframe shopping", "If you keep switching charts until one agrees with your bias, you are not doing multi-timeframe analysis — you are searching for confirmation."],
      ["Conflict is normal", "A lower-timeframe uptrend can exist inside a higher-timeframe downtrend. Decide which timeframe defines your trade thesis before entering."],
    ],
  },
  {
    id: "sessions", level: "12 · Intermediate", icon: Clock3, title: "Sessions, News & Volatility", sub: "When liquidity and event risk change",
    sections: [
      ["Trading sessions", "London and New York typically bring deeper liquidity to major FX pairs and gold. Session opens can create both genuine expansion and stop-clearing volatility."],
      ["Economic news", "Rate decisions, CPI, jobs data and central-bank communication can move markets violently. Technical levels may slip or gap during high-impact releases."],
      ["Gold drivers", "Gold often responds to real yields, USD direction, inflation expectations, risk sentiment and geopolitics. Relationships can weaken or reverse in different regimes."],
      ["Do not predict headlines", "Your edge should not depend on correctly guessing a number before release. Decide whether your system trades, reduces risk or stands aside around scheduled news."],
    ],
  },
  {
    id: "xau", level: "13 · Intermediate", icon: Flame, title: "Trading Gold (XAUUSD)", sub: "Why gold behaves differently from major FX pairs",
    sections: [
      ["Gold moves fast", "XAUUSD can travel large distances quickly and can reverse sharply. Stops, lot size and broker tick values deserve extra attention."],
      ["Liquidity sweeps", "Gold frequently probes obvious highs and lows before expanding. Entering purely because a level was touched can be expensive."],
      ["Macro sensitivity", "USD moves, yields, inflation expectations and risk events can dominate technical setups. Context can change in minutes."],
      ["Respect the spread", "Around rollover and major news, gold spreads can widen significantly. A strategy tested on ideal fills may perform very differently live."],
    ],
  },
  {
    id: "strategy", level: "14 · Intermediate", icon: Brain, title: "Building a Trading Strategy", sub: "Turn ideas into explicit rules",
    sections: [
      ["Define the setup", "Write down market condition, location, trigger, invalidation and target. If two traders cannot apply the rule consistently, it is not defined enough."],
      ["Separate signal and sizing", "The setup decides whether a trade exists. Risk management decides how large it may be. Do not increase size because you 'feel' more confident."],
      ["Define no-trade conditions", "Knowing when not to trade is part of the strategy: late entries, poor liquidity, excessive spread, news risk, weak structure or insufficient reward."],
      ["Measure expectancy", "Expectancy combines win rate and average win/loss. A high win rate with occasional huge losses can still be a bad system."],
    ],
  },
  {
    id: "execution", level: "15 · Intermediate", icon: Target, title: "Entries, Stops & Targets", sub: "Translate an idea into an executable plan",
    sections: [
      ["Entry location", "Good entries balance confirmation with remaining room. Waiting too long can turn a correct idea into poor risk-to-reward."],
      ["Stop placement", "Place the stop where the thesis is invalid, then size down if the stop is wide. Tightening a stop only to fit a larger lot is backwards."],
      ["Targets", "Targets can use structure, liquidity, volatility or R-multiples. A target should have a reason, not just a round profit number."],
      ["Partial exits", "Scaling out can reduce variance but also reduce average winner size. Test the rule instead of assuming partial profit is always superior."],
    ],
  },
  {
    id: "management", level: "16 · Advanced", icon: ShieldCheck, title: "Trade Management", sub: "Break-even, trailing, scaling and exits",
    sections: [
      ["Break-even is not free", "Moving a stop to entry removes downside on that trade but can also convert normal retests into premature exits."],
      ["Trailing stops", "A trailing method should match market structure or volatility. A trail that is too tight can destroy a trend-following edge."],
      ["Let winners breathe", "The goal is not to protect every floating dollar. The goal is to protect the strategy's long-term expectancy."],
      ["Exit reasons", "Log whether exits were planned, structural, protective or emotional. Mixing discretionary exits with rule-based exits makes performance hard to diagnose."],
    ],
  },
  {
    id: "psychology", level: "17 · Advanced", icon: Brain, title: "Trading Psychology", sub: "Process, discipline and emotional control",
    sections: [
      ["FOMO", "Fear of missing out usually appears after price has already moved. Missing a trade is cheaper than entering a bad one."],
      ["Revenge trading", "After a loss, the desire to immediately win it back changes decision quality. A predefined cooldown rule can protect you from yourself."],
      ["Outcome bias", "A good trade can lose and a bad trade can win. Judge whether you followed your process before judging the P&L."],
      ["Boredom", "Many trading mistakes happen because nothing is happening. Professional behavior includes doing nothing when there is no edge."],
    ],
  },
  {
    id: "journal", level: "18 · Advanced", icon: BookOpen, title: "Journaling & Statistics", sub: "Learn from your own evidence",
    sections: [
      ["What to record", "Capture setup type, market regime, entry reason, stop, target, result, screenshot and whether every rule was followed."],
      ["Sample size", "Five wins are not proof of an edge and five losses are not proof a strategy is broken. Evaluate enough trades to include normal variance."],
      ["Key metrics", "Track expectancy, average R, win rate, profit factor, drawdown, losing streaks and performance by setup or regime."],
      ["Review mistakes separately", "Separate strategy losses from execution mistakes. Otherwise you may change a good system to solve a discipline problem."],
    ],
  },
  {
    id: "backtest", level: "19 · Advanced", icon: History, title: "Backtesting & Forward Testing", sub: "Prove an idea before trusting it",
    sections: [
      ["Avoid hindsight", "Define rules before scrolling through history. If the rule changes every time a losing example appears, the test is not valid."],
      ["Include costs", "Spread, commission, slippage and realistic fill assumptions matter. Tiny theoretical edges can disappear after costs."],
      ["Out-of-sample", "Build on one period and validate on another. If performance exists only in the data used to invent the rules, it may be overfit."],
      ["Forward test", "Demo or very small live testing shows how the system behaves with real-time decisions, latency and emotions."],
    ],
  },
  {
    id: "prop", level: "20 · Advanced", icon: ShieldCheck, title: "Prop Firm Risk", sub: "Daily loss, total drawdown and rule-aware trading",
    sections: [
      ["Read the actual rules", "Different firms calculate daily drawdown, trailing loss and equity limits differently. Never rely on a generic interpretation."],
      ["Use a buffer", "Do not trade exactly against the firm's loss threshold. Fees, floating P&L and calculation timing can create accidental breaches."],
      ["Consistency", "A challenge is a risk-management exercise before it is a profit target. Oversizing to finish faster often reduces the probability of completion."],
    ],
  },
  {
    id: "xaucloud", level: "21 · XauCloud", icon: Bot, title: "Using XauCloud Professionally", sub: "Understand what automation can — and cannot — do",
    sections: [
      ["Automation is not certainty", "XauCloud can execute a defined process consistently, but no trading system can guarantee profit or eliminate market risk."],
      ["Bot On / Off", "Bot Off stops new automatic entries while existing positions remain managed. Turning Bot On allows normal qualified entries again; it never forces an immediate trade."],
      ["Market Outlook", "Outlook is evidence and context, not permission to abandon risk rules. Execution still follows XauCloud's blockers and configured risk controls."],
      ["Use the data", "Review Analytics, Activity, AI Brain and the Pattern Scanner to understand what the system is seeing rather than judging it from one trade."],
    ],
  },
];

const FOREX_FAQ = [
  ["How much money do I need to start?", "There is no universal minimum. Start with an amount small enough that your planned percentage risk produces a position size your broker supports. Learning on demo first is often the better choice."],
  ["What is a good win rate?", "Win rate alone is meaningless. A 40% system can be excellent if winners are much larger than losers; a 90% system can be dangerous if rare losses are enormous."],
  ["How much should I risk per trade?", "There is no number that fits everyone. The right risk is small enough to survive normal losing streaks and remain inside your personal or prop-firm drawdown limits."],
  ["Are indicators bad?", "No. Indicators are tools derived from market data. Problems begin when several correlated indicators are treated as independent confirmation or used without understanding what they measure."],
  ["Can chart patterns guarantee a move?", "No. Patterns organize probabilities and invalidation. They fail regularly, which is why location, confirmation and risk management matter."],
  ["Should I trade news?", "Only if your strategy was designed and tested for news conditions. Spreads, slippage and volatility can change dramatically around releases."],
  ["Is gold harder than forex?", "Gold is not automatically harder, but it is often faster and more volatile. Position sizing and execution discipline are especially important."],
  ["Can an EA guarantee profit?", "No. Automation can improve consistency and remove some emotional mistakes, but market uncertainty and loss remain real."],
];

export function EducationPage({ setActive }) {
  const [topicId, setTopicId] = useState(null);
  const [faqOpen, setFaqOpen] = useState(null);
  const [query, setQuery] = useState("");
  // localStorage remains a same-device instant-paint cache only. The backend
  // (academy_progress) is the sole source of truth for certificate
  // eligibility -- see /cloud/academy/progress below, which reconciles this
  // on load and after every toggle.
  const [completed, setCompleted] = useState(() => {
    try { return JSON.parse(localStorage.getItem("xaucloud_edu_completed") || "[]"); } catch { return []; }
  });
  const [certStatus, setCertStatus] = useState(null); // { eligible, issued, needs_name, certificate, completed_count, required_count }
  const [nameInput, setNameInput] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [certError, setCertError] = useState("");
  const topic = FOREX_CURRICULUM.find((t) => t.id === topicId);

  const refreshCertStatus = useCallback(() => {
    commandAxios.get("/cloud/academy/certificate").then((r) => setCertStatus(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    commandAxios.get("/cloud/academy/progress").then((r) => {
      setCompleted(r.data.completed_lesson_ids || []);
      try { localStorage.setItem("xaucloud_edu_completed", JSON.stringify(r.data.completed_lesson_ids || [])); } catch {}
    }).catch(() => {});
    refreshCertStatus();
  }, [refreshCertStatus]);

  const toggleComplete = (id) => {
    const wasComplete = completed.includes(id);
    const next = wasComplete ? completed.filter((x) => x !== id) : [...completed, id];
    setCompleted(next);
    try { localStorage.setItem("xaucloud_edu_completed", JSON.stringify(next)); } catch {}
    const call = wasComplete
      ? commandAxios.post(`/cloud/academy/lessons/${encodeURIComponent(id)}/uncomplete`)
      : commandAxios.post(`/cloud/academy/lessons/${encodeURIComponent(id)}/complete`);
    call.then(() => refreshCertStatus()).catch(() => {});
  };

  const confirmNameAndIssue = () => {
    const name = nameInput.trim();
    if (name.length < 2) { setCertError("Enter the name to appear on your certificate."); return; }
    setIssuing(true); setCertError("");
    commandAxios.post("/cloud/academy/certificate/confirm-name", { name })
      .then((r) => setCertStatus((prev) => ({ ...prev, issued: true, needs_name: false, certificate: r.data.certificate })))
      .catch((e) => setCertError(e?.response?.data?.detail || "Could not issue certificate. Try again."))
      .finally(() => setIssuing(false));
  };

  if (topic) {
    const done = completed.includes(topic.id);
    return (
      <div className="space-y-4" data-testid="education-topic">
        <button onClick={() => setTopicId(null)} className="no-select inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/55 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Forex Academy
        </button>
        <div className="rounded-[26px] bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,0.13),transparent_42%),#0C0D12] p-5">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-300/60">{topic.level}</div>
          <div className="mt-3 flex items-center gap-3">
            <span className="rounded-xl bg-gold-300/10 p-2.5"><topic.icon className="h-5 w-5 text-gold-300" /></span>
            <div>
              <h1 className="text-[1.35rem] font-black tracking-tight">{topic.title}</h1>
              <p className="mt-0.5 text-[11.5px] text-white/40">{topic.sub}</p>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {topic.sections.map(([h, body]) => (
            <AK.Panel key={h} className="p-4">
              <div className="text-[14px] font-semibold">{h}</div>
              <p className="mt-1.5 text-[12.5px] leading-5 text-white/55">{body}</p>
            </AK.Panel>
          ))}
        </div>
        <button onClick={() => toggleComplete(topic.id)}
          className={`w-full rounded-2xl py-3 text-[12px] font-black ${done ? "bg-emerald-400/12 text-emerald-300" : "bg-gold-300 text-black"}`}>
          {done ? "✓ Completed — tap to undo" : "Mark lesson complete"}
        </button>
        <p className="text-center text-[9.5px] leading-4 text-white/25">
          Education only. Examples explain market mechanics and risk; they are not personalized financial advice or guarantees.
        </p>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = FOREX_CURRICULUM.filter((t) => !q || `${t.title} ${t.sub} ${t.level} ${t.sections.flat().join(" ")}`.toLowerCase().includes(q));
  const progress = Math.round((completed.length / FOREX_CURRICULUM.length) * 100);

  return (
    <div className="space-y-5" data-testid="education-page">
      <button onClick={() => setActive("more")} className="no-select inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/55 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> More
      </button>

      <div className="rounded-[28px] bg-[radial-gradient(circle_at_85%_10%,rgba(243,201,105,0.18),transparent_38%),linear-gradient(145deg,#111218,#090A0E)] p-5">
        <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-gold-300/65">XauCloud Forex Academy</div>
        <h1 className="mt-2 text-[1.7rem] font-black tracking-tight">Learn trading from zero to professional process.</h1>
        <p className="mt-2 max-w-lg text-[12.5px] leading-5 text-white/45">
          Market mechanics, price action, risk, psychology, testing, gold and automation — organized as a real learning path instead of random tips.
        </p>
        <div className="mt-4">
          <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-[0.15em] text-white/35">
            <span>Your progress</span><span>{completed.length}/{FOREX_CURRICULUM.length} · {progress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-gold-300" style={{ width: `${progress}%` }} /></div>
        </div>
      </div>

      <AK.Panel className="p-4">
        {certStatus?.issued && certStatus.certificate ? (
          <div>
            <div className="flex items-center gap-2 text-[13px] font-black text-emerald-300">
              <Trophy className="h-4 w-4" /> ACADEMY COMPLETE ✓
            </div>
            <p className="mt-1.5 text-[12px] leading-5 text-white/55">
              Congratulations — you've completed the XauCloud Forex Academy. Your certificate is issued in the name of{" "}
              <span className="font-semibold text-white/85">{certStatus.certificate.recipient_name}</span>.
            </p>
            <div className="mt-3 flex gap-2">
              <a href={`${API}/cloud/academy/certificate/view`} target="_blank" rel="noreferrer"
                className="no-select inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] py-2.5 text-[11.5px] font-bold text-white/85">
                <Eye className="h-3.5 w-3.5" /> View Certificate
              </a>
              <a href={`${API}/cloud/academy/certificate/download`}
                className="no-select inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gold-300 py-2.5 text-[11.5px] font-black text-black">
                <Download className="h-3.5 w-3.5" /> Download Certificate
              </a>
            </div>
            <p className="mt-2 text-[10px] text-white/30">Certificate ID: {certStatus.certificate.certificate_id}</p>
          </div>
        ) : certStatus?.eligible && certStatus.needs_name ? (
          <div>
            <div className="flex items-center gap-2 text-[13px] font-black text-gold-300"><Trophy className="h-4 w-4" /> Academy complete — one step left</div>
            <p className="mt-1.5 text-[12px] leading-5 text-white/55">Enter the name to appear on your certificate. This becomes permanent once issued.</p>
            <div className="mt-3 flex gap-2">
              <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Full name for certificate"
                className="min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3 py-2.5 text-[12.5px] text-white outline-none placeholder:text-white/30" />
              <button onClick={confirmNameAndIssue} disabled={issuing}
                className="no-select flex-none rounded-xl bg-gold-300 px-4 py-2.5 text-[11.5px] font-black text-black disabled:opacity-50">
                {issuing ? "Issuing…" : "Get Certificate"}
              </button>
            </div>
            {certError && <p className="mt-1.5 text-[11px] text-loss">{certError}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white/[0.05] text-white/30"><Trophy className="h-4 w-4" /></span>
            <div>
              <div className="text-[12.5px] font-bold text-white/70">Certificate</div>
              <p className="text-[11px] text-white/40">Complete the Academy to unlock your certificate.</p>
            </div>
          </div>
        )}
      </AK.Panel>

      <div className="flex items-center gap-2 rounded-2xl bg-[#0C0D12] px-3">
        <Search className="h-4 w-4 flex-none text-white/25" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search pips, risk, patterns, psychology…"
          className="min-w-0 flex-1 bg-transparent py-3 text-[12px] text-white outline-none placeholder:text-white/25" />
      </div>

      <div>
        <UI.SectionLabel className="mb-2 px-1">Curriculum · {filtered.length} lessons</UI.SectionLabel>
        <div className="overflow-hidden rounded-2xl bg-[#0C0D12]">
          {filtered.map((t, i) => {
            const done = completed.includes(t.id);
            return (
              <button key={t.id} onClick={() => setTopicId(t.id)}
                className={`no-select flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.035] ${i ? "border-t border-white/[0.055]" : ""}`}>
                <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${done ? "bg-emerald-400/10 text-emerald-300" : "bg-gold-300/10 text-gold-300"}`}>
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <t.icon className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-white/25">{t.level}</div>
                  <div className="mt-0.5 truncate text-[13px] font-semibold">{t.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-white/35">{t.sub}</div>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-white/20" />
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <UI.SectionLabel className="mb-2 px-1">Trading FAQ</UI.SectionLabel>
        <div className="space-y-2">
          {FOREX_FAQ.map(([question, answer], i) => {
            const open = faqOpen === i;
            return (
              <div key={question} className="overflow-hidden rounded-2xl bg-[#0C0D12]">
                <button onClick={() => setFaqOpen(open ? null : i)} className="no-select flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                  <span className="text-[12.5px] font-semibold">{question}</span>
                  <ChevronDown className={`h-4 w-4 flex-none text-white/30 transition ${open ? "rotate-180" : ""}`} />
                </button>
                {open && <p className="border-t border-white/[0.05] px-4 py-3 text-[12px] leading-5 text-white/50">{answer}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Pattern Scanner / playbook ──────────────────────────────────────────────
const PATTERN_LIBRARY = [
  ["Double Bottom", "Reversal", "bullish", "Two defended lows near the same zone after a decline.", ["Decline or bearish context before pattern", "Second low rejects instead of accelerating lower", "Neckline / intervening swing breaks", "Room exists before major resistance"]],
  ["Double Top", "Reversal", "bearish", "Two rejected highs near the same zone after an advance.", ["Advance before pattern", "Second high fails to continue", "Intervening swing low breaks", "Room exists before major support"]],
  ["Head & Shoulders", "Reversal", "bearish", "Three-peak distribution where the middle peak extends furthest.", ["Prior uptrend", "Right shoulder shows weaker continuation", "Neckline has clear structure", "Break or retest confirms rather than anticipating"]],
  ["Inverse H&S", "Reversal", "bullish", "Three-trough accumulation where the middle trough extends furthest.", ["Prior downtrend", "Right shoulder holds higher", "Neckline is identifiable", "Break/retest confirms"]],
  ["Bull Flag", "Continuation", "bullish", "Strong impulse up followed by controlled downward/sideways pause.", ["Impulse is strong", "Pullback is orderly and smaller than impulse", "Structure does not fully reverse", "Breakout has space to continue"]],
  ["Bear Flag", "Continuation", "bearish", "Strong impulse down followed by controlled upward/sideways pause.", ["Impulse is strong", "Retracement is corrective", "Structure stays broadly bearish", "Breakdown has room"]],
  ["Ascending Triangle", "Compression", "bullish", "Flat resistance with progressively higher lows.", ["Repeated resistance tests", "Higher lows are genuine", "Compression does not become random chop", "Wait for acceptance above resistance"]],
  ["Descending Triangle", "Compression", "bearish", "Flat support with progressively lower highs.", ["Repeated support tests", "Lower highs show pressure", "Compression remains organized", "Wait for acceptance below support"]],
  ["Symmetrical Triangle", "Compression", "neutral", "Lower highs and higher lows compress volatility.", ["Both boundaries converge", "Volume/volatility often contracts", "Direction is not assumed in advance", "Breakout needs confirmation and invalidation"]],
  ["Rising Wedge", "Exhaustion", "bearish", "Price rises inside narrowing boundaries while momentum often weakens.", ["Prior rise or mature rally", "Both boundaries slope upward", "Progress is slowing", "Break of lower boundary confirms"]],
  ["Falling Wedge", "Exhaustion", "bullish", "Price falls inside narrowing boundaries while downside momentum often weakens.", ["Prior decline or mature selloff", "Both boundaries slope downward", "Downside progress is slowing", "Upper-boundary break confirms"]],
  ["Break & Retest", "Structure", "neutral", "Price breaks a meaningful level, returns, then accepts the new side.", ["Level was meaningful before break", "Break has conviction", "Retest holds the new side", "Entry still has sensible invalidation and reward"]],
  ["Engulfing Rejection", "Candlestick", "neutral", "A strong candle consumes the prior body at a meaningful level.", ["Occurs at useful structure", "Candle closes with intent", "Not entering after an already exhausted move", "Risk is defined beyond invalidation"]],
  ["Pin-Bar Rejection", "Candlestick", "neutral", "Long wick shows an attempted move was rejected.", ["Wick rejects meaningful liquidity/structure", "Close returns into accepted area", "Follow-through supports rejection", "Do not treat every long wick as a signal"]],
];

function PatternScannerPage({ setActive, events, heartbeat }) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");

  const livePatternEvent = (events || []).find((e) => {
    const d = e?.details || {};
    return Boolean(d.pattern || d.pattern_name || d.setup_pattern || d.chart_pattern || e.pattern);
  });
  const livePattern = livePatternEvent
    ? String(livePatternEvent?.details?.pattern || livePatternEvent?.details?.pattern_name || livePatternEvent?.details?.setup_pattern || livePatternEvent?.details?.chart_pattern || livePatternEvent?.pattern)
    : null;
  const liveDecision = livePatternEvent ? String(livePatternEvent?.details?.decision || livePatternEvent?.decision || livePatternEvent?.message || "") : "";
  const symbol = heartbeat?.symbol || "XAUUSD";
  const timeframe = heartbeat?.timeframe || "M10";
  const categories = ["All", ...new Set(PATTERN_LIBRARY.map((p) => p[1]))];
  const q = query.trim().toLowerCase();
  const rows = PATTERN_LIBRARY.filter((p) => (filter === "All" || p[1] === filter) && (!q || `${p[0]} ${p[1]} ${p[3]} ${p[4].join(" ")}`.toLowerCase().includes(q)));

  if (selected) {
    const p = PATTERN_LIBRARY.find((x) => x[0] === selected);
    if (!p) return null;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="no-select inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/55 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Pattern Scanner
        </button>
        <div className="rounded-[26px] bg-[radial-gradient(circle_at_top_right,rgba(243,201,105,0.16),transparent_42%),#0C0D12] p-5">
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-gold-300/60">{p[1]} pattern</div>
          <h1 className="mt-2 text-[1.5rem] font-black">{p[0]}</h1>
          <p className="mt-2 text-[12.5px] leading-5 text-white/50">{p[3]}</p>
        </div>
        <AK.Panel className="p-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">Professional checklist</div>
          <div className="mt-3 space-y-3">
            {p[4].map((item, i) => (
              <div key={item} className="flex gap-3">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gold-300/10 font-mono text-[10px] font-bold text-gold-300">{i + 1}</span>
                <p className="pt-0.5 text-[12px] leading-5 text-white/55">{item}</p>
              </div>
            ))}
          </div>
        </AK.Panel>
        <AK.Panel className="p-4">
          <div className="text-[13px] font-semibold">Invalidation matters more than the name</div>
          <p className="mt-1.5 text-[11.5px] leading-5 text-white/45">
            A pattern is not a guaranteed forecast. Define what would prove the setup wrong, size the position from that invalidation, and demand enough room for the trade to make sense after spread and slippage.
          </p>
        </AK.Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="pattern-scanner-page">
      <button onClick={() => setActive("more")} className="no-select inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/55 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> More
      </button>

      <div className="rounded-[28px] bg-[radial-gradient(circle_at_85%_10%,rgba(243,201,105,0.18),transparent_38%),linear-gradient(145deg,#111218,#090A0E)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-gold-300/65">Pattern Scanner</div>
            <h1 className="mt-2 text-[1.6rem] font-black tracking-tight">{symbol} · {timeframe}</h1>
            <p className="mt-1 text-[12px] leading-5 text-white/45">Live XauCloud context when the EA reports a pattern, plus a complete chart-pattern playbook.</p>
          </div>
          <span className={`mt-1 h-2.5 w-2.5 rounded-full ${livePattern ? "bg-emerald-400 animate-pulse" : "bg-white/20"}`} />
        </div>
        <div className="mt-4 rounded-2xl bg-black/20 p-4">
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-white/25">EA-confirmed live pattern</div>
          {livePattern ? (
            <>
              <div className="mt-1.5 text-[15px] font-black text-emerald-300">{livePattern}</div>
              <div className="mt-1 text-[10.5px] text-white/40">{liveDecision || "Pattern context reported by the connected EA"} · {relativeTime(livePatternEvent?.ts)}</div>
            </>
          ) : (
            <>
              <div className="mt-1.5 text-[14px] font-semibold">No confirmed pattern right now</div>
              <div className="mt-1 text-[10.5px] leading-4 text-white/35">We do not invent detections in the browser. A live label appears only when the connected EA/backend reports one.</div>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-[#0C0D12] px-3">
        <Search className="h-4 w-4 flex-none text-white/25" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patterns…"
          className="min-w-0 flex-1 bg-transparent py-3 text-[12px] text-white outline-none placeholder:text-white/25" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {categories.map((c) => (
          <button key={c} onClick={() => setFilter(c)}
            className={`flex-none rounded-full px-3 py-1.5 text-[10px] font-semibold ${filter === c ? "bg-gold-300 text-black" : "bg-white/[0.05] text-white/45"}`}>
            {c}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl bg-[#0C0D12]">
        {rows.map((p, i) => (
          <button key={p[0]} onClick={() => setSelected(p[0])}
            className={`no-select flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/[0.035] ${i ? "border-t border-white/[0.055]" : ""}`}>
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gold-300/10 text-gold-300"><LineChart className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{p[0]}</div>
              <div className="mt-0.5 truncate text-[10px] text-white/35">{p[1]} · {p[3]}</div>
            </div>
            <ChevronRight className="h-4 w-4 flex-none text-white/20" />
          </button>
        ))}
      </div>

      <p className="text-center text-[9.5px] leading-4 text-white/25">
        Educational scanner. Live detections are shown only when reported by XauCloud; pattern examples are not trade signals or guarantees.
      </p>
    </div>
  );
}

// ─── Entitlement gate ──────────────────────────────────────────────────────
// ONE Command Center (2026-08-25): every signed-in user renders the exact
// same LicensedCloudDashboard shell -- same nav, same pages, same
// components. GET /cloud/entitlement is fetched once here and passed down
// as a prop; LicensedCloudDashboard uses it ONLY to decide, per nav tab,
// whether to show the real bot-personal page or a BotRequiredPage lock
// (Trading/Analytics/AI Brain/Control) and to swap Home's bot widgets for
// the subscriber-safe Market Outlook/10-Minute Engine/Recent Signals cards
// plus a single "Get XauCloud Bot" teaser. It never renders a second,
// smaller dashboard component for non-bot-owning users.
//
// Fail-safe: if this entitlement fetch itself errors (network blip, etc.,
// as opposed to a 401 which means "not logged in"), ownsBot defaults to
// true inside LicensedCloudDashboard (entFailed) -- a transient fetch
// failure can never lock a feature for an existing paying customer.
export default function CloudDashboard() {
  const navigate = useNavigate();
  const [entitlement, setEntitlement] = useState(null);
  const [entLoading, setEntLoading] = useState(true);
  const [entFailed, setEntFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    commandAxios.get("/cloud/entitlement")
      .then((r) => { if (!cancelled) setEntitlement(r.data); })
      .catch((err) => {
        if (cancelled) return;
        if (err.response?.status === 401) { navigate("/command/login"); return; }
        setEntFailed(true);
      })
      .finally(() => { if (!cancelled) setEntLoading(false); });
    return () => { cancelled = true; };
  }, [navigate]);

  if (entLoading) return (
    <div className="flex min-h-screen items-center justify-center bg-[#050507] text-white">
      <div className="text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-gold-300" />
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">Loading</div>
      </div>
    </div>
  );

  return <LicensedCloudDashboard entitlement={entitlement} entFailed={entFailed} />;
}
