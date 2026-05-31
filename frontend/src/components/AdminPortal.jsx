import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import {
  Key, GearSix, SignOut, ShieldCheck, Copy, Check, Trash, Plus,
  UserCircle, CurrencyNgn, Envelope, Lock, Eye, EyeSlash, ArrowLeft,
  FloppyDisk, ArrowCounterClockwise, ChartBar, Lightning, Flame,
  House, TrendUp, TrendDown, Pulse,
} from "@phosphor-icons/react";

const ax = axios.create({ withCredentials: true });

export default function AdminPortal({ api }) {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");
  const [admin, setAdmin] = useState(null);
  const [tab, setTab] = useState("dashboard");

  const checkAuth = useCallback(async () => {
    if (!token) return;
    try {
      const res = await ax.get(`${api}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      setAdmin(res.data);
    } catch {
      setToken(""); localStorage.removeItem("admin_token");
    }
  }, [api, token]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const handleLogin = (t) => { setToken(t); localStorage.setItem("admin_token", t); };
  const handleLogout = () => { setToken(""); setAdmin(null); localStorage.removeItem("admin_token"); ax.post(`${api}/auth/logout`).catch(() => {}); };

  if (!admin) return <LoginPage api={api} onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-background" data-testid="admin-portal">
      {/* Admin Header */}
      <header className="sticky top-0 z-50 bg-[hsl(0,0%,4%)] text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 md:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-[hsl(43,74%,49%)] flex items-center justify-center">
              <span className="font-mono text-xs font-bold text-black">AU</span>
            </div>
            <span className="font-heading font-bold text-sm">XauAI Sniper</span>
            <span className="text-xs bg-white/10 px-2 py-0.5 font-mono">ADMIN</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-white/50">{admin.email}</span>
            <a href="/" className="text-xs text-white/40 hover:text-white flex items-center gap-1"><ArrowLeft size={12} /> Public Site</a>
            <button onClick={handleLogout} data-testid="logout-btn" className="text-xs text-white/40 hover:text-white flex items-center gap-1"><SignOut size={12} /> Logout</button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 md:px-8 flex gap-0">
          {[
            { id: "dashboard", label: "DASHBOARD", icon: House },
            { id: "pins", label: "LICENSES", icon: Key },
            { id: "cloud", label: "XAUAI CLOUD", icon: ChartBar },
            { id: "settings", label: "SETTINGS", icon: GearSix },
            { id: "configurator", label: "EA CONFIG", icon: ChartBar },
            { id: "transactions", label: "PAYMENTS", icon: CurrencyNgn },
            { id: "account", label: "ACCOUNT", icon: UserCircle },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`admin-tab-${t.id}`}
              className={`px-5 py-3 text-xs font-bold tracking-[0.1em] flex items-center gap-2 border-b-2 transition-colors ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <t.icon size={14} weight={tab === t.id ? "fill" : "regular"} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-8 py-8">
        {tab === "dashboard" && <DashboardTab api={api} token={token} />}
        {tab === "pins" && <PinsTab api={api} token={token} />}
        {tab === "cloud" && <CloudAdminTab api={api} token={token} />}
        {tab === "settings" && <SettingsTab api={api} token={token} />}
        {tab === "configurator" && <ConfigTab api={api} token={token} />}
        {tab === "transactions" && <TransactionsTab api={api} token={token} />}
        {tab === "account" && <AccountTab api={api} token={token} admin={admin} onLogin={handleLogin} onLogout={handleLogout} />}
      </div>
    </div>
  );
}

// --- LOGIN PAGE ---
function LoginPage({ api, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const res = await ax.post(`${api}/auth/login`, { email, password });
      onLogin(res.data.token);
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[hsl(0,0%,4%)] flex items-center justify-center p-6" data-testid="admin-login-page">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-[hsl(43,74%,49%)] flex items-center justify-center mx-auto mb-4">
            <span className="font-mono text-lg font-bold text-black">AU</span>
          </div>
          <h1 className="font-heading text-2xl font-bold text-white">XauAI Admin</h1>
          <p className="text-sm text-white/40 mt-1">XauAI Sniper EA Management</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white/5 border border-white/10 p-6 space-y-4">
          <div>
            <label className="text-sm text-white/60 block mb-1">Email</label>
            <div className="relative">
              <Envelope size={16} className="absolute left-3 top-3 text-white/30" />
              <input data-testid="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@aisniper.com"
                className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/20 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(43,74%,49%)]" />
            </div>
          </div>
          <div>
            <label className="text-sm text-white/60 block mb-1">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-3 text-white/30" />
              <input data-testid="admin-password" type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password"
                className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/20 text-white text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(43,74%,49%)]" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-3 text-white/30 hover:text-white">
                {showPw ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {error && <div className="text-[hsl(348,83%,47%)] text-sm" data-testid="login-error">{error}</div>}
          <button type="submit" disabled={loading} data-testid="admin-login-btn"
            className="w-full py-3 bg-[hsl(43,74%,49%)] text-black font-bold text-sm disabled:opacity-50">
            {loading ? "LOGGING IN..." : "LOGIN"}
          </button>
        </form>
        <div className="text-center mt-4">
          <a href="/" className="text-xs text-white/30 hover:text-white/60">Back to public site</a>
        </div>
      </div>
    </div>
  );
}


// --- DASHBOARD TAB ---
function DashboardTab({ api, token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const h = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    ax.get(`${api}/admin/dashboard`, h).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [api, token]);

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading dashboard...</div>;
  if (!data) return <div className="text-center py-12 text-muted-foreground">Failed to load dashboard</div>;

  const b = data.bots;
  const rev = data.revenue;
  const perf = data.performance;

  return (
    <div data-testid="admin-dashboard-tab">
      {/* Top Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="BOTS SOLD" value={b.total_sold} sub={`${b.sold_via_payment} paid | ${b.free_generated} free`} color="text-foreground" testId="stat-total-sold" />
        <StatCard label="ACTIVELY TRADING" value={b.actively_trading} sub={`${b.purchased_not_activated} not yet activated`} color="text-[hsl(142,71%,45%)]" testId="stat-active" />
        <StatCard label="REVOKED" value={b.revoked} color="text-[hsl(348,83%,47%)]" testId="stat-revoked" />
        <StatCard label="REVENUE" value={rev.formatted_revenue} sub={`${rev.successful_payments} payments`} color="text-primary" testId="stat-revenue" />
      </div>

      {/* Performance Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Win/Loss */}
        <div className="border border-border bg-card" data-testid="perf-overview">
          <div className="px-5 py-3 border-b border-border bg-muted/30">
            <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground flex items-center gap-2"><Pulse size={14} /> GLOBAL PERFORMANCE (All Users)</h4>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">TOTAL TRADES</div>
                <div className="font-mono text-2xl font-bold">{perf.total_trades}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">WIN RATE</div>
                <div className={`font-mono text-2xl font-bold ${perf.win_rate >= 60 ? "text-[hsl(142,71%,45%)]" : perf.win_rate >= 45 ? "text-primary" : "text-[hsl(348,83%,47%)]"}`}>
                  {perf.win_rate}%
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">ACTIVE TRADERS</div>
                <div className="font-mono text-2xl font-bold text-primary">{perf.active_traders}</div>
              </div>
            </div>
            {/* Win/Loss bar */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[hsl(142,71%,45%)]">{perf.wins} wins</span>
                <span className="text-[hsl(348,83%,47%)]">{perf.losses} losses</span>
              </div>
              <div className="h-3 bg-muted flex overflow-hidden">
                <div className="bg-[hsl(142,71%,45%)] transition-all" style={{ width: `${perf.total_trades > 0 ? (perf.wins / perf.total_trades * 100) : 0}%` }} />
                <div className="bg-[hsl(348,83%,47%)] transition-all" style={{ width: `${perf.total_trades > 0 ? (perf.losses / perf.total_trades * 100) : 0}%` }} />
              </div>
            </div>
            {/* Pips */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">PROFIT PIPS</div>
                <div className="font-mono text-lg font-bold text-[hsl(142,71%,45%)]">+{perf.total_profit_pips}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">LOSS PIPS</div>
                <div className="font-mono text-lg font-bold text-[hsl(348,83%,47%)]">-{perf.total_loss_pips}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">NET PIPS</div>
                <div className={`font-mono text-lg font-bold ${perf.net_pips >= 0 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(348,83%,47%)]"}`}>
                  {perf.net_pips >= 0 ? "+" : ""}{perf.net_pips}
                </div>
              </div>
            </div>
            {perf.profit_factor > 0 && (
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                Profit Factor: <span className="font-mono font-bold text-foreground">{perf.profit_factor}</span>
              </div>
            )}
          </div>
        </div>

        {/* Strategy Breakdown */}
        <div className="border border-border bg-card" data-testid="strategy-performance">
          <div className="px-5 py-3 border-b border-border bg-muted/30">
            <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">STRATEGY PERFORMANCE</h4>
          </div>
          <div className="divide-y divide-border">
            {Object.entries(data.strategies || {}).map(([name, s]) => (
              <div key={name} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold">{name}</span>
                  <span className={`font-mono text-sm font-bold ${s.win_rate >= 60 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(348,83%,47%)]"}`}>
                    {s.win_rate}% WR
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">{s.trades} trades</span>
                  <span className="text-[hsl(142,71%,45%)]">+{s.profit_pips} pips</span>
                  <span className="text-[hsl(348,83%,47%)]">-{s.loss_pips} pips</span>
                  <span className={`font-bold ${s.net_pips >= 0 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(348,83%,47%)]"}`}>
                    Net: {s.net_pips >= 0 ? "+" : ""}{s.net_pips}
                  </span>
                </div>
                <div className="mt-2 h-1.5 bg-muted">
                  <div className="h-full bg-primary transition-all" style={{ width: `${s.win_rate}%` }} />
                </div>
              </div>
            ))}
            {Object.keys(data.strategies || {}).length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No strategy data yet. As users trade, data appears here.</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Trades */}
      <div className="border border-border bg-card" data-testid="recent-trades">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">RECENT TRADES (Global)</h4>
        </div>
        {data.recent_trades?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">RESULT</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">STRATEGY</th>
                <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground">PIPS</th>
                <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground">CONFIDENCE</th>
                <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">DATE</th>
              </tr></thead>
              <tbody>{data.recent_trades.map((t, i) => (
                <tr key={`trade-${t.strategy_name}-${i}`} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold ${t.was_winner ? "bg-[hsl(142,71%,45%)]/10 text-[hsl(142,71%,45%)]" : "bg-[hsl(348,83%,47%)]/10 text-[hsl(348,83%,47%)]"}`}>
                      {t.was_winner ? <TrendUp size={10} /> : <TrendDown size={10} />}
                      {t.was_winner ? "WIN" : "LOSS"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono">{t.strategy_name}</td>
                  <td className={`px-4 py-2 text-right font-mono font-bold ${t.profit_pips >= 0 ? "text-[hsl(142,71%,45%)]" : "text-[hsl(348,83%,47%)]"}`}>
                    {t.profit_pips >= 0 ? "+" : ""}{t.profit_pips?.toFixed(1)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{t.confidence}%</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{t.created_at?.split("T")[0]}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">No trades recorded yet. As users activate and trade, results will appear here.</div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, testId }) {
  return (
    <div className="border border-border bg-card p-4" data-testid={testId}>
      <div className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground mb-1">{label}</div>
      <div className={`font-mono text-2xl font-bold ${color || "text-foreground"}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

// --- PINS TAB ---
function PinsTab({ api, token }) {
  const [pins, setPins] = useState([]);
  const [stats, setStats] = useState(null);
  const [genCount, setGenCount] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [copiedPin, setCopiedPin] = useState(null);
  const [generating, setGenerating] = useState(false);
  const h = { headers: { Authorization: `Bearer ${token}` } };

  const fetch = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([ax.get(`${api}/admin/pins`, h), ax.get(`${api}/admin/pins/stats`, h)]);
      setPins(p.data.pins || []); setStats(s.data);
    } catch (err) { process.env.NODE_ENV === 'development' && console.error("Failed to fetch pins:", err); }
  }, [api, token]);

  useEffect(() => { fetch(); }, [fetch]);

  const generate = async () => {
    setGenerating(true);
    try { await ax.post(`${api}/admin/pins/generate`, { count: genCount, buyer_name: buyerName, buyer_email: buyerEmail, notes }, h); setBuyerName(""); setBuyerEmail(""); setNotes(""); await fetch(); } catch (err) { process.env.NODE_ENV === 'development' && console.error("Generate PIN failed:", err); } finally { setGenerating(false); }
  };
  const revoke = async (pin) => { await ax.put(`${api}/admin/pins/${pin}/revoke`, {}, h); fetch(); };
  const activate = async (pin) => { await ax.put(`${api}/admin/pins/${pin}/activate`, {}, h); fetch(); };
  const del = async (pin) => { await ax.delete(`${api}/admin/pins/${pin}`, h); fetch(); };
  const copy = (pin) => { navigator.clipboard.writeText(pin); setCopiedPin(pin); setTimeout(() => setCopiedPin(null), 2000); };

  return (
    <div data-testid="admin-pins-tab">
      {stats && (
        <div className="grid grid-cols-5 gap-0 border border-border mb-6" data-testid="admin-pin-stats">
          {[{l:"TOTAL",v:stats.total},{l:"ACTIVE",v:stats.active,c:"text-[hsl(142,71%,45%)]"},{l:"USED",v:stats.used,c:"text-primary"},{l:"UNUSED",v:stats.unused},{l:"REVOKED",v:stats.revoked,c:"text-[hsl(348,83%,47%)]"}].map((s,i) => (
            <div key={s.l} className={`p-4 ${i<4?"border-r border-border":""}`}><div className="text-[10px] font-bold tracking-[0.15em] text-muted-foreground mb-1">{s.l}</div><div className={`font-mono text-2xl font-bold ${s.c||"text-foreground"}`}>{s.v}</div></div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-border bg-card" data-testid="admin-gen-form">
          <div className="px-5 py-3 border-b border-border bg-muted/30"><h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">GENERATE FREE PINS</h4></div>
          <div className="p-5 space-y-3">
            <input data-testid="admin-pin-name" type="text" value={buyerName} onChange={e=>setBuyerName(e.target.value)} placeholder="Buyer Name" className="w-full px-3 py-2 border border-border bg-background text-sm" />
            <input data-testid="admin-pin-email" type="email" value={buyerEmail} onChange={e=>setBuyerEmail(e.target.value)} placeholder="Email" className="w-full px-3 py-2 border border-border bg-background text-sm" />
            <input type="text" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes" className="w-full px-3 py-2 border border-border bg-background text-sm" />
            <input type="number" min={1} max={50} value={genCount} onChange={e=>setGenCount(parseInt(e.target.value)||1)} className="w-full px-3 py-2 border border-border bg-background text-sm font-mono" />
            <button onClick={generate} disabled={generating} data-testid="admin-gen-btn" className="w-full px-4 py-3 bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 hover:-translate-y-[1px] transition-transform shadow-[2px_2px_0px_hsl(0,0%,4%)]">
              <Plus size={14} weight="bold" /> {generating ? "GENERATING..." : `GENERATE ${genCount} PIN${genCount>1?"S":""}`}
            </button>
          </div>
        </div>
        <div className="lg:col-span-2 border border-border bg-card" data-testid="admin-pin-list">
          <div className="px-5 py-3 border-b border-border bg-muted/30 flex justify-between"><h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground">ALL PINS</h4><span className="text-xs font-mono text-muted-foreground">{pins.length}</span></div>
          <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
            {pins.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No PINs yet</div> :
            pins.map(p => (
              <div key={p.pin} className="px-5 py-3 flex items-center gap-3" data-testid={`admin-pin-${p.pin}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5"><span className="font-mono text-sm font-bold">{p.pin}</span>
                    <button onClick={()=>copy(p.pin)} className="text-muted-foreground hover:text-foreground">{copiedPin===p.pin?<Check size={12} className="text-[hsl(142,71%,45%)]"/>:<Copy size={12}/>}</button></div>
                  <div className="text-xs text-muted-foreground flex gap-2">{p.buyer_name&&<span>{p.buyer_name}</span>}{p.buyer_email&&<span>{p.buyer_email}</span>}{p.payment_ref&&<span className="text-primary">PAID</span>}</div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  {p.is_used&&<span className="px-1.5 py-0.5 bg-primary/10 text-primary text-[9px] font-bold">ACTIVATED</span>}
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold ${p.is_active?"bg-[hsl(142,71%,45%)]/10 text-[hsl(142,71%,45%)]":"bg-[hsl(348,83%,47%)]/10 text-[hsl(348,83%,47%)]"}`}>{p.is_active?"ACTIVE":"REVOKED"}</span>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {p.is_active?<button onClick={()=>revoke(p.pin)} className="p-1 text-muted-foreground hover:text-[hsl(348,83%,47%)]" title="Revoke"><ShieldCheck size={14}/></button>:<button onClick={()=>activate(p.pin)} className="p-1 text-muted-foreground hover:text-[hsl(142,71%,45%)]" title="Activate"><ShieldCheck size={14}/></button>}
                  <button onClick={()=>del(p.pin)} className="p-1 text-muted-foreground hover:text-[hsl(348,83%,47%)]" title="Delete"><Trash size={14}/></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- SETTINGS TAB ---
function SettingsTab({ api, token }) {
  const [settings, setSettings] = useState(null);
  const [pk, setPk] = useState("");
  const [priceNaira, setPriceNaira] = useState(300000);
  const [smtpEmail, setSmtpEmail] = useState("");
  const [smtpPw, setSmtpPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const h = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    ax.get(`${api}/admin/settings`, h).then(r => {
      setSettings(r.data); setPriceNaira(r.data.pin_price_naira || 300000); setSmtpEmail(r.data.smtp_email || "");
    }).catch((err) => { process.env.NODE_ENV === 'development' && console.error("Failed to load settings:", err); });
  }, [api, token]);

  const save = async () => {
    setSaving(true);
    const updates = {};
    if (pk) updates.paystack_secret_key = pk;
    updates.pin_price_kobo = Math.round(priceNaira * 100);
    if (smtpEmail) updates.smtp_email = smtpEmail;
    if (smtpPw) updates.smtp_password = smtpPw;
    try { await ax.put(`${api}/admin/settings`, updates, h); setSaved(true); setPk(""); setSmtpPw(""); setTimeout(() => setSaved(false), 3000);
      const r = await ax.get(`${api}/admin/settings`, h); setSettings(r.data);
    } catch (err) { process.env.NODE_ENV === 'development' && console.error("Save settings failed:", err); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl" data-testid="admin-settings-tab">
      <h3 className="font-heading text-xl font-bold mb-6">Admin Settings</h3>
      <div className="space-y-6">
        {/* Paystack */}
        <div className="border border-border bg-card p-5">
          <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground mb-4 flex items-center gap-2"><CurrencyNgn size={14} /> PAYSTACK CONFIGURATION</h4>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1">Paystack Secret Key</label>
              <input data-testid="settings-paystack-key" type="password" value={pk} onChange={e=>setPk(e.target.value)} placeholder={settings?.paystack_configured ? "Key configured (enter new to change)" : "sk_live_xxxxx or sk_test_xxxxx"}
                className="w-full px-3 py-2 border border-border bg-background font-mono text-sm" />
              <p className="text-xs text-muted-foreground mt-1">Status: <span className={settings?.paystack_configured?"text-[hsl(142,71%,45%)]":"text-[hsl(348,83%,47%)]"}>{settings?.paystack_configured?"Configured":"Not set"}</span> {settings?.paystack_key_preview && settings.paystack_configured && <span className="font-mono">({settings.paystack_key_preview})</span>}</p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">PIN Price (Naira)</label>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">₦</span>
                <input data-testid="settings-price" type="number" value={priceNaira} onChange={e=>setPriceNaira(parseInt(e.target.value)||0)}
                  className="w-full px-3 py-2 border border-border bg-background font-mono text-sm" />
              </div>
              <p className="text-xs text-muted-foreground mt-1">Current: ₦{priceNaira?.toLocaleString()}</p>
            </div>
          </div>
        </div>
        {/* Email */}
        <div className="border border-border bg-card p-5">
          <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground mb-4 flex items-center gap-2"><Envelope size={14} /> EMAIL CONFIGURATION (Gmail)</h4>
          <p className="text-xs text-muted-foreground mb-3">Auto-send PINs to buyers after payment. Use a Gmail App Password (not your regular password). Go to myaccount.google.com &gt; Security &gt; App Passwords.</p>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1">Gmail Address</label>
              <input data-testid="settings-smtp-email" type="email" value={smtpEmail} onChange={e=>setSmtpEmail(e.target.value)} placeholder="yourname@gmail.com"
                className="w-full px-3 py-2 border border-border bg-background text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">App Password</label>
              <input data-testid="settings-smtp-password" type="password" value={smtpPw} onChange={e=>setSmtpPw(e.target.value)} placeholder={settings?.smtp_configured ? "Password configured (enter new to change)" : "xxxx xxxx xxxx xxxx"}
                className="w-full px-3 py-2 border border-border bg-background font-mono text-sm" />
              <p className="text-xs text-muted-foreground mt-1">Status: <span className={settings?.smtp_configured?"text-[hsl(142,71%,45%)]":"text-[hsl(348,83%,47%)]"}>{settings?.smtp_configured?"Configured":"Not set"}</span></p>
            </div>
          </div>
        </div>
        <button onClick={save} disabled={saving} data-testid="settings-save-btn"
          className="px-6 py-3 bg-primary text-primary-foreground font-bold text-sm flex items-center gap-2 hover:-translate-y-[1px] transition-transform shadow-[2px_2px_0px_hsl(0,0%,4%)]">
          <FloppyDisk size={16} weight="bold" /> {saving?"SAVING...":saved?"SAVED!":"SAVE SETTINGS"}
        </button>
      </div>
    </div>
  );
}

// --- CONFIGURATOR TAB ---
function ConfigTab({ api, token }) {
  const PRESETS = [
    { id:"conservative", label:"CONSERVATIVE", icon:ShieldCheck, wt:20, risk:0.5, trades:2, conf:85, color:"text-[hsl(142,71%,45%)]", bg:"bg-[hsl(142,71%,45%)]/10" },
    { id:"moderate", label:"MODERATE", icon:Lightning, wt:35, risk:1.0, trades:3, conf:75, color:"text-primary", bg:"bg-primary/10" },
    { id:"aggressive", label:"AGGRESSIVE", icon:Flame, wt:50, risk:1.5, trades:5, conf:65, color:"text-[hsl(348,83%,47%)]", bg:"bg-[hsl(348,83%,47%)]/10" },
  ];
  const [config, setConfig] = useState({name:"Default",risk_percent:1,daily_loss_limit:3,weekly_drawdown_limit:10,weekly_profit_target:35,max_open_trades:2,max_trades_per_day:3,enable_trend_mode:true,enable_range_mode:true,enable_breakout_mode:true,confidence_threshold:75,ema_fast:50,ema_slow:200,min_rr_ratio:1.5,partial_close_percent:50,trailing_atr_multi:1.5,sl_atr_multiplier:2,trade_london:true,trade_new_york:true,equity_protection:70,profit_mode:"moderate"});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const h = { headers: { Authorization: `Bearer ${token}` } };

  const u = (k,v) => { setConfig(p=>({...p,[k]:v})); setSaved(false); };
  const applyPreset = (p) => u("weekly_profit_target",p.wt) || u("risk_percent",p.risk) || u("max_trades_per_day",p.trades) || u("confidence_threshold",p.conf) || u("profit_mode",p.id) || setConfig(prev=>({...prev,weekly_profit_target:p.wt,risk_percent:p.risk,max_trades_per_day:p.trades,confidence_threshold:p.conf,profit_mode:p.id}));
  const save = async () => { setSaving(true); try { await ax.post(`${api}/admin/configs`, config, h); setSaved(true); setTimeout(()=>setSaved(false),3000); } catch (err) { process.env.NODE_ENV === 'development' && console.error("Save config failed:", err); } finally { setSaving(false); } };

  return (
    <div data-testid="admin-config-tab">
      <h3 className="font-heading text-xl font-bold mb-4">EA Parameter Configuration</h3>
      <div className="grid grid-cols-3 gap-3 mb-6">
        {PRESETS.map(p=>{const I=p.icon;const sel=config.profit_mode===p.id;return(
          <button key={p.id} onClick={()=>applyPreset(p)} data-testid={`admin-preset-${p.id}`} className={`text-left p-4 border transition-all ${sel?`${p.bg} border-current`:""} ${!sel?"border-border hover:border-foreground/20":""}`}>
            <div className="flex items-center gap-2 mb-1"><I size={16} weight={sel?"fill":"regular"} className={sel?p.color:"text-muted-foreground"}/><span className={`text-xs font-bold tracking-[0.1em] ${sel?p.color:"text-muted-foreground"}`}>{p.label}</span></div>
            <div className="font-mono text-2xl font-black">{p.wt}%<span className="text-xs font-medium text-muted-foreground ml-1">/week</span></div>
            <div className="text-xs text-muted-foreground mt-1">Risk: {p.risk}% | Trades: {p.trades}/day</div>
          </button>
        );})}
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[["Risk %","risk_percent",0.1,3,0.1],["Daily Loss","daily_loss_limit",1,10,0.5],["Weekly DD","weekly_drawdown_limit",5,20,1],["Weekly Target","weekly_profit_target",10,100,5],["Confidence","confidence_threshold",50,95,5],["Min R:R","min_rr_ratio",1,5,0.1]].map(([l,k,mn,mx,st])=>{
          const v=config[k];const pct=((v-mn)/(mx-mn))*100;return(
          <div key={k}><div className="flex justify-between text-sm mb-1"><span>{l}</span><span className="font-mono font-bold">{Number.isInteger(v)?v:v.toFixed(1)}</span></div>
          <input type="range" min={mn} max={mx} step={st} value={v} onChange={e=>u(k,parseFloat(e.target.value))} className="w-full h-1 appearance-none cursor-pointer accent-[hsl(43,74%,49%)]" style={{background:`linear-gradient(to right,hsl(43,74%,49%) ${pct}%,hsl(0,0%,90%) ${pct}%)`}} /></div>
        );})}
      </div>
      <button onClick={save} disabled={saving} data-testid="admin-config-save"
        className="px-6 py-3 bg-primary text-primary-foreground font-bold text-sm flex items-center gap-2 hover:-translate-y-[1px] transition-transform shadow-[2px_2px_0px_hsl(0,0%,4%)]">
        <FloppyDisk size={16} weight="bold" /> {saving?"SAVING...":saved?"SAVED!":"SAVE CONFIG"}
      </button>
    </div>
  );
}

// --- TRANSACTIONS TAB ---
function TransactionsTab({ api, token }) {
  const [txs, setTxs] = useState([]);
  const h = { headers: { Authorization: `Bearer ${token}` } };
  useEffect(() => { ax.get(`${api}/admin/transactions`, h).then(r=>setTxs(r.data.transactions||[])).catch((err) => { process.env.NODE_ENV === 'development' && console.error("Failed to load transactions:", err); }); }, [api, token]);

  return (
    <div data-testid="admin-transactions-tab">
      <h3 className="font-heading text-xl font-bold mb-4">Payment Transactions</h3>
      <div className="border border-border bg-card">
        <div className="px-5 py-3 border-b border-border bg-muted/30"><span className="text-xs font-bold tracking-[0.15em] text-muted-foreground">{txs.length} TRANSACTIONS</span></div>
        {txs.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No transactions yet</div> :
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">REF</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">BUYER</th>
              <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground">AMOUNT</th>
              <th className="text-center px-4 py-2 text-xs font-bold text-muted-foreground">STATUS</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">PIN</th>
              <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">DATE</th>
            </tr></thead>
            <tbody>{txs.map(t=>(
              <tr key={t.reference} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-mono text-xs">{t.reference}</td>
                <td className="px-4 py-2"><div className="text-xs">{t.buyer_name}</div><div className="text-xs text-muted-foreground">{t.buyer_email}</div></td>
                <td className="px-4 py-2 text-right font-mono">₦{(t.amount_kobo/100).toLocaleString()}</td>
                <td className="px-4 py-2 text-center"><span className={`px-2 py-0.5 text-[10px] font-bold ${t.payment_status==="success"?"bg-[hsl(142,71%,45%)]/10 text-[hsl(142,71%,45%)]":"bg-primary/10 text-primary"}`}>{(t.payment_status||"pending").toUpperCase()}</span></td>
                <td className="px-4 py-2 font-mono text-xs">{t.pin_generated||"-"}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{t.created_at?.split("T")[0]}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}


// --- ACCOUNT TAB ---
function AccountTab({ api, token, admin, onLogin, onLogout }) {
  const [newEmail, setNewEmail] = useState(admin?.email || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const h = { headers: { Authorization: `Bearer ${token}` } };

  const handleSave = async () => {
    setError(""); setMessage("");
    if (!currentPassword) { setError("Enter your current password to make changes."); return; }
    if (newPassword && newPassword !== confirmPassword) { setError("New passwords don't match."); return; }
    if (newPassword && newPassword.length < 6) { setError("New password must be at least 6 characters."); return; }
    if (!newEmail.includes("@")) { setError("Enter a valid email address."); return; }

    setSaving(true);
    try {
      const body = { current_password: currentPassword };
      if (newEmail !== admin?.email) body.new_email = newEmail;
      if (newPassword) body.new_password = newPassword;

      const res = await ax.put(`${api}/admin/account`, body, h);
      if (res.data.updated) {
        setMessage("Account updated successfully! " + (res.data.email !== admin?.email ? "You'll be logged in with the new email." : ""));
        if (res.data.token) { onLogin(res.data.token); }
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      } else {
        setMessage("No changes to save.");
      }
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Update failed. Check your current password.");
    } finally { setSaving(false); }
  };

  return (
    <div className="max-w-xl" data-testid="admin-account-tab">
      <h3 className="font-heading text-xl font-bold mb-6">Admin Account</h3>

      <div className="border border-border bg-card p-6 space-y-5">
        {/* Current info */}
        <div className="pb-4 border-b border-border">
          <div className="flex items-center gap-3 mb-1">
            <UserCircle size={32} weight="duotone" className="text-primary" />
            <div>
              <div className="font-bold text-sm">{admin?.name || "Admin"}</div>
              <div className="text-xs text-muted-foreground">{admin?.email}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Role: <span className="font-mono font-bold text-primary">ADMIN</span></div>
        </div>

        {/* Change Email */}
        <div>
          <label className="text-sm font-medium block mb-1.5">Email Address</label>
          <div className="relative">
            <Envelope size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input data-testid="account-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
        </div>

        {/* Change Password */}
        <div>
          <label className="text-sm font-medium block mb-1.5">New Password <span className="text-muted-foreground font-normal">(leave blank to keep current)</span></label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input data-testid="account-new-password" type={showNew ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password (optional)"
              className="w-full pl-10 pr-10 py-2.5 border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-3 text-muted-foreground">
              {showNew ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {newPassword && (
          <div>
            <label className="text-sm font-medium block mb-1.5">Confirm New Password</label>
            <input data-testid="account-confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password"
              className="w-full px-3 py-2.5 border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-[hsl(348,83%,47%)] mt-1">Passwords don't match</p>
            )}
          </div>
        )}

        {/* Current Password (required) */}
        <div className="pt-4 border-t border-border">
          <label className="text-sm font-bold block mb-1.5 text-foreground">Current Password <span className="text-[hsl(348,83%,47%)]">*</span></label>
          <p className="text-xs text-muted-foreground mb-2">Required to confirm any changes</p>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input data-testid="account-current-password" type={showCurrent ? "text" : "password"} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Enter current password"
              className="w-full pl-10 pr-10 py-2.5 border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-3 text-muted-foreground">
              {showCurrent ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && <div className="text-[hsl(348,83%,47%)] text-sm font-medium" data-testid="account-error">{error}</div>}
        {message && <div className="text-[hsl(142,71%,45%)] text-sm font-medium" data-testid="account-success">{message}</div>}

        <button onClick={handleSave} disabled={saving} data-testid="account-save-btn"
          className="w-full py-3 bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 hover:-translate-y-[1px] transition-transform shadow-[2px_2px_0px_hsl(0,0%,4%)]">
          <FloppyDisk size={16} weight="bold" /> {saving ? "UPDATING..." : "UPDATE ACCOUNT"}
        </button>
      </div>
    </div>
  );
}


// --- CLOUD ADMIN TAB ---
function CloudAdminTab({ api, token }) {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [settings, setSettings] = useState(null);
  const [infra, setInfra] = useState(null);
  const [botMode, setBotMode] = useState(null);    // {current, presets, set_at}
  const [diag, setDiag] = useState(null);          // diagnostics: workers + fanout logs + per-user readiness
  const [orphans, setOrphans] = useState(null);    // v1.4.3: orphan-trade detector
  const [sub, setSub] = useState("stats"); // stats | users | payments | botmode | infra | diagnostics | settings
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [newToken, setNewToken] = useState("");

  const headers = { Authorization: `Bearer ${token}` };

  const refresh = useCallback(async () => {
    try {
      const [s, u, p, cfg, inf, bm, dg, orp] = await Promise.all([
        ax.get(`${api}/admin/cloud/stats`, { headers }),
        ax.get(`${api}/admin/cloud/users`, { headers }),
        ax.get(`${api}/admin/cloud/payments`, { headers }),
        ax.get(`${api}/admin/cloud/settings`, { headers }),
        ax.get(`${api}/admin/cloud/infrastructure`, { headers }),
        ax.get(`${api}/admin/cloud/bot-mode`, { headers }),
        ax.get(`${api}/admin/cloud/diagnostics`, { headers }),
        ax.get(`${api}/admin/cloud/orphans`, { headers }),
      ]);
      setStats(s.data); setUsers(u.data.users || []); setPayments(p.data.payments || []);
      setSettings(cfg.data); setInfra(inf.data); setBotMode(bm.data); setDiag(dg.data);
      setOrphans(orp.data);
    } catch (e) { setMsg(e.response?.data?.detail || "Failed to load"); }
  }, [api, token]);

  useEffect(() => { refresh(); }, [refresh]);

  const setBotModePreset = async (mode) => {
    setBusy(true); setMsg("");
    try {
      await ax.post(`${api}/admin/cloud/bot-mode`, { mode }, { headers });
      setMsg(`Bot mode → ${mode}. Master EA will pick it up within 60 seconds.`);
      refresh();
    } catch (e) { setMsg(e.response?.data?.detail || "Mode change failed"); }
    finally { setBusy(false); }
  };

  const approve = async (id) => {
    setBusy(true); setMsg("");
    try { await ax.post(`${api}/admin/cloud/payments/${id}/approve`, {}, { headers }); setMsg("Approved."); refresh(); }
    catch (e) { setMsg(e.response?.data?.detail || "Approve failed"); }
    finally { setBusy(false); }
  };
  const reject = async (id) => {
    if (!window.confirm("Reject this payment?")) return;
    setBusy(true);
    try { await ax.post(`${api}/admin/cloud/payments/${id}/reject`, {}, { headers }); refresh(); }
    catch (e) { setMsg(e.response?.data?.detail || "Reject failed"); }
    finally { setBusy(false); }
  };

  const saveSettings = async () => {
    setBusy(true); setMsg("");
    try {
      // Pre-flight validation: don't let admin accidentally save $0 plan prices
      // (form blanks would clobber prices to 0 and break the public site).
      const plans = settings?.plans || {};
      for (const [pid, p] of Object.entries(plans)) {
        const price = Number(p.price_usd);
        if (!Number.isFinite(price) || price <= 0) {
          setMsg(`${pid.toUpperCase()} plan price must be > $0 (got ${p.price_usd}). Fix and re-save.`);
          setBusy(false); return;
        }
        if (!p.name || !p.name.trim()) {
          setMsg(`${pid.toUpperCase()} plan needs a name.`);
          setBusy(false); return;
        }
      }
      await ax.put(`${api}/admin/cloud/settings`, settings, { headers });
      setMsg("Saved.");
      refresh();
    }
    catch (e) { setMsg(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  // Per-user pricing override
  const overrideUser = async (uid, body) => {
    try {
      await ax.post(`${api}/admin/cloud/users/override`, { user_id: uid, ...body }, { headers });
      setMsg("User updated."); refresh();
    } catch (e) { setMsg(e.response?.data?.detail || "Update failed"); }
  };

  // v1.4.3 — Admin nuclear option: queues a "force-close-all" marker so the
  // worker closes EVERY open position (incl. legacy orphans without DB mapping)
  // on this user's MT5 account on the next poll cycle.
  const forceCloseUser = async (uid, email) => {
    if (!window.confirm(
      `NUKE: Force-close ALL open positions on ${email}'s cloud MT5 account?\n\n` +
      `This is used to clear legacy orphan trades from a pre-v1.4 worker.\n` +
      `The worker will close every position (magic 77007007 only) on its next poll (~30s).`
    )) return;
    try {
      const r = await ax.post(`${api}/admin/cloud/force-close-user`, { user_id: uid }, { headers });
      setMsg(`Force-close queued for ${email} (marker ${r.data?.marker_id?.slice(0,8) || "?"}). Worker will execute within ~30s.`);
    } catch (e) { setMsg(e.response?.data?.detail || "Force-close failed"); }
  };

  // Pricing edits (in-memory until "Save settings")
  const updPlan = (id, k, v) => {
    const plans = { ...(settings?.plans || {}) };
    const base = plans[id] || {};
    plans[id] = { ...base, [k]: k === "price_usd" || k === "max_balance_usd" ? Number(v) : v };
    setSettings({ ...settings, plans });
  };
  const updFx = (ccy, v) => {
    const r = { ...(settings?.fx_rates || {}) };
    r[ccy] = Number(v);
    setSettings({ ...settings, fx_rates: r });
  };

  const addWallet = () => setSettings({...settings, crypto_wallets: [...(settings.crypto_wallets||[]), {asset:"",network:"",address:""}]});
  const updWallet = (i,k,v) => { const a = [...settings.crypto_wallets]; a[i] = {...a[i], [k]:v}; setSettings({...settings, crypto_wallets: a}); };
  const delWallet = (i) => { const a = [...settings.crypto_wallets]; a.splice(i,1); setSettings({...settings, crypto_wallets: a}); };
  const addBank = () => setSettings({...settings, bank_accounts: [...(settings.bank_accounts||[]), {bank_name:"",account_name:"",account_number:"",swift:"",country:""}]});
  const updBank = (i,k,v) => { const a = [...settings.bank_accounts]; a[i] = {...a[i], [k]:v}; setSettings({...settings, bank_accounts: a}); };
  const delBank = (i) => { const a = [...settings.bank_accounts]; a.splice(i,1); setSettings({...settings, bank_accounts: a}); };

  return (
    <div className="space-y-6" data-testid="cloud-admin-tab">
      <div className="flex gap-0 border-b border-border overflow-x-auto">
        {[{id:"stats",label:"OVERVIEW"},{id:"users",label:"USERS"},{id:"payments",label:"PAYMENTS"},{id:"pricing",label:"PRICING & FX"},{id:"botmode",label:"BOT MODE"},{id:"infra",label:"INFRASTRUCTURE"},{id:"diagnostics",label:"DIAGNOSTICS"},{id:"settings",label:"SETTINGS"}].map(t=>(
          <button key={t.id} onClick={()=>setSub(t.id)} data-testid={`cloud-sub-${t.id}`}
                  className={`px-5 py-3 text-xs font-bold tracking-[0.1em] border-b-2 transition-colors whitespace-nowrap ${sub===t.id?"border-primary text-foreground":"border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label} {t.id==="payments" && stats?.pending_payments>0 ? <span className="ml-1 px-1.5 py-0.5 bg-primary text-primary-foreground rounded-full text-[10px]">{stats.pending_payments}</span> : null}
          </button>
        ))}
      </div>

      {msg && <div className="px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-sm rounded">{msg}</div>}

      {/* v1.4.3 — Orphan-trade alert. Surfaces anytime a user's worker
          reports MORE open positions (magic 77007007) than the master EA
          currently has open — those extras are legacy orphans. One-click NUKE
          per user clears them via the force-close-queue. */}
      {orphans && orphans.flagged_users && orphans.flagged_users.length > 0 && (
        <div className="border-2 border-[hsl(0,84%,60%)]/50 bg-[hsl(0,84%,60%)]/10 p-4 rounded space-y-3" data-testid="orphan-alert-banner">
          <div className="flex items-center gap-2">
            <span className="text-[hsl(0,84%,60%)] font-bold tracking-wider text-sm">⚠ ORPHAN POSITIONS DETECTED</span>
            <span className="text-xs text-muted-foreground">Master has {orphans.master_open_count} open · {orphans.flagged_users.length} user(s) flagged</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            These users' MT5 accounts have more open positions (magic 77007007) than the master EA. The extras are likely legacy
            trades from a pre-v1.4 worker that lacked the <code className="font-mono bg-black/30 px-1">XAUAI|sigid</code> comment, so
            auto close-sync can't see them. Click NUKE to force-close every magic-77007007 position on that user's terminal.
          </div>
          <div className="space-y-1">
            {orphans.flagged_users.map((o, i) => (
              <div key={o.user_id} className="flex items-center justify-between gap-3 bg-black/20 px-3 py-2 rounded text-sm" data-testid={`orphan-row-${i}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-semibold">{o.email}</span>
                  <span className="text-[10px] font-mono text-[hsl(0,84%,60%)]">{o.cloud_positions} cloud / {o.master_open} master = ~{o.orphan_estimate} orphan(s)</span>
                  <span className="text-[10px] text-muted-foreground">last reported {o.last_reported_at?.slice(11,19) || "?"}</span>
                </div>
                <button data-testid={`orphan-nuke-${i}`}
                        onClick={()=>forceCloseUser(o.user_id, o.email)}
                        className="px-3 py-1 bg-[hsl(0,84%,60%)] text-white text-[10px] font-bold tracking-widest rounded hover:bg-[hsl(0,84%,55%)]">NUKE</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {sub === "stats" && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="cloud-stats-grid">
          <StatCard label="TOTAL USERS" value={stats.total_users} testId="cloud-stat-total" />
          <StatCard label="TRIAL" value={stats.trial_users} color="primary" testId="cloud-stat-trial" />
          <StatCard label="ACTIVE (PAID)" value={stats.active_users} color="green" testId="cloud-stat-active" />
          <StatCard label="MT5 CONNECTED" value={stats.mt5_connected} testId="cloud-stat-connected" />
          <StatCard label="MRR" value={`$${stats.mrr_usd.toLocaleString()}`} color="green" testId="cloud-stat-mrr" />
          <StatCard label="PENDING PAYMENTS" value={stats.pending_payments} color={stats.pending_payments>0?"primary":undefined} testId="cloud-stat-pending" />
        </div>
      )}

      {sub === "users" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="cloud-users-table">
            <thead><tr className="text-[10px] font-bold tracking-widest text-muted-foreground border-b border-border">
              <th className="text-left py-2">EMAIL</th><th className="text-left py-2">STATUS</th>
              <th className="text-left py-2">PLAN</th><th className="text-right py-2">MT5</th>
              <th className="text-right py-2">BALANCE</th><th className="text-right py-2">ENDS</th>
              <th className="text-right py-2">OVERRIDE</th>
            </tr></thead>
            <tbody>
              {users.map((u,i)=>(
                <tr key={u.id} className="border-b border-border/50" data-testid={`cloud-user-${i}`}>
                  <td className="py-2"><div className="font-semibold">{u.email}</div><div className="text-[10px] text-muted-foreground">{u.full_name}</div></td>
                  <td className={`py-2 font-mono text-xs ${u.status==="active"?"text-[hsl(142,71%,45%)]":"text-primary"}`}>{u.status?.toUpperCase()}</td>
                  <td className="py-2 capitalize">
                    {u.plan}
                    {u.custom_price_usd ? <span className="ml-1 text-[10px] text-primary font-mono">(${u.custom_price_usd})</span> : null}
                  </td>
                  <td className="py-2 text-right">{u.mt5_connected ? <Check size={14} className="inline text-[hsl(142,71%,45%)]" /> : "—"}</td>
                  <td className="py-2 text-right font-mono">{u.last_balance ? `$${u.last_balance.toFixed(0)}` : "—"}</td>
                  <td className="py-2 text-right text-xs">{u.subscription_ends_at?.slice(0,10) || "—"}</td>
                  <td className="py-2 text-right space-x-1">
                    <button data-testid={`extend-30-${u.id}`}
                            onClick={()=>overrideUser(u.id, { extend_days: 30 })}
                            className="px-2 py-1 bg-[hsl(142,71%,45%)]/20 text-[hsl(142,71%,45%)] text-[10px] font-bold rounded hover:bg-[hsl(142,71%,45%)]/30">+30d</button>
                    <button data-testid={`override-price-${u.id}`}
                            onClick={()=>{
                              const v = window.prompt(`Set custom monthly price (USD) for ${u.email}.\nLeave blank to clear (use plan default).`, u.custom_price_usd || "");
                              if (v === null) return;
                              overrideUser(u.id, { custom_price_usd: v.trim() === "" ? 0 : Number(v) });
                            }}
                            className="px-2 py-1 bg-primary/20 text-primary text-[10px] font-bold rounded hover:bg-primary/30">$</button>
                    <button data-testid={`change-plan-${u.id}`}
                            onClick={()=>{
                              const next = u.plan === "starter" ? "pro" : "starter";
                              if (!window.confirm(`Switch ${u.email} to ${next}?`)) return;
                              overrideUser(u.id, { plan: next });
                            }}
                            className="px-2 py-1 bg-foreground/10 text-foreground text-[10px] font-bold rounded hover:bg-foreground/20">⇄</button>
                    <button data-testid={`force-close-${u.id}`}
                            onClick={()=>forceCloseUser(u.id, u.email)}
                            title="NUKE: Force-close ALL open positions on this user's MT5 (clears legacy orphan trades)"
                            className="px-2 py-1 bg-[hsl(0,84%,60%)]/20 text-[hsl(0,84%,60%)] text-[10px] font-bold rounded hover:bg-[hsl(0,84%,60%)]/30">NUKE</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <div className="text-center text-muted-foreground py-8">No cloud users yet.</div>}
        </div>
      )}

      {sub === "pricing" && settings && (
        <div className="space-y-6" data-testid="cloud-pricing-tab">
          <div className="border border-border p-4">
            <div className="text-xs font-bold tracking-widest text-muted-foreground mb-3">SUBSCRIPTION PLANS</div>
            <div className="grid md:grid-cols-2 gap-4">
              {["starter", "pro"].map(pid => {
                const defaults = { starter: { name: "Starter", price_usd: 50, max_balance_usd: 5000, description: "" }, pro: { name: "Pro", price_usd: 100, max_balance_usd: 999999, description: "" } };
                const cur = (settings.plans && settings.plans[pid]) || defaults[pid];
                return (
                  <div key={pid} className="border border-border p-3 space-y-2" data-testid={`plan-edit-${pid}`}>
                    <div className="text-[10px] font-bold tracking-widest text-primary">{pid.toUpperCase()}</div>
                    <input data-testid={`plan-${pid}-name`} value={cur.name||""} onChange={e=>updPlan(pid,"name",e.target.value)}
                           placeholder="Plan name" className="w-full bg-muted/30 border border-border px-3 py-2 text-sm" />
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div className="text-[10px] text-muted-foreground mb-1">PRICE USD/MO</div>
                        <input data-testid={`plan-${pid}-price`} type="number" step="0.01" value={cur.price_usd||0} onChange={e=>updPlan(pid,"price_usd",e.target.value)}
                               className="w-full bg-muted/30 border border-border px-3 py-2 text-sm font-mono" />
                      </div>
                      <div className="flex-1">
                        <div className="text-[10px] text-muted-foreground mb-1">MAX BALANCE</div>
                        <input data-testid={`plan-${pid}-max`} type="number" value={cur.max_balance_usd||0} onChange={e=>updPlan(pid,"max_balance_usd",e.target.value)}
                               className="w-full bg-muted/30 border border-border px-3 py-2 text-sm font-mono" />
                      </div>
                    </div>
                    <textarea data-testid={`plan-${pid}-desc`} value={cur.description||""} onChange={e=>updPlan(pid,"description",e.target.value)} rows={2}
                              placeholder="Description" className="w-full bg-muted/30 border border-border px-3 py-2 text-sm" />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border border-border p-4">
            <div className="text-xs font-bold tracking-widest text-muted-foreground mb-1">FX RATES (1 USD = X)</div>
            <div className="text-[11px] text-muted-foreground mb-3">Used to show local-currency amount on the bank-transfer payment page.</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {["NGN","KES","ZAR","GHS","EUR","GBP","INR","CAD","AUD"].map(ccy=>{
                const v = (settings.fx_rates && settings.fx_rates[ccy]) ?? "";
                return (
                  <div key={ccy}>
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">{ccy}</div>
                    <input data-testid={`fx-${ccy}`} type="number" step="0.01" value={v} onChange={e=>updFx(ccy,e.target.value)}
                           className="w-full bg-muted/30 border border-border px-3 py-2 text-sm font-mono" placeholder="rate" />
                  </div>
                );
              })}
            </div>
          </div>

          <button onClick={saveSettings} disabled={busy} data-testid="save-pricing"
                  className="px-5 py-2 bg-primary text-primary-foreground font-bold tracking-widest text-xs">
            {busy ? "SAVING..." : "SAVE PRICING & FX"}
          </button>
        </div>
      )}

      {sub === "payments" && (
        <div className="space-y-2" data-testid="cloud-payments-list">
          {payments.length === 0 ? <div className="text-center text-muted-foreground py-8">No payments submitted.</div> :
            payments.map((p,i)=>(
              <div key={p.id} className="border border-border p-4 flex items-start justify-between gap-4 flex-wrap" data-testid={`cloud-payment-${i}`}>
                <div className="flex gap-4 items-start flex-1 min-w-0">
                  {p.proof_image && (
                    <a href={p.proof_image} target="_blank" rel="noreferrer" data-testid={`proof-${i}`}
                       className="shrink-0 block">
                      <img src={p.proof_image} alt="proof" className="w-24 h-24 object-cover rounded-lg border border-border hover:opacity-80 transition-opacity" />
                      <div className="text-[10px] text-center text-muted-foreground mt-1">click to enlarge</div>
                    </a>
                  )}
                  <div className="min-w-0">
                    <div className="font-bold">{p.email}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Plan: <span className="capitalize">{p.plan}</span> · ${p.amount_usd} · {p.method}
                      {p.paid_currency && p.paid_currency !== "USD" && p.paid_amount_local > 0 &&
                        <span className="ml-1">(paid {p.paid_currency} {p.paid_amount_local.toLocaleString()})</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-1 break-all">Ref: {p.reference || "—"}</div>
                    {p.notes && <div className="text-[11px] text-muted-foreground mt-1">Notes: {p.notes}</div>}
                    <div className="text-[10px] text-muted-foreground mt-1">Submitted: {p.submitted_at?.slice(0,16).replace("T"," ")}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-[10px] font-bold rounded ${p.status==="approved"?"bg-[hsl(142,71%,45%)]/20 text-[hsl(142,71%,45%)]":p.status==="rejected"?"bg-[hsl(348,83%,47%)]/20 text-[hsl(348,83%,47%)]":"bg-primary/20 text-primary"}`}>{p.status?.toUpperCase()}</span>
                  {p.status === "pending" && <>
                    <button onClick={()=>approve(p.id)} disabled={busy} data-testid={`approve-${p.id}`} className="px-3 py-1.5 bg-[hsl(142,71%,45%)] text-black text-xs font-bold">APPROVE</button>
                    <button onClick={()=>reject(p.id)} disabled={busy} data-testid={`reject-${p.id}`} className="px-3 py-1.5 bg-[hsl(348,83%,47%)] text-white text-xs font-bold">REJECT</button>
                  </>}
                </div>
              </div>
            ))}
        </div>
      )}

      {sub === "botmode" && botMode && (
        <div className="space-y-5" data-testid="botmode-panel">
          <div className="border border-border p-4 sm:p-5">
            <div className="text-xs font-bold tracking-widest text-muted-foreground mb-1">CURRENT BOT MODE</div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <div className="text-3xl sm:text-4xl font-bold capitalize text-primary" data-testid="botmode-current">{botMode.current}</div>
              {botMode.set_at && <div className="text-[11px] text-muted-foreground font-mono">since {new Date(botMode.set_at).toLocaleString()}</div>}
            </div>
            <div className="text-[12px] text-muted-foreground mt-2 leading-relaxed">
              The master EA polls this every ~60s. Switching modes changes the score threshold,
              floor, HTF context-gate, and post-loss tightening for ALL trades — without restarting MT5.
              Cloud subscribers all execute against the same mode.
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3 sm:gap-4">
            {Object.entries(botMode.presets || {}).map(([id, p]) => {
              const isCurrent = id === botMode.current;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBotModePreset(id)}
                  disabled={busy || isCurrent}
                  data-testid={`botmode-${id}`}
                  className={`text-left border-2 p-4 sm:p-5 transition-colors ${isCurrent ? "border-primary bg-primary/10" : "border-border bg-muted/10 hover:border-primary/50 hover:bg-primary/5"} ${busy ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-[10px] font-bold tracking-widest ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>{id.toUpperCase()}</div>
                    {isCurrent && <div className="text-[9px] font-mono px-1.5 py-0.5 bg-primary text-primary-foreground rounded">ACTIVE</div>}
                  </div>
                  <div className="font-bold text-base sm:text-lg mb-2">{p.label}</div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed mb-3">{p.description}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/80 space-y-0.5 border-t border-border pt-2">
                    <div>gradeB: <span className="text-foreground">{p.gradeB}</span></div>
                    <div>scoreFloor: <span className="text-foreground">{p.scoreFloor}</span></div>
                    <div>HTF align: <span className="text-foreground">{p.useHTFBias ? `yes · TF=${p.contextTF}` : "off"}</span></div>
                    <div>post-loss tighten: <span className="text-foreground">{p.adaptiveTighten ? "on" : "off"}</span></div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border border-border p-3 sm:p-4 text-[12px] text-muted-foreground">
            <div className="font-bold text-foreground mb-1">⚠ A note on win-rate</div>
            <div className="leading-relaxed">
              No mode guarantees "always profit" — markets are stochastic. These presets bias the bot
              toward different risk/frequency tradeoffs. <span className="text-foreground">Conservative</span> trades less
              but with higher win-rate per trade. <span className="text-foreground">Aggressive</span> trades more but accepts
              more whipsaw. Win-rate × avg-win-size × frequency = expectancy. The bot is engineered for
              positive expectancy across all three modes — but only over a meaningful sample (50+ trades).
            </div>
          </div>
        </div>
      )}

      {sub === "infra" && infra && (
        <div className="space-y-6" data-testid="cloud-infra-panel">

          {/* Mode toggle + master heartbeat */}
          <div className="grid md:grid-cols-3 gap-4">
            <div className={`border-2 p-4 ${infra.shadow_mode ? "border-primary bg-primary/5" : "border-border"}`} data-testid="infra-mode-card">
              <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1">EXECUTION MODE</div>
              <div className="text-xl font-bold">{infra.shadow_mode ? "SHADOW" : "LIVE"}</div>
              <div className="text-xs text-muted-foreground mt-1 mb-3">
                {infra.shadow_mode ? "Simulated trades only. No real orders placed. Safe to test." : "Real trades hitting connected accounts."}
              </div>
              <button onClick={async()=>{
                setBusy(true); setMsg("");
                try {
                  const r = await ax.post(`${api}/admin/cloud/infrastructure/shadow-mode`, {enabled: !infra.shadow_mode}, { headers });
                  setMsg(r.data.message); refresh();
                } catch(e){ setMsg(e.response?.data?.detail || "Failed"); }
                finally { setBusy(false); }
              }} disabled={busy} data-testid="toggle-shadow-btn"
                 className={`w-full py-2 text-xs font-bold ${infra.shadow_mode ? "bg-primary text-primary-foreground" : "bg-[hsl(142,71%,45%)] text-black"}`}>
                {infra.shadow_mode ? "GO LIVE →" : "← BACK TO SHADOW"}
              </button>
            </div>
            <div className="border-2 border-border p-4" data-testid="infra-master-card">
              <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1">MASTER EA</div>
              <div className="text-xl font-bold capitalize">{infra.master_ea_status}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Last heartbeat: {infra.master_last_heartbeat?.slice(0,16).replace("T"," ") || "never"}
              </div>
            </div>
            <div className="border-2 border-border p-4" data-testid="infra-capacity-card">
              <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1">CAPACITY</div>
              <div className="text-xl font-bold">{infra.assigned_users} / {infra.total_capacity}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Users assigned vs max capacity ({infra.unassigned_users} unassigned)
              </div>
            </div>
          </div>

          {/* Agent token */}
          <div className="border border-border p-4" data-testid="infra-token-card">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1">AGENT TOKEN</div>
                <div className="font-mono text-sm">{newToken || infra.agent_token_preview || "not generated yet"}</div>
              </div>
              <button onClick={async()=>{
                if (!window.confirm("Rotate agent token? All workers will lose access until you paste the new token into their config.")) return;
                setBusy(true); setMsg("");
                try {
                  const r = await ax.post(`${api}/admin/cloud/infrastructure/rotate-token`, {}, { headers });
                  setNewToken(r.data.token); setMsg("New token — save it now; it won't show fully again!");
                  refresh();
                } catch(e){ setMsg(e.response?.data?.detail || "Failed"); }
                finally { setBusy(false); }
              }} disabled={busy} data-testid="rotate-token-btn" className="px-3 py-2 bg-primary text-primary-foreground text-xs font-bold">
                {infra.agent_token_preview ? "ROTATE" : "GENERATE"}
              </button>
            </div>
            <div className="text-xs text-muted-foreground">Workers authenticate with this token. Paste it into each VPS worker's config file.</div>
          </div>

          {/* Workers list */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold tracking-widest">VPS WORKERS</h3>
              <div className="flex gap-2">
                <button onClick={async()=>{
                  // Fetch master EA with admin auth and trigger browser download.
                  try {
                    const r = await ax.get(`${api}/admin/download/ea-master`, {
                      headers, responseType: "blob"
                    });
                    const url = window.URL.createObjectURL(new Blob([r.data], { type: "application/octet-stream" }));
                    const a = document.createElement("a");
                    a.href = url; a.download = "XAUUSD_AI_Sniper_EA_MASTER_v5.8.38_ENTRY_TIMING_MEMORY.mq5";
                    document.body.appendChild(a); a.click(); a.remove();
                    window.URL.revokeObjectURL(url);
                  } catch(e){ alert(e.response?.data?.detail || "Master EA download failed"); }
                }} data-testid="download-master-ea-btn"
                className="px-3 py-2 bg-[hsl(43,74%,49%)] text-black text-xs font-bold">⬇ MASTER EA</button>
                <button onClick={async()=>{
                  setBusy(true); setMsg("");
                  try {
                    const r = await ax.post(`${api}/admin/cloud/infrastructure/test-signal`,
                      { side: "BUY", slDistDollars: 4.0, tpMultR: 4.0, auto_close_seconds: 5, exit_rMult: 3.0 },
                      { headers });
                    const fo = r.data.fanout || [];
                    const detail = fo.length ?
                      `Fanned to ${fo.length} user(s):\n` +
                      fo.map(f=>`  • ${f.email} ($${f.balance.toFixed(0)} ${f.tier}) → ${f.lots} lots ($${f.risk_usd} risk)`).join("\n") +
                      "\n\nAll sized from each user's OWN balance (master balance irrelevant).\nAuto-closes at +3R in 5s — check user dashboards." :
                      "No users with MT5 connected yet — create a test user first.";
                    alert(r.data.message + "\n\n" + detail);
                    setMsg(`Fired test signal → ${fo.length} users, ${fo.reduce((s,f)=>s+f.lots,0).toFixed(2)} total lots`);
                  } catch(e){ setMsg(e.response?.data?.detail || "Failed"); }
                  finally { setBusy(false); }
                }} disabled={busy} data-testid="fire-test-signal-btn" className="px-3 py-2 bg-[hsl(142,71%,45%)] text-black text-xs font-bold">⚡ FIRE TEST SIGNAL</button>
                <button onClick={async()=>{
                  const name = prompt("Give this worker a name (e.g. 'My-Laptop' or 'Contabo-VPS'):", "My-Laptop"); if (!name) return;
                  try {
                    const r = await ax.post(`${api}/admin/cloud/infrastructure/pair-code`, {name, max_users: 30}, { headers });
                    const code = r.data.code;
                    const isMac = /Mac/i.test(navigator.platform);
                    const cmd = isMac
                      ? `curl -fsSL https://xauaisniper.com/install-worker.sh | bash`
                      : `iwr -useb https://xauaisniper.com/install-worker.ps1 | iex`;
                    const msg = [
                      `✅ PAIRING CODE: ${code}`,
                      `(valid 10 minutes — copy it)`,
                      ``,
                      `Now on YOUR laptop / VPS, open a terminal and paste:`,
                      ``,
                      cmd,
                      ``,
                      `When it asks, paste the 6-digit code above.`,
                      `That's it — no other copy/paste needed.`
                    ].join("\n");
                    alert(msg);
                    try { await navigator.clipboard.writeText(code); } catch {}
                    refresh();
                  } catch(e) { alert(e.response?.data?.detail || "Failed"); }
                }} data-testid="generate-pair-code-btn" className="px-3 py-2 bg-primary text-primary-foreground text-xs font-bold">🪄 GENERATE PAIR CODE</button>
                <button onClick={()=>{
                  const name = prompt("Worker name (e.g. Contabo-NYC-1):"); if (!name) return;
                  const max = parseInt(prompt("Max MT5 instances this worker can host:", "30")) || 30;
                  const endpoint = prompt("Optional endpoint URL (leave blank for pull-mode):", "") || "";
                  const notes = prompt("Notes (optional):", "") || "";
                  ax.post(`${api}/admin/cloud/infrastructure/workers`, {name, max_users: max, endpoint, notes}, { headers })
                    .then(()=>refresh()).catch(e=>setMsg(e.response?.data?.detail || "Failed"));
                }} data-testid="add-worker-btn" className="px-3 py-2 bg-muted text-foreground text-xs font-bold">+ MANUAL ADD</button>
              </div>
            </div>
            {infra.workers.length === 0 ? (
              <div className="border-2 border-dashed border-border p-8 text-center" data-testid="no-workers">
                <div className="text-muted-foreground mb-2">No VPS workers registered yet.</div>
                <div className="text-xs text-muted-foreground max-w-md mx-auto">You can still sell subscriptions today — Shadow Mode shows simulated trades in every user's dashboard. When you rent your first VPS, add it here and flip mode to LIVE.</div>
              </div>
            ) : (
              <div className="space-y-2">
                {infra.workers.map((w,i)=>(
                  <div key={w.id} className="border border-border p-4 flex items-center justify-between gap-4 flex-wrap" data-testid={`worker-${i}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{w.name}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {w.endpoint || "pull-mode"} · cap {w.current_users || 0}/{w.max_users}
                        {typeof w.active_users === "number" ? ` · ${w.active_users} active mt5` : ""}
                        {w.version ? ` · v${w.version}` : ""}
                        {w.last_heartbeat ? ` · last seen ${w.last_heartbeat.slice(11,16)}` : ""}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="text-[10px] font-mono px-2 py-1 bg-black/30 border border-border rounded select-all break-all">{w.id}</code>
                        <button onClick={()=>{ navigator.clipboard.writeText(w.id); alert("Worker ID copied"); }}
                                data-testid={`copy-worker-id-${i}`}
                                className="px-2 py-1 text-[10px] font-bold bg-muted hover:bg-primary/20">📋 COPY ID</button>
                      </div>
                      {w.notes && <div className="text-[11px] text-muted-foreground mt-1">{w.notes}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-[10px] font-bold rounded ${w.status==="online"?"bg-[hsl(142,71%,45%)]/20 text-[hsl(142,71%,45%)]":"bg-muted text-muted-foreground"}`}>{w.status?.toUpperCase()}</span>
                      <button onClick={async()=>{
                        if (!window.confirm(`Remove ${w.name}? Users assigned to it will be unassigned.`)) return;
                        await ax.delete(`${api}/admin/cloud/infrastructure/workers/${w.id}`, { headers });
                        refresh();
                      }} data-testid={`remove-worker-${i}`} className="px-3 py-1.5 bg-[hsl(348,83%,47%)] text-white text-xs font-bold">REMOVE</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick-start guide */}
          <div className="border border-primary/30 bg-primary/5 p-4 text-sm" data-testid="infra-guide">
            <div className="font-bold mb-2">⚖️ How sizing works (important):</div>
            <div className="text-muted-foreground mb-3 leading-relaxed">
              Your master EA emits price, SL/TP, and master lot data. The worker mirrors lot size
              proportionally: <span className="font-bold text-foreground">cloud lot = master lot × cloud equity / master balance</span>,
              then applies broker lot-step, max-lot, and free-margin checks.
              Same-size accounts should now take almost the same lots.
              Click <span className="font-mono">FIRE TEST SIGNAL</span> above to see this happen live.
            </div>
            <div className="font-bold mb-2">🚀 Going live (when you're ready):</div>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Run master MT5 on any always-on machine (your laptop works — VPS $5/mo if you want zero downtime)</li>
              <li>Click "Generate/Rotate" above and copy the agent token</li>
              <li>Paste token into master EA inputs — master will POST signals here automatically</li>
              <li>For real execution on user accounts: rent a Windows VPS, click "+ ADD WORKER" and register it</li>
              <li>Flip "GO LIVE" — all connected users switch from shadow → real trading</li>
            </ol>
          </div>
        </div>
      )}

      {sub === "diagnostics" && diag && (
        <div className="space-y-6" data-testid="cloud-diagnostics-panel">
          {/* At-a-glance health row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="WORKERS ONLINE" value={`${diag.online_workers} / ${diag.workers.length}`} color={diag.online_workers > 0 ? "green" : "primary"} testId="diag-workers-online" />
            <StatCard label="FAN-OUT READY USERS" value={`${diag.fanout_ready_users} / ${diag.total_users}`} color={diag.fanout_ready_users > 0 ? "green" : "primary"} testId="diag-ready-users" />
            <StatCard label="RECENT FAN-OUT EVENTS" value={diag.fanout_logs.length} testId="diag-fanout-count" />
            <StatCard label="RECENT MASTER SIGNALS" value={diag.signals.length} testId="diag-signal-count" />
          </div>

          {/* Diagnosis hint banner */}
          {(() => {
            if (diag.online_workers === 0) {
              return <div className="border-2 border-[hsl(348,83%,47%)]/40 bg-[hsl(348,83%,47%)]/5 p-4 text-sm" data-testid="diag-hint">
                <div className="font-bold text-[hsl(348,83%,47%)] mb-1">⛔ NO WORKERS ONLINE</div>
                The VPS worker is not heart-beating. Trades cannot copy. SSH the VPS and run <code className="font-mono bg-black/30 px-1">python worker_agent.py</code> — or check Windows Task Scheduler if you set it as a startup task. If the worker WAS running, look for a crash trace in <code className="font-mono bg-black/30 px-1">worker_agent.log</code>.
              </div>;
            }
            if (diag.fanout_ready_users === 0) {
              return <div className="border-2 border-primary/40 bg-primary/5 p-4 text-sm" data-testid="diag-hint">
                <div className="font-bold text-primary mb-1">⚠ NO USERS ARE FAN-OUT READY</div>
                Worker is online but no subscriber meets ALL of: status ∈ [trial,active], <code className="font-mono">mt5_connected</code>=true, <code className="font-mono">mt5_verification_status</code>=verified, <code className="font-mono">paused</code>=false. See per-user readiness table below.
              </div>;
            }
            // Only judge based on the LAST 5 fan-out events. Older failures
            // (e.g. from a pre-fix worker version) shouldn't keep the banner
            // red forever once the issue is resolved.
            const recent = (diag.fanout_logs || []).slice(0, 5);
            const recentFails = recent.filter(f => !f.ok).length;
            const recentOks = recent.filter(f => f.ok).length;
            if (recent.length === 0) {
              return <div className="border-2 border-primary/40 bg-primary/5 p-4 text-sm" data-testid="diag-hint">
                <div className="font-bold text-primary mb-1">ℹ NO FAN-OUT EVENTS YET</div>
                Workers online and users ready — fire a master signal to test the pipeline. Every fan-out attempt (success OR failure) will show below.
              </div>;
            }
            if (recentFails > 0 && recentOks === 0) {
              return <div className="border-2 border-[hsl(348,83%,47%)]/40 bg-[hsl(348,83%,47%)]/5 p-4 text-sm" data-testid="diag-hint">
                <div className="font-bold text-[hsl(348,83%,47%)] mb-1">⛔ RECENT FAN-OUT FAILURES</div>
                Last {recent.length} fan-out attempt(s) all failed. Inspect the error column below — common causes: invalid filling mode, lot-step mismatch, broker rejecting price/SL/TP, AutoTrading disabled in user's MT5, or the user's MT5 password no longer working.
              </div>;
            }
            if (recentFails > 0 && recentOks > 0) {
              return <div className="border-2 border-primary/40 bg-primary/5 p-4 text-sm" data-testid="diag-hint">
                <div className="font-bold text-primary mb-1">⚠ MIXED RESULTS</div>
                {recentOks} of last {recent.length} succeeded. Some users' brokers may be rejecting trades — check the error column for the failing ones.
              </div>;
            }
            return <div className="border-2 border-[hsl(142,71%,45%)]/40 bg-[hsl(142,71%,45%)]/5 p-4 text-sm" data-testid="diag-hint">
              <div className="font-bold text-[hsl(142,71%,45%)] mb-1">✅ COPY-TRADING IS HEALTHY</div>
              Workers online, users fan-out-ready, last {recent.length} fan-out events all succeeded. Master EA signals will mirror to subscriber accounts.
            </div>;
          })()}

          <button onClick={refresh} disabled={busy} data-testid="diag-refresh"
                  className="px-4 py-2 bg-muted text-foreground text-xs font-bold tracking-widest">
            {busy ? "REFRESHING..." : "↻ REFRESH"}
          </button>

          {/* Workers detail */}
          <div className="border border-border p-4">
            <div className="text-xs font-bold tracking-widest text-muted-foreground mb-3">VPS WORKERS</div>
            {diag.workers.length === 0 ? <div className="text-sm text-muted-foreground">No workers registered.</div> :
              <div className="space-y-2">
                {diag.workers.map((w,i)=>(
                  <div key={w.id} className="text-sm flex flex-wrap items-center gap-3 border-b border-border/50 pb-2" data-testid={`diag-worker-${i}`}>
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${w.status==="online"?"bg-[hsl(142,71%,45%)]/20 text-[hsl(142,71%,45%)]":"bg-[hsl(348,83%,47%)]/20 text-[hsl(348,83%,47%)]"}`}>{w.status?.toUpperCase()}</span>
                    <span className="font-bold">{w.name}</span>
                    <span className="text-muted-foreground text-xs">v{w.version || "?"}</span>
                    <span className="text-muted-foreground text-xs">{w.hostname || "unknown host"}</span>
                    <span className="text-muted-foreground text-xs">{w.active_users} mt5 sessions</span>
                    <span className="text-muted-foreground text-xs">last hb: {w.last_heartbeat?.slice(11,19) || "never"}</span>
                  </div>
                ))}
              </div>
            }
          </div>

          {/* Per-user fan-out readiness */}
          <div className="border border-border p-4">
            <div className="text-xs font-bold tracking-widest text-muted-foreground mb-3">PER-USER FAN-OUT READINESS</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="diag-users-table">
                <thead><tr className="text-[10px] font-bold tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left py-2">EMAIL</th>
                  <th className="text-left py-2">STATUS</th>
                  <th className="text-center py-2">MT5</th>
                  <th className="text-center py-2">VERIFIED</th>
                  <th className="text-center py-2">PAUSED</th>
                  <th className="text-center py-2">READY</th>
                  <th className="text-left py-2">BLOCKED REASON</th>
                </tr></thead>
                <tbody>
                  {diag.users.map((u,i)=>(
                    <tr key={u.id} className="border-b border-border/30" data-testid={`diag-user-${i}`}>
                      <td className="py-1.5 font-semibold">{u.email}</td>
                      <td className="py-1.5 capitalize">{u.status}</td>
                      <td className="py-1.5 text-center">{u.mt5_connected ? "✓" : "—"}</td>
                      <td className="py-1.5 text-center">
                        {u.mt5_verification_status === "verified" ? "✓"
                          : u.mt5_verification_status === "rejected"
                            ? <span className="text-[hsl(348,83%,47%)]" title={u.mt5_verification_error}>✗</span>
                            : <span className="text-primary">{u.mt5_verification_status || "—"}</span>}
                      </td>
                      <td className="py-1.5 text-center">{u.paused ? "✓" : "—"}</td>
                      <td className={`py-1.5 text-center font-bold ${u.fanout_ready ? "text-[hsl(142,71%,45%)]" : "text-[hsl(348,83%,47%)]"}`}>{u.fanout_ready ? "YES" : "NO"}</td>
                      <td className="py-1.5 text-muted-foreground text-[11px]">{u.blocked_reason || (u.mt5_verification_error || "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {diag.users.length === 0 && <div className="text-center text-muted-foreground py-8">No trial/active subscribers yet.</div>}
            </div>
          </div>

          {/* Recent fan-out events (the actual smoking gun for "trades not copying") */}
          <div className="border border-border p-4">
            <div className="text-xs font-bold tracking-widest text-muted-foreground mb-3">RECENT FAN-OUT EVENTS (NEWEST FIRST)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="diag-fanout-table">
                <thead><tr className="text-[10px] font-bold tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left py-2">TIME</th>
                  <th className="text-left py-2">USER</th>
                  <th className="text-left py-2">SIGNAL</th>
                  <th className="text-left py-2">SIDE</th>
                  <th className="text-right py-2">LOTS</th>
                  <th className="text-right py-2">TICKET</th>
                  <th className="text-center py-2">OK</th>
                  <th className="text-left py-2">ERROR</th>
                </tr></thead>
                <tbody>
                  {diag.fanout_logs.map((f,i)=>(
                    <tr key={i} className="border-b border-border/30 align-top" data-testid={`diag-fanout-${i}`}>
                      <td className="py-1.5 font-mono text-[10px] whitespace-nowrap">{f.opened_at?.slice(11,19) || "—"}</td>
                      <td className="py-1.5 break-all max-w-[180px]">{f.user_id?.startsWith("(") ? <span className="text-primary">{f.user_id}</span> : (f.user_id || "—").slice(0,8)}</td>
                      <td className="py-1.5 font-mono text-[10px]">{(f.signal_id || "—").slice(0,8)}</td>
                      <td className="py-1.5 font-bold">{f.side}</td>
                      <td className="py-1.5 text-right font-mono">{Number(f.lots || 0).toFixed(2)}</td>
                      <td className="py-1.5 text-right font-mono">{f.ticket || "—"}</td>
                      <td className={`py-1.5 text-center font-bold ${f.ok ? "text-[hsl(142,71%,45%)]" : "text-[hsl(348,83%,47%)]"}`}>{f.ok ? "✓" : "✗"}</td>
                      <td className="py-1.5 text-[11px] text-muted-foreground max-w-md break-words">{f.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {diag.fanout_logs.length === 0 && <div className="text-center text-muted-foreground py-8">No fan-out events yet. Fire a master signal — every attempt (success or failure) will appear here.</div>}
            </div>
          </div>

          {/* Recent master signals (so you can see if the master EA is actually firing) */}
          <div className="border border-border p-4">
            <div className="text-xs font-bold tracking-widest text-muted-foreground mb-3">RECENT MASTER SIGNALS (NEWEST FIRST)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="diag-signals-table">
                <thead><tr className="text-[10px] font-bold tracking-widest text-muted-foreground border-b border-border">
                  <th className="text-left py-2">TIME</th>
                  <th className="text-left py-2">SIGNAL ID</th>
                  <th className="text-left py-2">SIDE</th>
                  <th className="text-right py-2">ENTRY</th>
                  <th className="text-right py-2">SL</th>
                  <th className="text-right py-2">TP</th>
                  <th className="text-left py-2">SOURCE</th>
                </tr></thead>
                <tbody>
                  {diag.signals.map((s,i)=>(
                    <tr key={i} className="border-b border-border/30" data-testid={`diag-signal-${i}`}>
                      <td className="py-1.5 font-mono text-[10px]">{s.ts?.slice(11,19) || "—"}</td>
                      <td className="py-1.5 font-mono text-[10px]">{(s.id || "—").slice(0,8)}</td>
                      <td className="py-1.5 font-bold">{s.side}</td>
                      <td className="py-1.5 text-right font-mono">{s.entry?.toFixed?.(2) || s.entry}</td>
                      <td className="py-1.5 text-right font-mono">{s.sl?.toFixed?.(2) || s.sl}</td>
                      <td className="py-1.5 text-right font-mono">{s.tp?.toFixed?.(2) || s.tp}</td>
                      <td className="py-1.5 text-muted-foreground">{s.source || "master"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {diag.signals.length === 0 && <div className="text-center text-muted-foreground py-8">No master signals received yet.</div>}
            </div>
          </div>
        </div>
      )}

      {sub === "settings" && settings && (
        <div className="space-y-6" data-testid="cloud-settings-form">
          <div>
            <h3 className="text-sm font-bold tracking-widest mb-3">CRYPTO WALLETS</h3>
            <div className="space-y-2">
              {(settings.crypto_wallets || []).map((w,i)=>(
                <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center" data-testid={`crypto-wallet-${i}`}>
                  <input placeholder="Asset (USDT)" value={w.asset} onChange={e=>updWallet(i,"asset",e.target.value)} className="bg-background border border-border px-3 py-2 text-sm" />
                  <input placeholder="Network (TRC20)" value={w.network} onChange={e=>updWallet(i,"network",e.target.value)} className="bg-background border border-border px-3 py-2 text-sm" />
                  <input placeholder="Address" value={w.address} onChange={e=>updWallet(i,"address",e.target.value)} className="bg-background border border-border px-3 py-2 text-sm font-mono col-span-1 md:col-span-2" />
                  <button onClick={()=>delWallet(i)} className="text-[hsl(348,83%,47%)] text-xs md:col-start-4">Remove</button>
                </div>
              ))}
              <button onClick={addWallet} data-testid="add-wallet-btn" className="text-xs text-primary">+ Add crypto wallet</button>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-widest mb-3">BANK ACCOUNTS</h3>
            <div className="space-y-2">
              {(settings.bank_accounts || []).map((b,i)=>(
                <div key={i} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center" data-testid={`bank-acc-${i}`}>
                  <input placeholder="Bank name" value={b.bank_name} onChange={e=>updBank(i,"bank_name",e.target.value)} className="bg-background border border-border px-3 py-2 text-sm" />
                  <input placeholder="Account name" value={b.account_name} onChange={e=>updBank(i,"account_name",e.target.value)} className="bg-background border border-border px-3 py-2 text-sm" />
                  <input placeholder="Account number" value={b.account_number} onChange={e=>updBank(i,"account_number",e.target.value)} className="bg-background border border-border px-3 py-2 text-sm" />
                  <input placeholder="SWIFT (optional)" value={b.swift} onChange={e=>updBank(i,"swift",e.target.value)} className="bg-background border border-border px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <input placeholder="Country" value={b.country} onChange={e=>updBank(i,"country",e.target.value)} className="flex-1 bg-background border border-border px-3 py-2 text-sm" />
                    <button onClick={()=>delBank(i)} className="text-[hsl(348,83%,47%)] text-xs">X</button>
                  </div>
                </div>
              ))}
              <button onClick={addBank} data-testid="add-bank-btn" className="text-xs text-primary">+ Add bank account</button>
            </div>
          </div>
          <button onClick={saveSettings} disabled={busy} data-testid="save-cloud-settings"
                  className="px-6 py-3 bg-primary text-primary-foreground font-bold text-sm flex items-center gap-2 hover:-translate-y-[1px] transition-transform shadow-[2px_2px_0px_hsl(0,0%,4%)]">
            <FloppyDisk size={16} weight="bold" /> {busy ? "SAVING..." : "SAVE CLOUD SETTINGS"}
          </button>
        </div>
      )}
    </div>
  );
}
