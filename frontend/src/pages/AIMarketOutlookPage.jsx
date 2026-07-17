import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Bell, BellOff, ArrowUpRight, ArrowDownRight, Minus, Compass,
  ChevronDown, ChevronUp, Filter, TrendingUp, TrendingDown,
} from "lucide-react";
import { API } from "@/lib/api";

const outlookAxios = axios.create({ baseURL: API, withCredentials: true });
outlookAxios.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cloud_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

const CARD = "rounded-2xl border border-white/[0.07] bg-[#0d0e13]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

const COLOR_STYLE = {
  GREEN: { border: "border-l-emerald-400", text: "text-emerald-300", bg: "bg-emerald-300/[0.04]" },
  RED: { border: "border-l-rose-400", text: "text-rose-300", bg: "bg-rose-300/[0.04]" },
  GRAY: { border: "border-l-white/25", text: "text-white/45", bg: "bg-white/[0.02]" },
  AMBER: { border: "border-l-amber-300", text: "text-amber-200", bg: "bg-amber-300/[0.04]" },
};

const DIRECTION_ICON = { BUY: ArrowUpRight, SELL: ArrowDownRight, NEUTRAL: Minus, RANGE: Minus, TRANSITION: Compass, NO_VALID_OUTLOOK: Minus };

const HISTORY_FILTERS = ["All", "BUY", "SELL", "Green", "Red", "Gray", "Amber", "TP1", "TP2", "TP3", "Stopped", "No Entry"];

function resultLabel(o) {
  // v6.25.2 owner directive 2026-07-17 -- a TRANSITION/NEUTRAL/RANGE update
  // is informational only, never an active or resolved directional signal
  // -- must not be labeled with generic PUBLISHED/PENDING status text that
  // reads like a trade outcome.
  if (o.primary_direction && !["BUY", "SELL"].includes(o.primary_direction)) {
    return "INFORMATIONAL UPDATE";
  }
  if (!o.final_result) return o.status?.replace(/_/g, " ") || "PENDING";
  if (o.final_result.startsWith("GREEN") && o.highest_tp_reached) {
    return `TP${o.highest_tp_reached} HIT · +${o.final_r ?? "?"}R`;
  }
  if (o.final_result === "RED_STOPPED") return `STOPPED · ${o.final_r ?? -1}R`;
  if (o.final_result.startsWith("GRAY_EXPIRED")) return "NO ENTRY";
  if (o.final_result.startsWith("GRAY_INVALIDATED")) return "INVALIDATED";
  return o.final_result.replace(/_/g, " ");
}

