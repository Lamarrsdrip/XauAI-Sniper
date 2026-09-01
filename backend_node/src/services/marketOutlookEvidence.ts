import { getDb } from "../db.js";
import {
  BLOCKED_DECISIONS,
  EXECUTION_READY_DECISIONS,
  EXPIRED_DECISIONS,
  OUTLOOK_ACTIONABLE,
  OUTLOOK_BLOCKED,
  OUTLOOK_DATA_UNAVAILABLE,
  OUTLOOK_EXPIRED,
  OUTLOOK_NO_SIGNAL,
  OUTLOOK_SYMBOL,
  OUTLOOK_WATCHING,
  ANALYTICS_WIN,
} from "./marketOutlookCore.js";

/** Port of market_outlook.py:1937 `_as_utc`. */
export function asUtc(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (!value) return null;
  const s = String(value);
  const isoAttempt = new Date(s.replace("Z", "+00:00"));
  if (!Number.isNaN(isoAttempt.getTime())) return isoAttempt;
  // MT5-style "%Y.%m.%d %H:%M:%S" / "%Y.%m.%d %H:%M"
  const m = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? 0)));
  }
  return null;
}

/** Port of market_outlook.py:526 `_as_iso`. */
export function asIso(value: unknown): string | null {
  const parsed = asUtc(value);
  return parsed ? parsed.toISOString() : null;
}

/** Port of market_outlook.py:482 `_first_positive_number`. */
function firstPositiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const n = Number(value ?? 0);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export interface EvidenceQuote {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  quote_at: unknown;
  valid: boolean;
  spread: number | null;
}

