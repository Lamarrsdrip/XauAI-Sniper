import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { Cloud, Pause, Play, Shield, LogOut, TrendingUp, TrendingDown, Loader2, Copy, CheckCircle2, XCircle, Clock, CreditCard } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function useAuth() {
  const nav = useNavigate();
  useEffect(() => {
    const token = localStorage.getItem("cloud_token");
    if (!token) { nav("/cloud/login"); return; }
    axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
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
      const [m, d] = await Promise.all([axios.get(`${API}/cloud/auth/me`), axios.get(`${API}/cloud/dashboard`)]);
      setMe(m.data); setData(d.data);
    } catch (e) {
      if (e.response?.status === 401) { localStorage.removeItem("cloud_token"); nav("/cloud/login"); }
    } finally { setLoading(false); }
  }, [nav]);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 15000); return () => clearInterval(iv); }, [fetchAll]);

  const logout = async () => {
    try { await axios.post(`${API}/cloud/auth/logout`); } catch {}
    localStorage.removeItem("cloud_token");
    nav("/cloud");
  };

  const togglePause = async () => {
    try { await axios.post(`${API}/cloud/pause`, { paused: !data.paused }); fetchAll(); } catch {}
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
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Top bar */}
      <nav className="sticky top-0 z-40 backdrop-blur-xl bg-[#050505]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/cloud" className="flex items-center gap-2"><Cloud className="w-6 h-6 text-[#D4AF37]" /><span className="font-bold tracking-tight">XauAi Cloud</span></Link>
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-xs text-white/50"><span data-testid="user-email">{me.email}</span></div>
            <button onClick={logout} className="text-white/50 hover:text-white transition-colors" data-testid="logout-button"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </nav>

      {/* Trial / subscription banner */}
      {isTrial && daysLeft > 0 && (
        <div className="bg-[#D4AF37]/10 border-b border-[#D4AF37]/20 py-3" data-testid="trial-banner">
          <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-sm">
            <div><span className="text-[#D4AF37] font-semibold">Free trial active</span><span className="text-white/60 ml-2">— {daysLeft} day{daysLeft===1?"":"s"} remaining</span></div>
            <button onClick={()=>setTab("billing")} className="text-[#D4AF37] hover:underline font-semibold" data-testid="trial-upgrade-link">Upgrade now →</button>
          </div>
        </div>
      )}
      {needsPayment && (
        <div className="bg-red-500/10 border-b border-red-500/20 py-3" data-testid="expired-banner">
          <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-sm">
            <div><span className="text-red-400 font-semibold">Trial expired</span><span className="text-white/60 ml-2">— subscribe to continue trading</span></div>
            <button onClick={()=>setTab("billing")} className="text-red-400 hover:underline font-semibold" data-testid="expired-subscribe-link">Subscribe →</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-6 pt-6">
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
      <div className="max-w-7xl mx-auto px-6 py-8">
        {tab === "overview" && <OverviewTab me={me} data={data} onTogglePause={togglePause} />}
        {tab === "connect" && <ConnectTab me={me} onRefresh={fetchAll} />}
        {tab === "billing" && <BillingTab me={me} onRefresh={fetchAll} />}
      </div>
    </div>
  );
}

