import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import {
  Key, GearSix, SignOut, ShieldCheck, Copy, Check, Trash, Plus,
  UserCircle, CurrencyNgn, Envelope, Lock, Eye, EyeSlash, ArrowLeft,
  FloppyDisk, ChartBar, Lightning, Flame,
  House, Pulse, TrendUp,
} from "@phosphor-icons/react";

const ax = axios.create({ withCredentials: true });
const auth = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG   = "bg-[#060609]";
const CARD = "bg-[#0c0d11] border border-white/[0.08] rounded-2xl";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.18em] text-white/35";
const VALUE = "font-mono text-xl font-black";

function Badge({ tone = "neutral", children }) {
  const cls = {
    green:  "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
    red:    "bg-red-500/10 text-red-300 border-red-400/20",
    amber:  "bg-amber-300/10 text-amber-200 border-amber-300/20",
    neutral:"bg-white/[0.06] text-white/55 border-white/[0.08]",
  }[tone] || "bg-white/[0.06] text-white/55 border-white/[0.08]";
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>;
}

function StatCard({ label, value, sub, tone = "neutral", testId }) {
  const color = { green: "text-emerald-300", red: "text-red-300", amber: "text-amber-200", neutral: "text-white" }[tone] || "text-white";
  return (
    <div className={`${CARD} p-4`} data-testid={testId}>
      <div className={LABEL}>{label}</div>
      <div className={`${VALUE} mt-2 ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-white/38">{sub}</div>}
    </div>
  );
}

function CardSection({ title, children, action }) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/[0.06]">
        <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/45">{title}</h4>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-white/55 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Input({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-white/25 focus:border-amber-300/50 ${className}`}
      {...props}
    />
  );
}

