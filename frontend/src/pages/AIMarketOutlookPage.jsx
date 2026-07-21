import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Bell, BellOff, ArrowUpRight, ArrowDownRight, Minus, Compass,
  ChevronDown, ChevronUp, Filter, TrendingUp, TrendingDown,
} from "lucide-react";
import { API } from "@/lib/api";
import { ensureOneSignalDeviceRegistered } from "@/lib/onesignal";
import M10VsOutlookCard from "@/components/cloud/M10VsOutlookCard";

const outlookAxios = axios.create({ baseURL: API, withCredentials: true });

const CARD = "rounded-2xl border border-white/[0.07] bg-[#0d0e13]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

const COLOR_STYLE = {
  GREEN: { border: "border-l-emerald-400", text: "text-emerald-300", bg: "bg-emerald-300/[0.04]" },
  RED: { border: "border-l-rose-400", text: "text-rose-300", bg: "bg-rose-300/[0.04]" },
  GRAY: { border: "border-l-white/25", text: "text-white/45", bg: "bg-white/[0.02]" },
  AMBER: { border: "border-l-amber-300", text: "text-amber-200", bg: "bg-amber-300/[0.04]" },
};

const DIRECTION_ICON = { BUY: ArrowUpRight, SELL: ArrowDownRight, NEUTRAL: Minus, RANGE: Minus, TRANSITION: Compass, NO_VALID_OUTLOOK: Minus };

const HISTORY_FILTERS = ["All", "BUY", "SELL", "Green", "Red", "Gray", "Amber", "TP1", "TP2", "TP3", "Stopped", "Unavailable"];

