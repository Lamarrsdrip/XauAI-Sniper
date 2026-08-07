import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Bell, BellOff, Compass, ArrowUpRight, ArrowDownRight, Minus, Radar, WifiOff, CloudOff } from "lucide-react";
import { API } from "@/lib/api";

// Mirrors AIThoughtFeed's local axios convention -- self-contained, droppable panel.
const outlookAxios = axios.create({ baseURL: API, withCredentials: true });

const CARD = "rounded-2xl border border-white/[0.07] bg-[#0d0e13]";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";

const DIRECTION_STYLE = {
  BUY: { text: "text-emerald-300", border: "border-emerald-400/20", bg: "bg-emerald-300/[0.05]", Icon: ArrowUpRight },
  SELL: { text: "text-rose-300", border: "border-rose-400/20", bg: "bg-rose-300/[0.05]", Icon: ArrowDownRight },
  NEUTRAL: { text: "text-white/60", border: "border-white/[0.08]", bg: "bg-white/[0.02]", Icon: Minus },
  RANGE: { text: "text-white/60", border: "border-white/[0.08]", bg: "bg-white/[0.02]", Icon: Minus },
  TRANSITION: { text: "text-gold-200", border: "border-gold-300/20", bg: "bg-gold-300/[0.05]", Icon: Compass },
  NO_VALID_OUTLOOK: { text: "text-white/40", border: "border-white/[0.06]", bg: "bg-white/[0.01]", Icon: Minus },
};

function directionStyle(dir) {
  return DIRECTION_STYLE[dir] || DIRECTION_STYLE.NO_VALID_OUTLOOK;
}

/** Compact "AI Market Outlook" card for the Home dashboard — replaces the
 * former "AI Trading Assistant" compact card. Advisory-only, entirely
 * separate data source from the trading engine (see backend/market_outlook.py
 * docstring for the strict-separation guarantee this card's data ultimately
 * relies on). */
