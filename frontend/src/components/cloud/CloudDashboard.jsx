import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Activity, AreaChart, BarChart3, Bot, Brain, CheckCircle2, CircleDollarSign,
  Clock3, Copy, Flame, Gauge, History, Home, KeyRound, LineChart, Loader2,
  Lock, LogOut, Menu, Pause, Play, RefreshCw, Settings, Shield,
  SlidersHorizontal, Square, TerminalSquare, TrendingUp, Wifi, XCircle, AlertTriangle, Search,
} from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";
import AIThoughtFeed from "./AIThoughtFeed";
import { API } from "@/lib/api";

// ─── Axios ───────────────────────────────────────────────────────────────────
const commandAxios = axios.create({ baseURL: API, withCredentials: true });
commandAxios.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cloud_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

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
    d.module, d.decision, d.reason, d.blocked_by, d.ticket, d.symbol,
    d.close_reason_exact, d.closed_by_module, d.position_direction,
  ].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
};
const latestDecisionEvent = (events=[]) => events.find(e => /entries|blocks|exits|risk|ai|errors|overrides/.test(eventCategory(e))) || events[0];
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

function EventRow({ event }) {
  const tone = severityTone(event.severity);
  const d = eventDetails(event);
  const dotColor = { red:"bg-red-400", amber:"bg-amber-300", green:"bg-emerald-400", blue:"bg-sky-300", violet:"bg-violet-300", neutral:"bg-white/30" }[tone]||"bg-white/30";
  const module = getEventField(event, "module", "");
  const decision = getEventDecision(event);
  const reason = getEventReason(event);
  const ticket = getEventTicket(event);
  const allowed = getEventField(event, "allowed", getEventField(event, "trade_allowed", undefined));
  const repeat = eventRepeatText(event);
  const facts = [
    ["Symbol", event.symbol || d.symbol],
    ["Mode", getEventField(event, "mode", "")],
    ["Bias", getEventField(event, "market_bias", "")],
    ["Signal", getEventField(event, "signal_direction", "")],
    ["AI", getEventField(event, "ai_confidence", "")],
    ["Score", getEventField(event, "score", "")],
    ["Allowed", allowed === undefined ? "" : allowed ? "YES" : "NO"],
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
      </div>
    </div>
  );
}