function OverviewTab({ me, data, onTogglePause }) {
  const wr = data.totals.total_trades > 0 ? Math.round((data.totals.wins / data.totals.total_trades) * 100) : 0;
  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Net P&L (30d)" value={formatUSD(data.totals.net_pnl)} accent={data.totals.net_pnl >= 0 ? "green" : "red"} testid="kpi-pnl" />
        <KPI label="Trades" value={data.totals.total_trades} testid="kpi-trades" />
        <KPI label="Win Rate" value={`${wr}%`} testid="kpi-winrate" />
        <KPI label="Last Balance" value={me.last_balance ? formatUSD(me.last_balance) : "—"} testid="kpi-balance" />
      </div>

      {/* Execution status */}
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6" data-testid="execution-status-card">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <div className="text-xs font-mono tracking-widest text-white/40 mb-2">EXECUTION STATUS</div>
            <div className="flex items-center gap-3">
              {data.mt5_connected ? <CheckCircle2 className="w-6 h-6 text-green-400" /> : <XCircle className="w-6 h-6 text-red-400" />}
              <div>
                <div className="font-bold text-lg">{data.mt5_connected ? "MT5 Linked" : "MT5 Not Connected"}</div>
                <div className="text-sm text-white/60">
                  {data.paused ? "⏸ Trading paused by you" : data.mt5_connected ? "Active — executing trades 24/7" : "Connect your MT5 account to start"}
                </div>
              </div>
            </div>
          </div>
          {data.mt5_connected && (
            <button onClick={onTogglePause} data-testid="pause-toggle"
                    className={`px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-colors ${data.paused ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-red-500/20 text-red-400 hover:bg-red-500/30"}`}>
              {data.paused ? <><Play className="w-4 h-4" /> Resume trading</> : <><Pause className="w-4 h-4" /> Pause trading</>}
            </button>
          )}
        </div>
      </div>

      {/* Recent trades */}
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6" data-testid="trades-card">
        <div className="text-xs font-mono tracking-widest text-white/40 mb-4">RECENT TRADES</div>
        {data.trades.length === 0 ? (
          <div className="text-center py-12 text-white/40">
            <TrendingUp className="w-12 h-12 mx-auto mb-3 text-white/20" />
            <div>No trades yet. {data.mt5_connected ? "Signals arrive during market hours." : "Connect your MT5 to get started."}</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
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
        )}
      </div>
    </div>
  );
}