function Btn({ children, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold transition disabled:opacity-40";
  const v = {
    primary: "bg-amber-300 text-black hover:bg-amber-200",
    ghost:   "border border-white/[0.08] bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/[0.08]",
    danger:  "bg-red-500/15 text-red-300 border border-red-400/20 hover:bg-red-500/25",
    green:   "bg-emerald-400/15 text-emerald-300 border border-emerald-400/20 hover:bg-emerald-400/25",
  }[variant] || "";
  return <button className={`${base} ${v} ${className}`} {...props}>{children}</button>;
}

// ─── Main portal ──────────────────────────────────────────────────────────────
export default function AdminPortal({ api }) {
  const [token, setToken] = useState(localStorage.getItem("admin_token") || "");
  const [admin, setAdmin] = useState(null);
  const [tab, setTab] = useState("dashboard");

  const checkAuth = useCallback(async () => {
    if (!token) return;
    try {
      const res = await ax.get(`${api}/auth/me`, auth(token));
      setAdmin(res.data);
    } catch {
      setToken(""); localStorage.removeItem("admin_token");
    }
  }, [api, token]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const handleLogin  = (t) => { setToken(t); localStorage.setItem("admin_token", t); };
  const handleLogout = () => {
    setToken(""); setAdmin(null); localStorage.removeItem("admin_token");
    ax.post(`${api}/auth/logout`).catch(() => {});
  };

  if (!admin) return <LoginPage api={api} onLogin={handleLogin} />;

  const TABS = [
    { id: "dashboard",    label: "Dashboard",  icon: House          },
    { id: "pins",         label: "Licenses",   icon: Key            },
    { id: "command",      label: "Bot Ops",    icon: Pulse          },
    { id: "settings",     label: "Settings",   icon: GearSix        },
    { id: "configurator", label: "EA Config",  icon: ChartBar       },
    { id: "transactions", label: "Payments",   icon: CurrencyNgn    },
    { id: "account",      label: "Account",    icon: UserCircle     },
  ];

  return (
    <div className={`min-h-screen ${BG} text-white`} data-testid="admin-portal">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#060609]/92 backdrop-blur-2xl">
        <div className="mx-auto flex h-[56px] max-w-7xl items-center justify-between gap-3 px-5 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-300">
              <span className="font-mono text-[10px] font-black text-black">XA</span>
            </div>
            <span className="text-[14px] font-semibold">XauAI Sniper</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 font-mono text-[9px] text-white/40">ADMIN · v6.17.3</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-[11px] text-white/35 sm:block">{admin.email}</span>
            <a href="/" className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/70 transition">
              <ArrowLeft size={11} /> Site
            </a>
            <button onClick={handleLogout} data-testid="logout-btn" className="flex items-center gap-1 text-[11px] text-white/35 hover:text-white/70 transition">
              <SignOut size={11} /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="sticky top-[56px] z-40 border-b border-white/[0.06] bg-[#060609]/92 backdrop-blur-xl overflow-x-auto">
        <div className="mx-auto flex max-w-7xl gap-0 px-5 md:px-8 min-w-max">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} data-testid={`admin-tab-${t.id}`}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-[12px] font-semibold transition-colors whitespace-nowrap ${active ? "border-amber-300 text-white" : "border-transparent text-white/38 hover:text-white/65"}`}>
                <Icon size={13} weight={active ? "fill" : "regular"} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-5 md:px-8 py-7">
        {tab === "dashboard"    && <DashboardTab    api={api} token={token} />}
        {tab === "pins"         && <PinsTab         api={api} token={token} />}
        {tab === "command"      && <CommandOpsTab   api={api} token={token} />}
        {tab === "settings"     && <SettingsTab     api={api} token={token} />}
        {tab === "configurator" && <ConfigTab       api={api} token={token} />}
        {tab === "transactions" && <TransactionsTab api={api} token={token} />}
        {tab === "account"      && <AccountTab api={api} token={token} admin={admin} onLogin={handleLogin} onLogout={handleLogout} />}
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
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
    <div className={`min-h-screen ${BG} flex items-center justify-center p-6`} data-testid="admin-login-page">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-300">
            <span className="font-mono text-base font-black text-black">XA</span>
          </div>
          <h1 className="text-2xl font-semibold text-white">XauAI Admin</h1>
          <p className="mt-1 text-[13px] text-white/38">v6.17.3 management portal</p>
        </div>

        <form onSubmit={handleSubmit} className={`${CARD} p-6 space-y-4`}>
          <Field label="Email">
            <div className="relative">
              <Envelope size={14} className="absolute left-3 top-3 text-white/30" />
              <Input data-testid="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@xauaisniper.com" className="pl-9" />
            </div>
          </Field>

          <Field label="Password">
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-3 text-white/30" />
              <Input data-testid="admin-password" type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="pl-9 pr-9" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-3 text-white/30 hover:text-white/60">
                {showPw ? <EyeSlash size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          {error && <p className="text-[12px] text-red-300" data-testid="login-error">{error}</p>}

          <Btn type="submit" disabled={loading} className="w-full" data-testid="admin-login-btn">
            {loading ? "Logging in..." : "Log in"}
          </Btn>
        </form>

        <div className="mt-4 text-center">
          <a href="/" className="text-[11px] text-white/28 hover:text-white/55">← Back to site</a>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardTab({ api, token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const h = useMemo(() => auth(token), [token]);

  useEffect(() => {
    ax.get(`${api}/admin/dashboard`, h).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [api, h]);

  if (loading) return <div className="py-12 text-center text-white/40 text-sm">Loading dashboard…</div>;
  if (!data)   return <div className="py-12 text-center text-white/40 text-sm">Failed to load dashboard</div>;

  const b = data.bots;
  const rev = data.revenue;

  return (
    <div className="space-y-5" data-testid="admin-dashboard-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Licenses issued"   value={b.total_sold}       sub={`${b.sold_via_payment} paid · ${b.free_generated} manual`} testId="stat-total-sold" />
        <StatCard label="Activated"         value={b.actively_trading} sub={`${b.purchased_not_activated} waiting`} tone="green" testId="stat-active" />
        <StatCard label="Revoked"           value={b.revoked}          tone="red" testId="stat-revoked" />
        <StatCard label="Revenue"           value={rev.formatted_revenue} sub={`${rev.successful_payments} payments`} tone="amber" testId="stat-revenue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection title="License business overview" data-testid="license-business-overview">
          <p className="text-[13px] leading-6 text-white/45 mb-4">
            Tracks licenses sold, activation status, payments, and live bot operations. Trading performance lives in EA reports and the user Command Center.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className={`${CARD} p-4`}>
              <div className={LABEL}>Paid licenses</div>
              <div className={`${VALUE} mt-2 text-amber-200`}>{b.sold_via_payment}</div>
            </div>
            <div className={`${CARD} p-4`}>
              <div className={LABEL}>Manual licenses</div>
              <div className={`${VALUE} mt-2`}>{b.free_generated}</div>
            </div>
          </div>
        </CardSection>

        <CardSection title="Admin workflow" data-testid="admin-next-actions">
          <div className="space-y-2">
            {[
              ["Licenses", "Create, revoke, activate, and copy ASE license keys."],
              ["Bot Ops",  "Watch live heartbeat, command queue, and EA activity."],
              ["Payments", "Review Paystack transactions and generated license keys."],
              ["Settings", "Set license price, payment keys, and email delivery."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
                <div className="text-[13px] font-semibold">{title}</div>
                <div className="mt-0.5 text-[11px] text-white/40">{body}</div>
              </div>
            ))}
          </div>
        </CardSection>
      </div>
    </div>
  );
}

// ─── Pins / Licenses ──────────────────────────────────────────────────────────
function PinsTab({ api, token }) {
  const [pins, setPins] = useState([]);
  const [stats, setStats] = useState(null);
  const [genCount, setGenCount] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [copiedPin, setCopiedPin] = useState(null);
  const [generating, setGenerating] = useState(false);
  const h = useMemo(() => auth(token), [token]);

  const fetchPins = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([ax.get(`${api}/admin/pins`, h), ax.get(`${api}/admin/pins/stats`, h)]);
      setPins(p.data.pins || []); setStats(s.data);
    } catch {}
  }, [api, h]);

  useEffect(() => { fetchPins(); }, [fetchPins]);

  const generate = async () => {
    setGenerating(true);
    try {
      await ax.post(`${api}/admin/pins/generate`, { count: genCount, buyer_name: buyerName, buyer_email: buyerEmail, notes }, h);
      setBuyerName(""); setBuyerEmail(""); setNotes(""); await fetchPins();
    } catch {} finally { setGenerating(false); }
  };
  const revoke   = async (pin) => { await ax.put(`${api}/admin/pins/${pin}/revoke`,   {}, h); fetchPins(); };
  const activate = async (pin) => { await ax.put(`${api}/admin/pins/${pin}/activate`, {}, h); fetchPins(); };
  const del      = async (pin) => { await ax.delete(`${api}/admin/pins/${pin}`,            h); fetchPins(); };
  const copy = (pin) => { navigator.clipboard.writeText(pin); setCopiedPin(pin); setTimeout(() => setCopiedPin(null), 2000); };

  return (
    <div className="space-y-5" data-testid="admin-pins-tab">
      {stats && (
        <div className="grid grid-cols-5 gap-3" data-testid="admin-pin-stats">
          {[
            { l: "Total",   v: stats.total,   tone: "neutral" },
            { l: "Active",  v: stats.active,  tone: "green"   },
            { l: "Used",    v: stats.used,    tone: "amber"   },
            { l: "Unused",  v: stats.unused,  tone: "neutral" },
            { l: "Revoked", v: stats.revoked, tone: "red"     },
          ].map((s) => <StatCard key={s.l} label={s.l} value={s.v} tone={s.tone} />)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Generate form */}
        <CardSection title="Generate licenses" data-testid="admin-gen-form">
          <div className="space-y-3">
            <Field label="Buyer name">
              <Input data-testid="admin-pin-name" type="text" value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="Full name" />
            </Field>
            <Field label="Buyer email">
              <Input data-testid="admin-pin-email" type="email" value={buyerEmail} onChange={e => setBuyerEmail(e.target.value)} placeholder="buyer@email.com" />
            </Field>
            <Field label="Notes">
              <Input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional note" />
            </Field>
            <Field label="Count">
              <Input type="number" min={1} max={50} value={genCount} onChange={e => setGenCount(parseInt(e.target.value) || 1)} className="font-mono" />
            </Field>
            <Btn onClick={generate} disabled={generating} className="w-full" data-testid="admin-gen-btn">
              <Plus size={13} weight="bold" /> {generating ? "Generating…" : `Generate ${genCount} key${genCount > 1 ? "s" : ""}`}
            </Btn>
          </div>
        </CardSection>

        {/* Pin list */}
        <div className="lg:col-span-2">
          <CardSection title={`All licenses · ${pins.length}`} data-testid="admin-pin-list">
            <div className="max-h-[520px] overflow-y-auto -m-5 divide-y divide-white/[0.05]">
              {pins.length === 0 ? (
                <div className="p-8 text-center text-[13px] text-white/35">No licenses yet</div>
              ) : pins.map((p) => (
                <div key={p.pin} className="flex items-center gap-3 px-5 py-3" data-testid={`admin-pin-${p.pin}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] font-bold">{p.pin}</span>
                      <button onClick={() => copy(p.pin)} className="text-white/30 hover:text-white/70">
                        {copiedPin === p.pin ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      </button>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-white/35">
                      {p.buyer_name && <span>{p.buyer_name}</span>}
                      {p.buyer_email && <span>{p.buyer_email}</span>}
                      {p.payment_ref && <span className="text-amber-200">PAID</span>}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {p.is_used && <Badge tone="amber">Activated</Badge>}
                    <Badge tone={p.is_active ? "green" : "red"}>{p.is_active ? "Active" : "Revoked"}</Badge>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    {p.is_active
                      ? <button onClick={() => revoke(p.pin)}   title="Revoke"   className="rounded-lg p-1.5 text-white/30 hover:bg-red-400/10 hover:text-red-300"><ShieldCheck size={13} /></button>
                      : <button onClick={() => activate(p.pin)} title="Activate" className="rounded-lg p-1.5 text-white/30 hover:bg-emerald-400/10 hover:text-emerald-300"><ShieldCheck size={13} /></button>
                    }
                    <button onClick={() => del(p.pin)} title="Delete" className="rounded-lg p-1.5 text-white/30 hover:bg-red-400/10 hover:text-red-300"><Trash size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          </CardSection>
        </div>
      </div>
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsTab({ api, token }) {
  const [settings, setSettings] = useState(null);
  const [pk, setPk] = useState("");
  const [priceNaira, setPriceNaira] = useState(300000);
  const [smtpEmail, setSmtpEmail] = useState("");
  const [smtpPw, setSmtpPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const h = useMemo(() => auth(token), [token]);

  // v6.9.0 — global Gold/Index Mode platform switches (architecture phase)
  const [marketSettings, setMarketSettings] = useState(null);
  const [marketSaving, setMarketSaving] = useState(false);
  const [marketSaved, setMarketSaved] = useState(false);
  const [indexSymbolsInput, setIndexSymbolsInput] = useState("");

  useEffect(() => {
    ax.get(`${api}/admin/market-mode-settings`, h).then(r => {
      setMarketSettings(r.data);
      setIndexSymbolsInput((r.data.allowed_index_symbols || []).join(", "));
    }).catch(() => {});
  }, [api, h]);

  const saveMarketSettings = async () => {
    setMarketSaving(true);
    const payload = {
      ...marketSettings,
      allowed_index_symbols: indexSymbolsInput.split(",").map(s => s.trim().toUpperCase()).filter(Boolean),
    };
    try {
      const r = await ax.put(`${api}/admin/market-mode-settings`, payload, h);
      setMarketSettings(r.data.settings);
      setMarketSaved(true); setTimeout(() => setMarketSaved(false), 3000);
    } catch {} finally { setMarketSaving(false); }
  };

  useEffect(() => {
    ax.get(`${api}/admin/settings`, h).then(r => {
      setSettings(r.data); setPriceNaira(r.data.pin_price_naira || 300000); setSmtpEmail(r.data.smtp_email || "");
    }).catch(() => {});
  }, [api, h]);

  const save = async () => {
    setSaving(true);
    const updates = {};
    if (pk) updates.paystack_secret_key = pk;
    updates.pin_price_kobo = Math.round(priceNaira * 100);
    if (smtpEmail) updates.smtp_email = smtpEmail;
    if (smtpPw) updates.smtp_password = smtpPw;
    try {
      await ax.put(`${api}/admin/settings`, updates, h);
      setSaved(true); setPk(""); setSmtpPw(""); setTimeout(() => setSaved(false), 3000);
      const r = await ax.get(`${api}/admin/settings`, h); setSettings(r.data);
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-5" data-testid="admin-settings-tab">
      <CardSection title="Paystack configuration">
        <div className="space-y-4">
          <Field label="Paystack secret key">
            <Input data-testid="settings-paystack-key" type="password" value={pk} onChange={e => setPk(e.target.value)}
              placeholder={settings?.paystack_configured ? "Configured — enter new key to change" : "sk_live_xxxxxx"} className="font-mono" />
            <p className="mt-1 text-[11px] text-white/35">
              Status: <span className={settings?.paystack_configured ? "text-emerald-400" : "text-red-400"}>{settings?.paystack_configured ? "Configured" : "Not set"}</span>
              {settings?.paystack_key_preview && settings.paystack_configured && <span className="ml-1 font-mono">({settings.paystack_key_preview})</span>}
            </p>
          </Field>
          <Field label="PIN price (Naira)">
            <div className="flex items-center gap-2">
              <span className="text-white/50">₦</span>
              <Input data-testid="settings-price" type="number" value={priceNaira} onChange={e => setPriceNaira(parseInt(e.target.value) || 0)} className="font-mono" />
            </div>
            <p className="mt-1 text-[11px] text-white/35">Current: ₦{priceNaira?.toLocaleString()}</p>
          </Field>
        </div>
      </CardSection>

      <CardSection title="Email configuration (Gmail SMTP)">
        <p className="text-[12px] text-white/40 mb-4 leading-5">Auto-send license keys to buyers after payment. Use a Gmail App Password — <span className="text-white/60">myaccount.google.com → Security → App Passwords.</span></p>
        <div className="space-y-4">
          <Field label="Gmail address">
            <div className="relative">
              <Envelope size={13} className="absolute left-3 top-3 text-white/30" />
              <Input data-testid="settings-smtp-email" type="email" value={smtpEmail} onChange={e => setSmtpEmail(e.target.value)} placeholder="you@gmail.com" className="pl-9" />
            </div>
          </Field>
          <Field label="App password">
            <Input data-testid="settings-smtp-password" type="password" value={smtpPw} onChange={e => setSmtpPw(e.target.value)}
              placeholder={settings?.smtp_configured ? "Configured — enter new to change" : "xxxx xxxx xxxx xxxx"} className="font-mono" />
            <p className="mt-1 text-[11px] text-white/35">Status: <span className={settings?.smtp_configured ? "text-emerald-400" : "text-red-400"}>{settings?.smtp_configured ? "Configured" : "Not set"}</span></p>
          </Field>
        </div>
      </CardSection>

      <Btn onClick={save} disabled={saving} data-testid="settings-save-btn">
        <FloppyDisk size={14} weight="bold" /> {saving ? "Saving…" : saved ? "Saved!" : "Save settings"}
      </Btn>

      {/* v6.9.0 — Market Modes (architecture phase). These gate what the
          website/dashboard advertises, not live EA behavior — the EA's own
          InpIndexModeLogOnly safety switch is what actually blocks index
          trades until a real, tested index strategy exists. */}
      <CardSection title="Market modes">
        <p className="mb-4 text-[12px] leading-5 text-white/40">
          Controls what the public site and Command Center offer. Gold Mode is the live, fully tested strategy.
          Index Mode is currently detection + diagnostics only — no index entry strategy has shipped yet, so
          enabling it here only affects what customers see, not what the EA trades.
        </p>
        {!marketSettings ? (
          <p className="text-[12px] text-white/35">Loading…</p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5 cursor-pointer">
              <span>
                <span className="block text-[13px] font-semibold">Gold Mode enabled on platform</span>
                <span className="mt-0.5 block text-[11px] text-white/38">Live and fully tested for XAUUSD.</span>
              </span>
              <input type="checkbox" checked={!!marketSettings.platform_gold_mode_enabled}
                onChange={e => setMarketSettings(s => ({ ...s, platform_gold_mode_enabled: e.target.checked }))}
                className="h-5 w-5 accent-amber-300" />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3.5 cursor-pointer">
              <span>
                <span className="block text-[13px] font-semibold">Index Mode enabled on platform</span>
                <span className="mt-0.5 block text-[11px] text-white/38">Detection-only until a real index strategy ships. Leave off until then.</span>
              </span>
              <input type="checkbox" checked={!!marketSettings.platform_index_mode_enabled}
                onChange={e => setMarketSettings(s => ({ ...s, platform_index_mode_enabled: e.target.checked }))}
                className="h-5 w-5 accent-amber-300" />
            </label>
            <Field label="Allowed index symbols (comma-separated)">
              <Input value={indexSymbolsInput} onChange={e => setIndexSymbolsInput(e.target.value)}
                placeholder="US30, NAS100, GER40" className="font-mono" />
              <p className="mt-1 text-[11px] text-white/35">Only meaningful once a real index symbol/broker is confirmed — see docs/index_mode_state_and_scanner_design.md.</p>
            </Field>
            <Field label="Default trading universe">
              <select value={marketSettings.default_trading_universe}
                onChange={e => setMarketSettings(s => ({ ...s, default_trading_universe: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] text-white outline-none focus:border-amber-300/40">
                <option value="GOLD_ONLY">Gold only</option>
                <option value="INDEX_ONLY">Index only</option>
                <option value="GOLD_AND_INDEX">Gold + Index</option>
              </select>
              <p className="mt-1 text-[11px] text-white/35">Stays Gold only until Index Mode is fully tested — matches the EA's own default.</p>
            </Field>
            <Btn onClick={saveMarketSettings} disabled={marketSaving}>
              <FloppyDisk size={14} weight="bold" /> {marketSaving ? "Saving…" : marketSaved ? "Saved!" : "Save market modes"}
            </Btn>
          </div>
        )}
      </CardSection>
    </div>
  );
}

// ─── EA Config ────────────────────────────────────────────────────────────────
function ConfigTab({ api, token }) {
  const PRESETS = [
    { id: "conservative", label: "Conservative", icon: ShieldCheck, wt: 20, risk: 0.5,  trades: 2, conf: 85, tone: "green"  },
    { id: "moderate",     label: "Moderate",     icon: Lightning,   wt: 35, risk: 1.0,  trades: 3, conf: 75, tone: "amber"  },
    { id: "aggressive",   label: "Aggressive",   icon: Flame,       wt: 50, risk: 1.5,  trades: 5, conf: 65, tone: "red"    },
  ];
  const [config, setConfig] = useState({ name: "Default", risk_percent: 1, daily_loss_limit: 3, weekly_drawdown_limit: 5, weekly_profit_target: 35, max_open_trades: 2, max_trades_per_day: 3, enable_trend_mode: true, enable_range_mode: true, enable_breakout_mode: true, confidence_threshold: 75, ema_fast: 50, ema_slow: 200, min_rr_ratio: 1.5, partial_close_percent: 50, trailing_atr_multi: 1.5, sl_atr_multiplier: 2, trade_london: true, trade_new_york: true, equity_protection: 70, profit_mode: "moderate" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const h = { headers: { Authorization: `Bearer ${token}` } };

  const u = (k, v) => { setConfig(p => ({ ...p, [k]: v })); setSaved(false); };
  const applyPreset = (p) => setConfig(prev => ({ ...prev, weekly_profit_target: p.wt, risk_percent: p.risk, max_trades_per_day: p.trades, confidence_threshold: p.conf, profit_mode: p.id }));
  const save = async () => {
    setSaving(true);
    try { await ax.post(`${api}/admin/configs`, config, h); setSaved(true); setTimeout(() => setSaved(false), 3000); } catch {} finally { setSaving(false); }
  };

  return (
    <div className="space-y-5" data-testid="admin-config-tab">
      <div className="grid grid-cols-3 gap-3">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const sel = config.profit_mode === p.id;
          const toneClasses = { green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", amber: "border-amber-300/30 bg-amber-300/10 text-amber-200", red: "border-red-400/30 bg-red-500/10 text-red-300" };
          return (
            <button key={p.id} onClick={() => applyPreset(p)} data-testid={`admin-preset-${p.id}`}
              className={`rounded-2xl border p-4 text-left transition ${sel ? toneClasses[p.tone] : "border-white/[0.08] bg-white/[0.03] text-white/55 hover:border-white/[0.14]"}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} weight={sel ? "fill" : "regular"} />
                <span className="text-[11px] font-bold uppercase tracking-[0.1em]">{p.label}</span>
              </div>
              <div className="font-mono text-xl font-black">{p.wt}%<span className="text-[11px] font-medium text-white/40 ml-1">/wk</span></div>
              <div className="mt-1 text-[11px] text-white/38">Risk {p.risk}% · {p.trades}/day max</div>
            </button>
          );
        })}
      </div>

      <CardSection title="Parameters">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          {[["Risk %","risk_percent",0.1,3,0.1],["Daily loss","daily_loss_limit",1,10,0.5],["Weekly DD","weekly_drawdown_limit",5,20,1],["Weekly target","weekly_profit_target",10,100,5],["Confidence","confidence_threshold",50,95,5],["Min R:R","min_rr_ratio",1,5,0.1]].map(([l, k, mn, mx, st]) => {
            const v = config[k];
            const pct = ((v - mn) / (mx - mn)) * 100;
            return (
              <div key={k}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-[12px] text-white/55">{l}</span>
                  <span className="font-mono text-[12px] font-bold">{Number.isInteger(v) ? v : v.toFixed(1)}</span>
                </div>
                <input type="range" min={mn} max={mx} step={st} value={v} onChange={e => u(k, parseFloat(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-amber-300"
                  style={{ background: `linear-gradient(to right, #d4af37 ${pct}%, rgba(255,255,255,0.1) ${pct}%)` }} />
              </div>
            );
          })}
        </div>
      </CardSection>

      <Btn onClick={save} disabled={saving} data-testid="admin-config-save">
        <FloppyDisk size={14} weight="bold" /> {saving ? "Saving…" : saved ? "Saved!" : "Save config"}
      </Btn>
    </div>
  );
}

// ─── Transactions ─────────────────────────────────────────────────────────────
function TransactionsTab({ api, token }) {
  const [txs, setTxs] = useState([]);
  const h = useMemo(() => auth(token), [token]);
  useEffect(() => { ax.get(`${api}/admin/transactions`, h).then(r => setTxs(r.data.transactions || [])).catch(() => {}); }, [api, h]);

  return (
    <div className="space-y-4" data-testid="admin-transactions-tab">
      <CardSection title={`Payment transactions · ${txs.length}`}>
        {txs.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-white/35">No transactions yet</p>
        ) : (
          <div className="overflow-x-auto -m-5">
            <table className="w-full text-[12px] min-w-[640px]">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["Reference","Buyer","Amount","Status","PIN","Date"].map(h => (
                    <th key={h} className={`px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/35 ${h==="Amount" ? "text-right" : h==="Status" ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {txs.map((t) => (
                  <tr key={t.reference}>
                    <td className="px-5 py-3 font-mono text-[11px] text-white/55">{t.reference}</td>
                    <td className="px-5 py-3"><div>{t.buyer_name}</div><div className="text-white/35">{t.buyer_email}</div></td>
                    <td className="px-5 py-3 text-right font-mono">₦{(t.amount_kobo / 100).toLocaleString()}</td>
                    <td className="px-5 py-3 text-center">
                      <Badge tone={t.payment_status === "success" ? "green" : "amber"}>{(t.payment_status || "pending").toUpperCase()}</Badge>
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px]">{t.pin_generated || "—"}</td>
                    <td className="px-5 py-3 text-white/40">{t.created_at?.split("T")[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardSection>
    </div>
  );
}

// ─── Bot Ops ──────────────────────────────────────────────────────────────────
function CommandOpsTab({ api, token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const h = useMemo(() => auth(token), [token]);

  const fetchOps = useCallback(async () => {
    setLoading(true);
    try { const res = await ax.get(`${api}/admin/command-center/overview`, h); setData(res.data); } catch {} finally { setLoading(false); }
  }, [api, h]);

  useEffect(() => { fetchOps(); }, [fetchOps]);

  if (loading) return <div className="py-12 text-center text-white/40 text-sm">Loading bot operations…</div>;
  if (!data)   return <div className="py-12 text-center text-white/40 text-sm">Failed to load bot operations</div>;

  const bot      = data.bot      || {};
  const licenses = data.licenses || {};
  const commands = data.commands || {};
  const activity = data.activity || [];
  const online   = bot.online;

  return (
    <div className="space-y-5" data-testid="admin-command-ops-tab">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Bot operations</h3>
          <p className="mt-0.5 text-[13px] text-white/40">Fleet heartbeat, command queue, and recent EA events.</p>
        </div>
        <Btn variant="ghost" onClick={fetchOps}>Refresh</Btn>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Active licenses"      value={licenses.active || 0}           sub={`${licenses.activated || 0} activated`} tone="green" />
        <StatCard label="Linked MT5 accounts"  value={licenses.linked_accounts || 0}  sub={`${licenses.total || 0} total`} />
        <StatCard label="Bot heartbeat"        value={online ? "Online" : "Offline"}  sub={bot.last_heartbeat ? bot.last_heartbeat.slice(0, 16).replace("T", " ") : "never"} tone={online ? "green" : "red"} />
        <StatCard label="Pending commands"     value={commands.pending || 0}           sub={`${commands.executed || 0} executed · ${commands.failed || 0} failed`} tone={commands.failed ? "red" : "neutral"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection title="Latest bot heartbeat">
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            {[
              ["Status",         bot.status || (online ? "ONLINE" : "OFFLINE")],
              ["EA version",     bot.ea_version || "—"],
              ["Account",        bot.account_number || "—"],
              ["Broker",         bot.broker_server  || "—"],
              ["Symbol",         `${bot.symbol || "—"} ${bot.timeframe || ""}`.trim()],
              ["Open positions", bot.open_positions ?? "—"],
              ["Algo trading",   bot.algo_trading    ? "Enabled"  : "Disabled"],
              ["Trading",        bot.trading_allowed ? "Allowed"  : "Not allowed"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <div className={`${LABEL} mb-1`}>{label}</div>
                <div className="font-mono text-[12px] font-bold break-words">{value}</div>
              </div>
            ))}
          </div>
        </CardSection>

        <CardSection title="Recent commands">
          <div className="-m-5 divide-y divide-white/[0.05] max-h-[340px] overflow-y-auto">
            {(commands.recent || []).length === 0 ? (
              <p className="p-6 text-center text-[13px] text-white/35">No remote commands yet.</p>
            ) : (commands.recent || []).map((cmd) => (
              <div key={cmd.id} className="px-5 py-3">
                <div className="flex justify-between gap-3">
                  <div className="text-[13px] font-semibold">{cmd.label || cmd.action}</div>
                  <Badge tone={cmd.status === "EXECUTED" ? "green" : cmd.status === "FAILED" ? "red" : "amber"}>{cmd.status}</Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-white/35">{cmd.user_email || "user"} · {cmd.requested_at?.slice(0, 16).replace("T", " ")}</div>
              </div>
            ))}
          </div>
        </CardSection>
      </div>

      <CardSection title="Recent EA activity">
        <div className="-m-5 divide-y divide-white/[0.05] max-h-[420px] overflow-y-auto">
          {activity.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-white/35">No EA activity events yet.</p>
          ) : activity.map((event) => (
            <div key={event.id} className="px-5 py-3">
              <div className="flex justify-between gap-3">
                <div className="text-[13px] font-semibold">{event.event_type}</div>
                <Badge tone={["TRADE","COMMAND"].includes(event.severity) ? "green" : ["BLOCK","WARNING"].includes(event.severity) ? "amber" : ["ERROR","CRITICAL"].includes(event.severity) ? "red" : "neutral"}>{event.severity}</Badge>
              </div>
              <div className="mt-0.5 text-[12px] text-white/50">{event.message}</div>
              <div className="mt-0.5 text-[11px] text-white/30">{event.account || "account"} · {event.ts?.slice(0, 16).replace("T", " ")}</div>
            </div>
          ))}
        </div>
      </CardSection>
    </div>
  );
}

// ─── Account ──────────────────────────────────────────────────────────────────
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
    if (!currentPassword) { setError("Enter your current password to confirm changes."); return; }
    if (newPassword && newPassword !== confirmPassword) { setError("New passwords don't match."); return; }
    if (newPassword && newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (!newEmail.includes("@")) { setError("Enter a valid email address."); return; }
    setSaving(true);
    try {
      const body = { current_password: currentPassword };
      if (newEmail !== admin?.email) body.new_email = newEmail;
      if (newPassword) body.new_password = newPassword;
      const res = await ax.put(`${api}/admin/account`, body, h);
      if (res.data.updated) {
        setMessage("Account updated.");
        if (res.data.token) onLogin(res.data.token);
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
    <div className="max-w-md space-y-5" data-testid="admin-account-tab">
      <CardSection title="Admin account">
        <div className="space-y-5">
          <div className="flex items-center gap-3 pb-4 border-b border-white/[0.06]">
            <UserCircle size={30} weight="duotone" className="text-amber-200" />
            <div>
              <div className="text-[14px] font-semibold">{admin?.name || "Admin"}</div>
              <div className="text-[12px] text-white/40">{admin?.email}</div>
              <div className="mt-0.5 font-mono text-[10px] text-amber-200">ADMIN · v6.17.3</div>
            </div>
          </div>

          <Field label="Email address">
            <div className="relative">
              <Envelope size={13} className="absolute left-3 top-3 text-white/30" />
              <Input data-testid="account-email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="pl-9" />
            </div>
          </Field>

          <Field label={<span>New password <span className="text-white/30 font-normal">(leave blank to keep)</span></span>}>
            <div className="relative">
              <Lock size={13} className="absolute left-3 top-3 text-white/30" />
              <Input data-testid="account-new-password" type={showNew ? "text" : "password"} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password" className="pl-9 pr-9" />
              <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-3 text-white/30 hover:text-white/60">{showNew ? <EyeSlash size={13} /> : <Eye size={13} />}</button>
            </div>
          </Field>

          {newPassword && (
            <Field label="Confirm new password">
              <Input data-testid="account-confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" />
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="mt-1 text-[11px] text-red-300">Passwords don't match</p>
              )}
            </Field>
          )}

          <div className="pt-4 border-t border-white/[0.06]">
            <Field label={<span>Current password <span className="text-red-400">*</span></span>}>
              <p className="mb-1.5 text-[11px] text-white/35">Required to confirm any changes</p>
              <div className="relative">
                <Lock size={13} className="absolute left-3 top-3 text-white/30" />
                <Input data-testid="account-current-password" type={showCurrent ? "text" : "password"} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Current password" className="pl-9 pr-9" />
                <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-3 text-white/30 hover:text-white/60">{showCurrent ? <EyeSlash size={13} /> : <Eye size={13} />}</button>
              </div>
            </Field>
          </div>

          {error   && <p className="text-[12px] text-red-300"     data-testid="account-error">{error}</p>}
          {message && <p className="text-[12px] text-emerald-400" data-testid="account-success">{message}</p>}

          <Btn onClick={handleSave} disabled={saving} className="w-full" data-testid="account-save-btn">
            <FloppyDisk size={13} weight="bold" /> {saving ? "Updating…" : "Update account"}
          </Btn>

          <Btn variant="danger" onClick={onLogout} className="w-full">
            <SignOut size={13} /> Log out
          </Btn>
        </div>
      </CardSection>
    </div>
  );
}
