import React from "react";

const CARD = "rounded-2xl bg-[#0C0D12]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

function timestampLabel(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

// Bug fix: this card used to show the EA's raw M10_DECISION_* / freshness
// enum text with underscores swapped for spaces (e.g. "TRANSITION_WATCH" ->
// "TRANSITION WATCH") -- still a raw system code, not plain English. These
// are the complete, real decision values the EA sends (see M10_DECISION_*
// in XAUUSD_AI_Sniper_EA.mq5), written as a customer would actually read them.
export const M10_DECISION_LABELS = {
  BUY_CANDIDATE: "Buy setup forming",
  SELL_CANDIDATE: "Sell setup forming",
  WAIT_FOR_BUY_RETRACE: "Waiting for a pullback to buy",
  WAIT_FOR_SELL_RETRACE: "Waiting for a pullback to sell",
  TREND_CONTINUATION_NO_ENTRY_YET: "Trend continuing, no entry yet",
  TRANSITION_WATCH: "Watching for a trend change",
  RANGE_NO_TRADE: "Market ranging, no trade",
  NO_VALID_SIGNAL: "No valid signal right now",
  DATA_UNAVAILABLE: "Waiting for data",
  DATA_PENDING: "Waiting for data",
  WAITING: "Waiting for signal",
};

// M30 consensus candidate-lifecycle values (XAU_BuildM30ConsensusDecision,
// XAUUSD_AI_Sniper_EA.mq5) -- same "raw enum shown to a customer" bug class
// as M10_DECISION_LABELS above, in the adjacent M30ConsensusCard.
export const M30_LIFECYCLE_LABELS = {
  MODE_INACTIVE: "M30 mode inactive",
  ENTRY_TIMER_ACTIVE: "Entry timer running",
  TIMER_ELAPSED_AWAITING_REVALIDATION: "Timer elapsed, re-checking setup",
  NO_ACTIVE_CANDIDATE: "No active candidate",
  AWAITING_SLOT_DATA: "Waiting for slot data",
};

export const FRESHNESS_LABELS = {
  FRESH: "Up to date",
  STALE: "Delayed",
  NO_DATA: "No data yet",
  "NO DATA": "No data yet",
};

export function humanEnumLabel(value, map) {
  if (!value) return "—";
  const key = String(value).toUpperCase().trim();
  if (map && map[key]) return map[key];
  return key
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * One display-only comparison of the EA's canonical M10 signal and the
 * backend's canonical hourly outlook. It never derives a trading decision or
 * performs a request; callers supply data from their existing owners.
 */
export default function M10VsOutlookCard({
  m10,
  outlook,
  online = true,
  loading = false,
  requestFailed = false,
}) {
  const m10Dir = m10?.preferred_direction || "NONE";
  const outlookDir = outlook?.primary_direction || "NONE";
  const m10Freshness = m10?.freshness_state || "NO DATA";
  const outlookFreshness = outlook?.freshness_state || outlook?.status || "NO DATA";
  const bothDirectional = ["BUY", "SELL"].includes(m10Dir) && ["BUY", "SELL"].includes(outlookDir);
  const comparisonIsFresh = online && !requestFailed && m10Freshness === "FRESH";
  const agree = comparisonIsFresh && bothDirectional && m10Dir === outlookDir;
  const conflict = comparisonIsFresh && bothDirectional && m10Dir !== outlookDir;

  return (
    <div className={`${CARD} p-5`} data-testid="m10-vs-outlook-card">
      <div className={MONO_LABEL}>M10 Execution Signal vs Hourly Advisory Outlook</div>

      {loading && !outlook ? (
        <p className="mt-3 text-[12px] text-white/40">Loading the latest canonical outlook…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
            <div className="min-w-0 rounded-xl border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-white/35">M10 (near-term)</div>
              <div className="mt-1 truncate font-mono text-lg font-black">{m10Dir}</div>
              <div className="mt-1 break-words text-white/45">
                {m10 ? `${humanEnumLabel(m10.decision || "WAITING", M10_DECISION_LABELS)} · ${humanEnumLabel(m10Freshness, FRESHNESS_LABELS)}` : "No signal data yet"}
              </div>
              <div className="mt-1 text-[10px] text-white/30">
                {m10?.confidence != null ? `${Number(m10.confidence).toFixed(0)}% ${["BUY","SELL"].includes(m10Dir) ? "signal confidence" : "evidence strength"}` : "Evidence —"}
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wide text-white/35">Hourly outlook</div>
              <div className="mt-1 truncate font-mono text-lg font-black">{outlookDir}</div>
              <div className="mt-1 break-words text-white/45">
                {outlook?.confidence_pct != null ? `${outlook.confidence_pct}% confidence` : "No outlook data yet"}
              </div>
              <div className="mt-1 text-[10px] text-white/30">{humanEnumLabel(outlookFreshness, FRESHNESS_LABELS)}</div>
            </div>
          </div>

          {!online && (
            <p className="mt-3 text-[11px] text-gold-200">
              EA offline — values shown are last known only; no live agreement is claimed.
            </p>
          )}
          {requestFailed && (
            <p className="mt-3 text-[11px] text-rose-300">
              The hourly outlook refresh failed. Last known data remains clearly marked.
            </p>
          )}
          {online && m10 && m10Freshness !== "FRESH" && (
            <p className="mt-3 text-[11px] text-gold-200">
              M10 evidence is {m10Freshness.toLowerCase()} — waiting for fresh data before showing agreement.
            </p>
          )}
          {agree && <p className="mt-3 text-[11px] text-emerald-300">Agree: both currently favor {m10Dir}.</p>}
          {conflict && <p className="mt-3 text-[11px] text-gold-300">Conflict: M10 favors {m10Dir}; hourly outlook favors {outlookDir}.</p>}
          {online && !requestFailed && m10Freshness === "FRESH" && !bothDirectional && (
            <p className="mt-3 text-[11px] text-white/35">
              M10 remains authoritative. The hourly advisory is neutral or waiting and does not erase the M10 state.
            </p>
          )}
          {!loading && !m10 && !outlook && (
            <p className="mt-3 text-[11px] text-white/35">No comparison data yet. Waiting for the EA and hourly outlook.</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/35">
            <span>M10 broker bar {m10?.bar_time || "—"}</span>
            <span>· Hourly update (device time) {timestampLabel(outlook?.generated_at || outlook?.published_at || outlook?.created_at || outlook?.ts)}</span>
          </div>
        </>
      )}
    </div>
  );
}