function KPI({ label, value, accent, testid }) {
  const color = accent === "green" ? "text-green-400" : accent === "red" ? "text-red-400" : "text-white";
  return (
    <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-5" data-testid={testid}>
      <div className="text-[10px] font-mono tracking-widest text-white/40 mb-2">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}

function ConnectTab({ me, onRefresh }) {
  const [form, setForm] = useState({ broker_server: "", mt5_login: "", mt5_password: "", risk_tier: "balanced" });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const connected = me.mt5_connected;

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMsg(""); setLoading(true);
    try {
      const res = await axios.post(`${API}/cloud/mt5/connect`, form);
      setMsg(res.data.message); onRefresh();
    } catch (e) { setErr(e.response?.data?.detail || "Connect failed"); }
    finally { setLoading(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Remove MT5 credentials from XauAi Cloud? Open trades will not be affected.")) return;
    setLoading(true);
    try { await axios.post(`${API}/cloud/mt5/disconnect`); onRefresh(); setMsg("Credentials removed."); }
    catch (e) { setErr(e.response?.data?.detail || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="max-w-2xl">
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6 mb-6" data-testid="connect-card">
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

        {connected ? (
          <div data-testid="mt5-connected-view">
            <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <div>
                <div className="font-semibold text-green-400">MT5 Account Connected</div>
                <div className="text-xs text-white/50">Broker: {me.broker_server || "—"} · Login: {me.mt5_login || "—"} · Risk: {me.risk_tier || "balanced"}</div>
              </div>
            </div>
            <button onClick={disconnect} disabled={loading} className="w-full py-3 border border-red-500/30 text-red-400 rounded-xl hover:bg-red-500/10 transition-colors disabled:opacity-50" data-testid="disconnect-button">
              Disconnect MT5 account
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" data-testid="mt5-connect-form">
            <div>
              <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">BROKER SERVER</label>
              <input required value={form.broker_server} onChange={e=>setForm({...form, broker_server: e.target.value})} placeholder="e.g. TradeCom-Live"
                     className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none" data-testid="mt5-server" />
              <div className="text-xs text-white/30 mt-1">Find this in MT5 → Tools → Options → Server</div>
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
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    axios.get(`${API}/cloud/config`).then(r => setCfg(r.data));
    axios.get(`${API}/cloud/payments/my`).then(r => setPayments(r.data.payments || []));
  }, []);

  const copy = (txt, key) => { navigator.clipboard.writeText(txt); setCopied(key); setTimeout(()=>setCopied(""),2000); };

  const submit = async (e) => {
    e.preventDefault(); setErr(""); setMsg(""); setLoading(true);
    try {
      const plan = cfg.plans[selectedPlan];
      const res = await axios.post(`${API}/cloud/payments/submit`, {
        plan: selectedPlan, method, amount_usd: plan.price_usd, reference, notes
      });
      setMsg(res.data.message);
      setReference(""); setNotes("");
      const p = await axios.get(`${API}/cloud/payments/my`); setPayments(p.data.payments || []);
      onRefresh();
    } catch (e) { setErr(e.response?.data?.detail || "Submit failed"); }
    finally { setLoading(false); }
  };

  if (!cfg) return <Loader2 className="w-6 h-6 animate-spin text-[#D4AF37]" />;

  return (
    <div className="space-y-6">
      {/* Current subscription status */}
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6" data-testid="subscription-status">
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
      <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6" data-testid="payment-instructions">
        <div className="text-xs font-mono tracking-widest text-white/40 mb-3">PAYMENT METHOD</div>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[{id:"crypto",label:"Crypto"},{id:"bank",label:"Bank transfer"},{id:"fiat",label:"Card / Paystack"}].map(m => (
            <button key={m.id} onClick={()=>setMethod(m.id)} data-testid={`method-${m.id}`}
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
                  <button onClick={()=>copy(w.address, `w${i}`)} className="text-xs text-[#D4AF37] flex items-center gap-1" data-testid={`copy-wallet-${i}`}>
                    {copied===`w${i}` ? "Copied!" : <>Copy <Copy className="w-3 h-3" /></>}
                  </button>
                </div>
                <div className="font-mono text-sm break-all">{w.address}</div>
              </div>
            ))}
          </div>
        )}
        {method === "bank" && (
          <div className="space-y-3" data-testid="bank-details">
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
        {method === "fiat" && (
          <div className="text-sm text-white/60 p-4 bg-white/5 rounded-xl" data-testid="fiat-details">
            Paystack checkout integration is coming soon. For now, please use bank transfer or crypto, or contact support for card payments.
          </div>
        )}
      </div>

      {/* Submit payment proof */}
      <form onSubmit={submit} className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6" data-testid="payment-submit-form">
        <div className="text-xs font-mono tracking-widest text-white/40 mb-4">SUBMIT PAYMENT CONFIRMATION</div>
        <div className="text-sm text-white/60 mb-4">After you've sent payment, submit the transaction reference below. Admin verifies within 24 hours and activates your subscription.</div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">TRANSACTION REFERENCE</label>
            <input value={reference} onChange={e=>setReference(e.target.value)} required placeholder="tx hash, bank ref, or confirmation number"
                   className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none font-mono text-sm" data-testid="payment-reference" />
          </div>
          <div>
            <label className="block text-xs font-mono tracking-widest text-white/50 mb-1.5">NOTES (OPTIONAL)</label>
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="Anything we should know"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-[#D4AF37] outline-none text-sm" data-testid="payment-notes" />
          </div>
          {msg && <div className="text-green-400 text-sm" data-testid="pay-msg">{msg}</div>}
          {err && <div className="text-red-400 text-sm" data-testid="pay-err">{err}</div>}
          <button type="submit" disabled={loading} className="w-full py-3 bg-[#D4AF37] text-black font-semibold rounded-xl hover:bg-[#E5C558] transition-colors disabled:opacity-50 flex items-center justify-center gap-2" data-testid="payment-submit">
            <CreditCard className="w-4 h-4" /> {loading ? "Submitting…" : `Submit ${cfg.plans[selectedPlan].name} payment ($${cfg.plans[selectedPlan].price_usd})`}
          </button>
        </div>
      </form>

      {/* Payment history */}
      {payments.length > 0 && (
        <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-6" data-testid="payment-history">
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
