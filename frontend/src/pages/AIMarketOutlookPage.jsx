import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Bell, BellOff, ArrowUpRight, ArrowDownRight, Minus, Compass,
  ChevronDown, ChevronUp, Filter, TrendingUp, TrendingDown, Activity,
  AlertTriangle, CheckCircle2, Clock3, Database, Radio, ShieldCheck, Wallet,
} from "lucide-react";
import { API } from "@/lib/api";
import Seo from "@/components/Seo";

const outlookAxios = axios.create({ baseURL: API, withCredentials: true });

const CARD = "rounded-2xl bg-[#0C0D12]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

const COLOR_STYLE = {
  GREEN: { border: "border-l-emerald-400", text: "text-emerald-300", bg: "bg-emerald-300/[0.04]" },
  RED: { border: "border-l-rose-400", text: "text-rose-300", bg: "bg-rose-300/[0.04]" },
  GRAY: { border: "border-l-white/25", text: "text-white/45", bg: "bg-white/[0.02]" },
  AMBER: { border: "border-l-gold-300", text: "text-gold-200", bg: "bg-gold-300/[0.04]" },
  // PARTIAL_PROFIT / BREAK_EVEN (root-cause fix, 2026-08-05): distinct from
  // GREEN/RED so a genuinely-positive-but-below-TP1 or near-entry close is
  // never visually indistinguishable from a clean win or a real loss.
  BLUE: { border: "border-l-sky-400", text: "text-sky-300", bg: "bg-sky-400/[0.04]" },
  TEAL: { border: "border-l-teal-400", text: "text-teal-300", bg: "bg-teal-400/[0.04]" },
};

const DIRECTION_ICON = { BUY: ArrowUpRight, SELL: ArrowDownRight, NEUTRAL: Minus, RANGE: Minus, TRANSITION: Compass, NO_VALID_OUTLOOK: Minus };

// Two independent filter dimensions, customer-meaning labels only -- color
// names (Green/Red/Gray/Amber) are internal styling references, never
// customer-facing filter labels.
const DIRECTION_FILTERS = ["All", "BUY", "SELL"];
const RESULT_FILTERS = ["All", "Wins", "Losses", "Active"];
// Maps each Result chip to the /outlook/history query params the backend
// already supports. "Active" uses color=AMBER (still-tracking/unresolved) --
// the backend doesn't yet distinguish "expired" from "still active" as a
// separate queryable state, so that split isn't offered rather than
// fabricating a filter that doesn't correspond to real data.
const RESULT_FILTER_PARAMS = { All: {}, Wins: { color: "GREEN" }, Losses: { color: "RED" }, Active: { color: "AMBER" } };
const HISTORY_PAGE_SIZE = 12;

// The one authoritative XauCloud result-display conversion, mirroring
// backend market_outlook.py's build_result_conversion()/
// XAUCLOUD_PIPS_PER_GOLD_MOVE exactly: 1.00 Gold price move = 10 XauCloud
// pips, so TP1 (+0.50R) = +5.00 Gold moves = +50 XauCloud pips. Used for
// the advisory tracking's own R (current_r/mfe_r/mae_r), which only ever
// carries R + risk_distance client-side; real automated trade results
// already arrive with result_pips/result_gold_moves computed server-side
// by that same function and must never be recomputed here.
// v6.26.0 Phase 4 owner directive -- one shared conversion engine. The
// backend (market_outlook_routes.get_current_outlook) now pre-computes
// pips/Gold moves for current_r/mfe_r/mae_r via the same
// build_result_conversion() every other server-side consumer already uses
// (current_pips/current_gold_moves, mfe_pips/mfe_gold_moves,
// mae_pips/mae_gold_moves on the outlook object) -- this page must display
// those values, never recompute them client-side. The fallback path below
// only exists for a still-loading/older cached response where the
// precomputed fields haven't arrived yet; it is not a second source of
// truth, just a graceful "—" until the real value lands.
const XAUCLOUD_PIPS_PER_GOLD_MOVE = 10;
function resultText(r, riskDistance, precomputedPips, precomputedGoldMoves) {
  if (precomputedPips != null && precomputedGoldMoves != null) {
    const sign = r >= 0 ? "+" : "";
    return `${sign}${precomputedPips} pips · ${sign}${precomputedGoldMoves} Gold moves · ${rText(r)}`;
  }
  if (r == null || !riskDistance) return rText(r);
  const priceMove = r * riskDistance;
  const goldMoves = Math.round(priceMove * 100) / 100;
  const pips = Math.round(priceMove * XAUCLOUD_PIPS_PER_GOLD_MOVE * 10) / 10;
  const sign = r >= 0 ? "+" : "";
  return `${sign}${pips}${" pips · "}${sign}${goldMoves} Gold moves · ${rText(r)}`;
}

const DEVELOPMENT_PREVIEW_CONTRACT = {
  state: "ACTIONABLE_SIGNAL", stateReason: "M10_EXECUTION_READY", canonicalSource: "M10",
  symbol: "XAUUSD", direction: "SELL", confidence: 72, confidenceSource: "EA_M10",
  executionStatus: "READY", executionReady: true, candidateId: "preview-sell-20260722",
  signalBarTime: "2026-07-22T08:50:00+00:00", eventTime: new Date().toISOString(),
  freshnessSeconds: 8, dataHealth: "HEALTHY", missingFields: [], blockerCode: null,
  nextRequiredCondition: "Signal is confirmed by the EA.",
  m10: { decision: "SELL_CANDIDATE", direction: "SELL", confidence: 72, freshness_state: "FRESH", execution_status: "READY" },
  hourlyContext: { state: "NEUTRAL", direction: null, confidence: null, reason: "Broader hourly context remains neutral.", advisoryOnly: true },
  notificationEligibility: { eligible: true, reason: "ELIGIBLE" }, notificationSent: false,
};