export default function AIMarketOutlookCard({ linked = true, online = true, onOutlookChange, onStatusChange }) {
  const [outlook, setOutlook] = useState(null);
  const [freshness, setFreshness] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [verifiedStatus, setVerifiedStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requestFailed, setRequestFailed] = useState(false);
  // Owner directive (2026-08-05) test case 8: a duplicate/out-of-order
  // stale /outlook/current response must never restore old signal data
  // over a newer one -- see AIMarketOutlookPage.jsx's identical guard.
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!linked) {
      requestSeq.current += 1;
      setOutlook(null);
      setLoading(false);
      setRequestFailed(false);
      onOutlookChange?.(null);
      onStatusChange?.({ loading:false, requestFailed:false });
      return;
    }
    const requestId = ++requestSeq.current;
    try {
      const [{ data: cur }, { data: pr }, statusResult] = await Promise.all([
        outlookAxios.get("/outlook/current"),
        outlookAxios.get("/outlook/notifications/prefs"),
        outlookAxios.get("/outlook/notifications/status").catch(() => ({ data: { final_status: "UNKNOWN" } })),
      ]);
      if (requestId !== requestSeq.current) return; // a newer request already superseded this one
      const nextOutlook = cur?.outlook || null;
      setOutlook(nextOutlook);
      setFreshness(cur?.freshness || null);
      setPrefs(pr?.prefs || null);
      setVerifiedStatus(statusResult?.data || null);
      setRequestFailed(false);
      onOutlookChange?.(nextOutlook);
      onStatusChange?.({ loading:false, requestFailed:false });
    } catch (_) {
      if (requestId !== requestSeq.current) return;
      setRequestFailed(true);
      onStatusChange?.({ loading:false, requestFailed:true });
    }
    if (requestId === requestSeq.current) setLoading(false);
  }, [linked, onOutlookChange, onStatusChange]);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  // v6.25.2 owner directive 2026-07-17 -- this compact card reproduced the
  // previously-fixed "false-ON" bug: it lit the bell gold on any successful
  // tier-preference save, with no permission request, no device subscription,
  // and no check against real delivery status. A user could see "notifications
  // on" while push delivery was structurally impossible (e.g. production
  // reporting DEPENDENCY_MISSING). The full Outlook page's fix for this
  // exact bug only shows ON after final_status === "ON_VERIFIED" (see
  // AIMarketOutlookPage.jsx) -- mirror that here instead of trusting the
  // tier preference alone.
  const notifOn = verifiedStatus?.final_status === "ON_VERIFIED";

  const turnOffNotifications = useCallback(async (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      const { data } = await outlookAxios.post("/outlook/notifications/prefs", { tier: "OFF", notify_all_devices: true });
      setPrefs(data?.prefs || { tier: "OFF" });
      const statusResult = await outlookAxios.get("/outlook/notifications/status").catch(() => null);
      if (statusResult) setVerifiedStatus(statusResult.data);
    } catch (_) { /* ignore — user can retry from the full page settings */ }
  }, []);

  const dir = outlook?.primary_direction || "NO_VALID_OUTLOOK";
  const style = directionStyle(dir);
  const lastCheckedText = freshness?.last_checked_at
    ? new Date(freshness.last_checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  // Bug fix: this card used to compute its own client-side staleness (age
  // > 75 minutes) and still render the OLD BUY/SELL direction, entry zone,
  // SL, and confidence underneath a red warning -- exactly the "old signal
  // underneath a warning" defect. The backend's /outlook/current now
  // returns one authoritative `freshness.state`
  // (compute_outlook_freshness in market_outlook.py) that this card reads
  // directly instead of re-deriving its own answer -- so the Home card and
  // the full Outlook page can never disagree about what's "current."
  let bodyState = "LOADING";
  if (!linked) bodyState = "NOT_LINKED";
  else if (loading) bodyState = "LOADING";
  else if (requestFailed && !outlook && !freshness) bodyState = "DATA_CONNECTION_ERROR";
  else if (!online) bodyState = "EA_OFFLINE";
  else if (freshness?.state) bodyState = freshness.state;
  else bodyState = "NO_FRESH_SIGNAL";

  return (
    <Link to="/ai-market-outlook" className={`${CARD} block p-4 hover:border-gold-300/20 transition`} data-testid="ai-market-outlook-card">
      <div className="flex items-center justify-between">
        <span className={MONO_LABEL}>AI Market Outlook</span>
        {notifOn ? (
          <button onClick={turnOffNotifications} title="Phone alerts verified active — click to turn off"
                  className="rounded-full p-1.5 hover:bg-white/[0.06] transition" data-testid="outlook-bell">
            <Bell className="h-3.5 w-3.5 text-gold-300" />
          </button>
        ) : (
          // Turning ON requires a real browser permission grant + device
          // subscription, which this compact card can't safely do inline --
          // let the click fall through to the card's own Link and land on
          // the full settings page where that real flow runs.
          <span title="Not verified — open full settings to enable" className="rounded-full p-1.5" data-testid="outlook-bell">
            <BellOff className="h-3.5 w-3.5 text-white/30" />
          </span>
        )}
      </div>

      {bodyState === "NOT_LINKED" && (
        <p className="mt-3 text-[12px] text-white/40">Connect your license to receive hourly outlooks.</p>
      )}

      {bodyState === "LOADING" && (
        <p className="mt-3 text-[12px] text-white/40">Loading outlook…</p>
      )}

      {/* Reserved for genuine system failures only -- red styling. */}
      {bodyState === "DATA_CONNECTION_ERROR" && (
        <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.05] px-3 py-2.5" data-testid="outlook-data-connection-error">
          <div className="flex items-center gap-2">
            <CloudOff className="h-3.5 w-3.5 flex-none text-rose-300" />
            <span className="text-[12px] font-semibold text-rose-200">Can&apos;t reach the market data service</span>
          </div>
          <p className="mt-1 text-[11px] text-white/40">Showing last known data. Trying again shortly.</p>
        </div>
      )}

      {bodyState === "EA_OFFLINE" && (
        <div className="mt-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2.5" data-testid="outlook-ea-offline">
          <div className="flex items-center gap-2">
            <WifiOff className="h-3.5 w-3.5 flex-none text-white/40" />
            <span className="text-[12px] font-semibold text-white/70">Your EA isn&apos;t connected right now</span>
          </div>
          <p className="mt-1 text-[11px] text-white/40">No live outlook until a fresh heartbeat arrives from your MT5 terminal.</p>
        </div>
      )}

      {/* Normal, expected state -- not an error. Neutral/premium styling,
          never red. */}
      {bodyState === "NO_FRESH_SIGNAL" && (
        <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5" data-testid="outlook-no-fresh-signal">
          <div className="flex items-center gap-2">
            <Radar className="h-3.5 w-3.5 flex-none text-white/35" />
            <span className="text-[12px] font-semibold text-white/70">No signal right now</span>
          </div>
          <p className="mt-1 text-[11px] text-white/40">XauCloud is waiting for new Gold market data. This updates automatically.</p>
          {lastCheckedText && <p className="mt-1 text-[10px] text-white/25">Last checked: {lastCheckedText}</p>}
        </div>
      )}

      {bodyState === "SIGNAL_FORMING" && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 rounded-full border ${style.border} ${style.bg} px-2.5 py-1`}>
              <style.Icon className={`h-3 w-3 ${style.text}`} />
              <span className={`font-mono text-[12px] font-bold ${style.text}`}>Setup forming</span>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-white/40">Not ready to trade yet.</p>
          {lastCheckedText && <p className="mt-2 text-[10px] text-white/25">Last checked: {lastCheckedText}</p>}
        </div>
      )}

      {bodyState === "ACTIVE_SIGNAL" && outlook && (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 rounded-full border ${style.border} ${style.bg} px-2.5 py-1`}>
              <style.Icon className={`h-3 w-3 ${style.text}`} />
              <span className={`font-mono text-[12px] font-bold ${style.text}`}>{dir} active signal</span>
            </div>
            <span className="font-mono text-[11px] text-white/40">
              {(outlook.confidence_category || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) || `${outlook.confidence_pct}%`} confidence
            </span>
          </div>
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
            Manual advisory · not an automated XauCloud entry
            {outlook.automated_entry_approved === false && " · Not eligible for automated trading"}
            {outlook.automated_entry_approved === true && " · Eligible for automated trading"}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-white/45">
            <div>Entry: <span className="text-white/70">{outlook.preferred_entry_zone_low}–{outlook.preferred_entry_zone_high}</span></div>
            <div>SL: <span className="text-white/70">{outlook.suggested_sl}</span></div>
          </div>
          <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-white/35">{outlook.reasoning}</p>
          {lastCheckedText && <p className="mt-2 text-[10px] text-white/25">Last checked: {lastCheckedText}</p>}
        </div>
      )}

      {bodyState === "SIGNAL_COMPLETED" && (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 ${freshness?.result === "WIN" ? "border-emerald-400/20 bg-emerald-300/[0.05]" : "border-rose-400/20 bg-rose-400/[0.05]"}`} data-testid="outlook-signal-completed">
          <div className="flex items-center gap-2">
            <style.Icon className={`h-3.5 w-3.5 flex-none ${freshness?.result === "WIN" ? "text-emerald-300" : "text-rose-300"}`} />
            <span className={`text-[12px] font-semibold ${freshness?.result === "WIN" ? "text-emerald-200" : "text-rose-200"}`}>
              {dir} signal completed
            </span>
          </div>
          <p className="mt-1 text-[11px] text-white/50">{freshness?.message}</p>
          {lastCheckedText && <p className="mt-1 text-[10px] text-white/25">Last checked: {lastCheckedText}</p>}
        </div>
      )}
    </Link>
  );
}
