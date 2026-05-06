import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { Cloud, Pause, Play, Shield, LogOut, TrendingUp, TrendingDown, Loader2, Copy, CheckCircle2, XCircle, Clock, CreditCard, Calculator, RefreshCw, AlertTriangle } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import { forceRefreshApp } from "@/registerSW";
import { FALLBACK_BROKER_SERVERS } from "./brokerServers";

// Compact relative-time formatter ("12s ago", "3m ago", "2h ago")
const relativeTime = (iso) => {
  if (!iso) return "never";
  try {
    const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60)    return `${Math.floor(s)}s ago`;
    if (s < 3600)  return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  } catch { return "—"; }
};

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Scoped axios instance — never touches global defaults (avoids leaking Bearer
// token into admin portal or other axios calls that run in the same session)
const cloudAxios = axios.create({ baseURL: API });
cloudAxios.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("cloud_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

function useAuth() {
  const nav = useNavigate();
  useEffect(() => {
    const token = localStorage.getItem("cloud_token");
    if (!token) nav("/cloud/login");
  }, [nav]);
}

function formatUSD(n) { return "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function CloudDashboard() {
  useAuth();
  const nav = useNavigate();
  const [me, setMe] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview"); // overview | connect | billing

  const fetchAll = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([cloudAxios.get(`/cloud/auth/me`), cloudAxios.get(`/cloud/dashboard`)]);
      setMe(m.data); setData(d.data);
    } catch (e) {
      if (e.response?.status === 401) { localStorage.removeItem("cloud_token"); nav("/cloud/login"); }
    } finally { setLoading(false); }
  }, [nav]);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 15000); return () => clearInterval(iv); }, [fetchAll]);

  const logout = async () => {
    try { await cloudAxios.post(`/cloud/auth/logout`); } catch {}
    localStorage.removeItem("cloud_token");
    nav("/cloud");
  };

  const togglePause = async () => {
    try { await cloudAxios.post(`/cloud/pause`, { paused: !data.paused }); fetchAll(); } catch {}
  };

  if (loading || !me) return (
    <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />
    </div>
  );

  const daysLeft = me.days_remaining ?? 0;
  const isTrial = me.status === "trial";
  const isActive = me.subscription_active;
  const needsPayment = !isActive && isTrial && daysLeft <= 0;

  return (
    <div className="min-h-screen bg-[#050505] text-white pb-20 sm:pb-0">
      <InstallAppPrompt />
      {/* Top bar */}
      <nav className="sticky top-0 z-40 backdrop-blur-xl bg-[#050505]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <Link to="/cloud" className="flex items-center gap-2 min-w-0"><Cloud className="w-5 h-5 sm:w-6 sm:h-6 text-[#D4AF37] flex-none" /><span className="font-bold tracking-tight text-sm sm:text-base truncate">XauAi Cloud</span></Link>
          <div className="flex items-center gap-3 flex-none">
            <div className="hidden md:block text-xs text-white/50"><span data-testid="user-email">{me.email}</span></div>
            <button onClick={logout} className="text-white/50 hover:text-white transition-colors p-1.5" data-testid="logout-button" aria-label="Log out"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </nav>

      {/* Trial / subscription banner */}
      {isTrial && daysLeft > 0 && (
        <div className="bg-[#D4AF37]/10 border-b border-[#D4AF37]/20 py-2.5 sm:py-3" data-testid="trial-banner">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs sm:text-sm gap-2">
            <div className="min-w-0"><span className="text-[#D4AF37] font-semibold">Free trial</span><span className="text-white/60 ml-1 sm:ml-2">— {daysLeft}d left</span></div>
            <button onClick={()=>setTab("billing")} className="text-[#D4AF37] hover:underline font-semibold whitespace-nowrap" data-testid="trial-upgrade-link">Upgrade →</button>
          </div>
        </div>
      )}
      {needsPayment && (
        <div className="bg-red-500/10 border-b border-red-500/20 py-2.5 sm:py-3" data-testid="expired-banner">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs sm:text-sm gap-2">
            <div className="min-w-0"><span className="text-red-400 font-semibold">Trial expired</span><span className="text-white/60 ml-1 sm:ml-2 hidden sm:inline">— subscribe to continue</span></div>
            <button onClick={()=>setTab("billing")} className="text-red-400 hover:underline font-semibold whitespace-nowrap" data-testid="expired-subscribe-link">Subscribe →</button>
          </div>
        </div>
      )}

      {/* Desktop tabs (hidden on mobile; mobile uses bottom nav) */}
      <div className="hidden sm:block max-w-7xl mx-auto px-6 pt-6">
        <div className="flex gap-2 border-b border-white/5">
          {[
            {id:"overview",label:"Overview"},
            {id:"connect",label:"MT5 Connection"},
            {id:"billing",label:"Subscription"},
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} data-testid={`tab-${t.id}`}
                    className={`px-4 py-3 text-sm transition-colors ${tab===t.id?"text-[#D4AF37] border-b-2 border-[#D4AF37]":"text-white/50 hover:text-white"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-8">
        {tab === "overview" && <OverviewTab me={me} data={data} onTogglePause={togglePause} />}
        {tab === "connect" && <ConnectTab me={me} onRefresh={fetchAll} />}
        {tab === "billing" && <BillingTab me={me} onRefresh={fetchAll} />}
      </div>

      {/* Mobile bottom tab bar — native-app feel */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#050505]/95 backdrop-blur-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-3">
          {[
            {id:"overview",label:"Overview",Icon:TrendingUp},
            {id:"connect",label:"Connect",Icon:Shield},
            {id:"billing",label:"Billing",Icon:CreditCard},
          ].map(({id,label,Icon})=>(
            <button key={id} onClick={()=>setTab(id)} data-testid={`mtab-${id}`}
                    className={`flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${tab===id?"text-[#D4AF37]":"text-white/50"}`}>
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function OverviewTab({ me, data, onTogglePause }) {
  const wr = data.totals.total_trades > 0 ? Math.round((data.totals.wins / data.totals.total_trades) * 100) : 0;
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <KPI label="Net P&L (30d)" value={formatUSD(data.totals.net_pnl)} accent={data.totals.net_pnl >= 0 ? "green" : "red"} testid="kpi-pnl" />
        <KPI label="Trades" value={data.totals.total_trades} testid="kpi-trades" />
        <KPI label="Win Rate" value={`${wr}%`} testid="kpi-winrate" />
        <KPI label="Last Balance" value={me.last_balance ? formatUSD(me.last_balance) : "—"} testid="kpi-balance" />
      </div>

      {/* Execution status */}
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6" data-testid="execution-status-card">
        <div className="flex items-center justify-between mb-4 sm:mb-6 flex-wrap gap-3">
          <div>
            <div className="text-[10px] sm:text-xs font-mono tracking-widest text-white/40 mb-1.5 sm:mb-2">EXECUTION STATUS</div>
            <div className="flex items-center gap-3">
              {data.mt5_connected ? <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-green-400" /> : <XCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-400" />}
              <div>
                <div className="font-bold text-base sm:text-lg">{data.mt5_connected ? "MT5 Linked" : "MT5 Not Connected"}</div>
                <div className="text-xs sm:text-sm text-white/60">
                  {data.paused ? "⏸ Trading paused by you" : data.mt5_connected ? "Active — executing 24/7" : "Connect to start"}
                </div>
              </div>
            </div>
          </div>
          {data.mt5_connected && (
            <button onClick={onTogglePause} data-testid="pause-toggle"
                    className={`w-full sm:w-auto px-5 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors ${data.paused ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-red-500/20 text-red-400 hover:bg-red-500/30"}`}>
              {data.paused ? <><Play className="w-4 h-4" /> Resume</> : <><Pause className="w-4 h-4" /> Pause</>}
            </button>
          )}
        </div>
      </div>

      <BotReasoningFeed />

      {/* Recent trades */}
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6" data-testid="trades-card">
        <div className="text-[10px] sm:text-xs font-mono tracking-widest text-white/40 mb-3 sm:mb-4">RECENT TRADES</div>
        {data.trades.length === 0 ? (
          <div className="text-center py-10 sm:py-12 text-white/40">
            <TrendingUp className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 text-white/20" />
            <div className="text-sm sm:text-base">No trades yet. {data.mt5_connected ? "Signals arrive during market hours." : "Connect your MT5 to get started."}</div>
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden space-y-2">
              {data.trades.map((t,i)=>(
                <div key={t.id||i} className="bg-black/30 rounded-xl p-3 flex items-center justify-between" data-testid={`trade-card-${i}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-sm">{t.symbol}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.side==="BUY"?"bg-green-500/20 text-green-400":"bg-red-500/20 text-red-400"}`}>{t.side}</span>
                      <span className="font-mono text-xs text-white/50">{t.lots?.toFixed(2)}</span>
                    </div>
                    <div className="text-[10px] text-white/40">{t.closed_at?.slice(0,16).replace("T"," ")}</div>
                  </div>
                  <div className={`font-mono text-sm font-semibold ${t.profit>=0?"text-green-400":"text-red-400"}`}>{formatUSD(t.profit)}</div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs font-mono tracking-widest text-white/40 border-b border-white/5">
                  <th className="py-2 text-left">SYMBOL</th><th className="py-2 text-left">SIDE</th>
                  <th className="py-2 text-right">LOTS</th><th className="py-2 text-right">P&L</th>
                  <th className="py-2 text-right">CLOSED</th>
                </tr></thead>
                <tbody>
                  {data.trades.map((t,i)=>(
                    <tr key={t.id || i} className="border-b border-white/5" data-testid={`trade-row-${i}`}>
                      <td className="py-3 font-mono">{t.symbol}</td>
                      <td className={`py-3 font-semibold ${t.side==="BUY"?"text-green-400":"text-red-400"}`}>{t.side}</td>
                      <td className="py-3 font-mono text-right">{t.lots?.toFixed(2)}</td>
                      <td className={`py-3 font-mono text-right font-semibold ${t.profit>=0?"text-green-400":"text-red-400"}`}>{formatUSD(t.profit)}</td>
                      <td className="py-3 text-right text-white/50 text-xs">{t.closed_at?.slice(0,16).replace("T"," ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KPI({ label, value, accent, testid }) {
  const color = accent === "green" ? "text-green-400" : accent === "red" ? "text-red-400" : "text-white";
  return (
    <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-5" data-testid={testid}>
      <div className="text-[9px] sm:text-[10px] font-mono tracking-widest text-white/40 mb-1 sm:mb-2">{label}</div>
      <div className={`text-lg sm:text-2xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}

// Live "Bot Reasoning" feed — polls the master EA's TRADE BLOCKED BECAUSE / FIRED
// events every 6s so subscribers see exactly why their copy account is or isn't
// trading right now. Removes the "is this thing broken?" mystery.
function BotReasoningFeed() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const r = await cloudAxios.get(`/cloud/me/reasoning?limit=20`);
        if (alive) { setEvents(r.data.events || []); setErr(""); }
      } catch (e) {
        if (alive) setErr(e.response?.data?.detail || "Could not load activity feed");
      } finally { if (alive) setLoading(false); }
    };
    fetchOnce();
    const id = setInterval(fetchOnce, 6000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6" data-testid="bot-reasoning-feed">
      <div className="flex items-center justify-between mb-3 sm:mb-4 flex-wrap gap-2">
        <div className="text-[10px] sm:text-xs font-mono tracking-widest text-white/40">BOT ACTIVITY · LIVE</div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-white/40">refreshing every 6s</span>
        </div>
      </div>
      {loading && events.length === 0 ? (
        <div className="flex items-center gap-2 text-white/40 text-sm py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Connecting to master EA…
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-8 text-white/40 text-sm">
          <Cloud className="w-8 h-8 mx-auto mb-2 text-white/20" />
          No activity yet. The bot will start logging once the master EA is online.
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {events.map((e, i) => {
            const isFire = e.event_type === "FIRE";
            const grade = (e.grade || "").toUpperCase();
            const dirArrow = e.signal_dir > 0 ? "↑" : e.signal_dir < 0 ? "↓" : "·";
            const accent = isFire
              ? "border-green-500/40 bg-green-500/5"
              : grade.includes("VETO") || grade.includes("LOCK") || grade === "NEWS"
              ? "border-red-500/30 bg-red-500/5"
              : "border-white/10 bg-white/[0.02]";
            const labelColor = isFire ? "text-green-400" : "text-amber-400";
            return (
              <div key={e.id || i} className={`flex items-start gap-3 p-3 border rounded-xl ${accent}`} data-testid={`reasoning-row-${i}`}>
                <div className={`flex-none text-[10px] font-mono font-bold tracking-widest ${labelColor} pt-0.5`}>
                  {isFire ? "FIRE" : "BLOCK"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white/90 leading-snug break-words">{e.reason}</div>
                  <div className="flex items-center gap-2 text-[10px] font-mono text-white/40 mt-1 flex-wrap">
                    <span>{relativeTime(e.ts)}</span>
                    {e.regime && <span>· {e.regime}</span>}
                    {e.setup && <span>· {e.setup}</span>}
                    {grade && grade !== e.event_type && <span>· {grade}</span>}
                    {e.signal_dir !== 0 && <span className={e.signal_dir > 0 ? "text-green-400" : "text-red-400"}>{dirArrow} {e.signal_dir > 0 ? "BUY" : "SELL"}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {err && <div className="text-xs text-red-400 mt-2" data-testid="reasoning-err">{err}</div>}
    </div>
  );
}

function ConnectTab({ me, onRefresh }) {
  const [form, setForm] = useState({ broker_server: "", mt5_login: "", mt5_password: "", risk_tier: "balanced" });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [simBalance, setSimBalance] = useState(me.last_balance || 1000);
  const [brokerList, setBrokerList] = useState(FALLBACK_BROKER_SERVERS);
  const [serverQuery, setServerQuery] = useState("");
  const [serverDropOpen, setServerDropOpen] = useState(false);
  const [customServer, setCustomServer] = useState(false);

  const connected = me.mt5_connected;
  const verifyStatus = me.mt5_verification_status || "none";
  const verifyError = me.mt5_verification_error || "";

  // Try the API first; if it returns a non-empty list, use it. Otherwise keep
  // the baked-in fallback so the dropdown ALWAYS works (even if backend is older).
  useEffect(() => {
    let alive = true;
    cloudAxios.get(`/cloud/mt5/brokers`)
      .then(r => {
        const list = r.data?.servers || [];
        if (alive && Array.isArray(list) && list.length > 0) setBrokerList(list);
      })
      .catch(() => { /* silently keep fallback */ });
    return () => { alive = false; };
  }, []);

  // Filter dropdown list by query (broker name OR server name). Empty query → first 60 items.
  const filteredServers = (() => {
    const q = serverQuery.trim().toLowerCase();
    if (!q) return brokerList.slice(0, 60);
    return brokerList.filter(b =>
      b.broker.toLowerCase().includes(q) ||
      b.server.toLowerCase().includes(q)
    ).slice(0, 60);
  })();

  // v1.1 — Account-size scaling preview
  // Exactly mirrors what the bot will do live:
  //   risk_tier → risk % of balance → $ risked per trade → approx lot size
  //   (XAUUSD 1 lot ≈ $100/pip; SL is ~3-6 pips ATR-based on M5)
  const riskPctMap = { conservative: 0.6, balanced: 1.2, aggressive: 2.0 };
  const tier = form.risk_tier || "balanced";
  const riskPct = riskPctMap[tier];
  const riskUSD = (simBalance * riskPct) / 100;
  const assumedSLpips = 4.0; // typical M5 2.5× ATR SL in pips on XAUUSD
  const pipValuePerLot = 100; // XAUUSD standard contract = $100 per 1-pip on 1.0 lot
  const lotSize = riskUSD / (assumedSLpips * pipValuePerLot);

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMsg(""); setLoading(true);
    try {
      const res = await cloudAxios.post(`/cloud/mt5/connect`, form);
      setMsg(res.data.message); onRefresh();
    } catch (e) { setErr(e.response?.data?.detail || "Connect failed"); }
    finally { setLoading(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Remove MT5 credentials from XauAi Cloud? Open trades will not be affected.")) return;
    setLoading(true);
    try { await cloudAxios.post(`/cloud/mt5/disconnect`); onRefresh(); setMsg("Credentials removed."); }
    catch (e) { setErr(e.response?.data?.detail || "Failed"); }
    finally { setLoading(false); }
  };

  const [refreshing, setRefreshing] = useState(false);
  const [executorStatus, setExecutorStatus] = useState({ online: null, total: null });

  // Poll public config every 30s to know if any worker is online
  useEffect(() => {
    let alive = true;
    const tick = () => {
      cloudAxios.get(`/cloud/config`).then(r => {
        if (!alive) return;
        setExecutorStatus({
          online: r.data?.executor_workers_online ?? 0,
          total:  r.data?.executor_workers_total  ?? 0,
        });
      }).catch(()=>{});
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const refreshBalance = async () => {
    if (refreshing) return;
    setRefreshing(true); setErr(""); setMsg("");
    try {
      const res = await cloudAxios.post(`/cloud/mt5/refresh-balance`);
      setMsg(res.data?.message || "Refresh requested.");
      // Poll the dashboard a few times so the user sees the new balance pop in
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 2000));
        await onRefresh();
      }
    } catch (e) { setErr(e.response?.data?.detail || "Refresh failed"); }
    finally { setRefreshing(false); }
  };

  return (
    <div className="max-w-2xl">
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6 mb-5 sm:mb-6" data-testid="connect-card">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-10 h-10 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center flex-none">
            <Shield className="w-5 h-5 text-[#D4AF37]" />
          </div>
          <div>
            <div className="font-bold mb-1">Secure credential handling</div>
            <div className="text-sm text-white/60 leading-relaxed">
              Your MT5 password is encrypted with Fernet-AES before it ever touches our database. Only our isolated executor agent can decrypt it to place trades. You can revoke anytime by clicking "Disconnect".
            </div>
          </div>
        </div>

        {/* Verification banner — shown for pending/rejected creds (above connected/form) */}
        {(verifyStatus === "pending" || verifyStatus === "rejected") && (
          <div className={`mb-4 p-4 rounded-xl border flex items-start gap-3 ${verifyStatus === "rejected" ? "bg-red-500/10 border-red-500/30" : "bg-yellow-500/10 border-yellow-500/30"}`} data-testid="verify-banner">
            {verifyStatus === "rejected"
              ? <XCircle className="w-5 h-5 text-red-400 flex-none mt-0.5" />
              : <Clock  className="w-5 h-5 text-yellow-400 flex-none mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className={`font-semibold ${verifyStatus === "rejected" ? "text-red-400" : "text-yellow-400"}`}>
                {verifyStatus === "rejected" ? "Broker login failed" : "Verifying broker login…"}
              </div>
              <div className="text-xs text-white/60 mt-1 leading-relaxed">
                {verifyStatus === "rejected" ? (
                  <>Our executor agent could not log in: <span className="font-mono text-red-300">{verifyError || "Invalid credentials"}</span>. Re-enter your details below.</>
                ) : executorStatus.online === 0 ? (
                  <>
                    <span className="text-yellow-300 font-semibold">Waiting for an executor agent to come online.</span> Your credentials are saved &amp; encrypted. The XauAi platform team is bringing the broker-execution VPS online — verification will run automatically the moment it connects (no action needed from you). Until then you'll see <b>simulated trades</b> in your Overview tab to show how the system would have traded your account.
                    <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded-md bg-black/40 border border-white/10 font-mono text-[10px]">
                      <span className="w-2 h-2 rounded-full bg-red-400" /> Executor offline ({executorStatus.total ?? 0} workers registered)
                    </div>
                  </>
                ) : (
                  <>
                    Executor agent is online — verification should complete in a few seconds. Refresh to update.
                    <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 rounded-md bg-black/40 border border-white/10 font-mono text-[10px]">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Executor online · {executorStatus.online} worker{executorStatus.online === 1 ? "" : "s"}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {connected ? (
          <div data-testid="mt5-connected-view">
            {/* v5.1.3: live executor status — without this user can't tell if cloud is actually connected to a worker */}
            {me.executor_online === false && (
              <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl mb-3" data-testid="executor-offline-banner">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-none mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-amber-300">No cloud worker is currently online</div>
                  <div className="text-xs text-amber-200/80 mt-1 leading-relaxed">
                    Your trades + balance updates are paused until a worker reconnects. The "Refresh" button won't fetch a new balance until then. We're notified — you don't need to do anything.
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl mb-4" data-testid="verified-banner">
              <CheckCircle2 className="w-5 h-5 text-green-400 flex-none mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-green-400 flex items-center gap-2 flex-wrap">
                  MT5 Account Connected &amp; Verified
                  {me.last_balance > 0 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/30 text-green-300" data-testid="verified-balance-pill">
                      {(me.account_currency || "USD") + " "}
                      {Number(me.last_balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={refreshBalance}
                    disabled={refreshing || me.executor_online === false}
                    title={me.executor_online === false ? "No worker online — refresh disabled" : "Force the worker to push a fresh balance/equity snapshot from your broker"}
                    className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-full bg-white/5 border border-white/15 text-white/70 hover:bg-[#D4AF37]/10 hover:border-[#D4AF37]/40 hover:text-[#D4AF37] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    data-testid="refresh-balance-btn"
                  >
                    {refreshing
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> SYNCING…</>
                      : <><RefreshCw className="w-3 h-3" /> REFRESH</>}
                  </button>
                </div>
                <div className="text-xs text-white/60 mt-1 leading-relaxed">
                  <span className="font-mono text-white/80">{me.broker_server || "—"}</span>
                  {" · "}Login <span className="font-mono text-white/80">{me.mt5_login || "—"}</span>
                  {" · "}Risk <span className="capitalize text-white/80">{me.risk_tier || "balanced"}</span>
                </div>
                {me.last_balance > 0 && (
                  <div className="text-[11px] text-white/50 mt-1.5 flex items-center gap-3 flex-wrap">
                    <span>Balance: <span className="font-mono text-white/80">{(me.account_currency || "$")} {Number(me.last_balance).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</span></span>
                    {me.last_equity > 0 && me.last_equity !== me.last_balance && (
                      <span>Equity: <span className="font-mono text-white/80">{(me.account_currency || "$")} {Number(me.last_equity).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</span></span>
                    )}
                    {me.last_balance_updated_at && (
                      <span className="text-white/40" data-testid="last-balance-update">
                        updated {relativeTime(me.last_balance_updated_at)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Live scaling on their current balance + current tier */}
            <div className="bg-black/40 border border-[#D4AF37]/20 rounded-xl p-4 mb-4" data-testid="live-scaling">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="w-4 h-4 text-[#D4AF37]" />
                <div className="text-xs font-mono tracking-widest text-[#D4AF37]">LIVE SCALING ON YOUR ACCOUNT</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[9px] font-mono tracking-widest text-white/40 mb-1">BALANCE</div>
                  <div className="text-base font-bold font-mono text-white">${(me.last_balance || 0).toFixed(0)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[9px] font-mono tracking-widest text-white/40 mb-1">RISK/TRADE</div>
                  <div className="text-base font-bold font-mono text-[#D4AF37]">{riskPctMap[me.risk_tier || "balanced"]}%</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[9px] font-mono tracking-widest text-white/40 mb-1">$ RISKED</div>
                  <div className="text-base font-bold font-mono">${(((me.last_balance||0)*riskPctMap[me.risk_tier||"balanced"])/100).toFixed(0)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[9px] font-mono tracking-widest text-white/40 mb-1">BASKET ARMS AT</div>
                  <div className="text-base font-bold font-mono text-green-400">${((me.last_balance||0)*0.02).toFixed(0)}</div>
                </div>
              </div>
              {!me.last_balance && <div className="text-[11px] text-white/40 mt-2">Worker agent will sync your balance within 60s after first connection.</div>}
            </div>

            <button onClick={disconnect} disabled={loading} className="w-full py-3 border border-red-500/30 text-red-400 rounded-xl hover:bg-red-500/10 transition-colors disabled:opacity-50" data-testid="disconnect-button">
              Disconnect MT5 account
            </button>
          </div>
        ) : verifyStatus === "pending" && me.broker_server ? (
          <div data-testid="mt5-pending-view">
            <div className="bg-black/40 border border-yellow-500/20 rounded-xl p-4 mb-4">
              <div className="text-xs font-mono tracking-widest text-white/40 mb-2">CREDENTIALS ON FILE (encrypted)</div>
              <div className="text-sm text-white/80">
                <span className="text-white/40">Broker:</span> <span className="font-mono">{me.broker_server}</span><br/>
                <span className="text-white/40">Login:</span> <span className="font-mono">{me.mt5_login || "—"}</span><br/>
                <span className="text-white/40">Risk tier:</span> <span className="font-mono capitalize">{me.risk_tier || "balanced"}</span>
              </div>
            </div>
            <button onClick={disconnect} disabled={loading} className="w-full py-3 border border-red-500/30 text-red-400 rounded-xl hover:bg-red-500/10 transition-colors disabled:opacity-50" data-testid="cancel-pending-button">
              Cancel &amp; remove credentials
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" data-testid="mt5-connect-form">
            {/* BROKER SERVER — searchable like MT5's broker picker */}
            <div className="relative">
              <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">BROKER SERVER</label>
              {!customServer ? (
                <>
                  <input
                    type="text"
                    value={form.broker_server || serverQuery}
                    onChange={e => { setServerQuery(e.target.value); setForm({ ...form, broker_server: "" }); setServerDropOpen(true); }}
                    onFocus={() => setServerDropOpen(true)}
                    onBlur={() => setTimeout(() => setServerDropOpen(false), 150)}
                    placeholder="Search broker (e.g. Exness, IC Markets, FBS...)"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none"
                    data-testid="mt5-server-search"
                    autoComplete="off"
                  />
                  {serverDropOpen && (
                    <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-auto bg-[#111] border border-[#D4AF37]/30 rounded-xl shadow-2xl" data-testid="server-dropdown">
                      <div className="px-4 py-2 text-[10px] font-mono tracking-widest text-white/40 border-b border-white/5 sticky top-0 bg-[#111]">
                        {filteredServers.length} {filteredServers.length === 1 ? "MATCH" : "MATCHES"} · {brokerList.length} BROKERS
                      </div>
                      {filteredServers.length === 0 && (
                        <div className="px-4 py-3 text-sm text-white/50">
                          No match for "<span className="font-mono text-white/70">{serverQuery}</span>". Try fewer letters or
                          <button type="button"
                                  onMouseDown={() => { setCustomServer(true); setServerDropOpen(false); setServerQuery(""); setForm({ ...form, broker_server: "" }); }}
                                  className="ml-1 text-[#D4AF37] hover:underline" data-testid="server-empty-custom">type custom →</button>
                        </div>
                      )}
                      {filteredServers.map(b => (
                        <button
                          key={b.server}
                          type="button"
                          onMouseDown={() => { setForm({ ...form, broker_server: b.server }); setServerQuery(b.server); setServerDropOpen(false); }}
                          data-testid={`server-option-${b.server}`}
                          className="w-full text-left px-4 py-2.5 hover:bg-[#D4AF37]/10 border-b border-white/5 flex items-center justify-between gap-3"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="font-mono text-sm truncate">{b.server}</span>
                            <span className="text-[10px] text-white/40">{b.broker}</span>
                          </div>
                          <span className={`flex-none text-[10px] font-mono px-2 py-0.5 rounded-full ${b.type === "live" || b.type === "real" ? "bg-green-500/15 text-green-400 border border-green-500/30" : "bg-blue-500/15 text-blue-400 border border-blue-500/30"}`}>
                            {b.type === "live" || b.type === "real" ? "LIVE" : "DEMO"}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onMouseDown={() => { setCustomServer(true); setServerDropOpen(false); setServerQuery(""); setForm({ ...form, broker_server: "" }); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-[#D4AF37]/10 text-[#D4AF37] text-sm border-t border-[#D4AF37]/20 sticky bottom-0 bg-[#111]"
                        data-testid="server-option-custom"
                      >
                        + My broker isn't listed (type custom)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex gap-2">
                  <input
                    required
                    value={form.broker_server}
                    onChange={e => setForm({ ...form, broker_server: e.target.value })}
                    placeholder="Type exact server name (e.g. YourBroker-Live)"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none"
                    data-testid="mt5-server-custom"
                    autoComplete="off"
                  />
                  <button type="button" onClick={() => { setCustomServer(false); setForm({ ...form, broker_server: "" }); }}
                          className="px-3 text-xs text-white/50 hover:text-white border border-white/10 rounded-xl"
                          data-testid="server-back-search">Back</button>
                </div>
              )}
              <div className="text-xs text-white/30 mt-1">
                Find this in MT5 → Tools → Options → Server. Format must be <span className="font-mono text-white/50">Broker-Live</span> or <span className="font-mono text-white/50">Broker-Demo</span>.
              </div>
            </div>
            <div>
              <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">MT5 LOGIN (ACCOUNT NUMBER)</label>
              <input required value={form.mt5_login} onChange={e=>setForm({...form, mt5_login: e.target.value})} placeholder="e.g. 10023456"
                     className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="mt5-login" />
            </div>
            <div>
              <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">MT5 PASSWORD</label>
              <input type="password" required value={form.mt5_password} onChange={e=>setForm({...form, mt5_password: e.target.value})}
                     className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="mt5-password" />
              <div className="text-xs text-white/30 mt-1">Encrypted with Fernet-AES before storage. Never logged.</div>
            </div>
            <div>
              <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">RISK TIER</label>
              <div className="grid grid-cols-3 gap-2">
                {["conservative","balanced","aggressive"].map(t=>(
                  <button key={t} type="button" onClick={()=>setForm({...form, risk_tier: t})} data-testid={`risk-${t}`}
                          className={`py-2.5 rounded-xl border transition-colors capitalize text-sm ${form.risk_tier===t?"bg-[#D4AF37]/10 border-[#D4AF37]/40 text-[#D4AF37]":"bg-white/5 border-white/10 text-white/70 hover:bg-white/10"}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="text-xs text-white/30 mt-1">Conservative: 0.6% / Balanced: 1.2% / Aggressive: 2% risk per trade</div>
            </div>

            {/* v1.1 — Live account-size scaling preview */}
            <div className="bg-black/40 border border-[#D4AF37]/20 rounded-xl p-4" data-testid="scaling-preview">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="w-4 h-4 text-[#D4AF37]" />
                <div className="text-xs font-mono tracking-widest text-[#D4AF37]">ACCOUNT-SIZE SCALING PREVIEW</div>
              </div>
              <div className="mb-3">
                <label className="block text-[10px] font-mono tracking-widest text-white/50 mb-1">SIMULATED BALANCE (USD)</label>
                <input type="number" value={simBalance} min={100} step={100}
                       onChange={e=>setSimBalance(Math.max(100, Number(e.target.value)||0))}
                       className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 font-mono text-sm focus:border-[#D4AF37] outline-none"
                       data-testid="sim-balance-input" />
                <div className="text-[10px] text-white/30 mt-1">Plug in your real balance to see how trades will size on YOUR account</div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white/5 rounded-lg p-3" data-testid="preview-risk-pct">
                  <div className="text-[9px] font-mono tracking-widest text-white/40 mb-1">RISK PER TRADE</div>
                  <div className="text-lg font-bold font-mono text-[#D4AF37]">{riskPct}%</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="preview-risk-usd">
                  <div className="text-[9px] font-mono tracking-widest text-white/40 mb-1">$ RISKED</div>
                  <div className="text-lg font-bold font-mono text-white">${riskUSD.toFixed(0)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3" data-testid="preview-lot-size">
                  <div className="text-[9px] font-mono tracking-widest text-white/40 mb-1">LOT SIZE (APPROX)</div>
                  <div className="text-lg font-bold font-mono text-green-400">{lotSize.toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/5 space-y-1 text-[11px] text-white/50">
                <div>• At <span className="font-mono text-[#D4AF37]">+1R</span> profit: SL locks at <span className="font-mono">+${(riskUSD*0.2).toFixed(0)}</span> (breakeven protection)</div>
                <div>• At <span className="font-mono text-[#D4AF37]">+3R</span> profit: 30% closes automatically (<span className="font-mono">+${(riskUSD*3*0.3).toFixed(0)}</span> banked)</div>
                <div>• Basket lock arms at <span className="font-mono">${(simBalance*0.02).toFixed(0)}</span> floating (2% of balance)</div>
                <div>• Hard cap: max loss per single trade = <span className="font-mono">${(simBalance*0.03).toFixed(0)}</span> (3% of balance)</div>
              </div>
            </div>
            {msg && <div className="text-green-400 text-sm" data-testid="connect-msg">{msg}</div>}
            {err && <div className="text-red-400 text-sm" data-testid="connect-err">{err}</div>}
            <button type="submit" disabled={loading} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50 flex items-center justify-center gap-2" data-testid="connect-submit">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Connecting…" : "Connect MT5 account →"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function BillingTab({ me, onRefresh }) {
  const [cfg, setCfg] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState("pro");
  const [method, setMethod] = useState("crypto");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [proofImage, setProofImage] = useState("");   // base64 data URL
  const [proofName, setProofName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [payments, setPayments] = useState([]);
  // v5.1.4: manual currency picker — production CDN may not expose CF-IPCountry,
  // so we let the user pick. Persists in localStorage so they only set it once.
  const [chosenCurrency, setChosenCurrency] = useState(
    () => localStorage.getItem("xauai_pref_currency") || "");

  useEffect(() => {
    cloudAxios.get(`/cloud/config`).then(r => {
      setCfg(r.data);
      if (!chosenCurrency && r.data?.user_currency) setChosenCurrency(r.data.user_currency);
    }).catch(() => {});
    cloudAxios.get(`/cloud/payments/my`).then(r => setPayments(r.data.payments || [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCurrency = (ccy) => {
    setChosenCurrency(ccy);
    if (ccy) localStorage.setItem("xauai_pref_currency", ccy);
    else     localStorage.removeItem("xauai_pref_currency");
  };

  const copy = (txt, key) => { navigator.clipboard.writeText(txt); setCopied(key); setTimeout(()=>setCopied(""),2000); };

  const onProofPick = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setErr("Proof image must be under 5 MB"); return; }
    const r = new FileReader();
    r.onload = () => { setProofImage(r.result); setProofName(f.name); setErr(""); };
    r.readAsDataURL(f);
  };

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMsg(""); setLoading(true);
    try {
      const plan = cfg.plans[selectedPlan];
      const ccy = chosenCurrency || cfg.user_currency || "USD";
      const rate = (cfg.fx_rates && cfg.fx_rates[ccy]) || 1;
      const localAmount = +(plan.price_usd * rate).toFixed(2);
      const res = await cloudAxios.post(`/cloud/payments/submit`, {
        plan: selectedPlan,
        method,
        amount_usd: plan.price_usd,
        reference,
        notes,
        proof_image: method === "bank" ? proofImage : "",
        paid_currency: method === "bank" ? ccy : "USD",
        paid_amount_local: method === "bank" ? localAmount : plan.price_usd,
      });
      setMsg(res.data.message);
      setReference(""); setNotes(""); setProofImage(""); setProofName("");
      const p = await cloudAxios.get(`/cloud/payments/my`); setPayments(p.data.payments || []);
      onRefresh();
    } catch (e) { setErr(e.response?.data?.detail || "Submit failed"); }
    finally { setLoading(false); }
  };

  if (!cfg) return <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />;

  const userCcy = chosenCurrency || cfg.user_currency || "USD";
  const fxRate = (cfg.fx_rates && cfg.fx_rates[userCcy]) || 1;
  const planPrice = cfg.plans[selectedPlan]?.price_usd || 0;
  const localPrice = (planPrice * fxRate).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const showLocal = method === "bank" && userCcy !== "USD";
  const fxOptions = Object.keys(cfg.fx_rates || { USD: 1 });

  return (
    <div className="space-y-6">
      {/* Current subscription status */}
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6" data-testid="subscription-status">
        <div className="text-xs font-mono tracking-widest text-white/40 mb-2">CURRENT PLAN</div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-2xl font-bold capitalize">{me.plan || "—"} · <span className={`text-sm font-mono ${me.status==="active"?"text-green-400":"text-[#D4AF37]"}`}>{me.status?.toUpperCase()}</span></div>
            <div className="text-sm text-white/60 mt-1">{me.days_remaining != null ? `${me.days_remaining} day(s) remaining` : "—"}</div>
          </div>
        </div>
      </div>

      {/* Plan selection */}
      <div>
        <div className="text-xs font-mono tracking-widest text-white/40 mb-3">SELECT PLAN</div>
        <div className="grid md:grid-cols-2 gap-4">
          {Object.entries(cfg.plans).map(([id, p]) => (
            <button key={id} onClick={()=>setSelectedPlan(id)} data-testid={`select-plan-${id}`}
                    className={`text-left p-6 rounded-2xl border transition-all ${selectedPlan===id ? "bg-[#D4AF37]/10 border-[#D4AF37]/40" : "bg-white/5 border-white/10 hover:bg-white/10"}`}>
              <div className="text-xs font-mono tracking-widest text-white/50 mb-1">{p.name.toUpperCase()}</div>
              <div className="flex items-baseline gap-1 mb-2"><span className="text-3xl font-bold">${p.price_usd}</span><span className="text-white/50 text-sm">/mo</span></div>
              <div className="text-sm text-white/60">{p.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Payment method + instructions */}
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6" data-testid="payment-instructions">
        <div className="text-xs font-mono tracking-widest text-white/40 mb-3">PAYMENT METHOD</div>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {[{id:"crypto",label:"Crypto"},{id:"bank",label:"Bank transfer"}].map(m => (
            <button key={m.id} type="button" onClick={()=>setMethod(m.id)} data-testid={`method-${m.id}`}
                    className={`py-2.5 rounded-xl border transition-colors text-sm ${method===m.id?"bg-[#D4AF37]/10 border-[#D4AF37]/40 text-[#D4AF37]":"bg-white/5 border-white/10 text-white/70 hover:bg-white/10"}`}>
              {m.label}
            </button>
          ))}
        </div>

        {method === "crypto" && (
          <div className="space-y-3" data-testid="crypto-details">
            {cfg.crypto_wallets.length === 0 ? (
              <div className="text-sm text-white/50 p-4 bg-white/5 rounded-xl">Crypto payment addresses are being configured. Please try bank transfer or contact support.</div>
            ) : cfg.crypto_wallets.map((w,i)=>(
              <div key={i} className="p-4 bg-black/40 border border-white/5 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-mono tracking-widest text-white/50">{w.asset} · {w.network}</div>
                  <button type="button" onClick={()=>copy(w.address, `w${i}`)} className="text-xs text-[#D4AF37] flex items-center gap-1" data-testid={`copy-wallet-${i}`}>
                    {copied===`w${i}` ? "Copied!" : <>Copy <Copy className="w-3 h-3" /></>}
                  </button>
                </div>
                <div className="font-mono text-sm break-all">{w.address}</div>
              </div>
            ))}
            <div className="text-sm text-white/60 p-3 bg-[#D4AF37]/5 border border-[#D4AF37]/20 rounded-xl">
              Send exactly <span className="font-mono text-[#D4AF37]">${planPrice}</span> worth of crypto to the address above, then submit the transaction hash below.
            </div>
          </div>
        )}
        {method === "bank" && (
          <div className="space-y-3" data-testid="bank-details">
            {/* v5.1.4: manual currency picker — guarantees FX conversion works even when CDN headers don't expose country */}
            <div className="p-3 bg-white/[0.03] border border-white/10 rounded-xl" data-testid="currency-picker-row">
              <label className="text-[10px] font-mono tracking-widest text-white/50 mb-1.5 flex items-center gap-2">
                YOUR CURRENCY
                {chosenCurrency && chosenCurrency !== (cfg.user_currency || "USD") && (
                  <span className="text-[9px] font-normal text-[#D4AF37] normal-case tracking-normal">(manually selected)</span>
                )}
              </label>
              <select
                value={userCcy}
                onChange={(e) => setCurrency(e.target.value)}
                data-testid="currency-picker"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono focus:border-[#D4AF37] outline-none"
              >
                {fxOptions.map((c) => (
                  <option key={c} value={c}>{c}{c === "USD" ? "" : ` — pay ${c} ${(planPrice * (cfg.fx_rates[c] || 1)).toLocaleString(undefined,{maximumFractionDigits:2})}`}</option>
                ))}
              </select>
              <div className="text-[10px] text-white/40 mt-1.5">Pick your bank's currency to see the exact local-currency amount to transfer.</div>
            </div>
            {showLocal && (
              <div className="p-4 bg-[#D4AF37]/5 border border-[#D4AF37]/30 rounded-xl text-sm" data-testid="fx-conversion">
                <div className="text-xs font-mono tracking-widest text-[#D4AF37] mb-1">PAY THIS AMOUNT</div>
                <div className="text-2xl font-bold">{userCcy} {localPrice}</div>
                <div className="text-xs text-white/50 mt-1">≈ ${planPrice} USD · rate 1 USD = {fxRate} {userCcy}</div>
              </div>
            )}
            {cfg.bank_accounts.length === 0 ? (
              <div className="text-sm text-white/50 p-4 bg-white/5 rounded-xl">Bank accounts are being configured. Please try crypto or contact support.</div>
            ) : cfg.bank_accounts.map((b,i)=>(
              <div key={i} className="p-4 bg-black/40 border border-white/5 rounded-xl text-sm space-y-1" data-testid={`bank-row-${i}`}>
                <div><span className="text-white/40">Bank:</span> <span className="font-semibold">{b.bank_name}</span></div>
                <div><span className="text-white/40">Account name:</span> <span className="font-mono">{b.account_name}</span></div>
                <div><span className="text-white/40">Account #:</span> <span className="font-mono">{b.account_number}</span></div>
                {b.swift && <div><span className="text-white/40">SWIFT:</span> <span className="font-mono">{b.swift}</span></div>}
                {b.country && <div><span className="text-white/40">Country:</span> {b.country}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit payment proof */}
      <form onSubmit={submit} className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6" data-testid="payment-submit-form">
        <div className="text-xs font-mono tracking-widest text-white/40 mb-4">SUBMIT PAYMENT CONFIRMATION</div>
        <div className="text-sm text-white/60 mb-4">After you've sent payment, submit the transaction reference{method==="bank"?" plus a screenshot of the transfer":""} below. Admin verifies within 24 hours and activates your subscription.</div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">TRANSACTION REFERENCE</label>
            <input value={reference} onChange={e=>setReference(e.target.value)} required placeholder={method==="crypto"?"transaction hash":"bank reference / receipt #"}
                   className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none font-mono text-sm" data-testid="payment-reference" />
          </div>
          {method === "bank" && (
            <div>
              <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">PROOF OF PAYMENT (SCREENSHOT) *</label>
              <input type="file" accept="image/*" onChange={onProofPick} required
                     className="w-full text-sm text-white/70 file:bg-[#D4AF37]/10 file:text-[#D4AF37] file:border-0 file:rounded-lg file:px-4 file:py-2 file:mr-3 file:font-semibold file:cursor-pointer"
                     data-testid="payment-proof-upload" />
              {proofImage && (
                <div className="mt-2 flex items-center gap-3" data-testid="proof-preview">
                  <img src={proofImage} alt="proof" className="h-20 w-20 object-cover rounded-lg border border-white/10" />
                  <div className="text-xs text-white/60 font-mono">{proofName}</div>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">NOTES (OPTIONAL)</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Anything we should know"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none text-sm" data-testid="payment-notes" />
          </div>
          {msg && <div className="text-green-400 text-sm" data-testid="pay-msg">{msg}</div>}
          {err && <div className="text-red-400 text-sm" data-testid="pay-err">{err}</div>}
          <button type="submit" disabled={loading || (method==="bank" && !proofImage)} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50 flex items-center justify-center gap-2" data-testid="payment-submit">
            <CreditCard className="w-4 h-4" /> {loading ? "Submitting…" : `Submit ${cfg.plans[selectedPlan].name} payment ($${cfg.plans[selectedPlan].price_usd}${showLocal?` ≈ ${userCcy} ${localPrice}`:""})`}
          </button>
        </div>
      </form>

      {/* Payment history */}
      {payments.length > 0 && (
        <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-6" data-testid="payment-history">
          <div className="text-xs font-mono tracking-widest text-white/40 mb-4">PAYMENT HISTORY</div>
          <div className="space-y-2">
            {payments.map((p,i)=>(
              <div key={p.id} className="flex items-center justify-between p-3 bg-black/30 rounded-xl text-sm" data-testid={`history-row-${i}`}>
                <div>
                  <div className="font-semibold capitalize">{p.plan} · {p.method}</div>
                  <div className="text-xs text-white/40 font-mono">{p.reference}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold">${p.amount_usd}</div>
                  <div className={`text-xs font-mono mt-0.5 ${p.status==="approved"?"text-green-400":p.status==="rejected"?"text-red-400":"text-[#D4AF37]"}`}>
                    {p.status==="pending"?<><Clock className="w-3 h-3 inline mr-1" />PENDING</>:p.status.toUpperCase()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
