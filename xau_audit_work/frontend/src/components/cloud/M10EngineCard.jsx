import React, { useState } from "react";
import { Lock } from "lucide-react";
import * as UI from "@/lib/ui";
import { M10_DECISION_LABELS, FRESHNESS_LABELS, humanEnumLabel } from "./M10VsOutlookCard";
import { relTime } from "./SubscriberSignalCards";

const CARD = "rounded-2xl bg-[#0C0D12]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

function pill(tone) {
  const m = { green: "bg-emerald-400/12 text-emerald-300 border-emerald-400/20", red: "bg-red-500/12 text-red-300 border-red-400/20", amber: "bg-gold-300/12 text-gold-200 border-gold-300/20", blue: "bg-sky-300/12 text-sky-200 border-sky-300/20", neutral: "bg-white/[0.06] text-white/50 border-white/[0.08]" };
  return `border rounded-full px-2.5 py-0.5 text-[10px] font-bold ${m[tone] || m.neutral}`;
}

// ONE customer-facing 10-Minute Engine evidence panel (2026-08-25 dashboard
// unification fix). Previously a bot owner saw this full evidence card
// (buy/sell evidence bars, plain-English reason, technical detail) while a
// free/trial/signal-subscriber user saw only a 4-line summary (SignalCard in
// SubscriberSignalCards.jsx) sourced from a much thinner mirror payload.
// This component now renders identically for both personas -- the only
// difference is the shape of `evidence` the caller builds:
//   - Bot owner (CloudDashboard.jsx HomePage): straight from the EA's own
//     m10_signal heartbeat payload (latestM10Signal()).
//   - Subscriber (SubscriberHomePage): normalized from GET /cloud/signals/engine's
//     sanitized subscriber_signals mirror -- see normalizeSubscriberM10Evidence().
// `freshnessMeta` (subscriber-only) surfaces the last-evaluated vs
// last-state-change vs last-actionable distinction the mirror now tracks, so
// an actively-scanning-but-still-WATCHING engine never reads as stalled.
export function normalizeSubscriberM10Evidence(signal) {
  if (!signal) return null;
  return {
    decision: signal.decision || null,
    preferred_direction: ["BUY", "SELL"].includes(signal.direction) ? signal.direction : "NONE",
    freshness_state: signal.freshness_state || (signal.status === "EXPIRED" ? "STALE" : "FRESH"),
    buy_case_score: signal.buy_evidence,
    sell_case_score: signal.sell_evidence,
    confidence: signal.confidence,
    reason: signal.reason,
    trend_state: signal.trend_state,
    structure_state: signal.structure_state,
    location_state: signal.location_state,
    exhaustion_decision: signal.exhaustion_decision,
    evidence_id: signal.evidence_id,
    bar_time: signal.bar_time,
    age_seconds: null, // subscriber freshness is shown via freshnessMeta.last_evaluated_at instead
  };
}

function FreshnessLine({ freshnessMeta }) {
  if (!freshnessMeta) return null;
  const { last_evaluated_at, last_state_change_at, last_actionable_at } = freshnessMeta;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/30">
      <span>Last evaluated {relTime(last_evaluated_at)}</span>
      {last_state_change_at && <span>· Last state change {relTime(last_state_change_at)}</span>}
      {last_actionable_at && <span>· Last actionable signal {relTime(last_actionable_at)}</span>}
    </div>
  );
}

