import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Activity, AreaChart, BarChart3, Bot, Brain, CheckCircle2, CircleDollarSign,
  Clock3, Copy, Flame, Gauge, History, Home, KeyRound, LineChart, Loader2,
  Lock, LogOut, Menu, Pause, Play, RefreshCw, Settings, Shield,
  SlidersHorizontal, Square, TerminalSquare, TrendingUp, TrendingDown, Wifi, XCircle, AlertTriangle, Search, Zap,
} from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";
import AIThoughtFeed from "./AIThoughtFeed";
import AIMarketOutlookCard from "./AIMarketOutlookCard";
import { API } from "@/lib/api";

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
  ["control",      "Control",   SlidersHorizontal, "Remote commands & Prop Firm Mode"      ],
  ["license",      "License",   KeyRound,          "License binding and key management"    ],
  ["settings",     "Settings",  Settings,          "Account and app settings"              ],
];
const FILTERS = [
  ["all","All"],["entries","Entries"],["blocks","Blocks"],["exits","Exits"],
  ["risk","Risk"],["ai","AI"],["errors","Errors"],["overrides","Overrides"],
];
const COMMANDS = [
  { action:"PAUSE_NEW_TRADES",   label:"Pause",          detail:"Pause fresh entries. Open trades keep being managed.", icon:Pause,    tone:"amber", dangerous:false },
  { action:"RESUME_TRADING",     label:"Resume",         detail:"Allow new entries again after EA acknowledgement.",    icon:Play,     tone:"green", dangerous:false },
  { action:"STOP_TRADING",       label:"Stop",           detail:"Stop fresh entries. Trade management stays active.",   icon:Square,   tone:"red",   dangerous:true  },
  { action:"CLOSE_ALL_TRADES",   label:"Close all",      detail:"Ask the EA to close all EA-managed positions.",        icon:XCircle,  tone:"red",   dangerous:true  },
  { action:"FORCE_SYNC",         label:"Force sync",     detail:"Rebuild startup intelligence and position state.",     icon:RefreshCw,tone:"amber", dangerous:false },
  { action:"FORCE_REPORT_UPLOAD",label:"Upload reports", detail:"Mark local intelligence reports for upload.",          icon:AreaChart, tone:"amber", dangerous:false },
  { action:"MANUAL_OPEN_NOW", label:"Manual Buy Now",  detail:"Open a BUY immediately at current market price. This bypasses candidate age, Entry Readiness, timing wait, grade/score and AI opinion — it does NOT bypass spread/margin/stops/market-open broker safety checks. Builds a fresh execution snapshot at the moment the EA receives this command; no prior blocked signal is required or reused.", icon:TrendingUp, tone:"green", dangerous:true, payload:{direction:"BUY"} },
  { action:"MANUAL_OPEN_NOW", label:"Manual Sell Now",  detail:"Open a SELL immediately at current market price. This bypasses candidate age, Entry Readiness, timing wait, grade/score and AI opinion — it does NOT bypass spread/margin/stops/market-open broker safety checks. Builds a fresh execution snapshot at the moment the EA receives this command; no prior blocked signal is required or reused.", icon:TrendingDown, tone:"red", dangerous:true, payload:{direction:"SELL"} },
];
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
const CARD = "rounded-2xl border border-white/[0.07] bg-[#0d0e13]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