function resultLabel(o) {
  // v6.25.2 owner directive 2026-07-17 -- a TRANSITION/NEUTRAL/RANGE update
  // is informational only, never an active or resolved directional signal
  // -- must not be labeled with generic PUBLISHED/PENDING status text that
  // reads like a trade outcome.
  if (o.primary_direction && !["BUY", "SELL"].includes(o.primary_direction)) {
    return "INFORMATIONAL UPDATE";
  }
  if (o.signal_state === "TRACKING_AMBER") return "TRACKING · AWAITING TP1";
  if (o.signal_state === "WIN_GREEN_0_5R") return "WIN · +0.50R HIT";
  // Root-cause fix (2026-08-05): "TP{n} WIN" per the owner's exact
  // classification naming -- highest_tp_reached already distinguishes
  // TP1 from TP2/TP3, this only fixes the label text itself (was
  // "WIN · TP{n} HIT").
  if (o.signal_state === "WIN_GREEN_TP1") return `TP${o.highest_tp_reached || 1} WIN`;
  if (o.signal_state === "LOSS_RED_SL") return "LOSS · SL HIT";
  // Root-cause fix (2026-08-05): LOSS_RED_TIMEOUT now only fires when the
  // signal's own achieved R at the 60-minute deadline was genuinely
  // negative -- a positive-but-below-TP1 close is PARTIAL_PROFIT below,
  // never this branch, so this label no longer needs "BELOW +0.50R"
  // framing (that was the actual mislabeling bug: it fired regardless of
  // sign).
  if (o.signal_state === "LOSS_RED_TIMEOUT") return "LOSS · NO TP REACHED";
  if (o.signal_state === "PARTIAL_PROFIT") return "PARTIAL PROFIT";
  if (o.signal_state === "BREAK_EVEN") return "BREAK-EVEN";
  if (o.signal_state === "HISTORICAL_DATA_UNAVAILABLE") return "HISTORICAL DATA UNAVAILABLE";
  if (!o.final_result) return o.status?.replace(/_/g, " ") || "TRACKING";
  return o.final_result.replace(/_/g, " ");
}