/** Port of market_outlook.py:493 `extract_evidence_quote`. */
export function extractEvidenceQuote(evidence: Record<string, unknown> | null | undefined): EvidenceQuote {
  const ev = evidence ?? {};
  const thesis = (ev["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const readiness = (ev["entry_readiness"] as Record<string, unknown> | undefined) ?? {};
  const m10 = (ev["m10_signal"] as Record<string, unknown> | undefined) ?? {};
  const bid = firstPositiveNumber(thesis["live_bid"], m10["live_bid"], m10["bid"], readiness["live_bid"], readiness["bid"]);
  const ask = firstPositiveNumber(thesis["live_ask"], m10["live_ask"], m10["ask"], readiness["live_ask"], readiness["ask"]);
  let mid = firstPositiveNumber(thesis["live_mid"], m10["live_mid"], readiness["live_mid"]);
  if (!mid && bid > 0 && ask >= bid) mid = (bid + ask) / 2;
  const quoteAt = thesis["evidence_time_utc"] ?? m10["quote_time"] ?? m10["evidence_time_utc"] ?? readiness["evidence_time_utc"] ?? ev["event_time"] ?? ev["ts"];
  const valid = bid > 0 && ask >= bid;
  return { bid: bid || null, ask: ask || null, mid: mid || null, quote_at: quoteAt, valid, spread: valid ? ask - bid : null };
}

/** Port of market_outlook.py:515 `extract_evidence_quote_from_details`. */
export function extractEvidenceQuoteFromDetails(details: Record<string, unknown> | null | undefined, eventTime: unknown = null): EvidenceQuote {
  const d = details ?? {};
  return extractEvidenceQuote({
    market_thesis: d["market_thesis"] ?? {},
    entry_readiness: d["entry_readiness"] ?? {},
    m10_signal: d["m10_signal"] ?? {},
    event_time: eventTime,
  });
}

/** Port of market_outlook.py:376 `_canonical_m10_signal`. */
export function canonicalM10Signal(evidence: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const ev = evidence ?? {};
  const m10 = (ev["m10_signal"] as Record<string, unknown> | undefined) ?? {};
  const readiness = (ev["entry_readiness"] as Record<string, unknown> | undefined) ?? {};
  const thesis = (ev["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const decision = String(m10["decision"] ?? m10["final_decision"] ?? readiness["final_action"] ?? readiness["action"] ?? thesis["final_action"] ?? thesis["action"] ?? "").toUpperCase().trim();
  const preferred = String(m10["preferred_direction"] ?? m10["direction"] ?? readiness["preferred_direction"] ?? readiness["direction"] ?? thesis["preferred_direction"] ?? thesis["direction"] ?? "").toUpperCase().trim();
  const freshness = String(m10["freshness_state"] ?? "FRESH").toUpperCase().trim();
  const execution = (ev["execution"] as Record<string, unknown> | undefined) ?? {};
  const finalDecision = String(execution["final_decision"] ?? m10["execution_status"] ?? m10["execution_decision"] ?? readiness["final_decision"] ?? "").toUpperCase().trim();
  const blocker = String(execution["final_blocker"] ?? m10["blocker_code"] ?? m10["blocked_by"] ?? readiness["final_blocker"] ?? readiness["blocked_by"] ?? "").toUpperCase().trim();

  let direction = "";
  if (decision === "BUY_CANDIDATE") direction = "BUY";
  else if (decision === "SELL_CANDIDATE") direction = "SELL";
  else if (decision === "ALLOW_CORE" && ["BUY", "SELL"].includes(preferred)) direction = preferred;

  if (direction && ["BUY", "SELL"].includes(preferred) && preferred !== direction) direction = "";
  const candidate = ["BUY", "SELL"].includes(direction);
  const stale = !["", "FRESH", "CURRENT"].includes(freshness);
  const explicitAllowed = execution["final_execution_allowed"] === true;
  const explicitBlocked = (execution["final_execution_allowed"] === false && (Boolean(blocker) || BLOCKED_DECISIONS.has(finalDecision))) || BLOCKED_DECISIONS.has(finalDecision);
  const expired = stale || EXPIRED_DECISIONS.has(finalDecision) || ["CANCEL", "EXPIRE", "TIMEOUT"].some((p) => finalDecision.startsWith(p));
  const executionReady = Boolean(candidate && !expired && !explicitBlocked && (explicitAllowed || EXECUTION_READY_DECISIONS.has(finalDecision) || decision === "ALLOW_CORE"));

  let confidence: number | null = null;
  if (m10["confidence"] !== undefined && m10["confidence"] !== null) {
    const n = Number(m10["confidence"]);
    if (Number.isFinite(n)) confidence = Math.max(0, Math.min(100, n));
  }

  return {
    candidate,
    actionable: executionReady,
    execution_ready: executionReady,
    blocked: Boolean(candidate && explicitBlocked),
    expired: Boolean(candidate && expired),
    direction,
    decision,
    execution_status: finalDecision || (executionReady ? "READY" : candidate ? "PENDING" : "NO_CANDIDATE"),
    blocker_code: blocker || null,
    confidence,
    freshness_state: freshness,
    bar_time: String(m10["bar_time"] ?? m10["candle_time"] ?? ev["ts"] ?? ""),
    source: Object.keys(m10).length > 0 ? "M10_SIGNAL" : "READINESS_FALLBACK",
    candidate_id: String(m10["candidate_id"] ?? m10["signal_id"] ?? readiness["candidate_id"] ?? ""),
  };
}

export interface EaEvidenceResult {
  evidence: Record<string, unknown> | null;
  reason: string;
}

/** Port of market_outlook.py:308 `_latest_ea_evidence`. */
export async function latestEaEvidence(licenseKey: string, account: string, sourceEventId = ""): Promise<EaEvidenceResult> {
  const db = getDb();
  if (!account && !licenseKey) return { evidence: null, reason: "NO_CONNECTED_EA" };
  const scope: Record<string, unknown> =
    account && licenseKey ? { $or: [{ account }, { license_key: licenseKey }] } : account ? { account } : { license_key: licenseKey };

  const activity = db.collection("cloud_bot_activity");
  const ever = await activity.findOne(scope, { projection: { _id: 0, id: 1 } });
  if (!ever) return { evidence: null, reason: "NO_CONNECTED_EA" };

  let rows: Record<string, unknown>[] | null = null;
  if (sourceEventId) {
    const exact = await activity.findOne({ $and: [scope, { id: sourceEventId }] }, { projection: { _id: 0 } });
    if (exact) rows = [exact];
    else return { evidence: null, reason: "SOURCE_EVENT_NOT_FOUND" };
  }
  if (rows === null) {
    const cutoff = new Date(Date.now() - 20 * 60_000).toISOString();
    rows = await activity
      .find({ $and: [scope, { ts: { $gte: cutoff } }] }, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(50)
      .toArray();
  }
  if (rows.length === 0) return { evidence: null, reason: "STALE_EVIDENCE" };

  for (const row of rows) {
    const details = (row["details"] as Record<string, unknown> | undefined) ?? {};
    const thesis = (details["market_thesis"] as Record<string, unknown> | undefined) ?? {};
    const readiness = (details["entry_readiness"] as Record<string, unknown> | undefined) ?? {};
    const m10Signal = (details["m10_signal"] as Record<string, unknown> | undefined) ?? {};
    if (Object.keys(thesis).length > 0 || Object.keys(readiness).length > 0 || Object.keys(m10Signal).length > 0) {
      return {
        evidence: {
          ts: row["ts"],
          source_event_id: row["id"] ?? sourceEventId,
          symbol: row["symbol"] ?? OUTLOOK_SYMBOL,
          market_thesis: thesis,
          post_trade_state: details["post_trade_state"] ?? {},
          entry_readiness: readiness,
          m10_signal: m10Signal,
          regime: details["regime"] ?? row["mode"] ?? "",
          session: details["session"] ?? "",
          event_time: row["ts"],
          broker_time: details["broker_time"] ?? details["server_time"],
          device_time: details["device_time"] ?? details["local_time"],
          execution: {
            candidate_allowed: details["candidate_allowed"],
            final_execution_allowed: details["final_execution_allowed"],
            final_decision: details["final_decision"],
            final_blocker: details["final_blocker"] ?? details["blocked_by"],
            pipeline_stage: details["pipeline_stage"],
            open_trade_called: details["open_trade_called"],
            broker_retcode: details["broker_retcode"],
          },
        },
        reason: "OK",
      };
    }
  }
  return { evidence: null, reason: "INSUFFICIENT_MARKET_EVIDENCE" };
}

/** Port of market_outlook.py:536 `_outlook_within_freshness_window`. */
export function outlookWithinFreshnessWindow(doc: Record<string, unknown> | null | undefined, now: Date): boolean {
  if (!doc) return false;
  const expiry = asUtc(doc["expiry_at"]);
  return Boolean(expiry) && now < expiry!;
}

/** Port of market_outlook.py:543 `_outlook_still_live`. */
export function outlookStillLive(doc: Record<string, unknown> | null | undefined, now: Date): boolean {
  if (!doc || doc["analytics_outcome"] !== null && doc["analytics_outcome"] !== undefined) return false;
  if (doc["monitoring_closed"]) return false;
  return outlookWithinFreshnessWindow(doc, now);
}

/** Port of market_outlook.py:557 `_signal_belongs_to_current_hourly_window`. */
export function signalBelongsToCurrentHourlyWindow(signalDoc: Record<string, unknown> | null | undefined, doc: Record<string, unknown> | null | undefined): boolean {
  if (!doc || !signalDoc) return true;
  const docGenerated = asUtc(doc["generated_at"]);
  const signalGenerated = asUtc(signalDoc["generated_at"]);
  if (!docGenerated || !signalGenerated) return true;
  return signalGenerated >= docGenerated;
}

export interface OutlookFreshness {
  last_checked_at: string;
  next_expected_update_at: string;
  direction: string | null;
  result: string | null;
  outlook_id: unknown;
  state: string;
  message: string;
}

/** Port of market_outlook.py:584 `compute_outlook_freshness` -- the ONE authoritative "what should a customer see as current" determination. */
export function computeOutlookFreshness(
  doc: Record<string, unknown> | null | undefined,
  signalDoc: Record<string, unknown> | null | undefined,
  evidenceReason: string,
  now: Date = new Date(),
): OutlookFreshness {
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1);
  const base = {
    last_checked_at: now.toISOString(),
    next_expected_update_at: nextHour.toISOString(),
    direction: null,
    result: null,
    outlook_id: null,
  };

  if (["NO_CONNECTED_EA", "STALE_EVIDENCE"].includes(evidenceReason)) {
    return { ...base, state: "EA_OFFLINE", message: "Your EA isn't connected right now. No live outlook until a fresh heartbeat arrives." };
  }

  const signalCurrent = outlookStillLive(signalDoc, now) && signalBelongsToCurrentHourlyWindow(signalDoc, doc);
  const effective = signalCurrent ? signalDoc : doc;
  if (!effective || !outlookWithinFreshnessWindow(effective, now)) {
    return { ...base, state: "NO_FRESH_SIGNAL", message: "XauCloud is waiting for new Gold market data. A new outlook will appear automatically when a valid signal is ready." };
  }

  if (effective["owner_policy_blocked"] || effective["primary_direction"] === "BLOCKED") {
    return { ...base, state: "NO_FRESH_SIGNAL", outlook_id: effective["id"] ?? null, message: "XauCloud is waiting for new Gold market data. A new outlook will appear automatically when a valid signal is ready." };
  }

  const direction = effective["primary_direction"] as string | undefined;
  if (!direction || !["BUY", "SELL"].includes(direction)) {
    return { ...base, state: "SIGNAL_FORMING", outlook_id: effective["id"] ?? null, message: "XauCloud is checking the Gold market." };
  }

  if (effective["analytics_outcome"] === null || effective["analytics_outcome"] === undefined) {
    return { ...base, state: "ACTIVE_SIGNAL", direction, outlook_id: effective["id"] ?? null, message: `XauCloud is monitoring this ${direction} signal live.` };
  }

  const result = effective["analytics_outcome"] as string;
  return {
    ...base,
    state: "SIGNAL_COMPLETED",
    direction,
    result,
    outlook_id: effective["id"] ?? null,
    message: result === ANALYTICS_WIN ? "TP reached." : "No take-profit was reached during the one-hour signal window.",
  };
}

/** Port of market_outlook.py:659 `build_authoritative_outlook_contract` -- single deterministic M10-first API contract consumed by the Outlook UI. */
export function buildAuthoritativeOutlookContract(opts: {
  evidence: Record<string, unknown> | null | undefined;
  evidence_reason: string;
  hourly_doc?: Record<string, unknown> | null;
  signal_doc?: Record<string, unknown> | null;
  notification?: Record<string, unknown> | null;
  now?: Date;
  latest_doc?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const wallNow = (opts.now ? asUtc(opts.now) : null) ?? new Date();
  const evidence = opts.evidence ?? {};
  const canonical = canonicalM10Signal(evidence);
  const quote = extractEvidenceQuote(evidence);
  const eventAt = asUtc(evidence["event_time"] ?? evidence["ts"]);
  const freshnessSeconds = eventAt ? Math.max(0, Math.trunc((wallNow.getTime() - eventAt.getTime()) / 1000)) : null;

  const missingFields: string[] = [];
  if (Object.keys(evidence).length === 0) missingFields.push("EA_EVIDENCE");
  if (Object.keys(evidence).length > 0 && !quote.bid) missingFields.push("BROKER_BID");
  if (Object.keys(evidence).length > 0 && !quote.ask) missingFields.push("BROKER_ASK");

  const referenceDoc = opts.latest_doc !== undefined ? opts.latest_doc : opts.hourly_doc;
  const signalDoc = opts.signal_doc;
  const storedActive = Boolean(
    signalDoc &&
      ["BUY", "SELL"].includes(String(signalDoc["primary_direction"])) &&
      outlookStillLive(signalDoc, wallNow) &&
      signalBelongsToCurrentHourlyWindow(signalDoc, referenceDoc),
  );

  const direction = canonical["direction"] || (storedActive ? signalDoc?.["primary_direction"] ?? null : null);
  const confidence = canonical["candidate"] ? canonical["confidence"] : storedActive ? signalDoc?.["confidence_pct"] ?? null : null;
  const blocker = canonical["blocker_code"] as string | null;

  let state: string;
  let stateReason: string;
  if (Object.keys(evidence).length === 0 || opts.evidence_reason !== "OK" || missingFields.length > 0) {
    state = OUTLOOK_DATA_UNAVAILABLE;
    stateReason = opts.evidence_reason !== "OK" ? opts.evidence_reason : "MISSING_BROKER_QUOTE";
  } else if (storedActive && !canonical["candidate"]) {
    state = OUTLOOK_ACTIONABLE;
    stateReason = "ACTIVE_M10_SIGNAL_PRESERVED";
  } else if (canonical["expired"]) {
    state = OUTLOOK_EXPIRED;
    stateReason = "CANDIDATE_EXPIRED";
  } else if (canonical["blocked"]) {
    state = OUTLOOK_BLOCKED;
    stateReason = blocker || "EXECUTION_BLOCKED";
  } else if (canonical["actionable"]) {
    state = OUTLOOK_ACTIONABLE;
    stateReason = "M10_EXECUTION_READY";
  } else if (canonical["candidate"]) {
    state = OUTLOOK_WATCHING;
    stateReason = "AWAITING_EXECUTION_CONFIRMATION";
  } else {
    state = OUTLOOK_NO_SIGNAL;
    stateReason = "NO_QUALIFYING_M10_SETUP";
  }

  const notification = opts.notification ?? {};
  const eligible = state === OUTLOOK_ACTIONABLE && notification["delivery_status"] !== "SENT";
  const notificationReasonMap: Record<string, string> = {
    [OUTLOOK_WATCHING]: "CANDIDATE_NOT_EXECUTION_READY",
    [OUTLOOK_BLOCKED]: "EXECUTION_BLOCKED",
    [OUTLOOK_EXPIRED]: "STALE_OR_EXPIRED_CANDIDATE",
    [OUTLOOK_DATA_UNAVAILABLE]: "DATA_UNAVAILABLE",
  };
  const notificationReason =
    state === OUTLOOK_ACTIONABLE ? (eligible ? "ELIGIBLE" : "ALREADY_SENT") : (notificationReasonMap[state] ?? "NO_CONFIRMED_SIGNAL");

  const hourlyDoc = opts.hourly_doc;
  const hourlyDirection = hourlyDoc?.["primary_direction"] as string | undefined;
  const hourlyState = hourlyDirection === "BUY" ? "BULLISH" : hourlyDirection === "SELL" ? "BEARISH" : hourlyDirection === "NO_VALID_OUTLOOK" || !hourlyDoc ? "UNAVAILABLE" : "NEUTRAL";

  const candidateId = canonical["candidate_id"] || (canonical["candidate"] ? `${canonical["bar_time"]}:${direction}` : null);
  const sourceDoc = signalDoc ?? {};

  const nextRequiredMap: Record<string, string> = {
    [OUTLOOK_WATCHING]: "Wait for the EA's final execution revalidation.",
    [OUTLOOK_BLOCKED]: "Wait for the reported blocker to clear.",
    [OUTLOOK_EXPIRED]: "Scanning the next completed M10 bar.",
    [OUTLOOK_DATA_UNAVAILABLE]: "Wait for a fresh broker Bid/Ask snapshot.",
    [OUTLOOK_NO_SIGNAL]: "Scanning for the next qualifying M10 setup.",
  };

  const nextEvalTime = new Date(wallNow);
  nextEvalTime.setUTCMinutes(0, 0, 0);
  nextEvalTime.setUTCHours(nextEvalTime.getUTCHours() + 1);

  return {
    contractVersion: "outlook-current-v3",
    state,
    stateReason,
    canonicalSource: Object.keys(evidence).length > 0 ? "M10" : "NONE",
    symbol: evidence["symbol"] ?? hourlyDoc?.["symbol"] ?? OUTLOOK_SYMBOL,
    direction,
    confidence,
    confidenceSource: confidence !== null && confidence !== undefined ? "EA_M10" : null,
    executionStatus: canonical["candidate"] ? canonical["execution_status"] : storedActive ? "TRACKING" : canonical["execution_status"],
    executionReady: Boolean(canonical["execution_ready"] || storedActive),
    candidateId,
    signalBarTime: asIso(canonical["bar_time"]) ?? canonical["bar_time"] ?? null,
    eventTime: asIso(evidence["event_time"] ?? evidence["ts"]),
    brokerTime: asIso(evidence["broker_time"]),
    freshnessSeconds,
    dataHealth: state !== OUTLOOK_DATA_UNAVAILABLE ? "HEALTHY" : "UNAVAILABLE",
    missingFields,
    blockerCode: blocker,
    blockerLabel: blocker ? blocker.replace(/_/g, " ").replace(/\w\S*/g, (t) => t[0]!.toUpperCase() + t.slice(1).toLowerCase()) : null,
    nextRequiredCondition: nextRequiredMap[state] ?? "Signal is confirmed by the EA.",
    m10: { ...canonical, bid: quote.bid, ask: quote.ask, spread: quote.spread, quoteTime: asIso(quote.quote_at) },
    hourlyContext: {
      state: hourlyState,
      direction: ["BUY", "SELL"].includes(hourlyDirection ?? "") ? hourlyDirection : null,
      confidence: hourlyDoc?.["confidence_pct"] ?? null,
      reason: hourlyDoc?.["reasoning"] ?? hourlyDoc?.["no_valid_outlook_reason"] ?? null,
      generatedAt: hourlyDoc?.["generated_at"] ?? null,
      advisoryOnly: true,
    },
    notificationEligibility: { eligible, reason: notificationReason },
    notificationSent: notification["delivery_status"] === "SENT",
    notificationEventId: notification["id"] ?? null,
    lastValidOutlook: storedActive ? sourceDoc : null,
    nextEvaluationTime: nextEvalTime.toISOString(),
  };
}
