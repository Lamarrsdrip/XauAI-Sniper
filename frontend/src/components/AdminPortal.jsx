import React, { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import EmailComposer from "./admin/EmailComposer";
import MarketingControl from "./admin/MarketingControl";
import {
  Key, GearSix, SignOut, ShieldCheck, Copy, Check, Trash, Plus,
  UserCircle, CurrencyNgn, Envelope, Lock, Eye, EyeSlash, ArrowLeft,
  FloppyDisk, Megaphone,
  House, Pulse, TrendUp, Bell, ArrowClockwise, WarningCircle, Bank,
} from "@phosphor-icons/react";

const ax = axios.create({ withCredentials: true });
const auth = () => ({});

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG   = "bg-[#060609]";
const CARD = "bg-[#0c0d11] border border-white/[0.08] rounded-2xl";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.18em] text-white/35";
const VALUE = "font-mono text-xl font-black";

function Badge({ tone = "neutral", children }) {
  const cls = {
    green:  "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
    red:    "bg-red-500/10 text-red-300 border-red-400/20",
    amber:  "bg-gold-300/10 text-gold-200 border-gold-300/20",
    neutral:"bg-white/[0.06] text-white/55 border-white/[0.08]",
  }[tone] || "bg-white/[0.06] text-white/55 border-white/[0.08]";
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>;
}

function StatCard({ label, value, sub, tone = "neutral", testId }) {
  const color = { green: "text-emerald-300", red: "text-red-300", amber: "text-gold-200", neutral: "text-white" }[tone] || "text-white";
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
      className={`w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-[13px] text-white outline-none placeholder:text-white/25 focus:border-gold-300/50 ${className}`}
      {...props}
    />
  );
}

