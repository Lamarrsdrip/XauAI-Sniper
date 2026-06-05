import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Activity,
  AlertTriangle,
  AreaChart,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  Flame,
  Gauge,
  History,
  Home,
  KeyRound,
  LineChart,
  Loader2,
  Lock,
  LogOut,
  Menu,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  TerminalSquare,
  TrendingUp,
  Wifi,
  XCircle,
} from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";
import { API } from "@/lib/api";

const commandAxios = axios.create({ baseURL: API, withCredentials: true });
commandAxios.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cloud_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

const NAV = [
  ["home", "Home", Home],
  ["trading", "Trading", LineChart],
  ["analytics", "Analytics", BarChart3],
  ["activity", "Activity", Activity],
];

const MORE_NAV = [
  ["intelligence", "Brain", Brain, "EA decisions, waits, blocks, and learning"],
  ["control", "Control", SlidersHorizontal],
  ["license", "License", KeyRound],
  ["settings", "Settings", Settings],
];

const FILTERS = [
  ["all", "All"],
  ["trades", "Trades"],
  ["blocks", "Blocks"],
  ["errors", "Errors"],
  ["sync", "Sync"],
  ["exit", "Exit"],
  ["shadow", "Shadow"],
  ["risk", "Risk"],
];

const COMMANDS = [
  {
    action: "PAUSE_NEW_TRADES",
    label: "Pause",
    detail: "Pause fresh entries. Existing trades keep being managed.",
    icon: Pause,
    tone: "amber",
    dangerous: false,
  },
  {
    action: "RESUME_TRADING",
    label: "Resume",
    detail: "Allow new entries again after EA acknowledgement.",
    icon: Play,
    tone: "green",
    dangerous: false,
  },
  {
    action: "STOP_TRADING",
    label: "Stop",
    detail: "Stop fresh entries while trade management remains active.",
    icon: Square,
    tone: "red",
    dangerous: true,
  },
  {
    action: "CLOSE_ALL_TRADES",
    label: "Close all",
    detail: "Ask the EA to close EA-managed positions.",
    icon: XCircle,
    tone: "red",
    dangerous: true,
  },
  {
    action: "FORCE_SYNC",
    label: "Force sync",
    detail: "Rebuild startup intelligence and position state.",
    icon: RefreshCw,
    tone: "amber",
    dangerous: false,
  },
  {
    action: "FORCE_REPORT_UPLOAD",
    label: "Upload reports",
    detail: "Mark local intelligence reports for upload/check-in.",
    icon: AreaChart,
    tone: "amber",
    dangerous: false,
  },
];

const DEFAULT_PROP_FIRM_CONFIG = {
  enabled: false,
  starting_balance: 0,
  daily_loss_pct: 4,
  max_loss_pct: 8,
  safety_buffer_pct: 0.5,
  risk_per_trade_pct: 0.15,
  max_basket_risk_pct: 0.75,
  allow_retest_add: true,
  retest_add_lot_multi: 0.25,
};

const money = (value) =>
  Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const pct = (value) => `${Number(value || 0).toFixed(2)}%`;

const relativeTime = (iso) => {
  if (!iso) return "never";
  const date = new Date(iso);
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (!Number.isFinite(seconds)) return "never";
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

const toneClass = (tone) => {
  if (tone === "green") return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100";
  if (tone === "red") return "border-red-400/25 bg-red-500/[0.08] text-red-100";
  if (tone === "blue") return "border-sky-300/20 bg-sky-300/[0.08] text-sky-100";
  return "border-amber-300/22 bg-amber-300/[0.08] text-amber-100";
};

const severityTone = (severity) => {
  const s = String(severity || "INFO").toUpperCase();
  if (["CRITICAL", "ERROR"].includes(s)) return "red";
  if (["WARNING", "BLOCK"].includes(s)) return "amber";
  if (["TRADE", "COMMAND"].includes(s)) return "green";
  if (["EXIT", "SYNC"].includes(s)) return "blue";
  return "neutral";
};

function useAuthGuard() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!localStorage.getItem("cloud_token")) navigate("/command/login");
  }, [navigate]);
}