function pill(tone) {
  const m = { green:"bg-emerald-400/12 text-emerald-300 border-emerald-400/20", red:"bg-red-500/12 text-red-300 border-red-400/20", amber:"bg-amber-300/12 text-amber-200 border-amber-300/20", blue:"bg-sky-300/12 text-sky-200 border-sky-300/20", neutral:"bg-white/[0.06] text-white/50 border-white/[0.08]", violet:"bg-violet-300/12 text-violet-200 border-violet-300/20" };
  return `border rounded-full px-2.5 py-0.5 text-[10px] font-bold ${m[tone]||m.neutral}`;
}
function cardTone(tone) {
  const m = { green:"border-emerald-400/18 bg-emerald-300/[0.06]", red:"border-red-400/18 bg-red-500/[0.06]", amber:"border-amber-300/18 bg-amber-300/[0.06]", blue:"border-sky-300/18 bg-sky-300/[0.06]", violet:"border-violet-300/18 bg-violet-300/[0.06]" };
  return `border rounded-2xl ${m[tone]||"border-white/[0.07] bg-[#0d0e13]"}`;
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
      <Icon className="mx-auto mb-3 h-6 w-6 text-amber-300/60" />
      <div className="text-[14px] font-semibold">{title}</div>
      <p className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-white/38">{body}</p>
    </div>
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
  const dotColor = { red:"bg-red-400", amber:"bg-amber-300", green:"bg-emerald-400", blue:"bg-sky-300", violet:"bg-violet-300", neutral:"bg-white/30" }[tone]||"bg-white/30";
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
        {getEventField(event, "blocked_by", "") && <div className="mt-1 text-[12px] text-amber-200/80">Blocked by: {getEventField(event, "blocked_by", "")}</div>}
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
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[11px] font-bold text-amber-200 transition hover:bg-amber-300/20">
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
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-amber-300/70" />
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

function NumField({ label, value, onChange, suffix="%", min=0, max, step="0.01", note }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-medium text-white/55 mb-1.5">{label}</span>
      <div className="flex items-center rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 focus-within:border-amber-300/40 transition">
        <input type="number" inputMode="decimal" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(Number(e.target.value))}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-[13px] font-semibold text-white outline-none" />
        <span className="ml-2 text-[11px] text-white/30">{suffix}</span>
      </div>
      {note && <span className="mt-1 block text-[11px] text-white/30 leading-4">{note}</span>}
    </label>
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
            className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-amber-300/40" />
        </div>
        {message && <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-3 text-[12px] text-amber-200">{message}</div>}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button onClick={onCancel} className="rounded-xl border border-white/[0.08] bg-white/[0.04] py-3 text-[13px] font-semibold text-white/60 hover:text-white transition">Cancel</button>
          <button onClick={()=>onSubmit(key)} disabled={busy}
            className={`rounded-xl py-3 text-[13px] font-bold disabled:opacity-50 ${command.tone==="red"?"bg-red-400 text-black":"bg-amber-300 text-black"}`}>
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

function AppShell({ active, setActive, children, logout, statusText, online, eaVersion }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_NAV.some(([id])=>id===active);
  const go = (id)=>{ setActive(id); setMoreOpen(false); };

  return (
    <div className="min-h-screen bg-[#050507] pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-white" data-testid="bot-monitor-dashboard">
      <InstallAppPrompt />

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(212,175,55,0.09),transparent_40%),radial-gradient(ellipse_at_10%_0%,rgba(16,185,129,0.06),transparent_35%)]" />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#050507]/90 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/command" className="flex min-w-0 items-center gap-2.5">
            <XauAiLogo size={30} className="flex-none" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold leading-none">XAU AI Sniper</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-amber-300/55">Command · {eaVersion || "Waiting"}</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <div className={`hidden rounded-full border px-3 py-1.5 text-[11px] font-semibold sm:flex items-center gap-1.5 ${online?"border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300":"border-red-400/20 bg-red-400/[0.06] text-red-300"}`}>
              {online && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              {statusText}
            </div>
            <button onClick={logout} className="rounded-full border border-white/[0.07] bg-white/[0.03] p-2 text-white/45 hover:text-white transition">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="relative z-10 mx-auto max-w-5xl overflow-x-hidden px-4 py-5 pb-8">
        {children}
      </main>

      {/* More drawer */}
      {moreOpen && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/60 backdrop-blur-sm" onClick={()=>setMoreOpen(false)}>
          <div className="w-full rounded-t-[32px] border-t border-white/[0.08] bg-[#080809] p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/15" />
            <div className={`mb-4 ${MONO_LABEL}`}>More tools</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MORE_NAV.map(([id,label,Icon,detail])=>(
                <button key={id} onClick={()=>go(id)}
                  className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition ${active===id?"border-amber-300/25 bg-amber-300/[0.08]":"border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]"}`}>
                  <span className={`rounded-xl border p-2.5 ${active===id?"border-amber-300/20 bg-amber-300/10":"border-white/[0.07] bg-white/[0.03]"}`}>
                    <Icon className={`h-4 w-4 ${active===id?"text-amber-300":"text-white/50"}`} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[14px] font-semibold ${active===id?"text-amber-200":""}`}>{label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-white/38">{detail||"Open page"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-[60] border-t border-white/[0.07] bg-[#050507]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-sm items-center justify-around px-3 py-2">
          {NAV.map(([id,label,Icon])=>{
            const a = active===id;
            return (
              <button key={id} onClick={()=>setActive(id)}
                className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-5 py-2 transition-all ${a?"bg-amber-300 text-black":"text-white/38 hover:text-white/70"}`}>
                <Icon className="h-[18px] w-[18px]" />
                <span className="text-[10px] font-semibold tracking-tight">{label}</span>
              </button>
            );
          })}
          <button onClick={()=>setMoreOpen(true)}
            className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-5 py-2 transition-all ${moreActive?"bg-amber-300 text-black":"text-white/38 hover:text-white/70"}`}>
            <Menu className="h-[18px] w-[18px]" />
            <span className="text-[10px] font-semibold tracking-tight">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

// ─── Main controller ──────────────────────────────────────────────────────────
export default function CloudDashboard() {
  useAuthGuard();
  const navigate = useNavigate();
  const [active, setActive] = useState("home");
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
  const statusText  = online ? heartbeat.bot_state||"ONLINE" : "NO HEARTBEAT";
  const eaVersion   = heartbeat.ea_version || licenseInfo.ea_version || status?.license?.ea_version || "Waiting";
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
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-amber-300" />
        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">Loading</div>
      </div>
    </div>
  );

  return (
    <AppShell active={active} setActive={setActive} logout={logout} statusText={statusText} online={online} eaVersion={eaVersion}>
      {active==="home"         && <HomePage status={status} heartbeat={heartbeat} licenseInfo={licenseInfo} online={online} tradingOk={tradingOk} equityPoints={equityPoints} hasSufficientAnalytics={hasSufficientAnalytics} events={events} setActive={setActive} refresh={fetchAll} />}
      {active==="trading"      && <TradingPage heartbeat={heartbeat} events={events} online={online} linked={Boolean(license?.linked||status?.license?.linked)} openCommand={setModalCommand} />}
      {active==="analytics"    && <AnalyticsPage heartbeat={heartbeat} events={events} equityPoints={equityPoints} analytics={analytics} />}
      {active==="intelligence" && <IntelligencePage heartbeat={heartbeat} events={events} status={status} />}
      {active==="activity"     && <ActivityPage events={events} filter={filter} setFilter={setFilter} onForceOpen={setModalCommand} />}
      {active==="control"      && <ControlPage commands={commands} openCommand={setModalCommand} commandMsg={commandMsg} licenseKey={licenseInfo.activation_key} linked={Boolean(license?.linked||status?.license?.linked)} setActive={setActive} propFirm={propFirm} propFirmForm={propFirmForm} setPropFirmForm={setPropFirmForm} markDirty={()=>{propFirmDirty.current=true; propFirmIdempotencyKey.current=null;}} propFirmConfirmed={propFirmConfirmed} setPropFirmConfirmed={setPropFirmConfirmed} propFirmBusy={propFirmBusy} applyPropFirm={applyPropFirm} />}
      {active==="license"      && <LicensePage license={license} licenseInput={licenseInput} setLicenseInput={setLicenseInput} linkLicense={linkLicense} commandMsg={commandMsg} heartbeat={heartbeat} me={me} />}
      {active==="settings"     && <SettingsPage me={me} heartbeat={heartbeat} licenseInfo={licenseInfo} logout={logout} status={status} />}
      <CommandModal command={modalCommand} onCancel={()=>setModalCommand(null)} onSubmit={queueCommand} busy={commandBusy} message={commandMsg} licenseKey={licenseInfo.activation_key} />
    </AppShell>
  );
}

// ─── Home helpers ─────────────────────────────────────────────────────────────
function getSession() {
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
function M10SignalCard({ events, heartbeat }) {
  // v6.25.1 owner directive 2026-07-17 -- explicit newest-by-timestamp
  // selection (not "first match in whatever order events arrived"), and
  // verify the event actually belongs to the currently-connected
  // account+symbol before trusting it -- a stale event from a previous
  // session/build must never be silently displayed as current.
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
  if (!accountMatches || !symbolMatches) return null; // do not show evidence from a different account/symbol as if it were current

  const decision = latest.decision || "DATA_UNAVAILABLE";
  const preferredDir = latest.preferred_direction || "NONE";
  const freshnessState = latest.freshness_state || "UNKNOWN";
  const isStaleOrUnknown = freshnessState === "STALE" || freshnessState === "UNKNOWN";
  const decisionTone = isStaleOrUnknown ? "neutral"
    : decision === "BUY_CANDIDATE" ? "green"
    : decision === "SELL_CANDIDATE" ? "red"
    : decision.startsWith("WAIT_FOR") ? "amber"
    : decision === "TRANSITION_WATCH" ? "blue"
    : "neutral";
  const freshnessTone = freshnessState === "FRESH" ? "green" : freshnessState === "DEGRADED" ? "amber" : "red";

  // Scores are already 0-100 -- show the RAW percentage for each side, not
  // one normalized to the larger of the two (that used to make a 30-vs-20
  // score render as a full bar vs a 2/3 bar instead of the true 30%/20%).
  const buyScore = Number(latest.buy_case_score || 0);
  const sellScore = Number(latest.sell_case_score || 0);

  return (
    <div className={`${CARD} p-5`} data-testid="m10-signal-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={MONO_LABEL}>M10 Signal Engine · Evidence #{latest.evidence_id ?? "—"}</div>
        <div className="flex items-center gap-2">
          <span className={pill(freshnessTone)}>{freshnessState}{latest.age_seconds != null ? ` · ${latest.age_seconds}s old` : ""}</span>
          <span className={pill(decisionTone)}>{isStaleOrUnknown ? "DATA STALE" : decision.replace(/_/g, " ")}</span>
        </div>
      </div>

      {isStaleOrUnknown ? (
        <p className="mt-3 text-[11px] leading-4 text-white/45">
          This evidence is {freshnessState.toLowerCase()} ({latest.age_seconds != null ? `${latest.age_seconds}s old` : "age unknown"}) -- not shown as a live signal.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between text-[11px] text-white/50">
                <span>Buy case</span><span className="font-mono">{buyScore.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full bg-emerald-400/70" style={{ width: `${Math.max(0, Math.min(100, buyScore))}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] text-white/50">
                <span>Sell case</span><span className="font-mono">{sellScore.toFixed(0)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full bg-red-400/70" style={{ width: `${Math.max(0, Math.min(100, sellScore))}%` }} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-[11px]">
            <div><div className="text-white/35">Trend</div><div className="mt-0.5 font-mono text-white/80">{latest.trend_state || "—"}</div></div>
            <div><div className="text-white/35">Structure</div><div className="mt-0.5 font-mono text-white/80">{latest.structure_state || "—"}</div></div>
            <div><div className="text-white/35">Location</div><div className="mt-0.5 font-mono text-white/80">{latest.location_state || "—"}</div></div>
            <div><div className="text-white/35">Confidence</div><div className="mt-0.5 font-mono text-white/80">{Number(latest.confidence || 0).toFixed(0)}%</div></div>
          </div>

          <p className="mt-3 text-[11px] leading-4 text-white/45">
            Preferred direction: <span className="text-white/70 font-semibold">{preferredDir}</span>
            {latest.retracement_required ? " · location evidence noted inside the single entry timer" : ""}
            {" — "}{latest.reason || ""}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/35">
            <span className={pill("neutral")}>Exhaustion evidence-only: {(latest.exhaustion_decision || "—").replace(/_/g, " ")}</span>
            {latest.post_profit_buy_pending && <span className={pill("amber")}>Buy location evidence: extended</span>}
            {latest.post_profit_sell_pending && <span className={pill("amber")}>Sell location evidence: extended</span>}
          </div>
        </>
      )}

      <div className="mt-3 text-[10px] text-white/25 font-mono">
        M10 bar {latest.bar_time || "—"} · {latest.ea_version || ""} · {latest.build_hash || ""}
      </div>
    </div>
  );
}

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
        <span className={pill(decisionTone)}>{decision.replace(/_/g, " ")}</span>
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
                {(c.lifecycle_state || "UNKNOWN").replace(/_/g, " ")}
              </span>
              <span className="text-[10px] text-white/35 font-mono truncate">{c.candidate_id || "—"}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-[11px]">
              <div><div className="text-white/35">Timer</div><div className="mt-0.5 font-mono text-white/80">{Math.round(c.timer_elapsed_seconds ?? 0)}s / {Math.round(c.timer_duration_seconds ?? 0)}s</div></div>
              <div><div className="text-white/35">Remaining</div><div className="mt-0.5 font-mono text-white/80">{Math.round(c.timer_remaining_seconds ?? 0)}s</div></div>
              <div><div className="text-white/35">Origin price</div><div className="mt-0.5 font-mono text-white/80">{c.origin_price != null ? Number(c.origin_price).toFixed(2) : "—"}</div></div>
              <div><div className="text-white/35">Move since origin</div><div className="mt-0.5 font-mono text-white/80">{c.move_r_since_origin != null ? `${Number(c.move_r_since_origin).toFixed(2)}R` : "—"}</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/35">
              <span className={pill("neutral")}>Structural SL: {(c.structural_sl_status || "").replace(/_/g, " ").toLowerCase() || "unavailable"}</span>
              <span className={pill("neutral")}>Reservation: {(c.reservation_key_status || "").replace(/_/g, " ").toLowerCase() || "unavailable"}</span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-[11px] leading-4 text-white/45">
            No active candidate{c.lifecycle_state ? ` — ${c.lifecycle_state.replace(/_/g, " ").toLowerCase()}` : ""}.
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

function HomePage({ status, heartbeat, licenseInfo, online, tradingOk, equityPoints, hasSufficientAnalytics, events, setActive, refresh }) {
  const openTrades = online ? Number(status?.open_trades||heartbeat.open_positions||0) : 0;
  const ddNum      = Number(heartbeat.drawdown||0);
  const riskTone   = ddNum>5?"red":ddNum>2?"amber":"green";
  const pnlNum     = Number(heartbeat.daily_pnl||0);
  const pnlPos     = pnlNum >= 0;
  const aiEvent    = latestAiFieldsEvent(events);
  const conf       = Number(getEventField(aiEvent, "ai_confidence", 0)) || 0;
  const session    = getSession();
  const bias       = getMarketBias(aiEvent, heartbeat);
  const botState   = humanBotState(heartbeat.bot_state, openTrades, tradingOk, online);
  const stateTone  = openTrades>0?"amber":tradingOk?"green":"neutral";

  const offlineCopy = licenseInfo?.activation_key
    ? "License linked. Waiting for EA heartbeat from your MT5 terminal."
    : "Link your license key, attach the EA to MT5, and live data will appear here.";

  return (
    <div className="space-y-4">
      {/* Hero status */}
      <div className={`rounded-3xl border p-5 ${online?(openTrades>0?"border-amber-300/20 bg-amber-300/[0.05]":tradingOk?"border-emerald-400/18 bg-emerald-300/[0.05]":"border-white/[0.07] bg-white/[0.02]"):"border-white/[0.07] bg-white/[0.02]"}`} data-testid="bot-status-card">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={`mb-2 flex items-center gap-2 ${MONO_LABEL}`}>
              {online
                ? <><span className={`h-1.5 w-1.5 rounded-full animate-pulse ${openTrades>0?"bg-amber-300":"bg-emerald-400"}`} />{heartbeat.symbol||"XAUUSD"} · {heartbeat.timeframe||"UNKNOWN"} · {heartbeat.market_mode==="INDEX_MODE"?`Index Mode (${heartbeat.index_profile||"GENERIC_INDEX"})`:"Gold Mode"} · Live</>
                : <><Wifi className="h-3 w-3" />No connection</>}
            </div>
            <h1 className="text-[2rem] font-black tracking-tight leading-none">{botState}</h1>
            <p className="mt-2 text-[13px] leading-5 text-white/45 truncate">
              {online
                ? `${heartbeat.broker_server||"Broker"} · Account ${heartbeat.account_number||"—"}`
                : offlineCopy}
            </p>
          </div>
          <button onClick={refresh} className="rounded-full border border-white/[0.07] bg-white/[0.04] p-2.5 text-white/45 hover:text-white transition flex-none">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">
          <Sparkline points={equityPoints} tone={online?(openTrades>0?"#fbbf24":"#34d399"):"#d4af37"} height="h-[72px]" />
          {online && !hasSufficientAnalytics && (
            <p className="mt-1.5 text-[10px] text-white/30">Equity curve fills in once the EA reports enough real closed trades — see Analytics.</p>
          )}
        </div>
      </div>

      {/* v6.25.2 owner directive 2026-07-17 -- SetupHealth was fully built
          but never rendered anywhere visible; the only surviving surface for
          status.setup_checks was a bare "X/Y passing" count buried in the
          hidden Developer diagnostics panel, so a user could never see WHICH
          check (license/heartbeat/mt5_account/ea_version/algo) was actually
          failing. Only shown when something needs attention, so a fully
          healthy dashboard stays uncluttered. */}
      {!online && <SetupHealth checks={status?.setup_checks} />}

      {/* 4 core account metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Equity"      value={online?money(heartbeat.equity):"—"}       detail={online?`Balance ${money(heartbeat.balance)}`:"Not live"}     icon={CircleDollarSign} tone={online?"green":"neutral"} />
        <Metric label="Today's P&L" value={online?money(pnlNum):"—"}                 detail={pnlNum&&heartbeat.balance?`${((pnlNum/Number(heartbeat.balance))*100).toFixed(2)}% of balance`:"Today"} icon={TrendingUp} tone={pnlPos?"green":"red"} />
        <Metric label="Open trades" value={online?openTrades:"—"}                    detail={online?`${heartbeat.spread??"-"} pts spread`:"No data"}        icon={History}          tone={openTrades>0?"amber":"neutral"} />
        <Metric label="Open risk"   value={online?pct(heartbeat.drawdown):"—"}       detail="Current drawdown"                                              icon={Gauge}            tone={riskTone} />
      </div>

      {/* 4 market intelligence cards — trader-facing, no internal strings */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`${cardTone(bias.tone)} p-4 rounded-2xl min-w-0`}>
          <div className={MONO_LABEL}>Market bias</div>
          <div className="mt-2 font-mono text-xl font-black leading-none">{online?bias.label:"—"}</div>
          <div className="mt-1.5 text-[11px] text-white/40">HTF consensus</div>
        </div>
        <div className={`${cardTone(conf>=70?"green":conf>0?"amber":"neutral")} p-4 rounded-2xl min-w-0`}>
          <div className={MONO_LABEL}>AI confidence</div>
          <div className="mt-2 font-mono text-xl font-black leading-none">{online&&conf>0?`${conf}%`:"—"}</div>
          <div className="mt-1.5 text-[11px] text-white/40">{conf>=85?"Very high":conf>=70?"High":conf>=55?"Moderate":conf>0?"Building":"Waiting"}</div>
        </div>
        <div className={`${cardTone(session.tone)} p-4 rounded-2xl min-w-0`}>
          <div className={MONO_LABEL}>Session</div>
          <div className="mt-2 font-mono text-xl font-black leading-none">{session.label}</div>
          <div className="mt-1.5 text-[11px] text-white/40">UTC {new Date().getUTCHours().toString().padStart(2,"0")}:00</div>
        </div>
        <div className={`${cardTone(stateTone)} p-4 rounded-2xl min-w-0`}>
          <div className={MONO_LABEL}>Trading status</div>
          <div className="mt-2 font-mono text-xl font-black leading-none">{botState}</div>
          <div className="mt-1.5 text-[11px] text-white/40">{online?"EA connected":"No heartbeat"}</div>
        </div>
      </div>

      {/* No license CTA */}
      {!licenseInfo.activation_key && (
        <Empty title="Connect your license" body="Link your ASE license key once and live data from your MT5 account will stream here automatically." icon={KeyRound} />
      )}

      {online && <M10SignalCard events={events} heartbeat={heartbeat} />}
      {online && <M30ConsensusCard events={events} heartbeat={heartbeat} />}

      <AIMarketOutlookCard linked={Boolean(licenseInfo.activation_key)} />

      {/* Quick nav — 3 cards */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={()=>setActive("trading")} className={`${CARD} p-4 text-left hover:border-amber-300/20 transition`}>
          <LineChart className="mb-3 h-5 w-5 text-amber-300/60" />
          <div className="text-[13px] font-semibold">Trading</div>
          <p className="mt-1 text-[10px] leading-4 text-white/35">Open positions and trade timeline.</p>
        </button>
        <button onClick={()=>setActive("intelligence")} className={`${CARD} p-4 text-left hover:border-violet-400/20 transition`}>
          <Brain className="mb-3 h-5 w-5 text-violet-400/60" />
          <div className="text-[13px] font-semibold">AI Brain</div>
          <p className="mt-1 text-[10px] leading-4 text-white/35">AI decisions, ML state, blocks.</p>
        </button>
        <button onClick={()=>setActive("control")} className={`${CARD} p-4 text-left hover:border-white/15 transition`}>
          <SlidersHorizontal className="mb-3 h-5 w-5 text-white/40" />
          <div className="text-[13px] font-semibold">Controls</div>
          <p className="mt-1 text-[10px] leading-4 text-white/35">Remote commands and Prop Firm.</p>
        </button>
      </div>
    </div>
  );
}

function SetupHealth({ checks=[] }) {
  if (!checks.length) return null;
  const ok = checks.filter(c=>c.ok).length;
  return (
    <Card title="Setup health" subtitle={`${ok}/${checks.length} checks passing`}>
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map(c=>{
          const Icon = c.ok ? CheckCircle2 : XCircle;
          return (
            <div key={c.key||c.label} className={`flex items-start gap-3 rounded-xl border p-3 ${c.ok?"border-emerald-400/15 bg-emerald-300/[0.04]":"border-amber-300/15 bg-amber-300/[0.04]"}`}>
              <Icon className={`mt-0.5 h-4 w-4 flex-none ${c.ok?"text-emerald-400":"text-amber-400"}`} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{c.label}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-white/40">{c.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Trading ──────────────────────────────────────────────────────────────────
function TradingPage({ heartbeat, events, online, linked, openCommand }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Open trades" value={online?heartbeat.open_positions||0:0} detail="EA-reported" icon={History} tone="amber" />
        <Metric label="Symbol"      value={online?heartbeat.symbol||"XAUUSD":"—"} detail={heartbeat.timeframe||"UNKNOWN"} icon={TerminalSquare} tone="blue" />
        <Metric label="Spread"      value={online?`${heartbeat.spread??"-"}pts`:"—"} detail="Current quote" icon={Activity} tone="amber" />
        <Metric label="Bot state"   value={heartbeat.bot_state||"Waiting"} detail={heartbeat.last_action||"No action yet"} icon={Bot} tone={online?"green":"neutral"} />
      </div>
      {/* AI Trading Assistant — the conversational feed lives here now,
          not under Activity. Activity tab still has the raw log for anyone
          who wants it; this is the default, human-readable experience. */}
      <AIThoughtFeed linked={linked} onForceClose={openCommand} />
    </div>
  );
}

// ─── Analytics ────────────────────────────────────────────────────────────────
function AnalyticsPage({ heartbeat, events, equityPoints, analytics }) {
  const trades = weightedEventCount(events.filter(e=>eventCategory(e)==="entries"));
  const blocks = weightedEventCount(events.filter(e=>eventCategory(e)==="blocks"));
  const errors = weightedEventCount(events.filter(e=>eventCategory(e)==="errors"));
  const sufficient = Boolean(analytics?.sufficient_data);
  return (
    <div className="space-y-4">
      {/* v6.25.3 owner directive 2026-07-17 (Phase 7A P0) -- this curve and
          the metrics below it are now built from real closed-trade records
          the EA reports at close (GET /cloud/performance/analytics), not a
          made-up interpolation of the current balance/equity/daily_pnl. */}
      <Card title="Equity curve">
        <div className="mb-2 flex items-center justify-between">
          <span className={MONO_LABEL}>Realized P&L (verified trades)</span>
          <span className="font-mono text-[13px] font-bold text-amber-200">
            {sufficient ? money(analytics.realized_pnl) : "—"}
          </span>
        </div>
        <Sparkline points={equityPoints} tone="#d4af37" height="h-28" />
        {!sufficient && (
          <p className="mt-2 text-[11px] leading-4 text-white/40">
            Not enough verified data yet ({analytics?.verified_trade_count ?? 0} of {analytics?.minimum_required ?? 5} closed trades reported by the EA). This fills in automatically as your EA reports real trade closes.
          </p>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Win rate"      value={sufficient?pct(analytics.win_rate):"—"}         detail={sufficient?`${analytics.verified_trade_count} verified trades`:"Not enough data"} icon={TrendingUp}       tone={sufficient&&analytics.win_rate>=50?"green":"amber"} />
        <Metric label="Profit factor" value={sufficient?analytics.profit_factor.toFixed(2):"—"} detail="Gross profit / gross loss"                                                       icon={CircleDollarSign} tone={sufficient&&analytics.profit_factor>=1?"green":"red"} />
        <Metric label="Avg R"         value={sufficient&&analytics.avg_r!=null?`${analytics.avg_r.toFixed(2)}R`:"—"} detail="Average realized R-multiple"                                icon={Gauge}            tone="neutral" />
        <Metric label="Max drawdown"  value={sufficient?money(analytics.max_drawdown):"—"}    detail="Peak-to-trough, verified history"                                                icon={Shield}           tone={sufficient&&analytics.max_drawdown>0?"amber":"neutral"} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Live P&L"      value={money(heartbeat.daily_pnl)} detail="EA heartbeat (today, unverified)" icon={CircleDollarSign} tone={Number(heartbeat.daily_pnl||0)>=0?"green":"red"} />
        <Metric label="Floating DD"   value={pct(heartbeat.drawdown)}    detail="Current live floating"            icon={Gauge}            tone={Number(heartbeat.drawdown||0)>5?"red":"amber"} />
        <Metric label="Trade events"  value={trades}                     detail="Recent feed"         icon={TrendingUp}       tone="green" />
        <Metric label="Blocks/errors" value={`${blocks}/${errors}`}      detail="Protection vs faults" icon={Shield}          tone={errors?"red":"amber"} />
      </div>
      <Card title="Decision breakdown" subtitle="Counts include deduplicated repeats so repeated blocks are visible without flooding the feed.">
        <DecisionStats events={events} />
      </Card>
      <Card title="Module breakdown" subtitle="Which EA modules are making the recent decisions.">
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(events.reduce((acc,e)=>{
            const mod = getEventField(e,"module","Unspecified") || "Unspecified";
            acc[mod] = (acc[mod] || 0) + Number(e.repeat_count||1);
            return acc;
          }, {})).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([module,count])=>(
            <div key={module} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{module}</div>
                <p className="mt-1 text-[11px] text-white/35">Recent decisions</p>
              </div>
              <span className="font-mono text-lg font-black text-amber-200">{count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
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
      <div className="rounded-3xl border border-violet-400/20 bg-violet-300/[0.06] p-5">
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
      <div className="rounded-3xl border border-sky-400/18 bg-sky-300/[0.05] p-5">
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
        <Metric label="Regime"    value={heartbeat.bot_state||"Unknown"} detail={heartbeat.symbol||"XAUUSD"} icon={Activity} tone="blue" />
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
function ActivityPage({ events, filter, setFilter, onForceOpen }) {
  const [search, setSearch] = useState("");
  const visibleEvents = useMemo(()=>events.filter(e=>eventMatchesSearch(e, search)), [events, search]);
  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([id,label])=>(
            <button key={id} onClick={()=>setFilter(id)}
              data-testid={id==="entries"?"activity-filter-trade":undefined}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition ${filter===id?"bg-amber-300 text-black":"border border-white/[0.07] text-white/45 hover:text-white hover:border-white/15"}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3 py-2.5">
          <Search className="h-4 w-4 text-white/30" />
          <input
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="Search ticket, reason, module, symbol, time"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/25"
          />
        </label>
      </div>
      <DecisionStats events={visibleEvents} />
      <Card title="Bot Decision Feed" subtitle="Clean M10/M30 decision timeline: evidence, candidates, entries, cancellations, exits, risk, AI telemetry, errors, and overrides. Repeated noise is compressed.">
        {visibleEvents.length
          ? <div className="space-y-2">{visibleEvents.map((e,i)=><EventRow key={e.id||i} event={e} onForceOpen={onForceOpen} />)}</div>
          : <Empty title="No matching activity yet" body="Only meaningful decisions from your linked license and MT5 account will appear here. Old cloud records are hidden." icon={Activity} />}
      </Card>
      <DecisionHistory events={visibleEvents} />
    </div>
  );
}

// ─── Control ──────────────────────────────────────────────────────────────────
// v6.9.0 — Trading Universe (architecture phase). Index Mode toggle is
// intentionally disabled with an explanatory note: no real, tested index
// entry strategy exists yet, and the EA's own InpIndexModeLogOnly safety
// switch is what actually prevents index trades — this panel is settings
// storage + visibility, not a live trading control, until that changes.
function TradingUniverseCard({ linked, setActive }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const fetchSettings = useCallback(async () => {
    try { const r = await commandAxios.get("/cloud/trading-universe"); setSettings(r.data); }
    catch { /* left as null — card shows a load-failed state */ }
  }, []);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const save = async () => {
    if (!settings) return;
    setBusy(true); setMsg("");
    try {
      const r = await commandAxios.post("/cloud/trading-universe", settings);
      setSettings(r.data.settings);
      setMsg("Saved.");
    } catch (e) { setMsg(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const upd = (field, value) => setSettings(s => ({ ...s, [field]: value }));

  return (
    <Card title="TRADING UNIVERSE" subtitle="Gold Mode is live today. Index Mode is architecture-only — detection and diagnostics run, but no index trade will ever open until a real strategy ships.">
      {!linked && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3.5 text-[13px] text-amber-200">
          <AlertTriangle className="h-4 w-4 flex-none text-amber-400" />
          <span>Link your license first. <button onClick={() => setActive("license")} className="font-semibold underline">Open License</button></span>
        </div>
      )}
      {!settings ? (
        <div className="text-[13px] text-white/40">Loading…</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
              <div>
                <div className="text-[14px] font-semibold">Gold trading</div>
                <div className="mt-0.5 text-[12px] text-white/40">Gold Mode strategy is live today.</div>
              </div>
              <Toggle value={settings.enable_gold} onChange={v => upd("enable_gold", v)} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 opacity-60">
              <div>
                <div className="text-[14px] font-semibold">Index trading</div>
                <div className="mt-0.5 text-[12px] text-white/40">Detection-only — no strategy enabled yet.</div>
              </div>
              <Toggle value={settings.enable_index} onChange={v => upd("enable_index", v)} />
            </div>
          </div>

          {/* v6.25.2 owner directive 2026-07-17 -- audit found these controls
              were stored (POST /cloud/trading-universe) but never read back by
              anything, including /cloud/master/config (the only config the EA
              actually polls) -- they looked identical in weight to genuinely
              enforced controls elsewhere on this page (e.g. Prop Firm Mode)
              but did nothing. Disclosing honestly, matching the Index card's
              existing "Detection-only" convention, rather than implying real
              enforcement that doesn't exist yet. Do not remove this note when
              real EA-side enforcement ships -- replace it. */}
          <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-3 text-[11px] leading-4 text-amber-200/80">
            Not yet enforced by the live EA — these values are saved here but the bot does not read them back yet. Use the EA's own MT5 inputs to actually cap open trades until this ships.
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <NumField label="Max open trades — Gold" value={settings.max_open_trades_gold} onChange={v => upd("max_open_trades_gold", v)} suffix="trades" min={0} max={20} step="1" note="Not yet enforced — see note above" />
            <NumField label="Max open trades — Index" value={settings.max_open_trades_index} onChange={v => upd("max_open_trades_index", v)} suffix="trades" min={0} max={20} step="1" note="Not yet enforced — see note above" />
          </div>

          {msg && <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-3 text-[12px] text-amber-200">{msg}</div>}

          <button onClick={save} disabled={busy}
            className="mt-4 w-full rounded-2xl bg-amber-300 py-3 text-[13px] font-bold text-black disabled:opacity-35 disabled:cursor-not-allowed transition hover:bg-amber-200">
            {busy ? "Saving…" : "Save trading universe settings"}
          </button>
        </>
      )}
    </Card>
  );
}

function ControlPage({ commands, openCommand, commandMsg, licenseKey, linked, setActive, propFirm, propFirmForm, setPropFirmForm, markDirty, propFirmConfirmed, setPropFirmConfirmed, propFirmBusy, applyPropFirm }) {
  const applied = propFirm?.applied||{};
  const upd = (field, value)=>{ markDirty(); setPropFirmForm(p=>({...p,[field]:value})); };

  return (
    <div className="space-y-4">
      {/* Commands */}
      <Card title="Remote commands" subtitle="Every command needs license verification and EA acknowledgement before it executes.">
        {!linked && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3.5 text-[13px] text-amber-200">
            <AlertTriangle className="h-4 w-4 flex-none text-amber-400" />
            <span>Link your license first. <button onClick={()=>setActive("license")} className="font-semibold underline">Open License</button></span>
          </div>
        )}
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {COMMANDS.map(cmd=>{
            const Icon=cmd.icon;
            return (
              <button key={cmd.label} onClick={()=>openCommand(cmd)} disabled={!linked}
                className={`rounded-2xl border p-4 text-left transition disabled:opacity-35 disabled:cursor-not-allowed ${cardTone(cmd.tone)}`}>
                <Icon className="mb-3 h-5 w-5 opacity-70" />
                <div className="text-[14px] font-semibold">{cmd.label}</div>
                <p className="mt-1 text-[11px] leading-4 text-white/42">{cmd.detail}</p>
              </button>
            );
          })}
        </div>
        {commandMsg && <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-3 text-[12px] text-amber-200">{commandMsg}</div>}
      </Card>

      {/* Command history */}
      <Card title="Command history" subtitle="Queued, acknowledged, failed, or skipped commands.">
        {commands.length ? (
          <div className="space-y-2">
            {commands.map(cmd=>(
              <div key={cmd.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{cmd.label||cmd.action}</div>
                  <div className="mt-0.5 text-[11px] text-white/35">{relativeTime(cmd.requested_at)} · {cmd.ack_message||"Waiting for EA"}</div>
                </div>
                <span className={pill(cmd.status==="EXECUTED"?"green":cmd.status==="FAILED"?"red":"amber")}>{cmd.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No commands yet" body={`Commands appear here after you confirm with license key ${licenseKey||"ASE-..."}.`} icon={Lock} />
        )}
      </Card>

      {/* v6.9.0 — Trading Universe (architecture phase) */}
      <TradingUniverseCard linked={linked} setActive={setActive} />

      {/* Prop Firm Mode */}
      <Card title="PROP FIRM MODE" subtitle="Set the firm's exact limits. The EA stays unchanged until it receives and acknowledges this command.">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 mb-5">
          <div>
            <div className="text-[14px] font-semibold">{propFirmForm.enabled?"Protection on":"Protection off"}</div>
            <div className="mt-0.5 text-[12px] text-white/40">Caps exposure and locks before your firm's limits.</div>
          </div>
          <Toggle value={propFirmForm.enabled} onChange={v=>upd("enabled",v)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumField label="Starting balance" value={propFirmForm.starting_balance} onChange={v=>upd("starting_balance",v)} suffix="$" step="1" note="Prop account's original balance for total DD tracking." />
          <NumField label="Daily loss limit"    value={propFirmForm.daily_loss_pct}    onChange={v=>upd("daily_loss_pct",v)}    min={0.5} max={20} />
          <NumField label="Maximum total loss"  value={propFirmForm.max_loss_pct}      onChange={v=>upd("max_loss_pct",v)}      min={0.5} max={30} />
          <NumField label="Safety buffer"       value={propFirmForm.safety_buffer_pct} onChange={v=>upd("safety_buffer_pct",v)} min={0} max={10} note="EA locks this far before the firm's stated limit." />
          <NumField label="Risk per trade"      value={propFirmForm.risk_per_trade_pct} onChange={v=>upd("risk_per_trade_pct",v)} min={0.01} max={2} />
          <NumField label="Maximum basket risk" value={propFirmForm.max_basket_risk_pct} onChange={v=>upd("max_basket_risk_pct",v)} min={0.01} max={4} />
        </div>

        <label className="mt-4 flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 cursor-pointer">
          <input type="checkbox" checked={propFirmForm.allow_retest_add} onChange={e=>upd("allow_retest_add",e.target.checked)} className="mt-1 h-4 w-4 accent-amber-300" />
          <span>
            <span className="block text-[13px] font-semibold">Allow one confirmed retest add</span>
            <span className="mt-0.5 block text-[11px] text-white/38">One small retest, capped inside the basket risk limit.</span>
          </span>
        </label>

        {propFirmForm.allow_retest_add && (
          <div className="mt-3 max-w-xs">
            <NumField label="Retest add size" value={Number(propFirmForm.retest_add_lot_multi||0)*100} onChange={v=>upd("retest_add_lot_multi",v/100)} min={5} max={50} suffix="% of normal" step="1" />
          </div>
        )}

        <label className="mt-5 flex items-start gap-3 text-[12px] text-white/45 cursor-pointer">
          <input type="checkbox" checked={propFirmConfirmed} onChange={e=>setPropFirmConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-300" />
          I've verified these values against my prop firm's rules. Safety buffer stays above zero in case of calculation differences.
        </label>

        <button onClick={applyPropFirm} disabled={!linked||!propFirmConfirmed||propFirmBusy}
          className="mt-4 w-full rounded-2xl bg-amber-300 py-3 text-[13px] font-bold text-black disabled:opacity-35 disabled:cursor-not-allowed transition hover:bg-amber-200">
          {propFirmBusy?"Sending to EA…":"Apply to EA"}
        </button>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className={MONO_LABEL}>Command status</div>
            <div className="mt-2 text-[13px] font-semibold">{propFirm?.apply_status||"NOT CONFIGURED"}</div>
            <div className="mt-0.5 text-[11px] text-white/38">{propFirm?.apply_message||"No command sent yet."}</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className={MONO_LABEL}>Applied by EA</div>
            <div className={`mt-2 text-[13px] font-semibold ${applied.enabled?"text-emerald-300":"text-white/45"}`}>{applied.enabled?"ON":"OFF"}</div>
            <div className="mt-0.5 text-[11px] text-white/38">Risk {Number(applied.risk_per_trade_pct||0).toFixed(2)}% · Basket {Number(applied.max_basket_risk_pct||0).toFixed(2)}%</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── License ──────────────────────────────────────────────────────────────────
function LicensePage({ license, licenseInput, setLicenseInput, linkLicense, commandMsg, heartbeat, me }) {
  const info = license?.license;
  return (
    <div className="space-y-4">
      {/* Key card */}
      <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.06] p-5">
        <div className={`mb-2 ${MONO_LABEL} text-amber-300`}>Activation key</div>
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
            className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-amber-300/40 placeholder:text-white/25" />
          <button onClick={linkLicense} className="rounded-xl bg-amber-300 px-5 py-2.5 text-[13px] font-bold text-black hover:bg-amber-200 transition">Link license</button>
        </div>
        {commandMsg && <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.07] p-3 text-[12px] text-amber-200">{commandMsg}</div>}
      </Card>

      {/* Binding details */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`${CARD} p-4`}>
          <div className={MONO_LABEL}>License ID</div>
          <div className="mt-2 break-all font-mono text-[12px] font-bold leading-5 text-amber-100">{info?.license_id||"—"}</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-white/35">{me.email}</span>
            {info?.license_id && <CopyBtn value={info.license_id} label="Copy ID" />}
          </div>
        </div>
        <Metric label="MT5 binding"    value={info?.account_binding||heartbeat.account_number||"Not bound"} detail={heartbeat.broker_server||"Waiting for EA"} icon={TerminalSquare} tone={heartbeat.account_number?"green":"amber"} />
        <Metric label="VPS binding"    value={info?.vps_binding||"Not bound"} detail="Optional" icon={Wifi} tone="blue" />
        <Metric label="EA version"     value={heartbeat.ea_version||info?.ea_version||"Waiting"} detail={`Heartbeat ${relativeTime(heartbeat.last_heartbeat||heartbeat.ts)}`} icon={Bot} tone={heartbeat.ea_version?"green":"neutral"} />
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsPage({ me, heartbeat, licenseInfo, logout, status }) {
  const [diagOpen, setDiagOpen] = useState(false);
  return (
    <div className="space-y-4">
      <Card title="Account">
        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className={MONO_LABEL}>Command Center account</div>
            <div className="mt-2 text-[14px] font-semibold">{me.full_name||"Trader"}</div>
            <div className="mt-0.5 text-[12px] text-white/40">{me.email}</div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className={MONO_LABEL}>Connected EA</div>
            <div className="mt-2 text-[14px] font-semibold">{heartbeat.ea_version||"No EA heartbeat yet"}</div>
            <div className="mt-0.5 text-[12px] text-white/40">{heartbeat.broker_server||"Broker waiting"}</div>
          </div>
          <button onClick={logout} className="w-full rounded-xl border border-red-400/20 bg-red-500/[0.06] px-4 py-3 text-[13px] font-semibold text-red-300 hover:bg-red-500/[0.1] transition">
            Log out
          </button>
        </div>
      </Card>

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
              ["EA version",       heartbeat.ea_version||"—"],
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
