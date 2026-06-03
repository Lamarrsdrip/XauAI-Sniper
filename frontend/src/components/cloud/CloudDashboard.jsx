import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  KeyRound,
  Loader2,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  Square,
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

const FILTERS = [
  ["all", "All"],
  ["trades", "Trades"],
  ["blocks", "Blocks"],
  ["errors", "Errors"],
  ["sync", "Sync"],
  ["exit", "Exit-brain"],
  ["shadow", "Shadow"],
  ["risk", "Risk"],
];

const COMMANDS = [
  ["PAUSE_NEW_TRADES", "Pause new trades", Pause, "yellow"],
  ["RESUME_TRADING", "Resume trading", Play, "green"],
  ["STOP_TRADING", "Stop trading", Square, "red"],
  ["CLOSE_ALL_TRADES", "Close all trades", XCircle, "red"],
  ["FORCE_SYNC", "Force sync", RefreshCw, "yellow"],
  ["FORCE_REPORT_UPLOAD", "Mark report upload", Download, "yellow"],
];

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

const money = (value) =>
  Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

function useAuthGuard() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!localStorage.getItem("cloud_token")) navigate("/command/login");
  }, [navigate]);
}

function severityClass(severity) {
  const s = String(severity || "INFO").toUpperCase();
  if (s === "CRITICAL" || s === "ERROR") return "border-red-400/30 bg-red-500/[0.08] text-red-200";
  if (s === "WARNING" || s === "BLOCK") return "border-amber-300/25 bg-amber-300/[0.08] text-amber-100";
  if (s === "TRADE" || s === "COMMAND") return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100";
  if (s === "EXIT" || s === "SYNC") return "border-sky-300/20 bg-sky-300/[0.08] text-sky-100";
  return "border-white/10 bg-white/[0.04] text-white/80";
}

function StatusDot({ status }) {
  const color =
    status === "green" ? "bg-emerald-300" : status === "red" ? "bg-red-400" : "bg-amber-300";
  return <span className={`h-2.5 w-2.5 rounded-full ${color} shadow-lg`} />;
}

function Card({ title, value, detail, status = "yellow", testid }) {
  const tone =
    status === "green"
      ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200"
      : status === "red"
      ? "border-red-400/25 bg-red-500/[0.08] text-red-200"
      : "border-amber-300/25 bg-amber-300/[0.08] text-amber-100";
  return (
    <div className={`rounded-2xl border p-4 ${tone}`} data-testid={testid}>
      <div className="mb-2 flex items-center gap-2">
        <StatusDot status={status} />
        <div className="font-mono text-[10px] uppercase tracking-widest text-white/42">{title}</div>
      </div>
      <div className="text-xl font-black tracking-tight">{value}</div>
      {detail && <div className="mt-1 text-xs leading-5 text-white/50">{detail}</div>}
    </div>
  );
}

function MiniRecord({ title, record }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">{title}</div>
      {!record ? (
        <div className="mt-3 text-sm text-white/42">No record yet</div>
      ) : (
        <div className="mt-3 space-y-1 text-sm text-white/70">
          <div className="truncate font-bold">{record.message || record.reason || record.symbol || record.event_type || "Recorded"}</div>
          <div className="font-mono text-[11px] text-white/40">{relativeTime(record.ts || record.opened_at || record.closed_at)}</div>
        </div>
      )}
    </div>
  );
}