// v6.25.1 owner directive 2026-07-17 -- the dedicated Outlook page must show
// or link to the latest M10 signal decision, not just the hourly outlook.
// Reuses /cloud/monitor/activity (the same endpoint the Command Center
// dashboard reads) rather than a new backend route -- the EA already posts
// m10_signal there every tick. Explicitly compares the two independent
// systems' current direction so agreement/conflict is visible, not hidden.
function M10VsOutlookCard({ m10, outlook }) {
  if (!m10) return null;
  const m10Dir = m10.preferred_direction || "NONE";
  const outlookDir = outlook?.primary_direction || "NONE";
  const bothDirectional = ["BUY", "SELL"].includes(m10Dir) && ["BUY", "SELL"].includes(outlookDir);
  const agree = bothDirectional && m10Dir === outlookDir;
  const conflict = bothDirectional && m10Dir !== outlookDir;
  const freshnessState = m10.freshness_state || "UNKNOWN";

  return (
    <div className={`${CARD} p-5`} data-testid="m10-vs-outlook-card">
      <div className={MONO_LABEL}>M10 Signal vs Hourly Outlook</div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
        <div className="rounded-xl border border-white/10 p-3">
          <div className="text-white/35 text-[10px] uppercase tracking-wide">M10 (near-term)</div>
          <div className="mt-1 font-mono text-lg font-black">{m10Dir}</div>
          <div className="mt-1 text-white/45">{(m10.decision || "").replace(/_/g, " ")} · {freshnessState}</div>
        </div>
        <div className="rounded-xl border border-white/10 p-3">
          <div className="text-white/35 text-[10px] uppercase tracking-wide">Hourly Outlook</div>
          <div className="mt-1 font-mono text-lg font-black">{outlookDir}</div>
          <div className="mt-1 text-white/45">{outlook?.confidence_pct != null ? `${outlook.confidence_pct}% confidence` : "—"}</div>
        </div>
      </div>
      {agree && <p className="mt-3 text-[11px] text-emerald-300">Agree: both currently favor {m10Dir}.</p>}
      {conflict && <p className="mt-3 text-[11px] text-amber-300">Conflict: M10 favors {m10Dir}, hourly outlook favors {outlookDir} -- different decision horizons (near-term entry quality vs broader hourly interpretation), not a bug.</p>}
      {!bothDirectional && <p className="mt-3 text-[11px] text-white/35">One or both systems have no directional idea right now.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/35">
        <span>Exhaustion: evidence-only ({(m10.exhaustion_decision || "—").replace(/_/g, " ")})</span>
        {m10.post_profit_buy_pending && <span className="text-amber-300">· Buy waiting for retrace</span>}
        {m10.post_profit_sell_pending && <span className="text-amber-300">· Sell waiting for retrace</span>}
        <span>· M10 bar {m10.bar_time || "—"}</span>
      </div>
    </div>
  );
}

function OutlookHero({ outlook, advanced, setAdvanced }) {
  if (!outlook) return null;
  const dir = outlook.primary_direction || "NO_VALID_OUTLOOK";
  const Icon = DIRECTION_ICON[dir] || Minus;
  const isDirectional = dir === "BUY" || dir === "SELL";

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${dir === "BUY" ? "text-emerald-300" : dir === "SELL" ? "text-rose-300" : "text-white/50"}`} />
          <span className="font-mono text-2xl font-black">{dir.replace(/_/g, " ")}</span>
          {isDirectional && <span className="font-mono text-sm text-white/40">{outlook.confidence_pct}%</span>}
        </div>
        <button onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-white/25">
          {advanced ? "Simple" : "Advanced"} {advanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
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
            <Metric label="Expected path" value={(outlook.expected_path || "").replace(/_/g, " ")} />
            <Metric label="Setup type" value={(outlook.setup_type || "").replace(/_/g, " ")} />
            <Metric label="Status" value={(outlook.status || "").replace(/_/g, " ")} />
            <Metric label="Chase limit" value={outlook.chase_limit} />
          </div>
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
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [verifiedStatus, setVerifiedStatus] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testSending, setTestSending] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await outlookAxios.get("/outlook/notifications/status");
      setVerifiedStatus(data);
    } catch (_) {
      setVerifiedStatus({ final_status: "UNKNOWN" });
    }
  }, []);

  // v6.24.18 owner directive -- subscribeDevice() must return a structured
  // result, never silently swallow. Real errors are reported through
  // verifiedStatus (backed by the authenticated /outlook/notifications/status
  // endpoint) rather than an empty catch block hiding the failure entirely.
  const subscribeDevice = useCallback(async () => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return { ok: false, code: "PUSH_UNSUPPORTED", message: "This browser does not support push notifications." };
    }
    try {
      const { data } = await outlookAxios.get("/outlook/notifications/vapid-public-key");
      if (!data?.configured || !data?.public_key) {
        return { ok: false, code: "SERVER_NOT_CONFIGURED", message: "Push server is not configured yet." };
      }
      const reg = await navigator.serviceWorker.ready;
      const swVersion = reg.active?.scriptURL || "";
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.public_key),
        });
      }
      let json = sub.toJSON();
      let subResp = await outlookAxios.post("/outlook/notifications/subscribe", {
        endpoint: json.endpoint, keys: json.keys, device_label: navigator.userAgent.slice(0, 60),
        timezone_offset_minutes: -new Date().getTimezoneOffset(), sw_version: swVersion,
      });
      // v6.25.2 owner directive -- if the backend's active VAPID key
      // rotated since this browser last subscribed (an explicit admin
      // rotation, not the ordinary restart-retains-same-fingerprint case),
      // the old PushManager subscription was created under a key the
      // backend can no longer sign for. Drop it and create a fresh one
      // under the current public key, then re-register.
      if (subResp.data?.key_rotated_or_mismatched) {
        await sub.unsubscribe().catch(() => {});
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.public_key),
        });
        json = sub.toJSON();
        subResp = await outlookAxios.post("/outlook/notifications/subscribe", {
          endpoint: json.endpoint, keys: json.keys, device_label: navigator.userAgent.slice(0, 60),
          timezone_offset_minutes: -new Date().getTimezoneOffset(), sw_version: swVersion,
        });
      }
      return { ok: true, device_id: subResp.data?.device_id, endpoint_registered: true, server_ready: true };
    } catch (e) {
      return { ok: false, code: "REGISTRATION_FAILED", message: e?.message || "Device registration failed." };
    }
  }, []);

  const setTier = useCallback(async (tier) => {
    setSaving(true);
    try {
      // Audit fix: this used to call subscribeDevice() only inside the
      // `permission === "default"` branch (i.e. only on the very first
      // prompt). A user whose browser permission was already "granted"
      // before ever opening this settings panel -- a plausible first-
      // contact state, not an edge case -- would skip subscribeDevice()
      // entirely: the tier still saves and the bell lights up "ON", but no
      // push subscription is ever created or verified with the backend, so
      // no notification would ever actually arrive, with no error shown
      // anywhere. Now subscribeDevice() runs whenever the user is turning
      // notifications ON and permission is already granted, in addition to
      // the request-then-subscribe path for a fresh "default" state.
      if (tier !== "OFF" && typeof Notification !== "undefined") {
        if (Notification.permission === "default") {
          const perm = await Notification.requestPermission();
          setPermissionState(perm);
          if (perm === "granted") await subscribeDevice();
        } else if (Notification.permission === "granted") {
          await subscribeDevice();
        }
      }
      const { data } = await outlookAxios.post("/outlook/notifications/prefs", { tier, notify_all_devices: prefs?.notify_all_devices !== false });
      setPrefs(data?.prefs || { tier });
    } catch (_) { /* leave prefs unchanged on failure, user can retry */ }
    await refreshStatus();
    setSaving(false);
  }, [prefs, setPrefs, subscribeDevice, refreshStatus]);

  const tier = prefs?.tier || "OFF";

  // Owner spec (Phase 4/10): a returning user whose browser permission is
  // already granted must be re-registered automatically -- no second
  // permission prompt, no silent "looks ON but nothing ever arrives" gap if
  // the push subscription expired or this is a fresh device/reinstalled PWA.
  // Runs once prefs have actually loaded (prefs !== null) so it never fires
  // with a stale default tier before the real saved tier is known.
  useEffect(() => {
    if (!prefs) return;
    refreshStatus();
    if (tier === "OFF") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    subscribeDevice().then(refreshStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  const allowNotifications = useCallback(async () => {
    setSaving(true);
    let regResult = { ok: false };
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        setPermissionState(perm);
        if (perm !== "granted") { setSaving(false); return; }
      }
      regResult = await subscribeDevice();
      if (regResult.ok) {
        const { data } = await outlookAxios.post("/outlook/notifications/prefs", { tier: "ALL_UPDATES", notify_all_devices: true });
        setPrefs(data?.prefs || { tier: "ALL_UPDATES" });
      }
    } catch (_) { /* leave prefs unchanged on failure, user can retry */ }
    await refreshStatus();
    setSaving(false);
  }, [subscribeDevice, setPrefs, refreshStatus]);

  const sendTestNotification = useCallback(async () => {
    setTestSending(true);
    setTestResult(null);
    try {
      const { data } = await outlookAxios.post("/outlook/notifications/test");
      setTestResult(data);
    } catch (e) {
      setTestResult({ status: "FAILED", message: e?.message || "Request failed." });
    }
    await refreshStatus();
    setTestSending(false);
  }, [refreshStatus]);

  // Prominent onboarding card: shown only to a user who has never enabled
  // Outlook notifications (tier still OFF) and hasn't explicitly denied
  // browser permission. Owner spec: one clear "Allow notifications" button;
  // tapping it uses the real browser permission path, then auto-selects
  // ALL_UPDATES -- it must never repeatedly nag a user who explicitly
  // declined (permissionState === "denied" falls through to the settings
  // list below instead, which already explains how to re-enable manually).
  const showOnboarding = prefs && tier === "OFF" && permissionState !== "denied";

  // v6.24.18 owner directive -- ON must mean ON_VERIFIED, never "the
  // preference tier happens to not be OFF". The bell only lights up amber
  // once the backend has confirmed a real device registration + a working
  // push server; every other state (still checking, setup incomplete,
  // permission denied, server not ready) gets its own honest label.
  const finalStatus = verifiedStatus?.final_status;
  const isVerified = finalStatus === "ON_VERIFIED";
  const statusLabel = {
    ON_VERIFIED: "Phone alerts active",
    OFF: "Notifications off",
    SERVER_NOT_CONFIGURED: "Push server not ready",
    DEPENDENCY_MISSING: "Push server not ready",
    SUBSCRIPTION_MISSING: "Setup required — device not registered",
    READY_NOT_TESTED: "Registered — send a test to verify",
    DELIVERY_FAILED: "Last delivery failed",
  }[finalStatus] || (finalStatus ? finalStatus : "Checking status…");

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex items-center justify-between">
        <span className={MONO_LABEL}>Notifications</span>
        {isVerified ? <Bell className="h-4 w-4 text-amber-300" /> : <BellOff className="h-4 w-4 text-white/30" />}
      </div>
      {tier !== "OFF" && (
        <div className="mt-1 flex items-center justify-between text-[10px]">
          <span className={isVerified ? "text-amber-300/80" : "text-white/40"}>{statusLabel}</span>
          <button onClick={sendTestNotification} disabled={testSending}
                  className="text-white/40 underline decoration-dotted hover:text-white/70 disabled:opacity-50">
            {testSending ? "Sending…" : "Send test notification"}
          </button>
        </div>
      )}
      {testResult && (
        <p className={`mt-1 text-[10px] ${testResult.status === "SENT" ? "text-emerald-300/80" : "text-rose-300/80"}`}>
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
                Enable notifications to get the AI Market Outlook every hour, plus TP/SL results, right on this device.
              </p>
            </div>
          </div>
          <button disabled={saving} onClick={allowNotifications}
                  className="mt-3 w-full rounded-lg bg-amber-300 py-2.5 text-[12px] font-bold text-black disabled:opacity-50">
            {saving ? "Enabling…" : "Allow Outlook notifications"}
          </button>
        </div>
      )}
      {permissionState === "denied" && (
        <p className="mt-2 text-[11px] text-rose-300/80">Notifications are blocked in your browser settings. Re-enable them for this site, then try again here.</p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {[
          { v: "OFF", l: "Off" },
          { v: "HOURLY_ONLY", l: "Hourly signals only" },
          { v: "HOURLY_PLUS_RESULTS", l: "Hourly signals + TP/SL results" },
          { v: "ALL_UPDATES", l: "All outlook updates" },
        ].map((opt) => (
          <button key={opt.v} disabled={saving} onClick={() => setTier(opt.v)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[12px] transition ${
                    tier === opt.v ? "border-amber-300/40 bg-amber-300/[0.06] text-amber-100" : "border-white/[0.06] text-white/60 hover:border-white/15"
                  }`}>
            {opt.l}
            {tier === opt.v && <span className="text-[10px]">ON</span>}
          </button>
        ))}
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

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function HistoryCard({ outlook }) {
  const color = COLOR_STYLE[outlook.color_state] || COLOR_STYLE.AMBER;
  const time = outlook.generated_at ? new Date(outlook.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className={`rounded-xl border border-white/[0.06] border-l-4 ${color.border} ${color.bg} p-3`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] font-bold">{time} {outlook.primary_direction} · {outlook.confidence_pct}%</span>
        <span className={`font-mono text-[11px] font-bold ${color.text}`}>{resultLabel(outlook)}</span>
      </div>
      {["BUY", "SELL"].includes(outlook.primary_direction) ? (
        <div className="mt-1 text-[11px] text-white/40">
          Entry {outlook.preferred_entry_zone_low}–{outlook.preferred_entry_zone_high} · SL {outlook.suggested_sl} ·
          TP1 {outlook.tp1_price} · TP2 {outlook.tp2_price} · TP3 {outlook.tp3_price}
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
      <div className="mt-1 text-[10px] text-white/30">MFE {outlook.mfe?.toFixed?.(2) ?? outlook.mfe} · MAE {outlook.mae?.toFixed?.(2) ?? outlook.mae}</div>
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
        else if (filter === "Stopped") params.result = "RED_STOPPED";
        else if (filter === "No Entry") params.color = "GRAY";
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
    const t = setInterval(() => { loadCurrent(); loadHistory(); loadM10Signal(); }, 60000);
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
              <Metric label="No entry" value={stats.no_entry_count ?? stats.no_entry_results} />
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