function AppShell({ active, setActive, children, logout, statusText, online }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_NAV.some(([id]) => id === active);
  const openPage = (id) => {
    setActive(id);
    setMoreOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#040404] pb-[calc(6.5rem+env(safe-area-inset-bottom))] text-white" data-testid="bot-monitor-dashboard">
      <InstallAppPrompt />
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(212,175,55,0.12),transparent_32%),radial-gradient(circle_at_20%_0%,rgba(16,185,129,0.08),transparent_28%)]" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#040404]/88 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/command" className="flex min-w-0 items-center gap-3">
            <XauAiLogo size={34} className="flex-none" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-black">XAU AI Sniper</span>
              <span className="block truncate font-mono text-[9px] uppercase tracking-[0.24em] text-[#d4af37]/70">
                Command Center
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <div className={`hidden rounded-full border px-3 py-1.5 text-[11px] font-bold sm:block ${online ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : "border-red-400/25 bg-red-500/10 text-red-200"}`}>
              {statusText}
            </div>
            <button onClick={logout} className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/58">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl overflow-x-hidden px-4 py-5 pb-[calc(8rem+env(safe-area-inset-bottom))]">{children}</main>

      {moreOpen && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/55 backdrop-blur-sm" onClick={() => setMoreOpen(false)}>
          <div
            className="w-full rounded-t-[34px] border border-white/10 bg-[#0b0b0b] p-4 pb-[calc(6.25rem+env(safe-area-inset-bottom))] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/18" />
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#d4af37]/70">Command Center</div>
                <div className="text-xl font-black">More tools</div>
              </div>
              <button onClick={() => setMoreOpen(false)} className="rounded-full border border-white/10 bg-white/[0.06] p-2 text-white/65">
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MORE_NAV.map(([id, label, Icon, detail]) => (
                <button
                  key={id}
                  onClick={() => openPage(id)}
                  className={`flex items-center gap-3 rounded-[22px] border p-4 text-left transition ${
                    active === id ? "border-[#d4af37]/45 bg-[#d4af37]/15 text-[#f5d36d]" : "border-white/10 bg-white/[0.045] text-white/80"
                  }`}
                >
                  <span className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-black">{label}</span>
                    <span className="mt-1 block truncate text-xs text-white/42">{detail || "Open page"}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-[60] border-t border-white/10 bg-[#050505]/94 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1 px-2 py-2">
          {NAV.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold transition ${
                active === id ? "bg-[#d4af37] text-black" : "text-white/42"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{label}</span>
            </button>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-semibold transition ${
              moreActive ? "bg-[#d4af37] text-black" : "text-white/42"
            }`}
          >
            <Menu className="h-4 w-4" />
            <span className="truncate">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

function Metric({ label, value, detail, icon: Icon, tone = "amber" }) {
  return (
    <div className={`min-w-0 overflow-hidden rounded-[22px] border p-4 ${toneClass(tone)}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/42">{label}</div>
        {Icon && <Icon className="h-4 w-4 opacity-70" />}
      </div>
      <div className="break-words font-mono text-xl font-black tracking-tight sm:text-2xl">{value}</div>
      {detail && <div className="mt-1 break-words text-xs text-white/50">{detail}</div>}
    </div>
  );
}

function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center justify-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] font-black text-white/70"
    >
      <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : label}
    </button>
  );
}

function Section({ title, subtitle, children, action }) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/20">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-sm leading-6 text-white/48">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, body, icon: Icon = Bot }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/25 p-6 text-center">
      <Icon className="mx-auto mb-3 h-7 w-7 text-[#d4af37]" />
      <div className="font-bold">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/45">{body}</p>
    </div>
  );
}

