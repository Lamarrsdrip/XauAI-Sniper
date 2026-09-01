import {
  ANALYTICS_BREAKEVEN,
  ANALYTICS_LOSS,
  ANALYTICS_PARTIAL,
  ANALYTICS_WIN,
  BREAK_EVEN_R_TOLERANCE,
  HALF_R_WIN_THRESHOLD,
  SIGNAL_BREAK_EVEN,
  SIGNAL_LOSS_SL,
  SIGNAL_LOSS_TIMEOUT,
  SIGNAL_PARTIAL_PROFIT,
  SIGNAL_TRACKING,
  SIGNAL_WIN_TP1,
  TIMEOUT_TERMINAL_STATES,
} from "./marketOutlookCore.js";
import { asUtc } from "./marketOutlookEvidence.js";
import { targetsHaveValidGeometry } from "./marketOutlookSignal.js";

/**
 * Port of market_outlook.py:1966 `advance_persisted_signal` -- pure
 * state-machine transition used by live monitoring and backfill. BUY is
 * valued on executable Bid, SELL on executable Ask. The immutable tracking
 * entry and original SL are never changed here.
 *
 * Owner-approved rule: a signal is a WIN if ANY of TP1/TP2/TP3 is touched
 * at any moment during the evaluation window -- the highest TP touched
 * sets the result, and nothing afterward (including a later SL touch) can
 * ever flip a confirmed win back to a loss. LOSS is only assigned once the
 * full window closes with NO take-profit ever touched, and even then a
 * genuinely positive-but-short-of-TP1 close is PARTIAL_PROFIT, one within
 * BREAK_EVEN_R_TOLERANCE of entry is BREAK_EVEN, and only a genuinely
 * negative close is LOSS.
 */