export default function CloudDashboard() {
  useAuthGuard();
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [commandMsg, setCommandMsg] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [meRes, statusRes, activityRes] = await Promise.all([
        commandAxios.get("/cloud/auth/me"),
        commandAxios.get("/cloud/monitor/status"),
        commandAxios.get("/cloud/monitor/activity", { params: { kind: filter, limit: 80 } }),
      ]);
      setMe(meRes.data);
      setStatus(statusRes.data);
      setEvents(activityRes.data.events || []);
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
    const id = setInterval(fetchAll, 6000);
    return () => clearInterval(id);
  }, [fetchAll]);

  const sendCommand = async (action) => {
    const label = action.replaceAll("_", " ");
    const pin = window.prompt(`Enter your 4-6 digit Command Center PIN to queue ${label}`);
    if (!pin) return;
    if (!window.confirm(`Queue ${label} for the EA?\n\nThe EA must poll and acknowledge it before anything changes.`)) return;
    try {
      const response = await commandAxios.post("/cloud/command/request", { action, pin, confirm: true });
      setCommandMsg(`Queued ${label}: ${response.data.command_id || "pending EA acknowledgement"}`);
      fetchAll();
    } catch (error) {
      setCommandMsg(error.response?.data?.detail || "Command queue failed");
    }
  };

  const logout = async () => {
    try {
      await commandAxios.post("/cloud/auth/logout");
    } catch {}
    localStorage.removeItem("cloud_token");
    navigate("/command");
  };

  if (loading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] text-white">
        <Loader2 className="h-6 w-6 animate-spin text-amber-200" />
      </div>
    );
  }

  const heartbeat = status?.heartbeat || {};
  const botOnline = Boolean(status && !status.offline);
  const tradingOk = Boolean(heartbeat.algo_trading && heartbeat.trading_allowed && heartbeat.mt5_connected);
  const mainStatus = botOnline && tradingOk ? "green" : botOnline ? "yellow" : "red";
  const statusText = botOnline ? heartbeat.bot_state || "ONLINE" : "BOT OFFLINE / NO HEARTBEAT";
  const alerts = status?.alerts || [];
  const openTrades = status?.open_trades ?? heartbeat.open_positions ?? 0;
  const drawdown = Number(heartbeat.drawdown || 0);

  return (
    <div className="min-h-screen bg-[#050505] pb-10 text-white" data-testid="bot-monitor-dashboard">
      <InstallAppPrompt />
      <nav className="sticky top-0 z-40 border-b border-white/10 bg-[#050505]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/command" className="flex min-w-0 items-center gap-3">
            <XauAiLogo size={34} className="flex-none" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-black">XAU AI Sniper Command Center</span>
              <span className="block truncate font-mono text-[9px] uppercase tracking-[0.22em] text-white/38">
                Monitor + PIN-safe control
              </span>
            </span>
          </Link>
          <button onClick={logout} className="rounded-full border border-white/10 p-2 text-white/55">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 sm:py-8">
        <section className={`rounded-[28px] border p-5 ${severityClass(mainStatus === "red" ? "CRITICAL" : mainStatus === "yellow" ? "WARNING" : "TRADE")}`} data-testid="bot-status-card">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/45">
                <StatusDot status={mainStatus} /> Bot Activity Monitor
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-5xl">{statusText}</h1>
              <p className="mt-2 text-sm text-white/58">
                Last heartbeat {relativeTime(heartbeat.last_heartbeat || heartbeat.ts)} · EA {heartbeat.ea_version || "unknown"} · {heartbeat.symbol || "XAUUSD"} {heartbeat.timeframe || "M5"}
              </p>
            </div>
            <button onClick={fetchAll} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-bold">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </section>

        {alerts.length > 0 && (
          <section className="space-y-2">
            {alerts.map((alert, index) => (
              <div key={`${alert.type}-${index}`} className={`rounded-2xl border p-3 text-sm ${severityClass(alert.severity)}`}>
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                <span className="font-bold">{alert.type}</span> · {alert.message}
              </div>
            ))}
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="MT5 connection" value={heartbeat.mt5_connected ? "Connected" : "Disconnected"} detail={heartbeat.broker_server || "Broker unknown"} status={heartbeat.mt5_connected ? "green" : "red"} />
          <Card title="Algo trading" value={heartbeat.algo_trading ? "Enabled" : "Disabled"} detail={heartbeat.trading_allowed ? "Trading allowed" : "Trading blocked"} status={heartbeat.algo_trading && heartbeat.trading_allowed ? "green" : "red"} />
          <Card title="Account" value={heartbeat.account_number || "Not linked"} detail={`${heartbeat.broker_server || "Broker"} · ${me.status || "license"}`} status={heartbeat.account_connected ? "green" : "yellow"} />
          <Card title="Intelligence sync" value={status?.intelligence_sync_state || heartbeat.sync_state || "Unknown"} detail={`EPF ${status?.equity_protection_state || heartbeat.epf_state || "T0"}`} status={String(heartbeat.sync_state || "").startsWith("OK") ? "green" : "yellow"} />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card title="Balance" value={money(heartbeat.balance)} detail={`Equity ${money(heartbeat.equity)}`} status="green" />
          <Card title="Floating / DD" value={`${drawdown.toFixed(2)}%`} detail={`Daily PnL ${money(heartbeat.daily_pnl)}`} status={drawdown > 5 ? "red" : drawdown > 2 ? "yellow" : "green"} />
          <Card title="Open trades" value={openTrades} detail={`Spread ${heartbeat.spread ?? "-"} pts`} status={Number(openTrades) > 0 ? "yellow" : "green"} />
          <Card title="Last action" value={heartbeat.last_action || "Waiting"} detail={heartbeat.last_decision_time ? `Decision ${relativeTime(heartbeat.last_decision_time)}` : "No decision yet"} status="yellow" />
        </section>

        <section className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">Safe remote commands</div>
              <div className="mt-1 text-sm text-white/55">
                PIN + confirmation required. Commands are queued, then the EA must poll, validate, execute, and acknowledge them.
              </div>
            </div>
            <KeyRound className="h-5 w-5 text-amber-200" />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {COMMANDS.map(([action, label, Icon, tone]) => (
              <button
                key={action}
                onClick={() => sendCommand(action)}
                className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-xs font-black ${
                  tone === "red"
                    ? "border-red-400/25 bg-red-500/[0.08] text-red-200"
                    : tone === "green"
                    ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200"
                    : "border-amber-300/25 bg-amber-300/[0.08] text-amber-100"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          {commandMsg && (
            <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-3 text-xs text-amber-100">
              {commandMsg}
            </div>
          )}
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          <MiniRecord title="Last signal" record={status?.last_signal} />
          <MiniRecord title="Last trade" record={status?.last_trade} />
          <MiniRecord title="Last blocked trade" record={status?.last_blocked_trade} />
        </section>

        <section className="rounded-[24px] border border-white/10 bg-white/[0.045] p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/40">
                <Activity className="h-4 w-4 text-amber-200" /> Live activity feed
              </div>
              <div className="mt-1 text-sm text-white/55">Trades, blocks, sync events, exits, shadow results, risk and errors.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setFilter(id)}
                  data-testid={id === "trades" ? "activity-filter-trade" : undefined}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${
                    filter === id ? "bg-amber-300 text-black" : "border border-white/10 bg-white/[0.05] text-white/60"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {events.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-center text-sm text-white/45">
                No monitor events yet. The EA will populate this when heartbeat/activity posts are enabled.
              </div>
            ) : (
              events.map((event, index) => (
                <div key={event.id || index} className={`rounded-2xl border p-3 ${severityClass(event.severity)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-white/45">
                        {event.severity || "INFO"} · {event.event_type}
                      </div>
                      <div className="mt-1 break-words text-sm">{event.message}</div>
                      <div className="mt-1 text-[11px] text-white/45">
                        {event.symbol || heartbeat.symbol || "XAUUSD"} · {event.account || heartbeat.account_number || "account"} · {relativeTime(event.ts)}
                      </div>
                    </div>
                    {String(event.severity || "").toUpperCase() === "TRADE" ? (
                      <CheckCircle2 className="h-5 w-5 flex-none" />
                    ) : (
                      <Clock className="h-5 w-5 flex-none opacity-50" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
