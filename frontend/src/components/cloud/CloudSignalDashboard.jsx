import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { LogOut, Lock, TrendingUp, Zap, Clock3 } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";
import { PaymentMethodModal } from "../BankTransferFlow";
import { useSignalCheckout } from "@/lib/signalCheckout";
import { API } from "@/lib/api";
import * as UI from "@/lib/ui";

// The Command Center experience for every signed-in user who is NOT
// bot-licensed (source: "trial" | "subscription" | "none" from GET
// /cloud/entitlement -- CloudDashboard.jsx only renders this component when
// entitlement.bot_license is false). Deliberately small and plain-English:
// current plan, Market Outlook, the 10-minute engine, recent signals,
// billing/upgrade, and a couple of locked bot-only teasers. This is NOT a
// second marketing page -- the public homepage already explains the
// product -- so copy here stays short and functional.
const signalAxios = axios.create({ baseURL: API, withCredentials: true });

function formatNaira(koboAmount) {
  if (koboAmount === null || koboAmount === undefined) return "—";
  const naira = koboAmount / 100;
  if (naira === 0) return "Free";
  return `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function relTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = ms / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const PLAN_LABEL = { WEEKLY: "Weekly Signals", MONTHLY: "Monthly Signals" };
const STATUS_TONE = { WATCHING: "info", ACTIONABLE: "profit", BLOCKED: "loss", EXPIRED: "neutral" };

// Plain-English summary of "your plan" from the entitlement object -- the
// header card and its CTA both derive from this single function so they
// never disagree with each other.
function planSummary(entitlement) {
  if (!entitlement) return { title: "Loading your plan…" };
  const { source, trial, subscription } = entitlement;

  if (source === "trial" && trial) {
    const days = trial.days_remaining ?? 0;
    // days_remaining hits 0 on the trial's own last active day (it's still
    // ACTIVE until trial_expires_at, at the end of that day) -- "0 market
    // days left" would read as a contradiction next to full access, so say
    // "Last day" instead of a confusing zero.
    return {
      title: "Free Signal Trial",
      sub: days === 0 ? "Last day" : `${days} market day${days === 1 ? "" : "s"} left`,
      tone: "gold",
    };
  }

  if (source === "subscription" && subscription) {
    return {
      title: PLAN_LABEL[subscription.plan] || "Signal Subscription",
      sub: `Active until ${formatDate(subscription.expires_at)}`,
      tone: "gold",
    };
  }

  // source === "none" -- either an expired trial/subscription, or nothing yet.
  if (subscription && !subscription.active) {
    return {
      title: `${PLAN_LABEL[subscription.plan] || "Signal Subscription"} expired`,
      sub: "Renew below to keep receiving Gold signals.",
      tone: "warn",
      showUpgrade: true,
    };
  }
  if (trial && trial.status === "EXPIRED") {
    return {
      title: "Your free XauCloud signal trial has ended",
      sub: "Subscribe below to keep receiving Gold signals and Market Outlook.",
      tone: "warn",
      showUpgrade: true,
    };
  }
  return {
    title: "No active plan yet",
    sub: "Start a free 3-market-day trial -- no card required.",
    tone: "neutral",
    showStartTrial: true,
  };
}

function SignalDetail({ signal }) {
  const rows = [
    ["Entry", signal.entry],
    ["Stop", signal.stop],
    ["TP1", signal.tp1],
    ["TP2", signal.tp2],
    ["TP3", signal.tp3],
  ].filter(([, v]) => v !== null && v !== undefined);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-bold">{signal.symbol}</span>
        <UI.Pill tone={signal.direction === "SELL" ? "loss" : "profit"}>{String(signal.direction || "").replace(/_/g, " ")}</UI.Pill>
        <UI.Pill tone={STATUS_TONE[signal.status] || "neutral"}>{signal.status}</UI.Pill>
        {signal.confidence != null && <span className="font-mono text-[11px] text-white/35">Confidence {signal.confidence}%</span>}
      </div>
      {rows.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
              <div className="font-mono text-[9px] uppercase tracking-widest text-white/30">{label}</div>
              <div className="nums mt-0.5 text-[12px] font-bold">{value}</div>
            </div>
          ))}
        </div>
      )}
      {signal.rationale && <p className="mt-3 text-[12px] leading-5 text-white/45">{signal.rationale}</p>}
      <div className="mt-2 text-[10.5px] text-white/25">Updated {relTime(signal.updated_at)}</div>
    </div>
  );
}

function SignalCard({ title, icon: Icon, state }) {
  const { loading, data, locked, unavailable, error } = state;
  return (
    <UI.Card title={title} action={Icon && <Icon className="h-4 w-4 text-gold-300/60" />}>
      {loading && <UI.Skeleton className="h-20 w-full" />}
      {!loading && locked && (
        <UI.EmptyState icon={Lock} title="Not included in your plan" body="Start a free trial or subscribe to see this." />
      )}
      {!loading && !locked && error && <div className="text-[12px] text-rose-400">{error}</div>}
      {!loading && !locked && !error && unavailable && (
        <div className="text-[12.5px] text-white/45">Signal feed temporarily unavailable.</div>
      )}
      {!loading && !locked && !error && !unavailable && !data?.signal && (
        <div className="text-[12.5px] text-white/45">No signal right now. Check back soon.</div>
      )}
      {!loading && !locked && !error && !unavailable && data?.signal && <SignalDetail signal={data.signal} />}
    </UI.Card>
  );
}

function RecentSignalsCard({ state }) {
  const { loading, signals, locked, error } = state;
  return (
    <UI.Card title="Recent Signals">
      {loading && <UI.Skeleton className="h-16 w-full" />}
      {!loading && locked && (
        <UI.EmptyState icon={Lock} title="Not included in your plan" body="Start a free trial or subscribe to see your recent signals." />
      )}
      {!loading && !locked && error && <div className="text-[12px] text-rose-400">{error}</div>}
      {!loading && !locked && !error && (!signals || signals.length === 0) && (
        <div className="text-[12.5px] text-white/45">No recent signals yet.</div>
      )}
      {!loading && !locked && !error && signals && signals.length > 0 && (
        <div className="divide-y divide-white/[0.06]">
          {signals.map((s) => (
            <div key={s.signal_id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">
                  {s.symbol} · {String(s.direction || "").replace(/_/g, " ")}
                </div>
                <div className="mt-0.5 text-[11px] text-white/35">
                  {s.engine === "OUTLOOK" ? "Market Outlook" : "10-Minute Engine"} · {relTime(s.updated_at)}
                </div>
              </div>
              <UI.Pill tone={STATUS_TONE[s.status] || "neutral"}>{s.status}</UI.Pill>
            </div>
          ))}
        </div>
      )}
    </UI.Card>
  );
}

function PlanUpgradeTile({ label, price, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left transition hover:border-gold-300/30 hover:bg-white/[0.05]"
      data-testid={`upgrade-tile-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="text-[12px] font-semibold text-white/80">{label}</div>
      <div className="mt-1 font-mono text-[16px] font-black text-gold-200">{price}</div>
      {sub && <div className="mt-0.5 text-[10.5px] text-white/35">{sub}</div>}
    </button>
  );
}