function DecisionSummaryCard({ events=[], heartbeat={}, setActive, title="Latest bot decision" }) {
  const event = latestDecisionEvent(events);
  const d = eventDetails(event);
  const allowed = event ? getEventField(event, "allowed", getEventField(event, "trade_allowed", undefined)) : undefined;
  const tone = event ? severityTone(event.severity) : "neutral";
  return (
    <Card
      title={title}
      subtitle="Clean M5 decision feed from the EA, deduplicated before it reaches this screen."
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
            <Metric label="Allowed" value={allowed===undefined?"—":allowed?"YES":"NO"} detail={getEventField(event,"blocked_by","")||"Decision result"} icon={Shield} tone={allowed===false?"amber":allowed===true?"green":"neutral"} />
            <Metric label="Bias" value={getEventField(event,"market_bias","—")||"—"} detail={event.symbol||heartbeat.symbol||"XAUUSD"} icon={Activity} tone="blue" />
            <Metric label="AI" value={getEventField(event,"ai_confidence","—")||"—"} detail="Confidence" icon={Brain} tone="violet" />
            <Metric label="Score" value={getEventField(event,"score","—")||"—"} detail={getEventField(event,"signal_direction","")||"Signal"} icon={Gauge} tone="amber" />
          </div>
          {eventRepeatText(event) && <div className="rounded-xl border border-violet-300/15 bg-violet-300/[0.05] p-3 text-[12px] text-violet-100">{eventRepeatText(event)}</div>}
        </div>
      ) : (
        <Empty title="Waiting for decision feed" body="The EA will publish one clean M5 decision event once the next scan cycle runs." icon={Activity} />
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
  const navigate = useNavigate();
  useEffect(()=>{ if(!localStorage.getItem("cloud_token")) navigate("/command/login"); },[navigate]);
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

  const fetchAll = useCallback(async () => {
    try {
      const [meR, stR, actR, cmdR, licR, pfR] = await Promise.all([
        commandAxios.get("/cloud/auth/me"),
        commandAxios.get("/cloud/monitor/status"),
        commandAxios.get("/cloud/monitor/activity", { params:{ kind:filter, limit:100 } }),
        commandAxios.get("/cloud/command/recent",   { params:{ limit:20 } }),
        commandAxios.get("/cloud/license/status"),
        commandAxios.get("/cloud/prop-firm/config"),
      ]);
      setMe(meR.data); setStatus(stR.data);
      setEvents(actR.data.events||[]); setCommands(cmdR.data.commands||[]);
      setLicense(licR.data); setPropFirm(pfR.data);
      if (!propFirmDirty.current && pfR.data?.requested)
        setPropFirmForm({ ...DEFAULT_PROP, ...pfR.data.requested });
      if (licR.data?.license?.activation_key) setLicenseInput(licR.data.license.activation_key);
    } catch (err) {
      if (err.response?.status===401) { localStorage.removeItem("cloud_token"); navigate("/command/login"); }
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
      const r = await commandAxios.post("/cloud/command/request",{ action:modalCommand.action, pin:licenseKey, confirm:true });
      setCommandMsg(`Queued ${modalCommand.label}: ${r.data.command_id}`);
      setModalCommand(null); fetchAll();
    } catch (e) { setCommandMsg(e.response?.data?.detail||"Command failed"); }
    finally { setCommandBusy(false); }
  };

  const applyPropFirm = async () => {
    if (!propFirmConfirmed) { setCommandMsg("Confirm you've checked these values against your prop firm's rules."); return; }
    setPropFirmBusy(true); setCommandMsg("");
    try {
      const r = await commandAxios.post("/cloud/command/request",{ action:"UPDATE_PROP_FIRM_CONFIG", pin:licenseInfo.activation_key, confirm:true, payload:propFirmForm });
      setCommandMsg(`Prop Firm Mode queued: ${r.data.command_id}`);
      setPropFirmConfirmed(false); propFirmDirty.current=false; fetchAll();
    } catch (e) { setCommandMsg(e.response?.data?.detail||"Update failed"); }
    finally { setPropFirmBusy(false); }
  };

  const logout = async () => {
    try { await commandAxios.post("/cloud/auth/logout"); } catch {}
    localStorage.removeItem("cloud_token"); navigate("/command");
  };

  const heartbeat   = status?.heartbeat || {};
  const licenseInfo = license?.license || status?.license || {};
  const online      = Boolean(status && !status.offline && heartbeat.account_number);
  const tradingOk   = Boolean(heartbeat.algo_trading && heartbeat.trading_allowed && heartbeat.mt5_connected);
  const statusText  = online ? heartbeat.bot_state||"ONLINE" : "NO HEARTBEAT";
  const eaVersion   = heartbeat.ea_version || licenseInfo.ea_version || status?.license?.ea_version || "v6.17.0";
  const equityPoints = useMemo(()=>{
    const base = Number(heartbeat.balance||heartbeat.equity||0);
    if (!base) return [];
    const d = Number(heartbeat.daily_pnl||0);
    return [base-d*1.4, base-d, base-d*0.55, base-d*0.2, Number(heartbeat.equity||base)];
  },[heartbeat.balance,heartbeat.daily_pnl,heartbeat.equity]);

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
      {active==="home"         && <HomePage status={status} heartbeat={heartbeat} licenseInfo={licenseInfo} online={online} tradingOk={tradingOk} equityPoints={equityPoints} events={events} setActive={setActive} refresh={fetchAll} />}
      {active==="trading"      && <TradingPage heartbeat={heartbeat} events={events} online={online} linked={Boolean(license?.linked||status?.license?.linked)} />}
      {active==="analytics"    && <AnalyticsPage heartbeat={heartbeat} events={events} equityPoints={equityPoints} />}
      {active==="intelligence" && <IntelligencePage heartbeat={heartbeat} events={events} status={status} />}
      {active==="activity"     && <ActivityPage events={events} filter={filter} setFilter={setFilter} />}
      {active==="control"      && <ControlPage commands={commands} openCommand={setModalCommand} commandMsg={commandMsg} licenseKey={licenseInfo.activation_key} linked={Boolean(license?.linked||status?.license?.linked)} setActive={setActive} propFirm={propFirm} propFirmForm={propFirmForm} setPropFirmForm={setPropFirmForm} markDirty={()=>{propFirmDirty.current=true;}} propFirmConfirmed={propFirmConfirmed} setPropFirmConfirmed={setPropFirmConfirmed} propFirmBusy={propFirmBusy} applyPropFirm={applyPropFirm} />}
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

function getMarketBias(hb) {
  const s = (hb.htf_consensus||hb.market_bias||hb.bot_state||"").toUpperCase();
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
function HomePage({ status, heartbeat, licenseInfo, online, tradingOk, equityPoints, events, setActive, refresh }) {
  const openTrades = online ? Number(status?.open_trades||heartbeat.open_positions||0) : 0;
  const ddNum      = Number(heartbeat.drawdown||0);
  const riskTone   = ddNum>5?"red":ddNum>2?"amber":"green";
  const pnlNum     = Number(heartbeat.daily_pnl||0);
  const pnlPos     = pnlNum >= 0;
  const conf       = Number(heartbeat.ai_confidence||heartbeat.last_ai_confidence||0);
  const session    = getSession();
  const bias       = getMarketBias(heartbeat);
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
                ? <><span className={`h-1.5 w-1.5 rounded-full animate-pulse ${openTrades>0?"bg-amber-300":"bg-emerald-400"}`} />{heartbeat.symbol||"XAUUSD"} · {heartbeat.timeframe||"M5"} · {heartbeat.market_mode==="INDEX_MODE"?`Index Mode (${heartbeat.index_profile||"GENERIC_INDEX"})`:"Gold Mode"} · Live</>
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
        </div>
      </div>

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

      <AIThoughtFeed linked={Boolean(licenseInfo.activation_key)} compact onOpenFull={()=>setActive("trading")} />

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
function TradingPage({ heartbeat, events, online, linked }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Open trades" value={online?heartbeat.open_positions||0:0} detail="EA-reported" icon={History} tone="amber" />
        <Metric label="Symbol"      value={online?heartbeat.symbol||"XAUUSD":"—"} detail={heartbeat.timeframe||"M5"} icon={TerminalSquare} tone="blue" />
        <Metric label="Spread"      value={online?`${heartbeat.spread??"-"}pts`:"—"} detail="Current quote" icon={Activity} tone="amber" />
        <Metric label="Bot state"   value={heartbeat.bot_state||"Waiting"} detail={heartbeat.last_action||"No action yet"} icon={Bot} tone={online?"green":"neutral"} />
      </div>
      {/* AI Trading Assistant — the conversational feed lives here now,
          not under Activity. Activity tab still has the raw log for anyone
          who wants it; this is the default, human-readable experience. */}
      <AIThoughtFeed linked={linked} />
    </div>
  );
}

// ─── Analytics ────────────────────────────────────────────────────────────────
function AnalyticsPage({ heartbeat, events, equityPoints }) {
  const trades = weightedEventCount(events.filter(e=>eventCategory(e)==="entries"));
  const blocks = weightedEventCount(events.filter(e=>eventCategory(e)==="blocks"));
  const errors = weightedEventCount(events.filter(e=>eventCategory(e)==="errors"));
  return (
    <div className="space-y-4">
      <Card title="Equity curve">
        <div className="mb-2 flex items-center justify-between">
          <span className={MONO_LABEL}>Session estimate</span>
          <span className="font-mono text-[13px] font-bold text-amber-200">{money(heartbeat.equity)}</span>
        </div>
        <Sparkline points={equityPoints} tone="#d4af37" height="h-28" />
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Daily P&L"     value={money(heartbeat.daily_pnl)} detail="EA heartbeat"       icon={CircleDollarSign} tone={Number(heartbeat.daily_pnl||0)>=0?"green":"red"} />
        <Metric label="Drawdown"      value={pct(heartbeat.drawdown)}    detail="Current"             icon={Gauge}            tone={Number(heartbeat.drawdown||0)>5?"red":"amber"} />
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
  const conf      = heartbeat.ai_confidence||heartbeat.last_ai_confidence||0;
  const verdict   = heartbeat.ai_verdict||heartbeat.last_action||"";
  const mlSamples = heartbeat.ml_samples||heartbeat.pattern_count||0;
  const mlTrusted = heartbeat.ml_trusted||(mlSamples>=10);

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
            ["Patterns", mlSamples||"—", "text-white"],
            ["Authority", mlTrusted?"Active":"Learning", mlTrusted?"text-emerald-300":"text-amber-300"],
            ["Hive",     heartbeat.hive_verdict||"Neutral", "text-sky-200"],
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
function ActivityPage({ events, filter, setFilter }) {
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
      <Card title="Bot Decision Feed" subtitle="Clean M5 decision timeline: entries, blocks, exits, risk, AI, errors, and overrides. Repeated noise is compressed.">
        {visibleEvents.length
          ? <div className="space-y-2">{visibleEvents.map((e,i)=><EventRow key={e.id||i} event={e} />)}</div>
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
                <div className="mt-0.5 text-[12px] text-white/40">Live — full entry + exit strategy.</div>
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <NumField label="Max open trades — Gold" value={settings.max_open_trades_gold} onChange={v => upd("max_open_trades_gold", v)} suffix="trades" min={0} max={20} step="1" note="0 = use EA input default" />
            <NumField label="Max open trades — Index" value={settings.max_open_trades_index} onChange={v => upd("max_open_trades_index", v)} suffix="trades" min={0} max={20} step="1" note="0 = use EA input default" />
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
              <button key={cmd.action} onClick={()=>openCommand(cmd)} disabled={!linked}
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