function rText(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function timeText(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

// Shows a timestamp in both broker/server time (UTC -- what MT5 actually
// stamped the event with) and the viewer's own local time, both labeled --
// a plain "8:50 AM" alone doesn't say which clock it's in, and the two can
// differ by hours depending on the customer's timezone vs the broker server.
function DualTime({ value }) {
  if (!value) return <span>—</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  const broker = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const local = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <span>Broker {broker} UTC · Yours {local}</span>;
}

function elapsedText(start, end) {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function OutlookHero({ outlook, advanced, setAdvanced }) {
  if (!outlook) return null;
  const dir = outlook.primary_direction || "NO_VALID_OUTLOOK";
  const Icon = DIRECTION_ICON[dir] || Minus;
  const isDirectional = dir === "BUY" || dir === "SELL";
  const lifecycleColor = COLOR_STYLE[outlook.color_state] || COLOR_STYLE.AMBER;

  return (
    <div className={`${CARD} ${isDirectional ? `border-l-4 ${lifecycleColor.border} ${lifecycleColor.bg}` : ""} p-5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${dir === "BUY" ? "text-emerald-300" : dir === "SELL" ? "text-rose-300" : "text-white/50"}`} />
          <span className="font-mono text-2xl font-black">{dir === "NEUTRAL" ? "NO TRADE RIGHT NOW" : dir.replace(/_/g, " ")}</span>
          {isDirectional && <span className="font-mono text-sm text-white/40">{outlook.confidence_pct}%</span>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {isDirectional && <span className={`max-w-[12rem] text-right font-mono text-[10px] font-bold ${lifecycleColor.text}`}>{resultLabel(outlook)}</span>}
          <button onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-white/25">
            {advanced ? "Simple" : "Advanced"} {advanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      <p className="mt-3 text-[13px] leading-5 text-white/70">{outlook.reasoning}</p>
      {outlook.uncertainty && <p className="mt-1 text-[11px] text-white/35">What would invalidate this: {outlook.uncertainty}</p>}
      {outlook.directional_conflict && (
        <p className="mt-2 rounded-lg border border-gold-300/25 bg-gold-300/[0.06] px-2.5 py-1.5 text-[11px] text-gold-200">
          Downgraded to TRANSITION: {outlook.directional_conflict}
        </p>
      )}
      {outlook.price_source === "EXTERNAL_FALLBACK_FEED" && (
        <p className="mt-2 text-[10px] text-white/30">Price source: fallback feed (no live EA price available this cycle)</p>
      )}
      {outlook.data_integrity_status === "INVALID_DATA" && (
        <p className="mt-2 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-2.5 py-1.5 text-[11px] text-rose-300">
          Flagged INVALID_DATA — excluded from performance stats: {outlook.data_integrity_note}
        </p>
      )}

      {isDirectional && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Audit fix: these used to be plain template literals, e.g.
                `${a}–${b}` -- if either field were ever missing, JS coerces
                it to the literal string "undefined" INSIDE the combined
                string, which is truthy and so bypasses Metric's own
                `value ?? "—"` fallback entirely (the fallback only catches
                a wholly-null/undefined value, not "undefined" baked into
                part of a longer string). safeJoin renders "—" for any
                missing piece before the pieces are ever combined. */}
            <Metric label="Preferred zone" value={safeJoin([outlook.preferred_entry_zone_low, outlook.preferred_entry_zone_high], "–")} />
            <Metric label="SL" value={outlook.suggested_sl} />
            <Metric label="TP1" value={outlook.tp1_price != null ? `${outlook.tp1_price}${outlook.tracking_entry_price != null ? ` (${Math.round(Math.abs(outlook.tp1_price - outlook.tracking_entry_price) * 100) / 10} pips)` : ""}` : "—"} />
            <Metric label="TP2 / TP3" value={safeJoin([outlook.tp2_price, outlook.tp3_price], " / ")} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Signal entry" value={outlook.tracking_entry_price} />
            <Metric label="Current result" value={resultText(outlook.current_r, outlook.risk_distance, outlook.current_pips, outlook.current_gold_moves)} />
            <Metric label="MFE / MAE" value={`${resultText(outlook.mfe_r, outlook.risk_distance, outlook.mfe_pips, outlook.mfe_gold_moves)} / ${resultText(outlook.mae_r, outlook.risk_distance, outlook.mae_pips, outlook.mae_gold_moves)}`} />
            <Metric label="Elapsed / deadline" value={`${elapsedText(outlook.published_at, outlook.classification_at)} / ${timeText(outlook.evaluation_deadline)}`} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Expected path" value={(outlook.expected_path || "").replace(/_/g, " ")} />
            <Metric label="Setup type" value={(outlook.setup_type || "").replace(/_/g, " ")} />
            <Metric label="Status" value={(outlook.status || "").replace(/_/g, " ")} />
            <Metric label="Chase limit" value={outlook.chase_limit} />
          </div>
          {(outlook.first_half_r_at || outlook.tp1_hit_at || outlook.tp2_hit_at || outlook.tp3_hit_at || outlook.sl_hit_at) && (
            <div className="mt-3 rounded-lg border border-white/[0.05] bg-black/15 p-2.5 font-mono text-[10px] text-white/40">
              +0.50R {timeText(outlook.first_half_r_at)} · TP1 {timeText(outlook.tp1_hit_at)} · TP2 {timeText(outlook.tp2_hit_at)} · TP3 {timeText(outlook.tp3_hit_at)} · SL {timeText(outlook.sl_hit_at)}
            </div>
          )}
          {outlook.final_structural_sl != null && (
            <div className="mt-3 rounded-lg border border-white/[0.05] bg-white/[0.015] p-2.5 text-[10px] text-white/40">
              Risk policy: raw structural SL {outlook.raw_structural_sl} (dist {outlook.raw_sl_distance}) ×{" "}
              {outlook.sl_widening_factor} widening → final SL {outlook.final_structural_sl} (dist {outlook.final_sl_distance}) ·
              target risk {outlook.configured_risk_pct}%
            </div>
          )}
        </>
      )}

      {advanced && (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <div className={MONO_LABEL}>Evidence breakdown</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {outlook.confidence_components && Object.entries(outlook.confidence_components).map(([k, v]) => (
              <div key={k} className="text-[10px]">
                <div className="text-white/35">{k.replace(/_/g, " ")}</div>
                <div className="font-mono text-white/70">{Math.round(v)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 text-[10px] text-white/45">
            <div>BUY pressure: <span className="text-white/70">{outlook.buy_pressure}</span></div>
            <div>SELL pressure: <span className="text-white/70">{outlook.sell_pressure}</span></div>
            <div>Exhaustion: <span className="text-white/70">{outlook.exhaustion_pct}%</span></div>
            <div>Movement consumed: <span className="text-white/70">{outlook.movement_consumed_pct}%</span></div>
            <div>Remaining room: <span className="text-white/70">{resultText(outlook.remaining_room_r, outlook.risk_distance)}</span></div>
            <div>Structure: <span className="text-white/70">{outlook.structure_state}</span></div>
            <div>Trend state: <span className="text-white/70">{outlook.trend_state}</span></div>
            <div>Regime: <span className="text-white/70">{outlook.market_regime}</span></div>
            <div>Outlook ID: <span className="text-white/70">{outlook.id}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="min-w-0">
      <div className={MONO_LABEL}>{label}</div>
      <div className="mt-1 truncate font-mono text-[13px] font-bold text-white/85">{value ?? "—"}</div>
    </div>
  );
}


// Joins possibly-missing values with a separator, rendering "—" for any
// null/undefined piece instead of letting it coerce to the literal text
// "undefined" inside the combined string.
function safeJoin(values, separator) {
  return values.map((v) => (v == null ? "—" : v)).join(separator);
}

// Real broker-confirmed trade truth outranks the advisory color for at-a-
// glance scanning (owner rule: never show green from floating/advisory
// profit alone) -- when a real result exists, the card border reflects
// THAT, while the advisory badge stays visible and separately labeled.
const REAL_RESULT_TONE_COLOR = { emerald: COLOR_STYLE.GREEN, rose: COLOR_STYLE.RED, slate: COLOR_STYLE.GRAY };

function HistoryCard({ outlook }) {
  const [expanded, setExpanded] = useState(false);
  const signalTime = outlook.published_at || outlook.generated_at;
  const time = signalTime ? new Date(signalTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const tradeResult = outlook.automated_trade_result;
  const tradeOutcome = tradeResult?.status === "matched" ? (AUTOMATED_RESULT_COPY[tradeResult.result] || { label: humanEnum(tradeResult.result), tone: "slate" }) : null;
  const tradeToneText = tradeOutcome ? { emerald: "text-emerald-300", rose: "text-rose-300", slate: "text-white/60" }[tradeOutcome.tone] : "";
  const color = (tradeOutcome && REAL_RESULT_TONE_COLOR[tradeOutcome.tone]) || COLOR_STYLE[outlook.color_state] || COLOR_STYLE.AMBER;
  return (
    <div className={`min-w-0 rounded-xl border border-white/[0.06] border-l-4 ${color.border} ${color.bg} p-3`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="font-mono text-[12px] font-bold">{time} {outlook.primary_direction} · {outlook.confidence_pct}%</span>
        <span className={`font-mono text-[11px] font-bold ${color.text}`}>{resultLabel(outlook)}</span>
      </div>

      {tradeOutcome && (
        <div className={`mt-2 rounded-lg border border-current/15 px-2.5 py-1.5 text-[11px] font-semibold ${tradeToneText}`}>
          Your account: {tradeOutcome.label} ({moneyText(tradeResult.realized_profit)})
        </div>
      )}
      {tradeResult?.status === "uncertain" && (
        <div className="mt-2 rounded-lg border border-gold-300/15 px-2.5 py-1.5 text-[11px] text-gold-200">
          Your account: real trade result can&apos;t be confirmed (multiple candidates)
        </div>
      )}

      {["BUY", "SELL"].includes(outlook.primary_direction) ? (
        <>
          <div className="mt-2 text-[11px] text-white/45">
            Entry <span className="font-mono text-white/75">{outlook.tracking_entry_price ?? "—"}</span> · SL {outlook.original_sl ?? outlook.suggested_sl} · TP1 {outlook.tp1_price}
          </div>
          {["WIN_GREEN_TP1", "WIN_GREEN_0_5R", "LOSS_RED_SL", "LOSS_RED_TIMEOUT"].includes(outlook.signal_state) && (
            <div className={`mt-1 font-mono text-[11px] font-semibold ${color.text}`}>
              Result: {resultText(outlook.analytics_r ?? outlook.current_r, outlook.risk_distance)}
            </div>
          )}
          <button onClick={() => setExpanded((e) => !e)} className="mt-2 flex items-center gap-1 text-[10px] text-white/35 hover:text-white/65">
            {expanded ? "Hide" : "Show"} technical details {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1 border-t border-white/[0.05] pt-2 text-[11px] text-white/45">
              <div>Suggested zone {outlook.preferred_entry_zone_low}–{outlook.preferred_entry_zone_high}</div>
              <div>TP2 {outlook.tp2_price} · TP3 {outlook.tp3_price}</div>
              <div>Current {resultText(outlook.current_r, outlook.risk_distance, outlook.current_pips, outlook.current_gold_moves)} · MFE {resultText(outlook.mfe_r, outlook.risk_distance, outlook.mfe_pips, outlook.mfe_gold_moves)} · MAE {resultText(outlook.mae_r, outlook.risk_distance, outlook.mae_pips, outlook.mae_gold_moves)}</div>
              <div>Elapsed {elapsedText(signalTime, outlook.classification_at)} · Deadline {timeText(outlook.evaluation_deadline)} · Last monitored {timeText(outlook.last_monitored_at)}</div>
              {(outlook.first_half_r_at || outlook.tp1_hit_at || outlook.tp2_hit_at || outlook.tp3_hit_at || outlook.sl_hit_at) && (
                <div className="text-[10px] text-white/35">
                  +50 pips {timeText(outlook.first_half_r_at)} · TP1 {timeText(outlook.tp1_hit_at)} · TP2 {timeText(outlook.tp2_hit_at)} · TP3 {timeText(outlook.tp3_hit_at)} · SL {timeText(outlook.sl_hit_at)}
                </div>
              )}
              {outlook.latest_path_event && <div className={`text-[10px] ${color.text}`}>Path: {outlook.latest_path_event.replace(/_/g, " ")}</div>}
              {outlook.historical_data_unavailable_reason && <div className="text-[10px] text-white/35">{outlook.historical_data_unavailable_reason}</div>}
              {tradeResult?.status === "matched" && (
                <div className="text-[10px] text-white/35">
                  Real trade: entry {tradeResult.entry_price} · exit {tradeResult.exit_price} · {tradeResult.result_pips != null ? `${tradeResult.result_pips >= 0 ? "+" : ""}${tradeResult.result_pips} pips` : rText(tradeResult.realized_r)} · ticket {tradeResult.ticket} · {tradeResult.close_reason}
                </div>
              )}
            </div>
          )}
        </>
      ) : outlook.primary_direction !== "NO_VALID_OUTLOOK" ? (
        // v6.25.2 owner directive 2026-07-17 -- a non-directional hourly
        // update (TRANSITION/NEUTRAL/RANGE) is informational only and must
        // never show empty "Entry — · SL — · TP1 —" fields, which reads
        // like a failed/incomplete trade signal instead of what it actually
        // is: no new directional replacement was confirmed this hour.
        <div className="mt-1 text-[11px] text-white/40">
          No new direction confirmed this hour.
        </div>
      ) : null}
      {!["BUY", "SELL"].includes(outlook.primary_direction) && (
        <div className="mt-1 text-[10px] text-white/30">Informational updates are excluded from signal analytics.</div>
      )}
    </div>
  );
}

function ageText(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function EvidenceDiagnostics({ diagnostics }) {
  if (!diagnostics) return null;
  return (
    <div className={`${CARD} p-4`}>
      <div className={MONO_LABEL}>Evidence pipeline</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-white/50 sm:grid-cols-3">
        <div>Last EA evidence: <span className="text-white/75">{ageText(diagnostics.evidence_age_seconds)}</span></div>
        <div>Status: <span className="text-white/75">{diagnostics.evidence_status || diagnostics.generation_status}</span></div>
        <div>Symbol: <span className="text-white/75">{diagnostics.evidence_symbol || "—"}</span></div>
        <div>Last outlook: <span className="text-white/75">{diagnostics.last_outlook_generated_at ? new Date(diagnostics.last_outlook_generated_at).toLocaleTimeString() : "—"}</span></div>
        <div>Next outlook: <span className="text-white/75">{diagnostics.next_outlook_at ? new Date(diagnostics.next_outlook_at).toLocaleTimeString() : "—"}</span></div>
      </div>
    </div>
  );
}

const STATE_COPY = {
  ACTIONABLE_SIGNAL: { eyebrow: "Execution-ready", title: "signal", tone: "emerald", description: "Fresh M10 setup confirmed by the EA." },
  WATCHING: { eyebrow: "Candidate forming", title: "Watching", tone: "amber", description: "Structure is present, but execution confirmation is still pending." },
  NO_SIGNAL: { eyebrow: "Market scan healthy", title: "No signal right now", tone: "slate", description: "Current evidence is complete, but no setup meets execution requirements." },
  DATA_UNAVAILABLE: { eyebrow: "Data recovery", title: "Live outlook temporarily unavailable", tone: "rose", description: "The platform is waiting for complete, fresh broker evidence." },
  BLOCKED: { eyebrow: "Protected", title: "setup blocked", tone: "rose", description: "The EA reported an owner-approved execution blocker." },
  EXPIRED: { eyebrow: "Lifecycle ended", title: "Previous setup expired", tone: "slate", description: "The candidate did not become ready within its permitted lifecycle." },
};

const TONES = {
  emerald: "border-emerald-300/25 bg-emerald-300/[0.055] text-emerald-200",
  amber: "border-gold-300/25 bg-gold-300/[0.055] text-gold-100",
  rose: "border-rose-300/20 bg-rose-300/[0.045] text-rose-100",
  slate: "border-white/10 bg-white/[0.025] text-white/85",
};

function humanEnum(value) {
  if (!value) return "—";
  return String(value).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function ageFromTimestamp(value) {
  if (!value) return "—";
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  return ageText(seconds);
}

function PrimaryStateCard({ contract }) {
  const state = contract?.state || "DATA_UNAVAILABLE";
  const meta = STATE_COPY[state] || STATE_COPY.DATA_UNAVAILABLE;
  const direction = contract?.direction;
  const title = state === "ACTIONABLE_SIGNAL"
    ? `${direction || "Confirmed"} ${meta.title}`
    : state === "WATCHING" && direction ? `${meta.title} for ${direction}`
    : state === "BLOCKED" && direction ? `${direction} ${meta.title}`
    : meta.title;
  const confidence = contract?.confidence;
  return (
    <section className={`relative overflow-hidden rounded-[28px] border p-6 sm:p-8 ${TONES[meta.tone]}`} aria-live="polite">
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-current opacity-[0.035] blur-2xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] opacity-65">{meta.eyebrow}</span>
          <span className="rounded-full border border-current/15 px-3 py-1 font-mono text-[10px] uppercase tracking-wider opacity-70">M10 canonical</span>
        </div>
        <div className="mt-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h2 className="max-w-xl text-3xl font-black tracking-[-0.04em] sm:text-5xl">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58">{meta.description}</p>
          </div>
          {confidence != null && (
            <div className="min-w-[130px] rounded-2xl border border-current/15 bg-black/15 px-5 py-4 text-right">
              <div className="text-3xl font-black">{Math.round(confidence)}%</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-widest opacity-60">EA confidence</div>
            </div>
          )}
        </div>
        <div className="mt-7 grid gap-3 border-t border-current/10 pt-5 sm:grid-cols-3">
          <Metric label="Execution" value={humanEnum(contract?.executionStatus)} />
          <Metric label="M10 bar" value={timeText(contract?.signalBarTime)} />
          <Metric label="Evidence age" value={contract?.freshnessSeconds != null ? ageText(contract.freshnessSeconds) : "—"} />
        </div>
      </div>
    </section>
  );
}

// The original spec's top summary explicitly wants suggested entry
// zone/SL/TP and next-update time visible up front, in plain English --
// this data already existed on the outlook doc (currentOutlook) but was
// never surfaced anywhere on the page after the M10-contract rework.
function SuggestedLevelsCard({ outlook }) {
  if (!outlook || !["BUY", "SELL"].includes(outlook.primary_direction)) return null;
  return (
    <section className={`${CARD} min-w-0 p-5`} data-testid="suggested-levels-card">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className={MONO_LABEL}>Suggested {outlook.primary_direction === "BUY" ? "buy" : "sell"} levels (advisory)</span>
        <span className="font-mono text-[9px] text-white/30">Next update {timeText(outlook.evaluation_deadline)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Entry zone" value={safeJoin([outlook.preferred_entry_zone_low, outlook.preferred_entry_zone_high], "–")} />
        <Metric label="Stop-loss" value={outlook.suggested_sl} />
        <Metric label="Take-profit" value={outlook.tp1_price} />
        <Metric label="Confidence" value={outlook.confidence_pct != null ? `${outlook.confidence_pct}%` : "—"} />
      </div>
      <p className="mt-3 text-[10px] leading-4 text-white/30">
        These are advisory levels for this hourly outlook, not a live automated order — check the Execution status above for whether XauCloud itself is trading.
      </p>
    </section>
  );
}

function M10ExecutionCard({ contract }) {
  const m10 = contract?.m10 || {};
  const ready = Boolean(contract?.executionReady);
  return (
    <section className={`${CARD} p-5 sm:p-6`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={MONO_LABEL}>M10 execution signal</div>
          <div className="mt-2 text-xl font-bold">{contract?.direction || (contract?.state === "NO_SIGNAL" ? "No signal" : "Waiting")}</div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-bold ${ready ? "border-emerald-300/25 text-emerald-200" : "border-gold-300/20 text-gold-100"}`}>
          {ready ? "READY" : humanEnum(contract?.state)}
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Freshness" value={humanEnum(m10.freshness_state)} />
        <Metric label="Confidence" value={contract?.confidence != null ? `${Math.round(contract.confidence)}%` : "—"} />
        <Metric label="Closed bar" value={timeText(contract?.signalBarTime)} />
        <Metric label="Signal age" value={ageFromTimestamp(contract?.eventTime)} />
      </div>
      {contract?.brokerTime && (
        <div className="mt-3 font-mono text-[10px] text-white/30" data-testid="m10-dual-time">
          <DualTime value={contract.brokerTime} />
        </div>
      )}
      <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-[12px] leading-5 text-white/55">
        <span className="text-white/80">Next:</span> {contract?.nextRequiredCondition || "Waiting for current EA evidence."}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-white/35">
        <span>Notification: {contract?.notificationSent ? "sent" : humanEnum(contract?.notificationEligibility?.reason)}</span>
        <span>Executed: {["EXECUTED", "FILLED", "BROKER_CONFIRMED"].includes(m10.execution_status) ? "yes" : "no"}</span>
      </div>
    </section>
  );
}

function HourlyContextCard({ context }) {
  return (
    <section className={`${CARD} p-5`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className={MONO_LABEL}>Hourly market context</div>
          <div className="mt-2 text-lg font-semibold">{humanEnum(context?.state || "UNAVAILABLE")} context</div>
        </div>
        <Clock3 className="h-5 w-5 text-white/25" />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-white/45">{context?.reason || "Waiting for the next hourly evaluation."}</p>
      <p className="mt-4 border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-white/30">Hourly context is advisory and does not replace the M10 execution signal.</p>
    </section>
  );
}

function WaitingCard({ contract }) {
  const Icon = contract?.state === "DATA_UNAVAILABLE" ? AlertTriangle : Radio;
  const actionable = contract?.state === "ACTIONABLE_SIGNAL";
  return (
    <section className={`${CARD} flex gap-4 p-5`}>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3"><Icon className="h-5 w-5 text-gold-200/75" /></div>
      <div>
        <div className={MONO_LABEL}>{actionable ? "Current execution state" : "What the bot is waiting for"}</div>
        <p className="mt-2 text-[13px] leading-5 text-white/70">
          {actionable ? "No additional confirmation is pending; the M10 signal is execution-ready." : contract?.nextRequiredCondition || "Fresh EA evidence."}
        </p>
        {contract?.blockerLabel && <p className="mt-1 text-[11px] text-rose-200/65">Blocker: {contract.blockerLabel}</p>}
      </div>
    </section>
  );
}

function DataHealthStrip({ contract, diagnostics, notificationStatus }) {
  const healthy = contract?.dataHealth === "HEALTHY";
  const items = [
    [Activity, "EA", diagnostics?.evidence_status === "OK" ? "Connected" : "Unavailable"],
    [Database, "Broker data", healthy ? "Fresh" : "Unavailable"],
    [Clock3, "Last M10 bar", timeText(contract?.signalBarTime)],
    [Radio, "Last update", ageFromTimestamp(contract?.eventTime)],
    [ShieldCheck, "Notifications", notificationStatus || (contract?.notificationSent ? "Delivered" : "Not sent")],
  ];
  return (
    <section className={`${CARD} grid grid-cols-2 gap-px overflow-hidden p-px sm:grid-cols-5`} aria-label="Data health">
      {items.map(([Icon, label, value]) => (
        <div key={label} className="min-w-0 bg-[#0d0e13] p-4">
          <div className="flex items-center gap-2 text-white/30"><Icon className="h-3.5 w-3.5" /><span className="font-mono text-[9px] uppercase tracking-widest">{label}</span></div>
          <div className="mt-2 truncate text-[11px] font-semibold text-white/70">{value}</div>
        </div>
      ))}
    </section>
  );
}

// "automated_trade_result" is real, broker-confirmed truth about a trade
// XauCloud actually executed -- separate from and never merged into the
// advisory M10/hourly tracking above (a prior owner directive keeps those
// two clearly apart: one is "what if you had taken this setup," the other
// is "what your account actually did"). Rendered in plain English first,
// with the underlying broker fields available on demand.
const AUTOMATED_RESULT_COPY = {
  TP_HIT: { label: "Hit take-profit", tone: "emerald", icon: CheckCircle2 },
  WIN: { label: "Closed in profit", tone: "emerald", icon: CheckCircle2 },
  SL_HIT: { label: "Hit stop-loss", tone: "rose", icon: AlertTriangle },
  LOSS: { label: "Closed at a loss", tone: "rose", icon: AlertTriangle },
  BREAK_EVEN: { label: "Closed break-even", tone: "slate", icon: Minus },
};

function moneyText(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function AutomatedTradeResultCard({ result }) {
  const [showDetails, setShowDetails] = useState(false);
  if (!result || !["matched", "uncertain"].includes(result.status)) return null;

  if (result.status === "uncertain") {
    return (
      <section className={`${CARD} border-l-4 border-l-gold-300 bg-gold-300/[0.04] p-5`}>
        <div className={MONO_LABEL}>Your account · real trade result</div>
        <div className="mt-2 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-gold-300" />
          <span className="text-lg font-bold text-gold-100">Can&apos;t confirm which trade this was yet</span>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-white/55">
          More than one trade in your account matched this signal&apos;s timing, so XauCloud is not guessing which one it was.
          This will stay unresolved rather than show a possibly-wrong result.
        </p>
      </section>
    );
  }

  const outcome = AUTOMATED_RESULT_COPY[result.result] || { label: humanEnum(result.result), tone: "slate", icon: Wallet };
  const Icon = outcome.icon;
  const toneClass = { emerald: "border-l-emerald-400 bg-emerald-300/[0.04] text-emerald-200",
    rose: "border-l-rose-400 bg-rose-300/[0.04] text-rose-200",
    slate: "border-l-white/25 bg-white/[0.02] text-white/70" }[outcome.tone];

  return (
    <section className={`${CARD} min-w-0 border-l-4 p-5 ${toneClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className={MONO_LABEL}>Your account · real trade result</div>
        <span className="flex-none rounded-full border border-current/20 px-2.5 py-1 font-mono text-[9px] uppercase tracking-widest opacity-70">
          Broker-confirmed
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Icon className="h-5 w-5" />
        <span className="text-lg font-bold">{result.direction} {result.symbol} {outcome.label}</span>
      </div>
      <p className="mt-1 text-[13px] font-semibold">
        {moneyText(result.realized_profit)}
      </p>
      {(result.result_pips != null || result.realized_r != null) && (
        <p className="mt-0.5 font-mono text-[12px] opacity-75">
          {result.result_pips != null
            ? `${result.result_pips >= 0 ? "+" : ""}${result.result_pips} pips · ${result.result_gold_moves >= 0 ? "+" : ""}${result.result_gold_moves} Gold moves · ${rText(result.result_r)}`
            : rText(result.realized_r)}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-4 text-white/45">
        This is what your account actually did, confirmed by your broker — it is shown separately from the advisory outlook above,
        which only tracks a hypothetical "if you had taken this setup" outcome.
      </p>
      <button onClick={() => setShowDetails((s) => !s)} className="mt-3 flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70">
        {showDetails ? "Hide" : "Show"} trade details {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {showDetails && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-current/10 pt-3 sm:grid-cols-4">
          <Metric label="Entry" value={result.entry_price} />
          <Metric label="Exit" value={result.exit_price} />
          <Metric label="Ticket" value={result.ticket} />
          <Metric label="Close reason" value={result.close_reason} />
          <Metric label="Opened" value={result.opened_at ? new Date(result.opened_at).toLocaleString() : "—"} />
          <Metric label="Closed" value={result.closed_at ? new Date(result.closed_at).toLocaleString() : "—"} />
        </div>
      )}
    </section>
  );
}

export default function AIMarketOutlookPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("outlook_id");
  const previewMode = process.env.NODE_ENV !== "production" && searchParams.get("preview") === "actionable";

  const [contract, setContract] = useState(null);
  const [currentOutlook, setCurrentOutlook] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({});
  const [directionFilter, setDirectionFilter] = useState("All");
  const [resultFilter, setResultFilter] = useState("All");
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [currentError, setCurrentError] = useState(false);
  // Owner directive (2026-08-05) test case 8: a duplicate/out-of-order
  // stale /outlook/current response arriving after a newer one must never
  // restore old signal data. setInterval fires a new request every 15s
  // regardless of whether the previous one has resolved yet, so a slow
  // request can otherwise resolve AFTER a faster, more recent one and
  // silently overwrite fresher state with stale state. This sequence
  // guard makes only the most-recently-ISSUED response ever allowed to
  // apply, discarding any response for a request that's no longer latest.
  const currentRequestSeq = useRef(0);

  const loadCurrent = useCallback(async () => {
    if (previewMode) {
      setContract({ ...DEVELOPMENT_PREVIEW_CONTRACT, eventTime: new Date().toISOString() });
      setDiagnostics({ evidence_status: "OK", evidence_age_seconds: 8, evidence_symbol: "XAUUSD" });
      return;
    }
    const requestId = ++currentRequestSeq.current;
    try {
      const { data } = await outlookAxios.get("/outlook/current");
      if (requestId !== currentRequestSeq.current) return; // a newer request already superseded this one
      setContract(data?.contract || null);
      setCurrentOutlook(data?.outlook || null);
      setDiagnostics(data?.diagnostics || null);
      setCurrentError(false);
    } catch (_) {
      if (requestId !== currentRequestSeq.current) return;
      setCurrentError(true);
    }
  }, [previewMode]);

  const loadPrefs = useCallback(async () => {
    if (previewMode) { setPrefs({ tier: "HOURLY_PLUS_RESULTS", notify_all_devices: true }); return; }
    try {
      const { data } = await outlookAxios.get("/outlook/notifications/prefs");
      setPrefs(data?.prefs || null);
    } catch (_) { /* advisory only */ }
  }, [previewMode]);

  const loadHistory = useCallback(async () => {
    if (previewMode) {
      setHistory([{
        id: "preview-history", primary_direction: "SELL", confidence_pct: 72, color_state: "GREEN",
        signal_state: "WIN_GREEN_TP1", highest_tp_reached: 1, published_at: new Date().toISOString(),
        tracking_entry_price: 2661.0, preferred_entry_zone_low: 2660.5, preferred_entry_zone_high: 2661.5,
        original_sl: 2666.0, tp1_price: 2656.0, current_r: 0.5, risk_distance: 5.0,
      }]);
      setStats({
        wins: 8, losses: 3, win_rate: 8 / 11, total_r: 4.7, average_r: 0.43,
        average_mfe: 0.81, average_mae: -0.24, active_unresolved_count: 1,
        unavailable_historical_count: 0,
      });
      return;
    }
    setHistoryLoading(true);
    try {
      const params = { ...RESULT_FILTER_PARAMS[resultFilter], limit: historyLimit };
      if (directionFilter !== "All") params.direction = directionFilter;
      const { data } = await outlookAxios.get("/outlook/history", { params });
      setHistory(data?.timeline || data?.outlooks || []);
      setStats(data?.stats || {});
      setHistoryError(false);
    } catch (_) {
      setHistoryError(true);
    } finally {
      setHistoryLoading(false);
    }
  }, [previewMode, directionFilter, resultFilter, historyLimit]);

  useEffect(() => {
    if (highlightId) {
      loadCurrent();
    } else {
      loadCurrent();
    }
    loadPrefs();
    // The backend owns classification; this lightweight refresh only makes
    // its persisted event-driven state visible promptly when the page is
    // open. It does not calculate or monitor prices in the browser.
    const t = setInterval(() => { loadCurrent(); loadHistory(); }, 15000);
    return () => clearInterval(t);
  }, [highlightId, loadCurrent, loadPrefs, loadHistory]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const changeDirectionFilter = useCallback((filter) => {
    setDirectionFilter(filter);
    setHistoryLimit(HISTORY_PAGE_SIZE);
  }, []);
  const changeResultFilter = useCallback((filter) => {
    setResultFilter(filter);
    setHistoryLimit(HISTORY_PAGE_SIZE);
  }, []);

  const notificationSummary = prefs?.tier === "OFF" ? "Preference off" : contract?.notificationSent ? "Delivered" : "Standing by";
  const comparisonM10 = contract?.m10 ? {
    ...contract.m10,
    preferred_direction: contract.direction || contract.m10.direction || "NONE",
    confidence: contract.confidence,
    bar_time: contract.signalBarTime,
  } : null;
  const comparisonHourly = contract?.hourlyContext ? {
    primary_direction: contract.hourlyContext.direction || contract.hourlyContext.state || "NONE",
    confidence_pct: contract.hourlyContext.confidence,
    status: contract.hourlyContext.state,
    generated_at: contract.eventTime,
  } : null;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#050507] text-white">
      <Seo
        title="AI Gold Market Outlook — XauCloud M10 Execution Truth"
        description="M10 execution truth with hourly advisory context for XAUUSD Gold trading, from the XauCloud AI Director."
        path="/ai-market-outlook"
      />
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="rounded-full border border-white/10 p-2 hover:border-white/25">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div><h1 className="text-lg font-black tracking-tight">AI Market Outlook</h1><p className="mt-0.5 text-[10px] text-white/35">M10 execution truth with hourly advisory context</p></div>
        </div>

        {currentError && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-400/[0.05] px-4 py-3">
            <p className="min-w-0 text-[12px] text-rose-200">The live outlook couldn't be refreshed. Showing the last known data.</p>
            <button onClick={loadCurrent} className="flex-none text-[11px] text-rose-100 underline decoration-dotted">Retry</button>
          </div>
        )}

        <div className="space-y-4">
          <PrimaryStateCard contract={contract} />
          <SuggestedLevelsCard outlook={currentOutlook} />
          <DataHealthStrip contract={contract} diagnostics={diagnostics} notificationStatus={notificationSummary} />
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
            <M10ExecutionCard contract={contract} />
            <div className="grid gap-4"><HourlyContextCard context={contract?.hourlyContext} /><WaitingCard contract={contract} /></div>
          </div>
          <AutomatedTradeResultCard result={currentOutlook?.automated_trade_result} />
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <section className={`${CARD} p-5 sm:p-6`}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><span className={MONO_LABEL}>Meaningful signal history</span><span className="text-[10px] text-white/30">Informational repeats grouped</span></div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Win rate" value={stats.win_rate != null ? `${Math.round(stats.win_rate * 100)}%` : "—"} />
              <Metric label="Wins / Losses" value={`${stats.wins ?? 0} / ${stats.losses ?? 0}`} />
              <Metric label="Total pips" value={stats.total_pips != null ? `${stats.total_pips > 0 ? "+" : ""}${stats.total_pips} pips` : "—"} />
              <Metric label="Avg pips" value={stats.average_pips != null ? `${stats.average_pips > 0 ? "+" : ""}${stats.average_pips} pips` : "—"} />
              <Metric label="Avg MFE / MAE" value={stats.average_mfe_pips != null ? `${stats.average_mfe_pips} / ${stats.average_mae_pips} pips` : "—"} />
              <Metric label="Active" value={stats.active_unresolved_count ?? 0} />
              <Metric label="Unavailable history" value={stats.unavailable_historical_count ?? 0} />
              </div>

              <div className="mt-4 min-w-0 space-y-2" data-testid="history-filters">
                <div className="min-w-0">
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-white/25">Direction</div>
                  <div className="flex flex-wrap gap-1.5">
                    {DIRECTION_FILTERS.map((f) => (
                      <button key={f} onClick={() => changeDirectionFilter(f)}
                              className={`rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold transition ${directionFilter === f ? "border-gold-300/40 bg-gold-300/[0.08] text-gold-100" : "border-white/[0.06] text-white/40 hover:border-white/15"}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-white/25">Result</div>
                  <div className="flex flex-wrap gap-1.5">
                    {RESULT_FILTERS.map((f) => (
                      <button key={f} onClick={() => changeResultFilter(f)}
                              className={`rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold transition ${resultFilter === f ? "border-gold-300/40 bg-gold-300/[0.08] text-gold-100" : "border-white/[0.06] text-white/40 hover:border-white/15"}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-5 min-w-0 space-y-2">
                {historyError && (
                  <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] p-4 text-center">
                    <p className="text-[12px] text-rose-200">Signal history couldn't be loaded right now.</p>
                    <button onClick={loadHistory} className="mt-2 text-[11px] text-rose-100 underline decoration-dotted">Retry</button>
                  </div>
                )}
                {/* Bug fix: this used to render the raw, ungrouped
                    cloud_outlook_signal_events log (every Watching/
                    Actionable/Blocked transition as its own uncolored card)
                    for the default "All" view, while filtered views used
                    the deduplicated, colored HistoryCard -- the exact
                    "All doesn't show colors, and shows repeated states"
                    complaint. Every filter state now renders the same
                    one-card-per-signal, real-result-colored HistoryCard. */}
                {!historyError && history.map((o) => <HistoryCard key={o.id} outlook={o} />)}
                {!historyError && history.length === 0 && !historyLoading && (
                  <p className="py-6 text-center text-[12px] text-white/35">
                    {directionFilter === "All" && resultFilter === "All"
                      ? "No completed or active signals yet. Informational heartbeats are not counted as trades."
                      : "No signals match this filter yet."}
                  </p>
                )}
                {historyLoading && history.length === 0 && (
                  <div className="space-y-2" aria-label="Loading signal history">
                    {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.02]" />)}
                  </div>
                )}
                {!historyError && history.length >= historyLimit && history.length > 0 && (
                  <button onClick={() => setHistoryLimit((l) => l + HISTORY_PAGE_SIZE)} disabled={historyLoading}
                          className="w-full rounded-xl border border-white/[0.07] py-2.5 text-[11px] text-white/50 hover:text-white disabled:opacity-50">
                    {historyLoading ? "Loading…" : "Load more"}
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