export function advancePersistedSignal(
  doc: Record<string, unknown>,
  bid: number | null | undefined,
  ask: number | null | undefined,
  observedAtInput: Date,
): [Record<string, unknown>, string[]] {
  const direction = String(doc["primary_direction"] ?? "").toUpperCase();
  if (!["BUY", "SELL"].includes(direction)) return [{}, []];
  const entry = Number(doc["tracking_entry_price"] ?? 0) || 0;
  const risk = Number(doc["risk_distance"] ?? 0) || 0;
  if (entry <= 0 || risk <= 0) return [{}, []];

  const observedAt = asUtc(observedAtInput) ?? new Date();
  const observedIso = observedAt.toISOString();
  const deadline = asUtc(doc["evaluation_deadline"]);
  const expiry = asUtc(doc["expiry_at"]);
  let outcome = doc["analytics_outcome"] as string | null | undefined;
  const updates: Record<string, unknown> = { last_monitored_at: observedIso };
  const events: string[] = [];
  const milestones: string[] = [...((doc["milestones_hit"] as string[] | undefined) ?? [])];
  const eventSnapshots: Record<string, unknown> = { ...((doc["event_snapshots"] as Record<string, unknown> | undefined) ?? {}) };
  let snapshotsChanged = false;

  let closePrice: number | null = null;
  if (direction === "BUY" && bid !== null && bid !== undefined && Number(bid) > 0) closePrice = Number(bid);
  else if (direction === "SELL" && ask !== null && ask !== undefined && Number(ask) > 0) closePrice = Number(ask);

  let currentR = Number(doc["current_r"] ?? 0) || 0;
  const priorCurrentR = currentR;
  let mfeR = Number(doc["mfe_r"] ?? doc["mfe"] ?? 0) || 0;
  let maeR = Number(doc["mae_r"] ?? doc["mae"] ?? 0) || 0;
  let tp1Hit = Boolean(doc["tp1_hit_at"]);
  let tp2Hit = Boolean(doc["tp2_hit_at"]);
  let tp3Hit = Boolean(doc["tp3_hit_at"]);
  let slHit = Boolean(doc["sl_hit_at"]);
  let halfHit = Boolean(doc["first_half_r_at"]);

  function recordEvent(event: string, eventAt: string, hitPrice: number | null, achievedR: number | null): void {
    events.push(event);
    eventSnapshots[event] = {
      event_at: eventAt,
      hit_price: hitPrice !== null ? Math.round(hitPrice * 1e6) / 1e6 : null,
      achieved_r: achievedR !== null ? Math.round(achievedR * 1e6) / 1e6 : null,
    };
    snapshotsChanged = true;
  }

  if (closePrice !== null) {
    currentR = direction === "BUY" ? (closePrice - entry) / risk : (entry - closePrice) / risk;
    mfeR = Math.max(mfeR, currentR);
    maeR = Math.min(maeR, currentR, 0.0);
    Object.assign(updates, {
      current_r: Math.round(currentR * 1e6) / 1e6,
      mfe_r: Math.round(mfeR * 1e6) / 1e6,
      mae_r: Math.round(maeR * 1e6) / 1e6,
      mfe: Math.round(mfeR * 1e6) / 1e6,
      mae: Math.round(maeR * 1e6) / 1e6,
      highest_tracked_price: Math.max(Number(doc["highest_tracked_price"] ?? entry) || entry, closePrice),
      lowest_tracked_price: Math.min(Number(doc["lowest_tracked_price"] ?? entry) || entry, closePrice),
      last_bid: bid !== null && bid !== undefined ? Number(bid) : null,
      last_ask: ask !== null && ask !== undefined ? Number(ask) : null,
      last_tracked_price: closePrice,
    });

    const tp1 = Number(doc["tp1_price"] ?? 0) || 0;
    const tp2 = Number(doc["tp2_price"] ?? 0) || 0;
    const tp3 = Number(doc["tp3_price"] ?? 0) || 0;
    const sl = Number(doc["original_sl"] ?? doc["suggested_sl"] ?? 0) || 0;
    const targetsValid = targetsHaveValidGeometry(direction, entry, tp1, tp2, tp3);
    const reached = (target: number): boolean => (direction === "BUY" ? closePrice! >= target : closePrice! <= target);
    const hitSlNow = sl > 0 && ((direction === "BUY" && closePrice <= sl) || (direction === "SELL" && closePrice >= sl));

    if (currentR >= HALF_R_WIN_THRESHOLD && !halfHit) {
      halfHit = true;
      updates["first_half_r_at"] = observedIso;
      recordEvent("HALF_R_REACHED", observedIso, closePrice, currentR);
      if (!milestones.includes("HALF_R_REACHED")) milestones.push("HALF_R_REACHED");
    }
    const tpChecks: [number, string, string, number][] = [
      [tp1, "tp1_hit_at", "TP1_HIT", 1],
      [tp2, "tp2_hit_at", "TP2_HIT", 2],
      [tp3, "tp3_hit_at", "TP3_HIT", 3],
    ];
    for (const [target, field, event, number] of tpChecks) {
      const already = Boolean(doc[field]) || Boolean(updates[field]);
      if (targetsValid && reached(target) && !already) {
        updates[field] = observedIso;
        recordEvent(event, observedIso, closePrice, currentR);
        if (!milestones.includes(event)) milestones.push(event);
        updates["highest_tp_reached"] = Math.max(Number(doc["highest_tp_reached"] ?? 0) || 0, number);
        if (number === 1) tp1Hit = true;
        else if (number === 2) tp2Hit = true;
        else tp3Hit = true;
      }
    }
    if (hitSlNow && !slHit) {
      slHit = true;
      updates["sl_hit_at"] = observedIso;
      recordEvent("SL_HIT", observedIso, closePrice, currentR);
      if (!milestones.includes("SL_HIT")) milestones.push("SL_HIT");
    }
  }

  let newState = (doc["signal_state"] as string | undefined) ?? SIGNAL_TRACKING;
  let latestPath = (doc["latest_path_event"] as string | undefined) ?? "TRACKING_STARTED";
  let classificationAt = doc["classification_at"] as string | null | undefined;
  let analyticsR = doc["analytics_r"] as number | null | undefined;
  const halfAt = asUtc(updates["first_half_r_at"] ?? doc["first_half_r_at"]);
  const tp1At = asUtc(updates["tp1_hit_at"] ?? doc["tp1_hit_at"]);
  const tp2At = asUtc(updates["tp2_hit_at"] ?? doc["tp2_hit_at"]);
  const tp3At = asUtc(updates["tp3_hit_at"] ?? doc["tp3_hit_at"]);
  const slAt = asUtc(updates["sl_hit_at"] ?? doc["sl_hit_at"]);
  const halfOnTime = Boolean(halfAt && (!deadline || halfAt <= deadline));
  const tp1OnTime = Boolean(tp1At && (!deadline || tp1At <= deadline));
  const tp2OnTime = Boolean(tp2At && (!deadline || tp2At <= deadline));
  const tp3OnTime = Boolean(tp3At && (!deadline || tp3At <= deadline));
  const slOnTime = Boolean(slAt && (!deadline || slAt <= deadline));
  let timeoutClassifiedNow = false;

  if (outcome === null || outcome === undefined) {
    if (tp3OnTime) {
      outcome = ANALYTICS_WIN;
      newState = SIGNAL_WIN_TP1;
      latestPath = "TP3_HIT";
      classificationAt = (updates["tp3_hit_at"] as string | undefined) ?? (doc["tp3_hit_at"] as string | undefined) ?? observedIso;
      analyticsR = Math.round(currentR * 1e6) / 1e6;
    } else if (tp2OnTime) {
      outcome = ANALYTICS_WIN;
      newState = SIGNAL_WIN_TP1;
      latestPath = "TP2_HIT";
      classificationAt = (updates["tp2_hit_at"] as string | undefined) ?? (doc["tp2_hit_at"] as string | undefined) ?? observedIso;
      analyticsR = Math.round(currentR * 1e6) / 1e6;
    } else if (tp1OnTime) {
      outcome = ANALYTICS_WIN;
      newState = SIGNAL_WIN_TP1;
      latestPath = "TP1_HIT";
      classificationAt = (updates["tp1_hit_at"] as string | undefined) ?? (doc["tp1_hit_at"] as string | undefined) ?? observedIso;
      analyticsR = Math.round(currentR * 1e6) / 1e6;
    } else if (deadline && observedAt >= deadline) {
      const deadlineR = Math.round((observedAt <= deadline ? currentR : priorCurrentR) * 1e6) / 1e6;
      if (deadlineR > BREAK_EVEN_R_TOLERANCE) {
        outcome = ANALYTICS_PARTIAL;
        newState = SIGNAL_PARTIAL_PROFIT;
        latestPath = "PARTIAL_PROFIT_BELOW_TP1";
      } else if (deadlineR < -BREAK_EVEN_R_TOLERANCE) {
        outcome = ANALYTICS_LOSS;
        newState = SIGNAL_LOSS_TIMEOUT;
        latestPath = "NO_TP_WITHIN_60M";
      } else {
        outcome = ANALYTICS_BREAKEVEN;
        newState = SIGNAL_BREAK_EVEN;
        latestPath = "BREAK_EVEN_AT_60M";
      }
      classificationAt = deadline.toISOString();
      analyticsR = deadlineR;
      timeoutClassifiedNow = true;
      if (!milestones.includes("TIMEOUT_60M")) milestones.push("TIMEOUT_60M");
      const timeoutPrice = observedAt <= deadline ? (updates["last_tracked_price"] ?? doc["last_tracked_price"]) : doc["last_tracked_price"];
      recordEvent("TIMEOUT_60M", deadline.toISOString(), (timeoutPrice as number) ?? null, analyticsR ?? null);
    } else if (!deadline && slHit) {
      outcome = ANALYTICS_LOSS;
      newState = SIGNAL_LOSS_SL;
      latestPath = "SL_HIT_BEFORE_WIN";
      classificationAt = (updates["sl_hit_at"] as string | undefined) ?? (doc["sl_hit_at"] as string | undefined) ?? observedIso;
      analyticsR = -1.0;
    }
  } else if (outcome === ANALYTICS_WIN) {
    const highestSoFar = Number(doc["highest_tp_reached"] ?? 0) || 0;
    if (tp3Hit && highestSoFar < 3) {
      latestPath = "TP3_HIT";
      classificationAt = (updates["tp3_hit_at"] as string | undefined) ?? (doc["tp3_hit_at"] as string | undefined) ?? classificationAt;
      analyticsR = Math.round(currentR * 1e6) / 1e6;
    } else if (tp2Hit && highestSoFar < 2) {
      latestPath = "TP2_HIT";
      classificationAt = (updates["tp2_hit_at"] as string | undefined) ?? (doc["tp2_hit_at"] as string | undefined) ?? classificationAt;
      analyticsR = Math.round(currentR * 1e6) / 1e6;
    } else if (slHit) {
      latestPath = "LATER_SL_AFTER_WIN";
    }
  } else if ([ANALYTICS_LOSS, ANALYTICS_PARTIAL, ANALYTICS_BREAKEVEN].includes(outcome) && TIMEOUT_TERMINAL_STATES.has(String(doc["signal_state"]))) {
    if (tp3Hit && !doc["tp3_hit_at"]) latestPath = "LATE_TP3_AFTER_60M";
    else if (tp2Hit && !doc["tp2_hit_at"]) latestPath = "LATE_TP2_AFTER_60M";
    else if (tp1Hit && !doc["tp1_hit_at"]) latestPath = "LATE_TP1_AFTER_60M";
    else if (halfHit && !doc["first_half_r_at"]) latestPath = "LATE_HALF_R_AFTER_60M";
  }

  if (timeoutClassifiedNow) {
    if (slHit && !slOnTime) latestPath = "LATE_SL_AFTER_60M";
    else if (tp3Hit && !doc["tp3_hit_at"]) latestPath = "LATE_TP3_AFTER_60M";
    else if (tp2Hit && !doc["tp2_hit_at"]) latestPath = "LATE_TP2_AFTER_60M";
    else if (tp1Hit && !tp1OnTime) latestPath = "LATE_TP1_AFTER_60M";
    else if (halfHit && !halfOnTime) latestPath = "LATE_HALF_R_AFTER_60M";
  }

  Object.assign(updates, {
    signal_state: newState,
    analytics_outcome: outcome,
    analytics_r: analyticsR,
    final_result: outcome ? newState : null,
    final_r: outcome ? analyticsR : null,
    classification_at: classificationAt,
    resolved_at: classificationAt,
    latest_path_event: latestPath,
    status: outcome === null || outcome === undefined ? "TRACKING" : latestPath,
    color_state: outcome === ANALYTICS_WIN ? "GREEN" : outcome === ANALYTICS_LOSS ? "RED" : outcome === ANALYTICS_PARTIAL ? "BLUE" : outcome === ANALYTICS_BREAKEVEN ? "TEAL" : "AMBER",
    milestones_hit: milestones,
  });
  if (snapshotsChanged) updates["event_snapshots"] = eventSnapshots;

  let monitoringClosed = Boolean(doc["monitoring_closed"]);
  if (tp3Hit || (expiry && observedAt >= expiry) || (!deadline && newState === SIGNAL_LOSS_SL)) {
    monitoringClosed = true;
  }
  updates["monitoring_closed"] = monitoringClosed;

  return [updates, Array.from(new Set(events))];
}
