import React from "react";
import axios from "axios";
import { Lock } from "lucide-react";
import { API } from "@/lib/api";
import * as UI from "@/lib/ui";

// The canonical, customer-facing "XauCloud Market Outlook" / "10-Minute
// Engine" / "Recent Signals" cards -- sourced from the sanitized subscriber
// mirror (GET /cloud/signals/outlook|engine|recent, backed by the
// subscriber_signals collection; see subscriberSignalFeed.ts). This is the
// ONE presentation used everywhere a customer sees these features: the
// unified Command Center Home for a non-bot-owning trial/subscriber user,
// and (previously) CloudSignalDashboard's own shell before it was merged
// into CloudDashboard.jsx. Do not fork a second version of these cards --
// see the "ONE Command Center" product rule (2026-08-25).
export const signalAxios = axios.create({ baseURL: API, withCredentials: true });

export function formatNaira(koboAmount) {
  if (koboAmount === null || koboAmount === undefined) return "—";
  const naira = koboAmount / 100;
  if (naira === 0) return "Free";
  return `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

export function relTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = ms / 1000;
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const PLAN_LABEL = { WEEKLY: "Weekly Signals", MONTHLY: "Monthly Signals" };
const STATUS_TONE = { WATCHING: "info", ACTIONABLE: "profit", BLOCKED: "loss", EXPIRED: "neutral" };

// Plain-English summary of "your plan" from the entitlement object -- every
// call site derives its header/CTA from this one function so they never
// disagree with each other.
export function planSummary(entitlement) {
  if (!entitlement) return { title: "Loading your plan…" };
  const { source, trial, subscription } = entitlement;

  if (source === "trial" && trial) {
    const days = trial.days_remaining ?? 0;
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

export function SignalCard({ title, icon: Icon, state }) {
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

export function RecentSignalsCard({ state }) {
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