function BillingSection({ billing, entitlement, onChoosePlanWeekly, onChoosePlanMonthly }) {
  const plans = billing.data?.plans;
  const history = billing.data?.payment_history || [];
  return (
    <UI.Card title="Billing" subtitle="Your plan, dates, and payment history.">
      {billing.loading && <UI.Skeleton className="h-24 w-full" />}
      {!billing.loading && billing.error && <div className="text-[12px] text-rose-400">{billing.error}</div>}
      {!billing.loading && !billing.error && (
        <>
          <div className="mb-5 grid gap-2.5 sm:grid-cols-3">
            <PlanUpgradeTile label="Weekly Signals" price={formatNaira(plans?.signals_weekly?.price_kobo)} sub="/ week" onClick={onChoosePlanWeekly} />
            <PlanUpgradeTile label="Monthly Signals" price={formatNaira(plans?.signals_monthly?.price_kobo)} sub="/ month" onClick={onChoosePlanMonthly} />
            <PlanUpgradeTile label="XauCloud Bot (Lifetime)" price={formatNaira(plans?.bot_lifetime?.price_kobo)} sub="one-time" onClick={() => { window.location.href = "/#purchase"; }} />
          </div>

          {entitlement?.subscription && (
            <div className="mb-4 rounded-xl border border-white/[0.07] bg-black/20 px-3.5 py-3 text-[12px] text-white/55">
              {PLAN_LABEL[entitlement.subscription.plan] || "Signal Subscription"} · {entitlement.subscription.active ? "active until" : "expired"} {formatDate(entitlement.subscription.expires_at)}
            </div>
          )}

          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-white/30">Payment history</div>
          {history.length === 0 ? (
            <div className="text-[12.5px] text-white/35">No payments yet.</div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {history.map((p) => (
                <div key={p.reference} className="flex items-center justify-between gap-3 py-2 text-[12px]">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-white/70">{p.reference}</div>
                    <div className="text-white/35">{p.plan_id || "BOT_LIFETIME"} · {relTime(p.created_at)}</div>
                  </div>
                  <UI.Pill tone={p.payment_status === "FULFILLED" ? "profit" : /FAILED|REJECTED|EXPIRED/.test(String(p.payment_status)) ? "loss" : "neutral"}>
                    {p.payment_status}
                  </UI.Pill>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </UI.Card>
  );
}

function LockedBotTeasers() {
  const rows = [
    { label: "Bot Operations", sub: "Remote pause/resume and live positions" },
    { label: "Automated MT5 execution", sub: "Trades placed automatically by the licensed EA" },
    { label: "Bot Activity", sub: "Trade-by-trade history and AI decisions" },
  ];
  return (
    <UI.Card title="XauCloud Bot">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3.5 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white/80">{r.label}</div>
              <div className="text-[11px] text-white/35">{r.sub}</div>
            </div>
            <span className="inline-flex flex-none items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold text-white/45">
              <Lock className="h-3 w-3" /> Bot license required
            </span>
          </div>
        ))}
        <p className="pt-1 text-[11.5px] text-white/40">This feature requires the XauCloud automated trading bot.</p>
        <button onClick={() => { window.location.href = "/#purchase"; }}
          className="no-select mt-1 w-full rounded-xl bg-gold-300 py-2.5 text-[12px] font-black text-black">
          Get XauCloud Bot
        </button>
      </div>
    </UI.Card>
  );
}

export default function CloudSignalDashboard({ entitlement: initialEntitlement }) {
  const navigate = useNavigate();
  const [entitlement, setEntitlement] = useState(initialEntitlement);
  useEffect(() => { setEntitlement(initialEntitlement); }, [initialEntitlement]);

  const [me, setMe] = useState(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialError, setTrialError] = useState("");

  const [outlook, setOutlook] = useState({ loading: true, data: null, locked: false, unavailable: false, error: "" });
  const [engine, setEngine] = useState({ loading: true, data: null, locked: false, unavailable: false, error: "" });
  const [recent, setRecent] = useState({ loading: true, signals: [], locked: false, error: "" });
  const [billing, setBilling] = useState({ loading: true, data: null, error: "" });

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

  const fetchRecent = useCallback(() => {
    signalAxios.get("/cloud/signals/recent")
      .then((r) => setRecent({ loading: false, signals: r.data.signals || [], locked: false, error: "" }))
      .catch((e) => {
        if (e.response?.status === 403 && e.response?.data?.reason === "NOT_ENTITLED") {
          setRecent({ loading: false, signals: [], locked: true, error: "" });
        } else {
          setRecent({ loading: false, signals: [], locked: false, error: "Could not load recent signals." });
        }
      });
  }, []);

  const fetchBilling = useCallback(() => {
    signalAxios.get("/cloud/billing")
      .then((r) => setBilling({ loading: false, data: r.data, error: "" }))
      .catch(() => setBilling({ loading: false, data: null, error: "Could not load billing." }));
  }, []);

  useEffect(() => {
    signalAxios.get("/cloud/auth/me").then((r) => setMe(r.data)).catch((e) => {
      if (e.response?.status === 401) navigate("/command/login");
    });
  }, [navigate]);

  useEffect(() => {
    const load = () => {
      fetchSignal("/cloud/signals/outlook", setOutlook);
      fetchSignal("/cloud/signals/engine", setEngine);
      fetchRecent();
      fetchBilling();
    };
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [fetchSignal, fetchRecent, fetchBilling]);

  // Weekly/Monthly checkout -- shared with the public PurchaseSection.
  const signalCheckout = useSignalCheckout(API);

  // If the visitor picked Weekly/Monthly on the homepage while logged out,
  // PurchaseSection stashed the intent so it can resume here once the
  // account exists and they land back on the dashboard.
  useEffect(() => {
    try {
      const pending = window.sessionStorage.getItem("xaucloud_pending_plan");
      if (pending === "SIGNALS_WEEKLY" || pending === "SIGNALS_MONTHLY") {
        window.sessionStorage.removeItem("xaucloud_pending_plan");
        signalCheckout.openPlan(pending);
      }
    } catch { /* private mode etc. -- non-fatal */ }
    // Runs once on mount only -- signalCheckout.openPlan is stable (useCallback with no deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startTrial = async () => {
    setTrialBusy(true); setTrialError("");
    try {
      const r = await signalAxios.post("/cloud/signals/trial/start", {});
      setEntitlement(r.data.entitlement);
      fetchSignal("/cloud/signals/outlook", setOutlook);
      fetchSignal("/cloud/signals/engine", setEngine);
      fetchRecent();
      fetchBilling();
    } catch (e) {
      setTrialError(e.response?.data?.message || e.response?.data?.detail || "Could not start your trial. Please try again.");
    } finally {
      setTrialBusy(false);
    }
  };

  const logout = async () => {
    try { await signalAxios.post("/cloud/auth/logout"); } catch { /* best-effort */ }
    navigate("/command");
  };

  const summary = planSummary(entitlement);
  const signalPlanPrice = formatNaira(
    (signalCheckout.planId === "SIGNALS_WEEKLY" ? billing.data?.plans?.signals_weekly : billing.data?.plans?.signals_monthly)?.price_kobo
  );

  return (
    <div className="min-h-screen bg-[#050507] pb-16 text-white" data-testid="signal-dashboard">
      <InstallAppPrompt />

      <nav className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#050505]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 md:px-6">
          <Link to="/command" className="flex items-center gap-2" data-testid="signal-dashboard-logo">
            <XauAiLogo size={28} />
            <span className="text-[14px] font-semibold">XauCloud Command Center</span>
          </Link>
          <button onClick={logout} className="flex items-center gap-1.5 text-[12px] text-white/50 hover:text-white" data-testid="signal-dashboard-logout">
            <LogOut className="h-3.5 w-3.5" /> Log out
          </button>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 md:px-6">

        <UI.Card tone={summary.tone}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">Your plan{me?.full_name ? ` · ${me.full_name}` : ""}</div>
              <div className="mt-1 text-[18px] font-bold" data-testid="plan-summary-title">{summary.title}</div>
              {summary.sub && <div className="mt-1 text-[12.5px] text-white/45">{summary.sub}</div>}
            </div>
            {summary.showStartTrial && (
              <UI.Button onClick={startTrial} disabled={trialBusy} data-testid="start-trial-btn">
                {trialBusy ? "Starting…" : "Start 3-Day Market Trial"}
              </UI.Button>
            )}
            {summary.showUpgrade && !summary.showStartTrial && (
              <UI.Button onClick={() => signalCheckout.openPlan("SIGNALS_WEEKLY")} data-testid="upgrade-cta-btn">
                Subscribe
              </UI.Button>
            )}
          </div>
          {trialError && <div className="mt-3 text-[12px] text-rose-400">{trialError}</div>}
        </UI.Card>

        <div className="grid gap-4 md:grid-cols-2">
          <SignalCard title="Market Outlook" icon={TrendingUp} state={outlook} />
          <SignalCard title="10-Minute Engine" icon={Zap} state={engine} />
        </div>

        <RecentSignalsCard state={recent} />

        <BillingSection
          billing={billing}
          entitlement={entitlement}
          onChoosePlanWeekly={() => signalCheckout.openPlan("SIGNALS_WEEKLY")}
          onChoosePlanMonthly={() => signalCheckout.openPlan("SIGNALS_MONTHLY")}
        />

        <LockedBotTeasers />

        <div className="flex items-center gap-1.5 text-[10.5px] text-white/25">
          <Clock3 className="h-3 w-3" /> Signals refresh automatically. This page shows plain-English status only -- no trading advice or profit guarantee.
        </div>
      </div>

      {signalCheckout.showModal && (
        <PaymentMethodModal
          api={API}
          priceDisplay={signalPlanPrice}
          subtitle={`${signalPlanPrice} · ${me?.email || ""}`}
          onPaystack={() => { signalCheckout.closeModal(); signalCheckout.payByPaystack(); }}
          onNomba={() => { signalCheckout.closeModal(); signalCheckout.payByNomba(); }}
          onClose={signalCheckout.closeModal}
          bankTransfer={signalCheckout.bankTransferProps}
        />
      )}
      {signalCheckout.error && !signalCheckout.showModal && (
        <div className="mx-auto mt-4 max-w-md text-center font-mono text-[12px] text-rose-400" data-testid="signal-dashboard-purchase-error">
          {signalCheckout.error}
        </div>
      )}
    </div>
  );
}