export default function M10EngineCard({ evidence, online = true, locked = false, unavailable = false, freshnessMeta = null }) {
  const [showTechnical, setShowTechnical] = useState(false);

  if (locked) {
    return (
      <div className={`${CARD} p-4`} data-testid="m10-signal-card">
        <div className={MONO_LABEL}>M10 Signal Engine · Evidence</div>
        <UI.EmptyState icon={Lock} title="Not included in your plan" body="Start a free trial or subscribe to see the full 10-Minute Engine evidence." />
      </div>
    );
  }
  if (unavailable) {
    return (
      <div className={`${CARD} p-4`} data-testid="m10-signal-card">
        <div className={MONO_LABEL}>M10 Signal Engine · Evidence</div>
        <p className="mt-2 text-[12px] leading-5 text-white/45">Signal feed temporarily unavailable.</p>
      </div>
    );
  }

  const latest = evidence;
  if (!latest) return (
    <div className={`${CARD} p-4`} data-testid="m10-signal-card">
      <div className={MONO_LABEL}>M10 Signal Engine · Evidence</div>
      <p className="mt-2 text-[12px] leading-5 text-white/45">
        {online
          ? "No live M10 evidence yet. The engine publishes a fresh reading after the next completed M10 scan (about every 10 minutes)."
          : "Waiting for your EA heartbeat. M10 evidence appears here once your bot is online and reports a scan."}
      </p>
      <FreshnessLine freshnessMeta={freshnessMeta} />
    </div>
  );

  const decision = latest.decision || "DATA_UNAVAILABLE";
  const preferredDir = latest.preferred_direction || "NONE";
  const freshnessState = latest.freshness_state || "UNKNOWN";
  const isStaleOrUnknown = freshnessState === "STALE" || freshnessState === "UNKNOWN";
  const decisionTone = isStaleOrUnknown ? "neutral"
    : decision === "BUY_CANDIDATE" ? "green"
    : decision === "SELL_CANDIDATE" ? "red"
    : decision.startsWith("WAIT_FOR") ? "amber"
    : decision === "TRANSITION_WATCH" ? "blue"
    : "neutral";
  const freshnessTone = freshnessState === "FRESH" ? "green" : freshnessState === "DEGRADED" ? "amber" : "red";

  const buyScore = Number(latest.buy_case_score || 0);
  const sellScore = Number(latest.sell_case_score || 0);
  const leadingScore = Math.max(buyScore, sellScore);
  const leadingSide = buyScore >= sellScore ? "BUY" : "SELL";
  const isActionable = ["BUY_CANDIDATE", "SELL_CANDIDATE"].includes(decision);
  const confidenceLabel = isActionable ? "Signal confidence" : "Evidence strength";
  const rawReason = String(latest.reason || "");
  const reasonLooksContradictory = /neither case cleared/i.test(rawReason) && leadingScore >= 55;
  const displayReason = reasonLooksContradictory
    ? `${leadingSide} evidence reached ${leadingScore.toFixed(1)}, but no actionable candidate was authorized because direction, structure, location and confirmation did not all pass.`
    : rawReason;
  const hasEvidenceScores = latest.buy_case_score != null || latest.sell_case_score != null;

  return (
    <div className={`${CARD} p-5`} data-testid="m10-signal-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className={MONO_LABEL}>M10 Signal Engine · Evidence{latest.evidence_id != null ? ` #${latest.evidence_id}` : ""}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={pill(freshnessTone)}>{humanEnumLabel(freshnessState, FRESHNESS_LABELS)}{latest.age_seconds != null ? ` · ${latest.age_seconds}s old` : ""}</span>
          <span className={pill(decisionTone)}>{isStaleOrUnknown ? "Data delayed" : humanEnumLabel(decision, M10_DECISION_LABELS)}</span>
        </div>
      </div>

      {isStaleOrUnknown ? (
        <p className="mt-3 text-[11px] leading-4 text-white/45">
          This evidence is {freshnessState.toLowerCase()}{latest.age_seconds != null ? ` (${latest.age_seconds}s old)` : ""} -- not shown as a live signal.
        </p>
      ) : (
        <>
          {hasEvidenceScores && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between text-[11px] text-white/50">
                  <span>Buy evidence</span><span className="font-mono">{buyScore.toFixed(0)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full bg-emerald-400/70" style={{ width: `${Math.max(0, Math.min(100, buyScore))}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] text-white/50">
                  <span>Sell evidence</span><span className="font-mono">{sellScore.toFixed(0)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full bg-red-400/70" style={{ width: `${Math.max(0, Math.min(100, sellScore))}%` }} />
                </div>
              </div>
            </div>
          )}

          {hasEvidenceScores && (
            <p className="mt-4 text-[12px] leading-5 text-white/70">
              <span className="font-semibold text-white/85">{preferredDir}</span> evidence is {leadingScore.toFixed(0)}% strong{isActionable ? "." : ", but the setup is not ready for execution yet."}
            </p>
          )}
          {displayReason && <p className="mt-1.5 text-[11px] leading-4 text-white/45">{displayReason}</p>}

          {(latest.trend_state || latest.structure_state || latest.location_state) && (
            <button onClick={() => setShowTechnical((s) => !s)} className="mt-3 flex items-center gap-1 text-[10px] text-white/35 hover:text-white/65">
              {showTechnical ? "Hide" : "Show"} technical details
            </button>
          )}
          {showTechnical && (
            <>
              <div className="mt-2 grid grid-cols-2 gap-3 border-t border-white/[0.05] pt-3 sm:grid-cols-4 text-[11px]">
                <div><div className="text-white/35">Trend</div><div className="mt-0.5 font-mono text-white/80">{humanEnumLabel(latest.trend_state)}</div></div>
                <div><div className="text-white/35">Structure</div><div className="mt-0.5 font-mono text-white/80">{humanEnumLabel(latest.structure_state)}</div></div>
                <div><div className="text-white/35">Location</div><div className="mt-0.5 font-mono text-white/80">{humanEnumLabel(latest.location_state)}</div></div>
                <div><div className="text-white/35">{confidenceLabel}</div><div className="mt-0.5 font-mono text-white/80">{Number(latest.confidence || 0).toFixed(0)}%</div></div>
              </div>
              <p className="mt-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] leading-4 text-white/40">
                Evidence scores describe the current setup; they are not next-candle probabilities. High evidence at a late or exhausted location can describe a move that is already mature.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/35">
                <span className={pill("neutral")}>Exhaustion evidence-only: {humanEnumLabel(latest.exhaustion_decision)}</span>
                {latest.post_profit_buy_pending && <span className={pill("amber")}>Buy location evidence: extended</span>}
                {latest.post_profit_sell_pending && <span className={pill("amber")}>Sell location evidence: extended</span>}
              </div>
            </>
          )}
        </>
      )}

      <div className="mt-3 text-[10px] text-white/25 font-mono">
        M10 bar {latest.bar_time || "—"}{latest.ea_version ? ` · ${latest.ea_version}` : ""}{latest.build_hash ? ` · ${latest.build_hash}` : ""}
      </div>
      <FreshnessLine freshnessMeta={freshnessMeta} />
    </div>
  );
}