function Sparkline({ points = [], tone = "#d4af37" }) {
  const values = points.length ? points : [0, 0, 0, 0, 0, 0, 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * 100;
      const y = 34 - ((v - min) / span) * 28;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 40" className="h-24 w-full overflow-visible">
      <path d={`${d} L100,40 L0,40 Z`} fill={tone} opacity="0.10" />
      <path d={d} fill="none" stroke={tone} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EventRow({ event }) {
  const tone = severityTone(event.severity);
  return (
    <div className={`rounded-[22px] border p-3 ${toneClass(tone)}`}>
      <div className="flex items-start gap-3">
        <div className="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-current" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/42">
              {event.severity || "INFO"} · {event.event_type || "EVENT"}
            </span>
            <span className="flex-none text-[11px] text-white/38">{relativeTime(event.ts)}</span>
          </div>
          <div className="mt-1 break-words text-sm leading-6 text-white/82">{event.message || "Event recorded"}</div>
        </div>
      </div>
    </div>
  );
}

function CommandModal({ command, onCancel, onSubmit, busy, message, licenseKey }) {
  const [key, setKey] = useState(licenseKey || "");
  if (!command) return null;
  const Icon = command.icon;
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center overflow-y-auto bg-black/70 p-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-8 backdrop-blur-sm sm:items-center sm:pb-3">
      <div className="max-h-[calc(100vh-8.5rem)] w-full max-w-md overflow-y-auto rounded-[30px] border border-white/10 bg-[#101010] p-5 shadow-2xl sm:max-h-[90vh]">
        <div className={`mb-4 inline-flex rounded-2xl border p-3 ${toneClass(command.tone)}`}>
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-2xl font-black">{command.label}</h3>
        <p className="mt-2 text-sm leading-6 text-white/55">{command.detail}</p>
        {command.dangerous && (
          <div className="mt-4 rounded-2xl border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-100">
            This is a high-impact command. The EA must validate and acknowledge it before the dashboard marks it executed.
          </div>
        )}
        <label className="mt-5 block text-xs font-bold uppercase tracking-[0.2em] text-white/42">License key</label>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="ASE-D4Q9-SUFW"
          className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 font-mono text-sm text-white outline-none focus:border-[#d4af37]"
        />
        {message && <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{message}</div>}
        <div className="sticky bottom-0 mt-5 grid grid-cols-2 gap-3 bg-[#101010] pt-3">
          <button onClick={onCancel} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/70">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(key)}
            disabled={busy}
            className={`rounded-2xl px-4 py-3 text-sm font-black ${command.tone === "red" ? "bg-red-400 text-black" : "bg-[#d4af37] text-black"} disabled:opacity-60`}
          >
            {busy ? "Queueing..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [propFirmForm, setPropFirmForm] = useState(DEFAULT_PROP_FIRM_CONFIG);
  const [propFirmConfirmed, setPropFirmConfirmed] = useState(false);
  const [propFirmBusy, setPropFirmBusy] = useState(false);
  const propFirmDirty = useRef(false);

  const fetchAll = useCallback(async () => {
    try {
      const [meRes, statusRes, activityRes, commandRes, licenseRes, propFirmRes] = await Promise.all([
        commandAxios.get("/cloud/auth/me"),
        commandAxios.get("/cloud/monitor/status"),
        commandAxios.get("/cloud/monitor/activity", { params: { kind: filter, limit: 100 } }),
        commandAxios.get("/cloud/command/recent", { params: { limit: 20 } }),
        commandAxios.get("/cloud/license/status"),
        commandAxios.get("/cloud/prop-firm/config"),
      ]);
      setMe(meRes.data);
      setStatus(statusRes.data);
      setEvents(activityRes.data.events || []);
      setCommands(commandRes.data.commands || []);
      setLicense(licenseRes.data);
      setPropFirm(propFirmRes.data);
      if (!propFirmDirty.current && propFirmRes.data?.requested) {
        setPropFirmForm({ ...DEFAULT_PROP_FIRM_CONFIG, ...propFirmRes.data.requested });
      }
      if (licenseRes.data?.license?.activation_key) setLicenseInput(licenseRes.data.license.activation_key);
    } catch (error) {
      if (error.response?.status === 401) {
        localStorage.removeItem("cloud_token");
        navigate("/command/login");
      }
    } finally {
      setLoading(false);
    }
  }, [filter, navigate]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 8000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const linkLicense = async () => {
    setCommandMsg("");
    try {
      await commandAxios.post("/cloud/license/link", { license_key: licenseInput });
      setCommandMsg("License linked. Waiting for EA heartbeat from this license/account.");
      fetchAll();
    } catch (error) {
      setCommandMsg(error.response?.data?.detail || "License link failed");
    }
  };

  const queueCommand = async (licenseKey) => {
    if (!modalCommand) return;
    setCommandBusy(true);
    setCommandMsg("");
    try {
      const response = await commandAxios.post("/cloud/command/request", {
        action: modalCommand.action,
        pin: licenseKey,
        confirm: true,
      });
      setCommandMsg(`Queued ${modalCommand.label}: ${response.data.command_id}`);
      setModalCommand(null);
      fetchAll();
    } catch (error) {
      setCommandMsg(error.response?.data?.detail || "Command queue failed");
    } finally {
      setCommandBusy(false);
    }
  };

  const applyPropFirmConfig = async () => {
    if (!propFirmConfirmed) {
      setCommandMsg("Confirm that these are the exact limits from your prop firm before applying.");
      return;
    }
    setPropFirmBusy(true);
    setCommandMsg("");
    try {
      const response = await commandAxios.post("/cloud/command/request", {
        action: "UPDATE_PROP_FIRM_CONFIG",
        pin: licenseInfo.activation_key,
        confirm: true,
        payload: propFirmForm,
      });
      setCommandMsg(`Prop Firm Mode queued for the EA: ${response.data.command_id}`);
      setPropFirmConfirmed(false);
      propFirmDirty.current = false;
      fetchAll();
    } catch (error) {
      setCommandMsg(error.response?.data?.detail || "Prop Firm Mode update failed");
    } finally {
      setPropFirmBusy(false);
    }
  };

  const logout = async () => {
    try {
      await commandAxios.post("/cloud/auth/logout");
    } catch {}
    localStorage.removeItem("cloud_token");
    navigate("/command");
  };

  const heartbeat = status?.heartbeat || {};
  const licenseInfo = license?.license || status?.license || {};
  const online = Boolean(status && !status.offline && heartbeat.account_number);
  const tradingOk = Boolean(heartbeat.algo_trading && heartbeat.trading_allowed && heartbeat.mt5_connected);
  const statusText = online ? heartbeat.bot_state || "ONLINE" : "NO HEARTBEAT";
  const equityPoints = useMemo(() => {
    const base = Number(heartbeat.balance || heartbeat.equity || 0);
    if (!base) return [];
    const daily = Number(heartbeat.daily_pnl || 0);
    return [base - daily * 1.4, base - daily, base - daily * 0.55, base - daily * 0.2, Number(heartbeat.equity || base)];
  }, [heartbeat.balance, heartbeat.daily_pnl, heartbeat.equity]);

  if (loading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#040404] text-white">
        <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
      </div>
    );
  }

  return (
    <AppShell active={active} setActive={setActive} logout={logout} statusText={statusText} online={online}>
      {active === "home" && (
        <HomePage
          status={status}
          heartbeat={heartbeat}
          licenseInfo={licenseInfo}
          online={online}
          tradingOk={tradingOk}
          equityPoints={equityPoints}
          setActive={setActive}
          refresh={fetchAll}
        />
      )}
      {active === "trading" && <TradingPage heartbeat={heartbeat} events={events} online={online} />}
      {active === "analytics" && <AnalyticsPage heartbeat={heartbeat} events={events} equityPoints={equityPoints} />}
      {active === "intelligence" && <IntelligencePage heartbeat={heartbeat} events={events} status={status} />}
      {active === "activity" && <ActivityPage events={events} filter={filter} setFilter={setFilter} status={status} />}
      {active === "control" && (
        <ControlPage
          commands={commands}
          openCommand={setModalCommand}
          commandMsg={commandMsg}
          licenseKey={licenseInfo.activation_key}
          linked={Boolean(license?.linked || status?.license?.linked)}
          setActive={setActive}
          propFirm={propFirm}
          propFirmForm={propFirmForm}
          setPropFirmForm={setPropFirmForm}
          markPropFirmDirty={() => { propFirmDirty.current = true; }}
          propFirmConfirmed={propFirmConfirmed}
          setPropFirmConfirmed={setPropFirmConfirmed}
          propFirmBusy={propFirmBusy}
          applyPropFirmConfig={applyPropFirmConfig}
        />
      )}
      {active === "license" && (
        <LicensePage
          license={license}
          licenseInput={licenseInput}
          setLicenseInput={setLicenseInput}
          linkLicense={linkLicense}
          commandMsg={commandMsg}
          heartbeat={heartbeat}
          me={me}
        />
      )}
      {active === "settings" && <SettingsPage me={me} heartbeat={heartbeat} logout={logout} />}
      <CommandModal
        command={modalCommand}
        onCancel={() => setModalCommand(null)}
        onSubmit={queueCommand}
        busy={commandBusy}
        message={commandMsg}
        licenseKey={licenseInfo.activation_key}
      />
    </AppShell>
  );
}

function HomePage({ status, heartbeat, licenseInfo, online, tradingOk, equityPoints, setActive, refresh }) {
  const openTrades = online ? Number(status?.open_trades || heartbeat.open_positions || 0) : 0;
  const riskTone = Number(heartbeat.drawdown || 0) > 5 ? "red" : Number(heartbeat.drawdown || 0) > 2 ? "amber" : "green";
  const primaryAlert = status?.alerts?.[0]?.message || "";
  const offlineCopy = licenseInfo?.activation_key
    ? primaryAlert || "License linked. Waiting for the EA heartbeat from MT5."
    : "Link your license, attach the EA to MT5, then the Command Center will show real data only.";
  return (
    <div className="space-y-4">
      <section className={`rounded-[32px] border p-5 ${toneClass(online ? (tradingOk ? "green" : "amber") : "red")}`} data-testid="bot-status-card">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">
              <Wifi className="h-4 w-4" /> {online ? "Live connection" : "Waiting for EA heartbeat"}
            </div>
            <h1 className="text-4xl font-black tracking-tight">{online ? heartbeat.bot_state || "Bot online" : "No live bot connected"}</h1>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {online
                ? `${heartbeat.account_number || "Account"} · ${heartbeat.broker_server || "Broker"} · ${heartbeat.symbol || "XAUUSD"} ${heartbeat.timeframe || "M5"}`
                : offlineCopy}
            </p>
          </div>
          <button onClick={refresh} className="rounded-full border border-white/10 bg-white/[0.06] p-3">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5">
          <Sparkline points={equityPoints} tone={online ? "#6ee7b7" : "#d4af37"} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Equity" value={online ? money(heartbeat.equity) : "Not live"} detail={`Balance ${online ? money(heartbeat.balance) : "-"}`} icon={CircleDollarSign} tone={online ? "green" : "amber"} />
        <Metric label="Floating PnL" value={online ? money(heartbeat.daily_pnl) : "-"} detail="Today" icon={TrendingUp} tone={Number(heartbeat.daily_pnl || 0) >= 0 ? "green" : "red"} />
        <Metric label="Open positions" value={openTrades} detail={online ? `Spread ${heartbeat.spread ?? "-"} pts` : "No live data"} icon={History} tone={openTrades > 0 ? "amber" : "green"} />
        <Metric label="Risk level" value={online ? pct(heartbeat.drawdown) : "Unknown"} detail={heartbeat.epf_state || "EPF waiting"} icon={Gauge} tone={riskTone} />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <Metric label="AI confidence" value={heartbeat.last_action ? "Active" : "Waiting"} detail={heartbeat.last_action || "No decision yet"} icon={Brain} tone="amber" />
        <Metric label="Heartbeat" value={relativeTime(heartbeat.last_heartbeat || heartbeat.ts)} detail={heartbeat.ea_version || "EA not reporting"} icon={Clock3} tone={online ? "green" : "red"} />
        <Metric label="License" value={licenseInfo.status || "Not linked"} detail={licenseInfo.activation_key || "Add license key"} icon={KeyRound} tone={licenseInfo.linked || licenseInfo.activation_key ? "green" : "amber"} />
      </section>

      <SetupChecklist checks={status?.setup_checks || []} />

      {!licenseInfo.activation_key && (
        <EmptyState
          title="Connect your license first"
          body="The Command Center uses your ASE license key as identity. Link it once, then the app only shows data from that license/account."
          icon={KeyRound}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setActive("intelligence")} className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4 text-left">
          <Brain className="mb-3 h-5 w-5 text-[#d4af37]" />
          <div className="font-bold">Open brain view</div>
          <p className="mt-1 text-xs leading-5 text-white/45">See why the EA waits, enters, blocks, and exits.</p>
        </button>
        <button onClick={() => setActive("control")} className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4 text-left">
          <SlidersHorizontal className="mb-3 h-5 w-5 text-[#d4af37]" />
          <div className="font-bold">Controls</div>
          <p className="mt-1 text-xs leading-5 text-white/45">Queue safe commands with license verification.</p>
        </button>
      </div>
    </div>
  );
}

function SetupChecklist({ checks = [] }) {
  if (!checks.length) return null;
  const healthy = checks.filter((check) => check.ok).length;
  return (
    <Section
      title="Setup Health"
      subtitle={`${healthy}/${checks.length} checks passing. This is the source of truth for why the Command Center is live or waiting.`}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map((check) => {
          const Icon = check.ok ? CheckCircle2 : XCircle;
          return (
            <div
              key={check.key || check.label}
              className={`flex min-w-0 items-start gap-3 rounded-2xl border p-3 ${toneClass(check.ok ? "green" : "amber")}`}
            >
              <Icon className="mt-0.5 h-4 w-4 flex-none" />
              <div className="min-w-0">
                <div className="text-sm font-black">{check.label}</div>
                <div className="mt-1 break-words text-xs leading-5 text-white/48">{check.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function TradingPage({ heartbeat, events, online }) {
  const tradeEvents = events.filter((e) => ["TRADE", "EXIT"].includes(String(e.severity || "").toUpperCase()));
  return (
    <div className="space-y-4">
      <Section title="Trading" subtitle="Open exposure, running positions, trade timeline, and execution events.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Open trades" value={online ? heartbeat.open_positions || 0 : 0} detail="EA-reported" icon={History} tone="amber" />
          <Metric label="Exposure" value={online ? heartbeat.symbol || "XAUUSD" : "No account"} detail={heartbeat.timeframe || "M5"} icon={TerminalSquare} tone="blue" />
          <Metric label="Spread" value={online ? `${heartbeat.spread ?? "-"} pts` : "-"} detail="Current quote" icon={Activity} tone="amber" />
          <Metric label="State" value={heartbeat.bot_state || "Waiting"} detail={heartbeat.last_action || "No action"} icon={Bot} tone={online ? "green" : "red"} />
        </div>
      </Section>
      <Section title="Trade timeline" subtitle="Only real EA activity appears here. No legacy cloud trades are shown.">
        {tradeEvents.length ? (
          <div className="space-y-2">{tradeEvents.slice(0, 20).map((e, i) => <EventRow key={e.id || i} event={e} />)}</div>
        ) : (
          <EmptyState title="No live trade events yet" body="When the EA opens, modifies, blocks, or closes a trade, it will appear here from the linked account." icon={History} />
        )}
      </Section>
    </div>
  );
}

function AnalyticsPage({ heartbeat, events, equityPoints }) {
  const trades = events.filter((e) => String(e.severity || "").toUpperCase() === "TRADE").length;
  const blocks = events.filter((e) => String(e.severity || "").toUpperCase() === "BLOCK").length;
  const errors = events.filter((e) => ["ERROR", "CRITICAL"].includes(String(e.severity || "").toUpperCase())).length;
  return (
    <div className="space-y-4">
      <Section title="Analytics" subtitle="Charts first. Cards only summarize what the charts are showing.">
        <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/42">Equity curve</span>
            <span className="text-xs text-white/45">{money(heartbeat.equity)}</span>
          </div>
          <Sparkline points={equityPoints} tone="#d4af37" />
        </div>
      </Section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Daily PnL" value={money(heartbeat.daily_pnl)} detail="EA heartbeat" icon={CircleDollarSign} tone={Number(heartbeat.daily_pnl || 0) >= 0 ? "green" : "red"} />
        <Metric label="Drawdown" value={pct(heartbeat.drawdown)} detail="Current" icon={Gauge} tone={Number(heartbeat.drawdown || 0) > 5 ? "red" : "amber"} />
        <Metric label="Trade events" value={trades} detail="Recent feed" icon={TrendingUp} tone="green" />
        <Metric label="Blocks/errors" value={`${blocks}/${errors}`} detail="Protection vs faults" icon={Shield} tone={errors ? "red" : "amber"} />
      </section>
      <Section title="Performance modules" subtitle="These populate from structured EA reports as the bot uploads intelligence data.">
        <div className="grid gap-3 sm:grid-cols-2">
          {["Signal performance", "Exit performance", "Block performance", "Learning performance"].map((name) => (
            <div key={name} className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
              <div className="font-bold">{name}</div>
              <p className="mt-2 text-sm leading-6 text-white/45">Waiting for enough linked report samples.</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function IntelligencePage({ heartbeat, events, status }) {
  const blocks = events.filter((e) => String(e.severity || "").toUpperCase() === "BLOCK");
  const syncs = events.filter((e) => String(e.event_type || "").toUpperCase().includes("SYNC"));
  const latestBrain = events.find((e) => /BLOCK|VETO|SIGNAL|SYNC|EXIT|SHADOW|LEARNING|CONFIDENCE/i.test(`${e.event_type} ${e.message}`));
  return (
    <div className="space-y-4">
      <Section title="AI Brain" subtitle="What the EA sees, why it waits, why it enters, and why it blocks.">
        <div className="rounded-[28px] border border-[#d4af37]/25 bg-[#d4af37]/10 p-5">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-[#f5d36d]">
            <Brain className="h-4 w-4" /> Current reasoning
          </div>
          <div className="text-2xl font-black">{heartbeat.last_action || latestBrain?.message || "Waiting for next EA decision"}</div>
          <p className="mt-2 text-sm leading-6 text-white/55">
            {latestBrain ? `${latestBrain.event_type} · ${relativeTime(latestBrain.ts)}` : "The EA will stream brain events here after heartbeat/activity is enabled for the linked license."}
          </p>
        </div>
      </Section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Market regime" value={heartbeat.bot_state || "Unknown"} detail={heartbeat.symbol || "XAUUSD"} icon={Activity} tone="blue" />
        <Metric label="Volatility" value={heartbeat.spread ? `${heartbeat.spread} pts` : "Waiting"} detail="Spread proxy" icon={Flame} tone="amber" />
        <Metric label="Sync state" value={status?.intelligence_sync_state || heartbeat.sync_state || "Unknown"} detail={status?.equity_protection_state || heartbeat.epf_state || "EPF"} icon={RefreshCw} tone="amber" />
        <Metric label="Blocks" value={blocks.length} detail="Recent veto/guard events" icon={Shield} tone={blocks.length ? "amber" : "green"} />
      </section>
      <Section title="Recent intelligence" subtitle="Entry reasons, block reasons, exit-brain decisions, shadow outcomes, and learning status.">
        {[...blocks, ...syncs].slice(0, 12).length ? (
          <div className="space-y-2">{[...blocks, ...syncs].slice(0, 12).map((e, i) => <EventRow key={e.id || i} event={e} />)}</div>
        ) : (
          <EmptyState title="The brain is quiet right now" body="No linked intelligence events yet. Once the EA reports, this screen becomes the operating system for understanding the bot." icon={Brain} />
        )}
      </Section>
    </div>
  );
}

function ActivityPage({ events, filter, setFilter }) {
  return (
    <div className="space-y-4">
      <Section title="Activity" subtitle="A clean timeline of every important bot event, like an operations feed.">
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              data-testid={id === "trades" ? "activity-filter-trade" : undefined}
              className={`rounded-full px-3 py-2 text-xs font-bold ${filter === id ? "bg-[#d4af37] text-black" : "border border-white/10 bg-white/[0.04] text-white/55"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {events.length ? (
          <div className="space-y-2">{events.map((e, i) => <EventRow key={e.id || i} event={e} />)}</div>
        ) : (
          <EmptyState title="No activity for this license yet" body="Old cloud records are intentionally hidden. Only events from your linked license/account will appear here." icon={Activity} />
        )}
      </Section>
    </div>
  );
}

function PropFirmNumberField({ label, value, onChange, suffix = "%", min = 0, max, step = "0.01", detail }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-white/70">{label}</span>
      <div className="mt-2 flex items-center rounded-2xl border border-white/10 bg-white/[0.05] px-3 focus-within:border-[#d4af37]/70">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm font-bold text-white outline-none"
        />
        <span className="ml-2 text-xs font-bold text-white/35">{suffix}</span>
      </div>
      {detail && <span className="mt-1 block text-[11px] leading-4 text-white/38">{detail}</span>}
    </label>
  );
}

function ControlPage({
  commands,
  openCommand,
  commandMsg,
  licenseKey,
  linked,
  setActive,
  propFirm,
  propFirmForm,
  setPropFirmForm,
  markPropFirmDirty,
  propFirmConfirmed,
  setPropFirmConfirmed,
  propFirmBusy,
  applyPropFirmConfig,
}) {
  const applied = propFirm?.applied || {};
  const updateProp = (field, value) => {
    markPropFirmDirty();
    setPropFirmForm((current) => ({ ...current, [field]: value }));
  };
  return (
    <div className="space-y-4">
      <Section title="PROP FIRM MODE" subtitle="Set the firm's exact limits here. The EA stays unchanged until it receives and acknowledges this command.">
        <div className="flex items-center justify-between gap-4 rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
          <div>
            <div className="font-black">{propFirmForm.enabled ? "Protection enabled" : "Protection off"}</div>
            <div className="mt-1 text-xs leading-5 text-white/45">
              Off by default. Turning it on caps exposure and locks before the configured firm limits.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={propFirmForm.enabled}
            onClick={() => updateProp("enabled", !propFirmForm.enabled)}
            className={`relative h-8 w-14 flex-none rounded-full transition ${propFirmForm.enabled ? "bg-emerald-400" : "bg-white/15"}`}
          >
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-black transition ${propFirmForm.enabled ? "left-7" : "left-1"}`} />
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PropFirmNumberField
            label="Starting account balance"
            value={propFirmForm.starting_balance}
            onChange={(value) => updateProp("starting_balance", value)}
            suffix="$"
            step="1"
            detail="Use the prop account's original balance for total drawdown tracking."
          />
          <PropFirmNumberField label="Daily loss limit" value={propFirmForm.daily_loss_pct} onChange={(value) => updateProp("daily_loss_pct", value)} min={0.5} max={20} />
          <PropFirmNumberField label="Maximum total loss" value={propFirmForm.max_loss_pct} onChange={(value) => updateProp("max_loss_pct", value)} min={0.5} max={30} />
          <PropFirmNumberField label="Safety buffer" value={propFirmForm.safety_buffer_pct} onChange={(value) => updateProp("safety_buffer_pct", value)} min={0} max={10} detail="The EA locks this far before the firm's stated limit." />
          <PropFirmNumberField label="Risk per trade" value={propFirmForm.risk_per_trade_pct} onChange={(value) => updateProp("risk_per_trade_pct", value)} min={0.01} max={2} />
          <PropFirmNumberField label="Maximum basket risk" value={propFirmForm.max_basket_risk_pct} onChange={(value) => updateProp("max_basket_risk_pct", value)} min={0.01} max={4} />
        </div>

        <label className="mt-4 flex items-start gap-3 rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
          <input
            type="checkbox"
            checked={propFirmForm.allow_retest_add}
            onChange={(event) => updateProp("allow_retest_add", event.target.checked)}
            className="mt-1 h-4 w-4 accent-[#d4af37]"
          />
          <span>
            <span className="block text-sm font-black">Allow one confirmed retest add</span>
            <span className="mt-1 block text-xs leading-5 text-white/45">
              Keeps the existing one-small-retest behavior, but only inside the configured basket risk.
            </span>
          </span>
        </label>

        {propFirmForm.allow_retest_add && (
          <div className="mt-4 max-w-sm">
            <PropFirmNumberField
              label="Retest add size"
              value={Number(propFirmForm.retest_add_lot_multi || 0) * 100}
              onChange={(value) => updateProp("retest_add_lot_multi", value / 100)}
              min={5}
              max={50}
              suffix="% of normal add"
              step="1"
            />
          </div>
        )}

        <label className="mt-5 flex items-start gap-3 text-xs leading-5 text-white/55">
          <input
            type="checkbox"
            checked={propFirmConfirmed}
            onChange={(event) => setPropFirmConfirmed(event.target.checked)}
            className="mt-1 h-4 w-4 accent-[#d4af37]"
          />
          I checked these values against my prop firm's rules. Firm calculations can differ, so the safety buffer should remain above zero.
        </label>
        <button
          onClick={applyPropFirmConfig}
          disabled={!linked || !propFirmConfirmed || propFirmBusy}
          className="mt-4 w-full rounded-2xl bg-[#d4af37] px-5 py-3 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {propFirmBusy ? "Sending to EA..." : "Apply to EA"}
        </button>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[20px] border border-white/10 bg-black/25 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Command status</div>
            <div className="mt-2 text-sm font-black">{propFirm?.apply_status || "NOT CONFIGURED"}</div>
            <div className="mt-1 text-xs leading-5 text-white/42">{propFirm?.apply_message || "No Prop Firm Mode command sent yet."}</div>
          </div>
          <div className="rounded-[20px] border border-white/10 bg-black/25 p-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">Applied by EA</div>
            <div className={`mt-2 text-sm font-black ${applied.enabled ? "text-emerald-300" : "text-white/70"}`}>
              {applied.enabled ? "ON" : "OFF"}
            </div>
            <div className="mt-1 text-xs leading-5 text-white/42">
              Risk {Number(applied.risk_per_trade_pct || 0).toFixed(2)}% · Basket {Number(applied.max_basket_risk_pct || 0).toFixed(2)}%
            </div>
          </div>
        </div>
      </Section>
      <Section title="Control" subtitle="Remote actions are isolated here. Every command needs license verification and EA acknowledgement.">
        {!linked && (
          <div className="mb-4 rounded-[22px] border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">
            Link your license before sending commands.
            <button onClick={() => setActive("license")} className="ml-2 font-black underline">Open License</button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMMANDS.map((cmd) => {
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.action}
                onClick={() => openCommand(cmd)}
                disabled={!linked}
                className={`rounded-[24px] border p-4 text-left transition disabled:opacity-40 ${toneClass(cmd.tone)}`}
              >
                <Icon className="mb-4 h-5 w-5" />
                <div className="font-black">{cmd.label}</div>
                <p className="mt-2 text-xs leading-5 text-white/52">{cmd.detail}</p>
              </button>
            );
          })}
        </div>
        {commandMsg && <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{commandMsg}</div>}
      </Section>
      <Section title="Command tracking" subtitle="Queued, executed, failed, or skipped commands.">
        {commands.length ? (
          <div className="space-y-2">
            {commands.map((cmd) => (
              <div key={cmd.id} className="rounded-[22px] border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold">{cmd.label || cmd.action}</div>
                    <div className="mt-1 text-xs text-white/42">{relativeTime(cmd.requested_at)} · {cmd.ack_message || "Waiting for EA acknowledgement"}</div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[10px] font-black ${cmd.status === "EXECUTED" ? "bg-emerald-300 text-black" : cmd.status === "FAILED" ? "bg-red-400 text-black" : "bg-[#d4af37] text-black"}`}>
                    {cmd.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No commands queued" body={`Commands will appear here after you confirm with license key ${licenseKey || "ASE-..."}.`} icon={Lock} />
        )}
      </Section>
    </div>
  );
}

function LicensePage({ license, licenseInput, setLicenseInput, linkLicense, commandMsg, heartbeat, me }) {
  const info = license?.license;
  return (
    <div className="space-y-4">
      <Section title="License" subtitle="Your license is the identity for the bot, account binding, heartbeat, and remote commands.">
        <div className="rounded-[26px] border border-[#d4af37]/25 bg-[#d4af37]/10 p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#f5d36d]">Activation key</div>
          <div className="mt-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 break-words font-mono text-2xl font-black">{info?.activation_key || "No license linked"}</div>
            {info?.activation_key && <CopyButton value={info.activation_key} label="Copy key" />}
          </div>
          <p className="mt-2 text-sm leading-6 text-white/50">
            License PIN / Activation Key is what you normally put into MT5 as <span className="font-mono text-white/70">InpLicensePIN</span>.
          </p>
          <p className="mt-1 text-xs text-white/42">{info?.status || license?.message || "Add the ASE key you received after purchase."}</p>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={licenseInput}
            onChange={(e) => setLicenseInput(e.target.value.toUpperCase())}
            placeholder="ASE-D4Q9-SUFW"
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 font-mono text-sm text-white outline-none focus:border-[#d4af37]"
          />
          <button onClick={linkLicense} className="rounded-2xl bg-[#d4af37] px-5 py-3 text-sm font-black text-black">
            Link license
          </button>
        </div>
        {commandMsg && <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{commandMsg}</div>}
      </Section>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className={`min-w-0 overflow-hidden rounded-[22px] border p-4 ${toneClass("amber")}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/42">License ID</div>
            <KeyRound className="h-4 w-4 flex-none opacity-70" />
          </div>
          <div className="break-all font-mono text-sm font-black leading-6 text-amber-50">{info?.license_id || "-"}</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="min-w-0 break-words text-xs leading-5 text-white/50">
              Internal support ID only. You should not need this in MT5.
              <br />{me.email}
            </div>
            {info?.license_id && <CopyButton value={info.license_id} label="Copy ID" />}
          </div>
        </div>
        <Metric label="MT5 binding" value={info?.account_binding || heartbeat.account_number || "Not bound"} detail={heartbeat.broker_server || "Waiting for EA"} icon={TerminalSquare} tone={info?.mt5_account || heartbeat.account_number ? "green" : "amber"} />
        <Metric label="VPS binding" value={info?.vps_binding || "Not bound"} detail="Optional" icon={Wifi} tone="blue" />
        <Metric label="EA version" value={heartbeat.ea_version || info?.ea_version || "Waiting"} detail={`Last heartbeat ${relativeTime(heartbeat.last_heartbeat || heartbeat.ts)}`} icon={Bot} tone={heartbeat.ea_version ? "green" : "amber"} />
      </section>
    </div>
  );
}

function SettingsPage({ me, heartbeat, logout }) {
  return (
    <div className="space-y-4">
      <Section title="Settings" subtitle="Account, app install, device status, and support details.">
        <div className="space-y-3">
          <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/42">Command Center account</div>
            <div className="mt-2 font-bold">{me.full_name || "Trader"}</div>
            <div className="mt-1 text-sm text-white/45">{me.email}</div>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/42">Connected bot</div>
            <div className="mt-2 font-bold">{heartbeat.ea_version || "No EA heartbeat yet"}</div>
            <div className="mt-1 text-sm text-white/45">{heartbeat.broker_server || "Broker waiting"}</div>
          </div>
          <button onClick={logout} className="w-full rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-black text-red-100">
            Log out
          </button>
        </div>
      </Section>
    </div>
  );
}