function resultLabel(o) {
  // v6.25.2 owner directive 2026-07-17 -- a TRANSITION/NEUTRAL/RANGE update
  // is informational only, never an active or resolved directional signal
  // -- must not be labeled with generic PUBLISHED/PENDING status text that
  // reads like a trade outcome.
  if (o.primary_direction && !["BUY", "SELL"].includes(o.primary_direction)) {
    return "INFORMATIONAL UPDATE";
  }
  if (o.signal_state === "TRACKING_AMBER") return "TRACKING · AWAITING +0.50R";
  if (o.signal_state === "WIN_GREEN_0_5R") return "WIN · +0.50R HIT";
  if (o.signal_state === "WIN_GREEN_TP1") return `WIN · TP${o.highest_tp_reached || 1} HIT`;
  if (o.signal_state === "LOSS_RED_SL") return "LOSS · SL HIT";
  if (o.signal_state === "LOSS_RED_TIMEOUT") return "LOSS · BELOW +0.50R AFTER 60 MIN";
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
        <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/[0.06] px-2.5 py-1.5 text-[11px] text-amber-200">
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
            <Metric label="TP1" value={outlook.tp1_price != null ? `${outlook.tp1_price} (${outlook.tp1_r ?? "—"}R)` : "—"} />
            <Metric label="TP2 / TP3" value={safeJoin([outlook.tp2_price, outlook.tp3_price], " / ")} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Signal entry" value={outlook.tracking_entry_price} />
            <Metric label="Current R" value={rText(outlook.current_r)} />
            <Metric label="MFE / MAE" value={`${rText(outlook.mfe_r)} / ${rText(outlook.mae_r)}`} />
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
            <div>Remaining room: <span className="text-white/70">{outlook.remaining_room_r}R</span></div>
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

function NotificationSettings({ prefs, setPrefs }) {
  const [saving, setSaving] = useState(false);
  const [permissionState, setPermissionState] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const [verifiedStatus, setVerifiedStatus] = useState(null);
  const [registrationResult, setRegistrationResult] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testSending, setTestSending] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await outlookAxios.get("/outlook/notifications/status");
      setVerifiedStatus(data);
      return data;
    } catch (_) {
      const fallback = { final_status: "UNKNOWN", remediation_code: "STATUS_UNAVAILABLE" };
      setVerifiedStatus(fallback);
      return fallback;
    }
  }, []);

  const registerDevice = useCallback(async ({ requestPermission }) => {
    setRegistrationResult({ ok: false, code: "REGISTERING", message: "Registering this device…" });
    const result = await ensureOneSignalDeviceRegistered({
      apiClient: outlookAxios,
      requestPermission,
      timeoutMs: 20000,
    });
    setRegistrationResult(result);
    setPermissionState(result.permission || (typeof Notification !== "undefined" ? Notification.permission : "unsupported"));
    await refreshStatus();
    return result;
  }, [refreshStatus]);

  const setTier = useCallback(async (tier) => {
    setSaving(true);
    setTestResult(null);
    try {
      if (tier !== "OFF") {
        const registration = await registerDevice({ requestPermission: true });
        if (!registration.ok) return;
      }

      const { data } = await outlookAxios.post("/outlook/notifications/prefs", {
        tier,
        notify_all_devices: prefs?.notify_all_devices !== false,
      });
      setPrefs(data?.prefs || { tier });
      if (tier === "OFF") {
        setRegistrationResult({
          ok: true,
          code: "PREFERENCES_OFF",
          message: "Notification delivery is off. This device can be re-enabled later without a new account link.",
        });
      }
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setRegistrationResult({
        ok: false,
        code: detail?.code || "PREFERENCE_SAVE_FAILED",
        message: detail?.message || error?.message || "Notification preference could not be saved.",
      });
    } finally {
      await refreshStatus();
      setSaving(false);
    }
  }, [prefs, registerDevice, refreshStatus, setPrefs]);

  const tier = prefs?.tier || "OFF";

  // Returning-session repair. It never opens a permission prompt. When the
  // browser already has permission, it relinks the OneSignal external ID and
  // refreshes the real per-device backend record.
  useEffect(() => {
    if (!prefs) return;
    refreshStatus();
    if (tier === "OFF") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    registerDevice({ requestPermission: false });
    // prefs/tier are the intentional session trigger; callbacks are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  const allowNotifications = useCallback(async () => {
    await setTier("ALL_UPDATES");
  }, [setTier]);

  const sendTestNotification = useCallback(async () => {
    setTestSending(true);
    setTestResult(null);
    try {
      // A valid local OneSignal subscription with a missing/stale backend row
      // repairs itself here before the provider send is attempted.
      const registration = await registerDevice({ requestPermission: true });
      if (!registration.ok) {
        setTestResult({ status: registration.code, message: registration.message });
        return;
      }
      const { data } = await outlookAxios.post("/outlook/notifications/test");
      setTestResult(data);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setTestResult({
        status: detail?.code || "FAILED",
        message: detail?.message || error?.message || "Test notification request failed.",
      });
    } finally {
      await refreshStatus();
      setTestSending(false);
    }
  }, [refreshStatus, registerDevice]);

  const finalStatus = verifiedStatus?.final_status;
  const registrationReady = ["READY_NOT_TESTED", "ON_VERIFIED"].includes(finalStatus);
  const isVerified = finalStatus === "ON_VERIFIED";
  const statusLabel = {
    ON_VERIFIED: "Phone alerts active",
    OFF: "Notifications off",
    SERVER_NOT_CONFIGURED: "Push server not ready",
    SUBSCRIPTION_MISSING: "Setup required — device not registered",
    REGISTRATION_INCOMPLETE: "Device registration is incomplete",
    READY_NOT_TESTED: "Registered — send a test to verify",
    DELIVERY_FAILED: "Last delivery failed",
    NO_ACTIVE_ONESIGNAL_RECIPIENT: "No active OneSignal recipient",
  }[finalStatus] || (finalStatus ? finalStatus.replace(/_/g, " ") : "Checking status…");

  const showOnboarding = prefs && tier === "OFF" && permissionState !== "denied";
  const diagnostic = registrationResult || {};
  const activeDevices = Number(verifiedStatus?.active_device_count || 0);

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center justify-between">
        <span className={MONO_LABEL}>Notifications</span>
        {isVerified ? <Bell className="h-4 w-4 text-amber-300" /> : <BellOff className="h-4 w-4 text-white/30" />}
      </div>

      {tier !== "OFF" && (
        <div className="mt-1 flex items-center justify-between gap-3 text-[10px]">
          <span className={isVerified ? "text-amber-300/80" : "text-white/45"}>{statusLabel}</span>
          <button onClick={sendTestNotification} disabled={testSending || saving}
                  className="shrink-0 text-white/45 underline decoration-dotted hover:text-white/75 disabled:opacity-50">
            {testSending ? "Registering / sending…" : "Send test notification"}
          </button>
        </div>
      )}

      {registrationResult?.message && (
        <p className={`mt-2 rounded-lg border px-3 py-2 text-[10px] leading-4 ${registrationResult.ok ? "border-emerald-400/15 bg-emerald-300/[0.04] text-emerald-200/80" : "border-amber-300/15 bg-amber-300/[0.04] text-amber-100/80"}`}>
          {registrationResult.code}: {registrationResult.message}
        </p>
      )}

      {testResult && (
        <p className={`mt-2 text-[10px] ${testResult.status === "SENT" ? "text-emerald-300/80" : "text-rose-300/80"}`}>
          {testResult.status}: {testResult.message}
        </p>
      )}

      {showOnboarding && (
        <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-4">
          <div className="flex items-start gap-3">
            <Bell className="h-6 w-6 flex-none text-amber-300" />
            <div>
              <div className="text-[13px] font-semibold text-amber-100">Get hourly Outlook updates</div>
              <p className="mt-1 text-[11px] leading-4 text-white/55">
                Permission alone is not treated as success. The app will wait for OneSignal to create and link this phone before enabling alerts.
              </p>
            </div>
          </div>
          <button disabled={saving} onClick={allowNotifications}
                  className="mt-3 w-full rounded-lg bg-amber-300 py-2.5 text-[12px] font-bold text-black disabled:opacity-50">
            {saving ? "Registering device…" : "Allow Outlook notifications"}
          </button>
        </div>
      )}

      {permissionState === "denied" && (
        <p className="mt-2 text-[11px] text-rose-300/80">Notifications are blocked in browser or iPhone settings. Re-enable them for this app, then tap Retry registration.</p>
      )}
      {registrationResult?.code === "IOS_PWA_INSTALL_REQUIRED" && (
        <p className="mt-2 text-[11px] text-amber-200">On iPhone, use Share → Add to Home Screen, then open XAU AI Sniper from that Home Screen icon.</p>
      )}

      {tier !== "OFF" && !registrationReady && (
        <button disabled={saving} onClick={() => registerDevice({ requestPermission: true })}
                className="mt-3 w-full rounded-lg border border-amber-300/25 bg-amber-300/[0.05] py-2.5 text-[11px] font-semibold text-amber-100 disabled:opacity-50">
          {saving ? "Registering…" : "Retry registration"}
        </button>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {[
          { v: "OFF", l: "Off" },
          { v: "HOURLY_ONLY", l: "Hourly signals only" },
          { v: "HOURLY_PLUS_RESULTS", l: "Hourly signals + TP/SL results" },
          { v: "ALL_UPDATES", l: "All outlook updates" },
        ].map((opt) => {
          const selected = tier === opt.v;
          const active = selected && (opt.v === "OFF" || registrationReady);
          return (
            <button key={opt.v} disabled={saving} onClick={() => setTier(opt.v)}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[12px] transition ${selected ? "border-amber-300/40 bg-amber-300/[0.06] text-amber-100" : "border-white/[0.06] text-white/60 hover:border-white/15"}`}>
              {opt.l}
              {selected && <span className="text-[9px]">{active ? (opt.v === "OFF" ? "OFF" : "ACTIVE") : "SAVED · NOT ACTIVE"}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.05] bg-black/15">
        <button onClick={() => setDiagnosticsOpen((open) => !open)} className="flex w-full items-center justify-between px-3 py-2 text-left text-[10px] text-white/40">
          <span>Registration diagnostics</span>
          <span>{diagnosticsOpen ? "Hide" : "Show"}</span>
        </button>
        {diagnosticsOpen && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-white/[0.05] px-3 py-3 text-[9px] text-white/40">
            <div>Permission <span className="text-white/70">{diagnostic.permission || permissionState}</span></div>
            <div>Standalone <span className="text-white/70">{diagnostic.standalone_mode == null ? "—" : diagnostic.standalone_mode ? "yes" : "no"}</span></div>
            <div>SW active <span className="text-white/70">{diagnostic.service_worker_active == null ? "—" : diagnostic.service_worker_active ? "yes" : "no"}</span></div>
            <div>SW scope <span className="text-white/70">{diagnostic.service_worker_scope || "—"}</span></div>
            <div>SDK initialized <span className="text-white/70">{diagnostic.one_signal_initialized == null ? "—" : diagnostic.one_signal_initialized ? "yes" : "no"}</span></div>
            <div>Opted in <span className="text-white/70">{diagnostic.opted_in == null ? "—" : diagnostic.opted_in ? "yes" : "no"}</span></div>
            <div>Subscription ID <span className="text-white/70">{diagnostic.subscription_id_masked || "missing"}</span></div>
            <div>Token <span className="text-white/70">{diagnostic.token_present == null ? "—" : diagnostic.token_present ? "present" : "missing"}</span></div>
            <div>OneSignal ID <span className="text-white/70">{diagnostic.onesignal_id_masked || "missing"}</span></div>
            <div>External ID <span className="text-white/70">{diagnostic.external_id_linked == null ? "—" : diagnostic.external_id_linked ? "linked" : "not linked"}</span></div>
            <div>Backend devices <span className="text-white/70">{activeDevices}</span></div>
            <div>Latest test <span className="text-white/70">{verifiedStatus?.latest_notification_status || "—"}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// Joins possibly-missing values with a separator, rendering "—" for any
// null/undefined piece instead of letting it coerce to the literal text
// "undefined" inside the combined string.
function safeJoin(values, separator) {
  return values.map((v) => (v == null ? "—" : v)).join(separator);
}

function HistoryCard({ outlook }) {
  const color = COLOR_STYLE[outlook.color_state] || COLOR_STYLE.AMBER;
  const signalTime = outlook.published_at || outlook.generated_at;
  const time = signalTime ? new Date(signalTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className={`rounded-xl border border-white/[0.06] border-l-4 ${color.border} ${color.bg} p-3`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] font-bold">{time} {outlook.primary_direction} · {outlook.confidence_pct}%</span>
        <span className={`font-mono text-[11px] font-bold ${color.text}`}>{resultLabel(outlook)}</span>
      </div>
      {["BUY", "SELL"].includes(outlook.primary_direction) ? (
        <div className="mt-2 space-y-1 text-[11px] text-white/45">
          <div>Signal entry <span className="font-mono text-white/75">{outlook.tracking_entry_price ?? "—"}</span> · Suggested zone {outlook.preferred_entry_zone_low}–{outlook.preferred_entry_zone_high}</div>
          <div>SL {outlook.original_sl ?? outlook.suggested_sl} · TP1 {outlook.tp1_price} · TP2 {outlook.tp2_price} · TP3 {outlook.tp3_price}</div>
          <div>Current {rText(outlook.current_r)} · MFE {rText(outlook.mfe_r)} · MAE {rText(outlook.mae_r)}</div>
          <div>Elapsed {elapsedText(signalTime, outlook.classification_at)} · Deadline {timeText(outlook.evaluation_deadline)} · Last monitored {timeText(outlook.last_monitored_at)}</div>
          {(outlook.first_half_r_at || outlook.tp1_hit_at || outlook.tp2_hit_at || outlook.tp3_hit_at || outlook.sl_hit_at) && (
            <div className="text-[10px] text-white/35">
              +0.50R {timeText(outlook.first_half_r_at)} · TP1 {timeText(outlook.tp1_hit_at)} · TP2 {timeText(outlook.tp2_hit_at)} · TP3 {timeText(outlook.tp3_hit_at)} · SL {timeText(outlook.sl_hit_at)}
            </div>
          )}
          {outlook.latest_path_event && <div className={`text-[10px] ${color.text}`}>Path: {outlook.latest_path_event.replace(/_/g, " ")}</div>}
          {outlook.historical_data_unavailable_reason && <div className="text-[10px] text-white/35">{outlook.historical_data_unavailable_reason}</div>}
        </div>
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

export default function AIMarketOutlookPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get("outlook_id");

  const [current, setCurrent] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [m10Signal, setM10Signal] = useState(null);

  const loadCurrent = useCallback(async () => {
    try {
      const { data } = await outlookAxios.get("/outlook/current");
      setCurrent(data?.outlook || null);
      setDiagnostics(data?.diagnostics || null);
    } catch (_) { /* advisory only */ }
  }, []);

  // v6.25.1 -- same endpoint the Command Center dashboard reads; picks the
  // newest event carrying an m10_signal block, explicitly by timestamp.
  const loadM10Signal = useCallback(async () => {
    try {
      const { data } = await outlookAxios.get("/cloud/monitor/activity", { params: { limit: 50 } });
      const candidates = (data?.events || []).filter((e) => e?.details?.m10_signal);
      const newest = candidates.reduce((best, e) => {
        const ts = new Date(e.ts || e.timestamp || 0).getTime();
        if (!best || ts > best._ts) return { ...e, _ts: ts };
        return best;
      }, null);
      setM10Signal(newest?.details?.m10_signal || null);
    } catch (_) { /* advisory only -- Outlook page must still work without it */ }
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const { data } = await outlookAxios.get("/outlook/notifications/prefs");
      setPrefs(data?.prefs || null);
    } catch (_) { /* advisory only */ }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const params = {};
      if (filter !== "All") {
        if (["BUY", "SELL"].includes(filter)) params.direction = filter;
        else if (["Green", "Red", "Gray", "Amber"].includes(filter)) params.color = filter.toUpperCase();
        else if (filter.startsWith("TP")) params.tp = filter;
        // Audit fix: was tp="INVALIDATED", which the backend mapped to a
        // literal status match that ALSO covers setups invalidated before
        // any entry was ever taken (a "no entry" outcome, not a stop-out).
        // Uses the precise final_result field instead -- see
        // market_outlook_routes.py's own comment on the `result` param.
        else if (filter === "Stopped") params.result = "LOSS_RED_SL";
        else if (filter === "Unavailable") params.result = "HISTORICAL_DATA_UNAVAILABLE";
      }
      const { data } = await outlookAxios.get("/outlook/history", { params });
      setHistory(data?.outlooks || []);
      setStats(data?.stats || {});
    } catch (_) { /* advisory only */ }
  }, [filter]);

  useEffect(() => {
    if (highlightId) {
      outlookAxios.get(`/outlook/${highlightId}`).then(({ data }) => setCurrent(data?.outlook || null)).catch(() => {});
    } else {
      loadCurrent();
    }
    loadPrefs();
    loadHistory();
    loadM10Signal();
    // The backend owns classification; this lightweight refresh only makes
    // its persisted event-driven state visible promptly when the page is
    // open. It does not calculate or monitor prices in the browser.
    const t = setInterval(() => { loadCurrent(); loadHistory(); loadM10Signal(); }, 15000);
    return () => clearInterval(t);
  }, [highlightId, loadCurrent, loadPrefs, loadHistory, loadM10Signal]);

  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="rounded-full border border-white/10 p-2 hover:border-white/25">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-mono text-lg font-black uppercase tracking-tight">AI Market Outlook</h1>
        </div>

        <div className="flex flex-col gap-4">
          <OutlookHero outlook={current} advanced={advanced} setAdvanced={setAdvanced} />
          <M10VsOutlookCard m10={m10Signal} outlook={current} />
          <EvidenceDiagnostics diagnostics={diagnostics} />
          <NotificationSettings prefs={prefs} setPrefs={setPrefs} />

          <div className={`${CARD} p-5`}>
            <div className="flex items-center justify-between">
              <span className={MONO_LABEL}>History</span>
              <button onClick={() => setShowFilters((s) => !s)} className="flex items-center gap-1 text-[11px] text-white/50">
                <Filter className="h-3 w-3" /> {filter}
              </button>
            </div>
            {showFilters && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {HISTORY_FILTERS.map((f) => (
                  <button key={f} onClick={() => { setFilter(f); setShowFilters(false); }}
                          className={`rounded-full border px-2.5 py-1 text-[10px] ${filter === f ? "border-amber-300/40 text-amber-200" : "border-white/10 text-white/45"}`}>
                    {f}
                  </button>
                ))}
              </div>
            )}

            {/* v6.24.18 owner directive -- genuine win rate: wins/(wins+losses),
                never wins/total. "—" (not "0%") when nothing has resolved yet. */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Win rate" value={stats.win_rate != null ? `${Math.round(stats.win_rate * 100)}%` : "—"} />
              <Metric label="Wins / Losses" value={`${stats.wins ?? 0} / ${stats.losses ?? 0}`} />
              <Metric label="Total R" value={stats.total_r != null ? `${stats.total_r > 0 ? "+" : ""}${stats.total_r}R` : "—"} />
              <Metric label="Avg R" value={stats.average_r != null ? `${stats.average_r > 0 ? "+" : ""}${stats.average_r}R` : "—"} />
              <Metric label="TP1 / TP2 / TP3" value={`${stats.tp1_hit_rate != null ? Math.round(stats.tp1_hit_rate * 100) : 0}% / ${stats.tp2_hit_rate != null ? Math.round(stats.tp2_hit_rate * 100) : 0}% / ${stats.tp3_hit_rate != null ? Math.round(stats.tp3_hit_rate * 100) : 0}%`} />
              <Metric label="Unavailable history" value={stats.unavailable_historical_count ?? 0} />
              <Metric label="Active" value={stats.active_unresolved_count ?? "—"} />
              <Metric label="Avg MFE/MAE" value={stats.average_mfe != null ? `${stats.average_mfe}/${stats.average_mae}` : "—"} />
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {history.length === 0 && <p className="text-[12px] text-white/35">No outlooks match this filter yet.</p>}
              {history.map((o) => <HistoryCard key={o.id} outlook={o} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