function Btn({ children, variant = "primary", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold transition disabled:opacity-40";
  const v = {
    primary: "bg-gold-300 text-black hover:bg-gold-200",
    ghost:   "border border-white/[0.08] bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/[0.08]",
    danger:  "bg-red-500/15 text-red-300 border border-red-400/20 hover:bg-red-500/25",
    green:   "bg-emerald-400/15 text-emerald-300 border border-emerald-400/20 hover:bg-emerald-400/25",
  }[variant] || "";
  return <button className={`${base} ${v} ${className}`} {...props}>{children}</button>;
}

// ─── Main portal ──────────────────────────────────────────────────────────────
export default function AdminPortal({ api }) {
  const [admin, setAdmin] = useState(null);
  const [tab, setTab] = useState("dashboard");

  const checkAuth = useCallback(async () => {
    try {
      const res = await ax.get(`${api}/auth/me`);
      setAdmin(res.data);
    } catch {
      setAdmin(null);
    }
  }, [api]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const handleLogin  = (user) => { setAdmin(user); };
  const handleLogout = () => {
    setAdmin(null);
    ax.post(`${api}/auth/logout`).catch(() => {});
  };

  if (!admin) return <LoginPage api={api} onLogin={handleLogin} />;

  // Grouped operations nav (owner spec): Overview / Customers / Money /
  // Trading / Comms / System — desktop sidebar, mobile horizontal scroll.
  const NAV_GROUPS = [
    { label: "Overview",  tabs: [["dashboard", "Dashboard", House]] },
    { label: "Customers", tabs: [["pins", "Licenses", Key]] },
    { label: "Money",     tabs: [["transactions", "Payments", CurrencyNgn], ["bankTransfers", "Bank Transfers", Bank]] },
    { label: "Trading",   tabs: [["command", "Bot Ops", Pulse], ["performance", "Performance", TrendUp]] },
    { label: "Comms",     tabs: [["marketing", "Marketing", Megaphone], ["notifications", "Notifications", Bell], ["email", "Email", Envelope], ["xPosting", "X Posting", Megaphone]] },
    { label: "System",    tabs: [["settings", "Settings", GearSix], ["account", "Account", UserCircle]] },
  ];
  const ALL_TABS = NAV_GROUPS.flatMap((g) => g.tabs);

  return (
    <div className={`min-h-screen ${BG} text-white`} data-testid="admin-portal">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[#060609]/92 pt-safe-top backdrop-blur-2xl">
        <div className="mx-auto flex h-[56px] max-w-7xl items-center justify-between gap-3 px-5 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold-300">
              <span className="font-mono text-[10px] font-black text-black">XA</span>
            </div>
            <span className="text-[14px] font-semibold">XauCloud</span>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 font-mono text-[9px] text-white/40">ADMIN · PUBLISHED RELEASE</span>
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

      {/* Mobile grouped nav — horizontal scroll */}
      <div className="sticky top-[calc(56px+max(env(safe-area-inset-top),0.7rem))] z-40 overflow-x-auto border-b border-white/[0.06] bg-[#060609]/92 backdrop-blur-xl md:hidden">
        <div className="flex min-w-max gap-0 px-4">
          {ALL_TABS.map(([id, label, Icon]) => {
            const active = tab === id;
            return (
              <button key={id} onClick={() => setTab(id)} data-testid={`admin-tab-${id}`}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-3 text-[12px] font-semibold transition-colors ${active ? "border-gold-300 text-white" : "border-transparent text-white/38 hover:text-white/65"}`}>
                <Icon size={13} weight={active ? "fill" : "regular"} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body: desktop grouped sidebar + content */}
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 md:px-8">
        <aside className="hidden w-52 flex-none md:block">
          <nav className="sticky top-[80px] space-y-5">
            {NAV_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">{g.label}</div>
                <div className="space-y-0.5">
                  {g.tabs.map(([id, label, Icon]) => {
                    const active = tab === id;
                    return (
                      <button key={id} onClick={() => setTab(id)} data-testid={`admin-tab-desktop-${id}`}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition ${active ? "bg-gold-300 text-black" : "text-white/50 hover:bg-white/[0.05] hover:text-white"}`}>
                        <Icon size={15} weight={active ? "fill" : "regular"} />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">
          {tab === "dashboard"     && <DashboardTab     api={api} />}
          {tab === "pins"          && <PinsTab          api={api} />}
          {tab === "command"       && <CommandOpsTab    api={api} />}
          {tab === "notifications" && <NotificationsTab api={api} />}
          {tab === "email"         && <EmailComposer    api={api} />}
          {tab === "xPosting"      && <XPostingTab      api={api} />}
          {tab === "marketing"     && <MarketingControl api={api} />}
          {tab === "performance"   && <PerformanceTab   api={api} />}
          {tab === "settings"      && <SettingsTab      api={api} />}
          {tab === "transactions"  && <TransactionsTab  api={api} />}
          {tab === "bankTransfers" && <BankTransfersTab api={api} />}
          {tab === "account"       && <AccountTab api={api} admin={admin} onLogin={handleLogin} onLogout={handleLogout} />}
        </main>
      </div>
    </div>
  );
}

function XPostingTab({ api }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try { const response = await ax.get(`${api}/admin/x-posting`); setStatus(response.data); }
    catch { setMessage("Could not load X posting status."); }
  }, [api]);
  useEffect(() => { load(); }, [load]);
  const setAuto = async (enabled) => {
    if (!window.confirm(enabled ? "Enable automatic X posts for genuine closed trades?" : "Disable automatic X posts?")) return;
    setBusy(true); setMessage("");
    try { await ax.put(`${api}/admin/x-posting`, { auto_post_enabled: enabled, confirm: true }); await load(); setMessage(enabled ? "Automatic X posting enabled." : "Automatic X posting disabled."); }
    catch (error) { setMessage(error.response?.data?.detail || "X posting setting could not be changed."); }
    finally { setBusy(false); }
  };
  const configured = Boolean(status?.configured);
  return <div className="max-w-2xl space-y-5" data-testid="admin-x-posting-tab">
    <CardSection title="X trade posting">
      <div className="space-y-4 text-[13px] text-white/55">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={configured ? "green" : "amber"}>{configured ? "X account configured" : "X account needs setup"}</Badge><Badge tone={status?.auto_post_enabled ? "green" : "neutral"}>{status?.auto_post_enabled ? "Automatic posting ON" : "Automatic posting OFF"}</Badge></div>
        <p>Posts are created only from authenticated, final XauCloud trade-journal closes. Account numbers, licenses, balances and credentials are never posted.</p>
        {!configured && <div className="rounded-xl border border-gold-300/20 bg-gold-300/[0.06] p-4 leading-6 text-gold-100/80"><strong className="text-gold-200">Setup required:</strong> Add the X OAuth Client ID and Client Secret to the production server environment, then connect the official publishing account. Tokens are never entered, displayed, or stored in this dashboard.<div className="mt-3"><Btn disabled={!status?.oauth_client_configured} onClick={() => { window.location.assign(`${api}/admin/x-posting/oauth/connect`); }}>Connect official X account</Btn>{!status?.oauth_client_configured && <p className="mt-2 text-[11px] text-gold-100/65">The server OAuth credentials still need to be configured.</p>}</div></div>}
        {configured && <p>Publishing account: <span className="font-mono text-white/80">{status.account_username || "configured (username not supplied)"}</span></p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Queued", status?.queue?.queued], ["Posting", status?.queue?.posting], ["Posted", status?.queue?.posted], ["Needs review", status?.queue?.failed]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3"><div className={LABEL}>{label}</div><div className="mt-1 font-mono text-lg font-bold text-white">{value ?? "—"}</div></div>)}</div>
        <div className="flex flex-wrap gap-2"><Btn disabled={busy || !configured || status?.auto_post_enabled} onClick={() => setAuto(true)}>Enable automatic posting</Btn><Btn variant="ghost" disabled={busy || !status?.auto_post_enabled} onClick={() => setAuto(false)}>Disable automatic posting</Btn></div>
        {message && <p className="text-[12px] text-white/65">{message}</p>}
      </div>
    </CardSection>
  </div>;
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginPage({ api, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Bug fix (Command Center admin audit, 2026-08-04): POST /auth/login
  // returns {mfa_required: true, mfa_token} instead of a session when the
  // account has MFA enabled -- no cookie is set for that response. This
  // used to be passed straight to onLogin(), which made the portal render
  // as "logged in" with no real session, so every subsequent API call
  // 401'd silently. Now handled as its own step.
  const [mfaToken, setMfaToken] = useState(null);
  const [mfaCode, setMfaCode] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const res = await ax.post(`${api}/auth/login`, { email, password });
      if (res.data?.mfa_required) {
        setMfaToken(res.data.mfa_token);
      } else {
        onLogin(res.data);
      }
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Login failed");
    } finally { setLoading(false); }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      const res = await ax.post(`${api}/auth/login/mfa`, { mfa_token: mfaToken, code: mfaCode });
      onLogin(res.data);
    } catch (err) {
      const d = err.response?.data?.detail;
      setError(typeof d === "string" ? d : "Incorrect code.");
    } finally { setLoading(false); }
  };

  return (
    <div className={`min-h-screen ${BG} flex items-center justify-center p-6`} data-testid="admin-login-page">
      <div className="w-full max-w-sm">
        <div className="text-center mb-7">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-300">
            <span className="font-mono text-base font-black text-black">XA</span>
          </div>
          <h1 className="text-2xl font-semibold text-white">XauCloud Admin</h1>
          <p className="mt-1 text-[13px] text-white/38">Operations console</p>
        </div>

        {!mfaToken ? (
          <form onSubmit={handleSubmit} className={`${CARD} p-6 space-y-4`}>
            <Field label="Email">
              <div className="relative">
                <Envelope size={14} className="absolute left-3 top-3 text-white/30" />
                <Input data-testid="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@xaucloud.io" className="pl-9" />
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
        ) : (
          <form onSubmit={handleMfaSubmit} className={`${CARD} p-6 space-y-4`} data-testid="admin-mfa-form">
            <div>
              <div className="text-[14px] font-semibold text-white">Two-factor code</div>
              <p className="mt-1 text-[12px] text-white/40">Enter the 6-digit code from your authenticator app.</p>
            </div>
            <Field label="Code">
              <Input data-testid="admin-mfa-code" inputMode="numeric" autoFocus maxLength={6}
                value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456" className="text-center font-mono text-lg tracking-[0.3em]" />
            </Field>
            {error && <p className="text-[12px] text-red-300" data-testid="mfa-error">{error}</p>}
            <Btn type="submit" disabled={loading || mfaCode.length !== 6} className="w-full" data-testid="admin-mfa-submit">
              {loading ? "Verifying..." : "Verify and log in"}
            </Btn>
            <button type="button" onClick={() => { setMfaToken(null); setMfaCode(""); setError(""); }}
              className="w-full text-center text-[11px] text-white/35 hover:text-white/60">
              ← Use a different account
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <a href="/" className="text-[11px] text-white/28 hover:text-white/55">← Back to site</a>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function DashboardTab({ api }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const h = useMemo(() => auth(), []);

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
              <div className={`${VALUE} mt-2 text-gold-200`}>{b.sold_via_payment}</div>
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

// ─── Notifications ────────────────────────────────────────────────────────────
// v6.25.3 owner directive 2026-07-17 -- switched from self-hosted Web Push
// (pywebpush + VAPID, permanently blocked by a missing Python package that
// only a full backend rebuild could fix) to OneSignal's REST API (plain
// HTTPS POST via `httpx`, already installed and working). Real, live
// visibility into push health, backed by GET /admin/notifications/health.
// The only "not configured" state now is the admin not having entered a
// real OneSignal App ID + REST API Key yet -- see the Settings tab.
function NotificationsTab({ api }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const h = useMemo(() => auth(), []);

  const load = useCallback(() => {
    setLoading(true); setError("");
    ax.get(`${api}/admin/notifications/health`, h)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || "Failed to load notification health"))
      .finally(() => setLoading(false));
  }, [api, h]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div className="py-12 text-center text-white/40 text-sm">Loading notification health…</div>;

  const onesignal = data?.onesignal || {};
  // First-party Web Push (VAPID) is self-managed — keys generate on the server,
  // no admin config required — so push is always available (no OneSignal).
  const configured = true;

  return (
    <div className="space-y-5" data-testid="admin-notifications-tab">
      <CardSection
        title="Push notification system health"
        action={
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/75 transition">
            <ArrowClockwise size={13} /> Refresh
          </button>
        }
      >
        {error && <p className="mb-3 text-[12px] text-red-300">{error}</p>}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard label="Push (VAPID)" value="Active" tone="green" testId="stat-onesignal-configured" />
          <StatCard label="Subscribed devices" value={data?.subscribed_devices ?? "—"} testId="stat-device-count" />
          <StatCard label="State" value={onesignal.initialization_state || "—"} tone="neutral" testId="stat-init-state" />
        </div>

        {!configured && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-gold-300/25 bg-gold-300/[0.06] p-4">
            <WarningCircle size={18} className="mt-0.5 flex-none text-gold-300" />
            <div>
              <div className="text-[13px] font-semibold text-gold-200">No notification can be delivered yet</div>
              <p className="mt-1 text-[12px] leading-5 text-gold-100/80">{onesignal.remediation}</p>
              <p className="mt-2 text-[11px] leading-5 text-white/40">
                Go to the Settings tab and enter your OneSignal App ID + REST API Key. Unlike the retired VAPID
                system, this takes effect immediately -- no backend restart needed.
              </p>
            </div>
          </div>
        )}

        {configured && (
          <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-300/[0.06] p-4 text-[12px] text-emerald-200">
            {onesignal.remediation}
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className={`${CARD} p-4`}>
            <div className={LABEL}>Last successful send</div>
            {data?.last_successful_send ? (
              <div className="mt-2 text-[12px] text-white/70">{data.last_successful_send.scheduled_time}</div>
            ) : (
              <div className="mt-2 text-[12px] text-white/35">None recorded yet</div>
            )}
          </div>
          <div className={`${CARD} p-4`}>
            <div className={LABEL}>Last failed send</div>
            {data?.last_failed_send ? (
              <div className="mt-2 text-[12px] text-red-200">
                {data.last_failed_send.scheduled_time} — {data.last_failed_send.delivery_status}
                {data.last_failed_send.failure_reason ? ` (${data.last_failed_send.failure_reason})` : ""}
              </div>
            ) : (
              <div className="mt-2 text-[12px] text-white/35">None recorded yet</div>
            )}
          </div>
        </div>
      </CardSection>
    </div>
  );
}

// ─── Performance / Reporting Periods ────────────────────────────────────────
function fmtNum(v, digits = 1) {
  return v == null || Number.isNaN(v) ? "--" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function fmtDate(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--" : d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function StartPeriodDialog({ api, h, onDone, onCancel }) {
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [accountLogins, setAccountLogins] = useState("");
  const [eaVersions, setEaVersions] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("form"); // form | confirm
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await ax.post(`${api}/admin/performance/periods/start`, {
        name,
        reason,
        account_logins: accountLogins.split(",").map(s => s.trim()).filter(Boolean) || undefined,
        ea_versions: eaVersions.split(",").map(s => s.trim()).filter(Boolean) || undefined,
        current_password: password,
        confirm: true,
      }, h);
      onDone();
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to start new period — check your password and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" data-testid="start-period-dialog">
      <div className={`${CARD} w-full max-w-lg`}>
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/[0.06]">
          <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/45">Start new forward period</h4>
        </div>
        <div className="p-5 space-y-4">
          {step === "form" && (
            <>
              <p className="text-[12px] leading-5 text-white/45">
                This archives the current active period (nothing is deleted) and starts a brand-new, honest forward
                record from this exact moment. Only trades opened after this timestamp will count toward the new period's
                win rate, profit factor, and drawdown.
              </p>
              <Field label="Period name">
                <Input data-testid="start-period-name" value={name} onChange={e => setName(e.target.value)} placeholder="XauCloud Forward Record — July 2026" />
              </Field>
              <Field label="Reason">
                <Input data-testid="start-period-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why start a new period now" />
              </Field>
              <Field label="Account logins (optional, comma-separated)">
                <Input data-testid="start-period-accounts" value={accountLogins} onChange={e => setAccountLogins(e.target.value)} placeholder="Leave blank to include all" />
              </Field>
              <Field label="EA versions (optional, comma-separated)">
                <Input data-testid="start-period-versions" value={eaVersions} onChange={e => setEaVersions(e.target.value)} placeholder="Leave blank to include all" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
                <Btn variant="primary" disabled={!name || !reason} onClick={() => setStep("confirm")}>Continue</Btn>
              </div>
            </>
          )}
          {step === "confirm" && (
            <>
              <div className="rounded-xl border border-gold-300/20 bg-gold-300/[0.06] p-4 text-[12px] leading-5 text-gold-100">
                You're about to archive the current period and start <span className="font-bold">"{name}"</span> effective
                immediately. The homepage will show <span className="font-bold">0 closed trades</span> until real trades
                close after this moment. This action is logged with your admin account and cannot be undone.
              </div>
              <Field label="Confirm your password">
                <Input data-testid="start-period-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Current admin password" />
              </Field>
              {error && <p className="text-[12px] text-red-400">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Btn variant="ghost" onClick={() => setStep("form")} disabled={saving}>Back</Btn>
                <Btn variant="danger" disabled={!password || saving} onClick={submit}>{saving ? "Starting…" : "Start new period"}</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PerformanceTab({ api }) {
  const h = useMemo(() => auth(), []);
  const [periods, setPeriods] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await ax.get(`${api}/admin/performance/periods`, h);
      setPeriods(r.data.periods || []);
    } catch {
      setPeriods(null);
    } finally {
      setLoading(false);
    }
  }, [api, h]);

  useEffect(() => { load(); }, [load]);

  const active = periods?.find(p => p.status === "ACTIVE");
  const archived = periods?.filter(p => p.status !== "ACTIVE") || [];

  return (
    <div className="max-w-3xl space-y-5" data-testid="admin-performance-tab">
      <CardSection
        title="Active reporting period"
        action={<Btn variant="primary" onClick={() => setDialogOpen(true)} data-testid="start-new-period-btn"><ArrowClockwise size={13} /> Start New Forward Period</Btn>}
      >
        {loading && <p className="text-[12px] text-white/40">Loading…</p>}
        {!loading && !periods && <p className="text-[12px] text-white/40">Could not load reporting periods.</p>}
        {!loading && periods && !active && <p className="text-[12px] text-white/40">No active period yet. Start one to begin honest forward tracking.</p>}
        {active && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold">{active.period_name}</span>
              <Badge tone="green">ACTIVE</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <div className={LABEL}>Started</div>
                <div className="mt-1 text-[13px] font-mono">{fmtDate(active.epoch_started_at)}</div>
              </div>
              <div>
                <div className={LABEL}>Closed trades</div>
                <div className="mt-1 text-[13px] font-mono">{active.total_trades ?? "--"}</div>
              </div>
              <div>
                <div className={LABEL}>Status</div>
                <div className="mt-1 text-[13px] font-mono">{active.sufficient_data ? "Reporting live" : `Collecting (${active.minimum_sample || 20} needed)`}</div>
              </div>
              <div>
                <div className={LABEL}>Account scope</div>
                <div className="mt-1 text-[13px] font-mono">{active.account_logins?.length ? active.account_logins.join(", ") : "All accounts"}</div>
              </div>
              <div>
                <div className={LABEL}>EA version scope</div>
                <div className="mt-1 text-[13px] font-mono">{active.ea_versions?.length ? active.ea_versions.join(", ") : "All versions"}</div>
              </div>
              <div>
                <div className={LABEL}>Started by</div>
                <div className="mt-1 text-[13px] font-mono">{active.started_by_admin || "--"}</div>
              </div>
            </div>
            {active.reason && (
              <div>
                <div className={LABEL}>Reason</div>
                <p className="mt-1 text-[12px] text-white/50">{active.reason}</p>
              </div>
            )}
          </div>
        )}
      </CardSection>

      <CardSection title={`Archived periods (${archived.length})`}>
        {archived.length === 0 && <p className="text-[12px] text-white/40">Nothing archived yet.</p>}
        <div className="space-y-3">
          {archived.map(p => (
            <div key={p.period_id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4" data-testid="archived-period-row">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold">{p.period_name}</span>
                <Badge tone="neutral">ARCHIVED</Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-white/35">
                {fmtDate(p.epoch_started_at)} – {fmtDate(p.epoch_ended_at)} · {p.total_trades ?? 0} trades · Win rate {p.win_rate != null ? `${fmtNum(p.win_rate)}%` : "--"}
              </div>
            </div>
          ))}
        </div>
      </CardSection>

      {dialogOpen && (
        <StartPeriodDialog
          api={api}
          h={h}
          onCancel={() => setDialogOpen(false)}
          onDone={() => { setDialogOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Pins / Licenses ──────────────────────────────────────────────────────────
function PinsTab({ api }) {
  const [pins, setPins] = useState([]);
  const [stats, setStats] = useState(null);
  const [genCount, setGenCount] = useState(1);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [copiedPin, setCopiedPin] = useState(null);
  const [generating, setGenerating] = useState(false);
  const h = useMemo(() => auth(), []);

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
  const del      = async (pin) => {
    if (!window.confirm(`Permanently delete license ${pin}? This cannot be undone -- use Revoke instead if you just want to deactivate it.`)) return;
    await ax.delete(`${api}/admin/pins/${pin}`, h); fetchPins();
  };
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
                      {p.payment_ref && <span className="text-gold-200">PAID</span>}
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

// ─── Payment method priority ──────────────────────────────────────────────────
const PAYMENT_METHOD_LABELS = { bank_transfer: "Nigeria Bank Transfer", paystack: "Paystack" };

function PaymentMethodPrioritySettings({ api }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const h = useMemo(() => auth(), []);

  const fetchSettings = useCallback(() => {
    ax.get(`${api}/admin/settings/payment-methods`, h).then(r => setSettings(r.data)).catch(() => {});
  }, [api, h]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const save = async (updates) => {
    setSaving(true);
    try {
      const r = await ax.put(`${api}/admin/settings/payment-methods`, updates, h);
      setSettings(r.data);
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch {} finally { setSaving(false); }
  };

  const moveMethod = (method, direction) => {
    if (!settings) return;
    const order = [...settings.payment_method_order];
    const i = order.indexOf(method);
    const j = i + direction;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    save({ payment_method_order: order });
  };

  if (!settings) return <CardSection title="Payment method priority"><p className="text-[13px] text-white/35">Loading…</p></CardSection>;

  return (
    <CardSection title="Payment method priority" action={saved && <span className="text-[11px] text-emerald-400">Saved</span>}>
      <p className="text-[12px] text-white/40 mb-4 leading-5">
        Controls the order and availability customers see on the checkout payment-method screen.
        Bank details live in the separate "Bank Transfers" tab; this only enables/disables/orders the
        three methods.
      </p>
      <div className="space-y-3">
        {settings.payment_method_order.map((method, i) => (
          <div key={method} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <button disabled={i === 0} onClick={() => moveMethod(method, -1)} className="text-white/30 hover:text-white disabled:opacity-20" aria-label="Move up">▲</button>
                <button disabled={i === settings.payment_method_order.length - 1} onClick={() => moveMethod(method, 1)} className="text-white/30 hover:text-white disabled:opacity-20" aria-label="Move down">▼</button>
              </div>
              <div>
                <div className="text-[13px] font-semibold text-white">{i + 1}. {PAYMENT_METHOD_LABELS[method]}</div>
                {settings.default_payment_method === method && <div className="text-[10px] text-emerald-400">Default</div>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {method !== "bank_transfer" && (
                <label className="flex items-center gap-1.5 text-[12px] text-white/60">
                  <input type="checkbox" checked={Boolean(settings[`${method}_enabled`])}
                    onChange={e => save({ [`${method}_enabled`]: e.target.checked })} />
                  Enabled
                </label>
              )}
              <button
                disabled={settings.default_payment_method === method}
                onClick={() => save({ default_payment_method: method })}
                className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/60 hover:text-white disabled:opacity-30"
              >
                Set default
              </button>
            </div>
          </div>
        ))}
      </div>
      {saving && <p className="mt-3 text-[11px] text-white/35">Saving…</p>}
    </CardSection>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function SettingsTab({ api }) {
  const [settings, setSettings] = useState(null);
  const [pk, setPk] = useState("");
  const [priceNaira, setPriceNaira] = useState(300000);
  const [smtpEmail, setSmtpEmail] = useState("");
  const [smtpPw, setSmtpPw] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [mailFrom, setMailFrom] = useState("");
  const [onesignalAppId, setOnesignalAppId] = useState("");
  const [onesignalApiKey, setOnesignalApiKey] = useState("");
  // Customer email & admin notification redesign (owner spec, 2026-08-04)
  const [emailSenderName, setEmailSenderName] = useState("");
  const [adminNotificationEmail, setAdminNotificationEmail] = useState("");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [communityLink, setCommunityLink] = useState("");
  const [mt5DownloadUrl, setMt5DownloadUrl] = useState("");
  const [vpsGuideUrl, setVpsGuideUrl] = useState("");
  const [installationGuideUrl, setInstallationGuideUrl] = useState("");
  const [commandCenterUrl, setCommandCenterUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const h = useMemo(() => auth(), []);

  useEffect(() => {
    ax.get(`${api}/admin/settings`, h).then(r => {
      setSettings(r.data); setPriceNaira(r.data.pin_price_naira || 300000); setSmtpEmail(r.data.smtp_email || "");
      setSmtpHost(r.data.smtp_host || ""); setSmtpPort(r.data.smtp_port || 465); setMailFrom(r.data.mail_from || "");
      setOnesignalAppId(r.data.onesignal_app_id || "");
      setEmailSenderName(r.data.email_sender_name || "XauCloud");
      setAdminNotificationEmail(r.data.admin_notification_email || "");
      setSupportEmail(r.data.support_email || "");
      setSupportPhone(r.data.support_phone || "");
      setCommunityLink(r.data.community_link || "");
      setMt5DownloadUrl(r.data.mt5_download_url || "");
      setVpsGuideUrl(r.data.vps_guide_url || "");
      setInstallationGuideUrl(r.data.installation_guide_url || "");
      setCommandCenterUrl(r.data.command_center_url || "");
    }).catch(() => {});
  }, [api, h]);

  const save = async () => {
    setSaving(true);
    const updates = {};
    if (pk) updates.paystack_secret_key = pk;
    updates.pin_price_kobo = Math.round(priceNaira * 100);
    if (smtpEmail) updates.smtp_email = smtpEmail;
    if (smtpPw) updates.smtp_password = smtpPw;
    updates.smtp_host = smtpHost;
    updates.smtp_port = Number(smtpPort) || 465;
    updates.mail_from = mailFrom;
    if (onesignalAppId) updates.onesignal_app_id = onesignalAppId;
    if (onesignalApiKey) updates.onesignal_api_key = onesignalApiKey;
    updates.email_sender_name = emailSenderName;
    updates.admin_notification_email = adminNotificationEmail;
    updates.support_email = supportEmail;
    updates.support_phone = supportPhone;
    updates.community_link = communityLink;
    updates.mt5_download_url = mt5DownloadUrl;
    updates.vps_guide_url = vpsGuideUrl;
    updates.installation_guide_url = installationGuideUrl;
    updates.command_center_url = commandCenterUrl;
    try {
      await ax.put(`${api}/admin/settings`, updates, h);
      setSaved(true); setPk(""); setSmtpPw(""); setOnesignalApiKey(""); setTimeout(() => setSaved(false), 3000);
      const r = await ax.get(`${api}/admin/settings`, h); setSettings(r.data);
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-5" data-testid="admin-settings-tab">
      <CardSection title="Pricing">
        <div className="space-y-4">
          <Field label="PIN price (Naira)">
            <div className="flex items-center gap-2">
              <span className="text-white/50">₦</span>
              <Input data-testid="settings-price" type="number" value={priceNaira} onChange={e => setPriceNaira(parseInt(e.target.value) || 0)} className="font-mono" />
            </div>
            <p className="mt-1 text-[11px] text-white/35">Current: ₦{priceNaira?.toLocaleString()} — used by the Paystack checkout and Nigeria bank-transfer orders.</p>
          </Field>
        </div>
      </CardSection>

      <PaymentMethodPrioritySettings api={api} />

      <CardSection title="Paystack (active — second payment option)">
        <p className="text-[12px] text-white/40 mb-4 leading-5">
          Paystack is active as the second checkout option, after Nigeria Bank Transfer. See "Payment
          method priority" above to enable/disable it or change the default.
        </p>
        <div className="space-y-4">
          <Field label="Paystack secret key">
            <Input data-testid="settings-paystack-key" type="password" value={pk} onChange={e => setPk(e.target.value)}
              placeholder={settings?.paystack_configured ? "Configured — enter new key to change" : "sk_live_xxxxxx"} className="font-mono" />
            <p className="mt-1 text-[11px] text-white/35">
              Status: <span className={settings?.paystack_configured ? "text-emerald-400" : "text-red-400"}>{settings?.paystack_configured ? "Configured" : "Not set"}</span>
              {settings?.paystack_key_preview && settings.paystack_configured && <span className="ml-1 font-mono">({settings.paystack_key_preview})</span>}
            </p>
          </Field>
        </div>
      </CardSection>

      <CardSection title="Email sending (SMTP)">
        <p className="text-[12px] text-white/40 mb-4 leading-5">
          Sends license keys, receipts and admin emails. Works with <span className="text-white/60">Gmail</span> (leave host blank —
          use a Google App Password) <span className="text-white/60">or Hostinger</span> to send as your own domain, e.g.
          <span className="text-white/60"> support@xaucloud.io</span> (host <span className="font-mono text-white/60">smtp.hostinger.com</span>, port 465).
        </p>
        <div className="space-y-4">
          <Field label="Login email / username">
            <div className="relative">
              <Envelope size={13} className="absolute left-3 top-3 text-white/30" />
              <Input data-testid="settings-smtp-email" type="email" value={smtpEmail} onChange={e => setSmtpEmail(e.target.value)} placeholder="support@xaucloud.io or you@gmail.com" className="pl-9" />
            </div>
          </Field>
          <Field label="Password / App password">
            <Input data-testid="settings-smtp-password" type="password" value={smtpPw} onChange={e => setSmtpPw(e.target.value)}
              placeholder={settings?.smtp_configured ? "Configured — enter new to change" : "Hostinger mailbox password or Gmail app password"} className="font-mono" />
            <p className="mt-1 text-[11px] text-white/35">Status: <span className={settings?.smtp_configured ? "text-emerald-400" : "text-red-400"}>{settings?.smtp_configured ? "Configured" : "Not set"}</span></p>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SMTP host">
              <Input data-testid="settings-smtp-host" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.hostinger.com (blank = Gmail)" className="font-mono" />
            </Field>
            <Field label="SMTP port">
              <Input data-testid="settings-smtp-port" type="number" value={smtpPort} onChange={e => setSmtpPort(parseInt(e.target.value) || 465)} placeholder="465" className="font-mono" />
              <p className="mt-1 text-[11px] text-white/35">465 = SSL · 587 = STARTTLS</p>
            </Field>
          </div>
          <Field label="From address (what customers see)">
            <Input data-testid="settings-mail-from" type="email" value={mailFrom} onChange={e => setMailFrom(e.target.value)} placeholder="support@xaucloud.io (blank = login email)" />
            <p className="mt-1 text-[11px] text-white/35">Most providers require this to match the login mailbox.</p>
          </Field>
        </div>
      </CardSection>

      {/* Customer email & admin notification redesign (owner spec,
          2026-08-04) -- everything here is editable without a code
          change, per the spec's explicit requirement. */}
      <CardSection title="Customer email branding">
        <p className="text-[12px] text-white/40 mb-4 leading-5">
          Controls how every customer email looks -- sender name, and the links shown in the "Getting Started" guide and Helpful Links buttons.
        </p>
        <div className="space-y-4">
          <Field label="Email sender name">
            <Input data-testid="settings-email-sender-name" value={emailSenderName} onChange={e => setEmailSenderName(e.target.value)} placeholder="XauCloud" />
            <p className="mt-1 text-[11px] text-white/35">Shown as the "From" name on every customer email, instead of the raw Gmail address.</p>
          </Field>
          <Field label="Support email">
            <Input data-testid="settings-support-email" type="email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} placeholder="support@xaucloud.com" />
          </Field>
          <Field label="Support phone">
            <Input data-testid="settings-support-phone" value={supportPhone} onChange={e => setSupportPhone(e.target.value)} placeholder="+234 800 000 0000" />
          </Field>
          <Field label="Community link (optional)">
            <Input data-testid="settings-community-link" value={communityLink} onChange={e => setCommunityLink(e.target.value)} placeholder="https://t.me/your-community" />
          </Field>
          <Field label="MT5 download URL">
            <Input data-testid="settings-mt5-url" value={mt5DownloadUrl} onChange={e => setMt5DownloadUrl(e.target.value)} placeholder="https://www.metatrader5.com/en/download" />
          </Field>
          <Field label="VPS guide URL">
            <Input data-testid="settings-vps-url" value={vpsGuideUrl} onChange={e => setVpsGuideUrl(e.target.value)} placeholder="https://yoursite.com/vps-guide" />
          </Field>
          <Field label="Installation guide URL">
            <Input data-testid="settings-install-guide-url" value={installationGuideUrl} onChange={e => setInstallationGuideUrl(e.target.value)} placeholder="https://yoursite.com/install" />
          </Field>
          <Field label="Command Center URL">
            <Input data-testid="settings-command-center-url" value={commandCenterUrl} onChange={e => setCommandCenterUrl(e.target.value)} placeholder="https://yoursite.com/command" />
          </Field>
        </div>
      </CardSection>

      <CardSection title="Admin sale notifications">
        <p className="text-[12px] text-white/40 mb-4 leading-5">
          Real-time email alerts to you whenever a customer starts checkout or completes a purchase. Leave blank to disable -- no notification is sent to a placeholder address.
        </p>
        <Field label="Admin notification email">
          <Input data-testid="settings-admin-notification-email" type="email" value={adminNotificationEmail} onChange={e => setAdminNotificationEmail(e.target.value)} placeholder="admin@xaucloud.com" />
          <p className="mt-1 text-[11px] text-white/35">
            Status: <span className={adminNotificationEmail ? "text-emerald-400" : "text-red-400"}>{adminNotificationEmail ? "Configured" : "Not set -- sale notifications are off"}</span>
          </p>
        </Field>
      </CardSection>

      {/* Push is first-party (self-managed VAPID) — no third-party keys needed. */}
      <CardSection title="Push notifications">
        <p className="text-[12px] leading-5 text-white/45">
          XauCloud push is <span className="text-white/70">first-party (Web Push / VAPID)</span>. Keys are generated and
          managed automatically on the server — nothing to configure here. Customers enable push from their
          dashboard or Settings. OneSignal has been removed.
        </p>
      </CardSection>

      <Btn onClick={save} disabled={saving} data-testid="settings-save-btn">
        <FloppyDisk size={14} weight="bold" /> {saving ? "Saving…" : saved ? "Saved!" : "Save settings"}
      </Btn>
    </div>
  );
}

// ─── Transactions ─────────────────────────────────────────────────────────────
function TransactionsTab({ api }) {
  const [txs, setTxs] = useState([]);
  const h = useMemo(() => auth(), []);
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

// ─── Bank Transfers ──────────────────────────────────────────────────────────
const BANK_TRANSFER_STATUS_TONE = {
  BANK_TRANSFER_PENDING: "neutral",
  BANK_TRANSFER_SUBMITTED: "amber",
  UNDER_ADMIN_REVIEW: "amber",
  FULFILLED: "green",
  BANK_TRANSFER_REJECTED: "red",
  BANK_TRANSFER_EXPIRED: "red",
};

function BankTransfersTab({ api }) {
  const [settings, setSettings] = useState(null);
  const [entries, setEntries] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const h = useMemo(() => auth(), []);

  const fetchSettings = useCallback(() => {
    ax.get(`${api}/admin/settings/bank-transfer`, h).then(r => setSettings(r.data)).catch(() => {});
  }, [api, h]);

  const fetchQueue = useCallback(() => {
    const params = statusFilter ? { status: statusFilter } : {};
    ax.get(`${api}/admin/bank-transfers`, { ...h, params }).then(r => setEntries(r.data.entries || [])).catch(() => {});
  }, [api, h, statusFilter]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const saveSettings = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await ax.put(`${api}/admin/settings/bank-transfer`, settings, h);
      setSettings(r.data);
      setMsg("Saved.");
    } catch (e) {
      setMsg(e.response?.data?.detail || "Could not save settings.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (reference, action, reason) => {
    setBusy(true); setMsg("");
    try {
      const body = reason !== undefined ? { reason } : {};
      await ax.post(`${api}/admin/bank-transfers/${reference}/${action}`, body, h);
      fetchQueue();
      if (detail?.reference === reference) {
        const r = await ax.get(`${api}/admin/bank-transfers/${reference}`, h);
        setDetail(r.data);
      }
    } catch (e) {
      setMsg(e.response?.data?.detail || `Could not ${action}.`);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (reference) => {
    try {
      const r = await ax.get(`${api}/admin/bank-transfers/${reference}`, h);
      setDetail(r.data);
    } catch {}
  };

  return (
    <div className="space-y-4" data-testid="admin-bank-transfers-tab">
      <CardSection title="Bank transfer settings" action={
        <Btn variant="primary" onClick={saveSettings} disabled={busy || !settings}><FloppyDisk size={14} /> Save</Btn>
      }>
        {!settings ? <p className="text-[13px] text-white/35">Loading…</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Enabled">
              <label className="flex items-center gap-2 text-[13px] text-white/70">
                <input type="checkbox" checked={Boolean(settings.enabled)}
                  onChange={e => setSettings({ ...settings, enabled: e.target.checked })} />
                Enable Nigeria Bank Transfer at checkout (available to every visitor, not just those detected as being in Nigeria)
              </label>
            </Field>
            <Field label="Timeout (minutes)">
              <Input type="number" value={settings.timeout_minutes || 60}
                onChange={e => setSettings({ ...settings, timeout_minutes: Number(e.target.value) })} />
            </Field>
            <Field label="Bank name">
              <Input value={settings.bank_name || ""} onChange={e => setSettings({ ...settings, bank_name: e.target.value })} />
            </Field>
            <Field label="Account name">
              <Input value={settings.account_name || ""} onChange={e => setSettings({ ...settings, account_name: e.target.value })} />
            </Field>
            <Field label="Account number">
              <Input value={settings.account_number || ""} onChange={e => setSettings({ ...settings, account_number: e.target.value })} />
            </Field>
            <Field label="Support contact">
              <Input value={settings.support_contact || ""} onChange={e => setSettings({ ...settings, support_contact: e.target.value })} />
            </Field>
            <Field label="Require proof of payment">
              <label className="flex items-center gap-2 text-[13px] text-white/70">
                <input type="checkbox" checked={Boolean(settings.proof_required)}
                  onChange={e => setSettings({ ...settings, proof_required: e.target.checked })} />
                Customer must upload a screenshot
              </label>
            </Field>
            <Field label="Instructions shown to customer">
              <Input value={settings.instructions || ""} onChange={e => setSettings({ ...settings, instructions: e.target.value })} />
            </Field>
          </div>
        )}
        {msg && <p className="mt-3 text-[12px] text-gold-300">{msg}</p>}
      </CardSection>

      <CardSection title={`Review queue · ${entries.length}`} action={
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white/60">
          <option value="">All statuses</option>
          <option value="BANK_TRANSFER_PENDING">Pending</option>
          <option value="BANK_TRANSFER_SUBMITTED">Submitted</option>
          <option value="FULFILLED">Fulfilled</option>
          <option value="BANK_TRANSFER_REJECTED">Rejected</option>
          <option value="BANK_TRANSFER_EXPIRED">Expired</option>
        </select>
      }>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-white/35">No bank-transfer orders</p>
        ) : (
          <div className="overflow-x-auto -m-5">
            <table className="w-full text-[12px] min-w-[760px]">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["Reference","Buyer","Amount","Status","Proof","Date",""].map(col => (
                    <th key={col} className="px-5 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {entries.map(t => (
                  <tr key={t.reference}>
                    <td className="px-5 py-3 font-mono text-[11px] text-white/55">{t.reference}</td>
                    <td className="px-5 py-3"><div>{t.buyer_name}</div><div className="text-white/35">{t.buyer_email}</div></td>
                    <td className="px-5 py-3 font-mono">₦{(t.amount_kobo / 100).toLocaleString()}</td>
                    <td className="px-5 py-3"><Badge tone={BANK_TRANSFER_STATUS_TONE[t.payment_status] || "neutral"}>{t.payment_status}</Badge></td>
                    <td className="px-5 py-3">{t.has_proof ? <Badge tone="green">Yes</Badge> : <Badge tone="neutral">No</Badge>}</td>
                    <td className="px-5 py-3 text-white/40">{t.created_at?.split("T")[0]}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Btn variant="ghost" className="!px-2.5 !py-1.5 !text-[11px]" onClick={() => openDetail(t.reference)}>View</Btn>
                        {(t.payment_status === "BANK_TRANSFER_SUBMITTED" || t.payment_status === "UNDER_ADMIN_REVIEW") && (
                          <Btn variant="green" className="!px-2.5 !py-1.5 !text-[11px]" disabled={busy} onClick={() => act(t.reference, "approve")}>Approve</Btn>
                        )}
                        {["BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED", "UNDER_ADMIN_REVIEW"].includes(t.payment_status) && (
                          <Btn variant="danger" className="!px-2.5 !py-1.5 !text-[11px]" disabled={busy}
                            onClick={() => act(t.reference, "reject", window.prompt("Rejection reason (optional):") || "")}>
                            Reject
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardSection>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#0a0a0e] p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-[14px] font-bold">{detail.reference}</h4>
              <Badge tone={BANK_TRANSFER_STATUS_TONE[detail.payment_status] || "neutral"}>{detail.payment_status}</Badge>
            </div>
            <div className="mt-3 space-y-1.5 text-[12px] text-white/60">
              <div>Buyer: {detail.buyer_name} · {detail.buyer_email}</div>
              <div>Amount: ₦{(detail.amount_kobo / 100).toLocaleString()}</div>
              <div>Expires: {detail.expires_at}</div>
              {detail.rejection_reason && <div>Rejection reason: {detail.rejection_reason}</div>}
              {detail.approved_by && <div>Approved by: {detail.approved_by} at {detail.approved_at}</div>}
              {(detail.admin_notes || []).map((n, i) => (
                <div key={i} className="rounded-lg bg-white/[0.03] px-2 py-1.5">{n.admin_email}: {n.note}</div>
              ))}
            </div>
            {detail.bank_transfer_proof && (
              <img src={detail.bank_transfer_proof} alt="Proof of payment" className="mt-3 max-h-64 w-full rounded-xl object-contain" />
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {(detail.payment_status === "BANK_TRANSFER_SUBMITTED" || detail.payment_status === "UNDER_ADMIN_REVIEW") && (
                <Btn variant="green" disabled={busy} onClick={() => act(detail.reference, "approve")}>Approve</Btn>
              )}
              {["BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED", "UNDER_ADMIN_REVIEW"].includes(detail.payment_status) && (
                <Btn variant="danger" disabled={busy}
                  onClick={() => act(detail.reference, "reject", window.prompt("Rejection reason (optional):") || "")}>
                  Reject
                </Btn>
              )}
              {["BANK_TRANSFER_PENDING", "BANK_TRANSFER_SUBMITTED"].includes(detail.payment_status) && (
                <Btn variant="ghost" disabled={busy} onClick={() => act(detail.reference, "mark-expired")}>Mark expired</Btn>
              )}
              <Btn variant="ghost" onClick={() => setDetail(null)}>Close</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bot Ops ──────────────────────────────────────────────────────────────────
function CommandOpsTab({ api }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const h = useMemo(() => auth(), []);

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
              ["EA version",     bot.ea_version || "Unknown"],
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
// ─── Two-factor authentication ─────────────────────────────────────────────
// Bug fix (Command Center admin audit, 2026-08-04): the backend's TOTP MFA
// system (/auth/mfa/setup|enable|disable, /auth/login/mfa) was fully built
// but had no frontend anywhere -- an admin with mfa_enabled=true could
// never actually get past login (see the LoginPage fix above), and there
// was no way to turn it on in the first place. Manual-entry secret only
// (no QR image) to avoid adding a new dependency for this; every
// authenticator app supports typing the secret in directly.
function MfaSection({ api, admin, onLogin }) {
  const [pending, setPending] = useState(null); // {secret, otpauth_uri}
  const [enableCode, setEnableCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const startSetup = async () => {
    setError(""); setMessage(""); setBusy(true);
    try {
      const res = await ax.post(`${api}/auth/mfa/setup`);
      setPending(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Could not start MFA setup.");
    } finally { setBusy(false); }
  };

  const confirmEnable = async () => {
    setError(""); setMessage(""); setBusy(true);
    try {
      await ax.post(`${api}/auth/mfa/enable`, { code: enableCode });
      setPending(null); setEnableCode("");
      setMessage("Two-factor authentication is now enabled.");
      onLogin({ ...admin, mfa_enabled: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Incorrect code.");
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setError(""); setMessage(""); setBusy(true);
    try {
      await ax.post(`${api}/auth/mfa/disable`, { password: disablePassword, code: disableCode });
      setDisablePassword(""); setDisableCode("");
      setMessage("Two-factor authentication is now disabled.");
      onLogin({ ...admin, mfa_enabled: false });
    } catch (err) {
      setError(err.response?.data?.detail || "Could not disable MFA.");
    } finally { setBusy(false); }
  };

  return (
    <CardSection title="Two-factor authentication">
      {error   && <p className="mb-3 text-[12px] text-red-300"     data-testid="mfa-section-error">{error}</p>}
      {message && <p className="mb-3 text-[12px] text-emerald-400" data-testid="mfa-section-success">{message}</p>}

      {admin?.mfa_enabled ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge tone="green">ENABLED</Badge>
            <span className="text-[12px] text-white/45">A code from your authenticator app is required on every login.</span>
          </div>
          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            <p className="text-[12px] text-white/40">Turn off two-factor authentication:</p>
            <Field label="Current password">
              <Input type="password" value={disablePassword} onChange={e => setDisablePassword(e.target.value)} placeholder="Current password" />
            </Field>
            <Field label="Current 6-digit code">
              <Input inputMode="numeric" maxLength={6} value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
            </Field>
            <Btn variant="danger" onClick={disable} disabled={busy || !disablePassword || disableCode.length !== 6} className="w-full">
              Disable two-factor authentication
            </Btn>
          </div>
        </div>
      ) : pending ? (
        <div className="space-y-4">
          <p className="text-[12px] text-white/45">
            Add this account to your authenticator app (Google Authenticator, Authy, 1Password, etc.), then enter the current 6-digit code to confirm.
          </p>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 space-y-2">
            <div>
              <div className={LABEL}>Secret (manual entry)</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all font-mono text-[12px] text-gold-200">{pending.secret}</code>
                <CopyIconBtn value={pending.secret} />
              </div>
            </div>
          </div>
          <Field label="6-digit code from your app">
            <Input inputMode="numeric" autoFocus maxLength={6} value={enableCode} onChange={e => setEnableCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="text-center font-mono text-lg tracking-[0.3em]" />
          </Field>
          <div className="flex gap-2">
            <Btn onClick={confirmEnable} disabled={busy || enableCode.length !== 6} className="flex-1">Confirm and enable</Btn>
            <Btn variant="ghost" onClick={() => { setPending(null); setEnableCode(""); }}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div>
            <Badge tone="neutral">NOT ENABLED</Badge>
            <p className="mt-2 max-w-sm text-[12px] text-white/45">Require a 6-digit authenticator code in addition to your password on every login.</p>
          </div>
          <Btn onClick={startSetup} disabled={busy}>Set up</Btn>
        </div>
      )}
    </CardSection>
  );
}

function CopyIconBtn({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="flex-none rounded-lg border border-white/[0.08] p-1.5 text-white/40 hover:text-white transition">
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function AccountTab({ api, admin, onLogin, onLogout }) {
  const [newEmail, setNewEmail] = useState(admin?.email || "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const h = {};

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
        onLogin({ ...admin, email: res.data.email || newEmail });
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
            <UserCircle size={30} weight="duotone" className="text-gold-200" />
            <div>
              <div className="text-[14px] font-semibold">{admin?.name || "Admin"}</div>
              <div className="text-[12px] text-white/40">{admin?.email}</div>
              <div className="mt-0.5 font-mono text-[10px] text-gold-200">ADMIN · RELEASE CONTROL</div>
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

      <MfaSection api={api} admin={admin} onLogin={onLogin} />
    </div>
  );
}
