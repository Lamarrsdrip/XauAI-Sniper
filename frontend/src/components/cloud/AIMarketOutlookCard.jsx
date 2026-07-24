import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Bell, BellOff, Compass, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
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
  TRANSITION: { text: "text-amber-200", border: "border-amber-300/20", bg: "bg-amber-300/[0.05]", Icon: Compass },
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
  const [prefs, setPrefs] = useState(null);
  const [verifiedStatus, setVerifiedStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [requestFailed, setRequestFailed] = useState(false);

  const load = useCallback(async () => {
    if (!linked) {
      setOutlook(null);
      setLoading(false);
      setRequestFailed(false);
      onOutlookChange?.(null);
      onStatusChange?.({ loading:false, requestFailed:false });
      return;
    }
    try {
      const [{ data: cur }, { data: pr }, statusResult] = await Promise.all([
        outlookAxios.get("/outlook/current"),
        outlookAxios.get("/outlook/notifications/prefs"),
        outlookAxios.get("/outlook/notifications/status").catch(() => ({ data: { final_status: "UNKNOWN" } })),
      ]);
      const nextOutlook = cur?.outlook || null;
      setOutlook(nextOutlook);
      setPrefs(pr?.prefs || null);
      setVerifiedStatus(statusResult?.data || null);
      setRequestFailed(false);
      onOutlookChange?.(nextOutlook);
      onStatusChange?.({ loading:false, requestFailed:false });
    } catch (_) {
      setRequestFailed(true);
      onStatusChange?.({ loading:false, requestFailed:true });
    }
    setLoading(false);
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
  const generatedAt = outlook?.generated_at || outlook?.published_at || outlook?.created_at || outlook?.ts;
  const ageMinutes = generatedAt ? (Date.now() - new Date(generatedAt).getTime()) / 60000 : Infinity;
  const stale = !Number.isFinite(ageMinutes) || ageMinutes > 75;

  return (
    <Link to="/ai-market-outlook" className={`${CARD} block p-4 hover:border-amber-300/20 transition`} data-testid="ai-market-outlook-card">
      <div className="flex items-center justify-between">
        <span className={MONO_LABEL}>AI Market Outlook</span>
        {notifOn ? (
          <button onClick={turnOffNotifications} title="Phone alerts verified active — click to turn off"
                  className="rounded-full p-1.5 hover:bg-white/[0.06] transition" data-testid="outlook-bell">
            <Bell className="h-3.5 w-3.5 text-amber-300" />
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

      {(!online || stale) && (
        <p className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-3 py-2 text-[11px] font-semibold text-rose-300">
          {!online
            ? "EA offline — showing no live outlook until a fresh heartbeat arrives."
            : "DATA STALE — do not rely on this outlook until fresh EA evidence arrives."}
        </p>
      )}

      {!linked ? (
        <p className="mt-3 text-[12px] text-white/40">Connect your license to receive hourly outlooks.</p>
      ) : loading ? (
        <p className="mt-3 text-[12px] text-white/40">Loading outlook…</p>
      ) : requestFailed && !outlook ? (
        <p className="mt-3 text-[12px] text-rose-300">Outlook request failed — no current outlook is being claimed.</p>
      ) : !outlook ? (
        <p className="mt-3 text-[12px] text-white/40">No outlook published yet — first hourly analysis is generating.</p>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 rounded-full border ${style.border} ${style.bg} px-2.5 py-1`}>
              <style.Icon className={`h-3 w-3 ${style.text}`} />
              <span className={`font-mono text-[12px] font-bold ${style.text}`}>{dir.replace(/_/g, " ")}</span>
            </div>
            {dir !== "NO_VALID_OUTLOOK" && (
              <span className="font-mono text-[11px] text-white/40">
                {(outlook.confidence_category || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) || `${outlook.confidence_pct}%`} confidence
              </span>
            )}
          </div>
          {(dir === "BUY" || dir === "SELL") && (
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
              Manual advisory · not an automated XauCloud entry
              {outlook.automated_entry_approved === false && " · Automated entry: not approved"}
              {outlook.automated_entry_approved === true && " · Automated entry: approved"}
            </p>
          )}
          {/* Audit fix: was excluding NO_VALID_OUTLOOK/NEUTRAL/RANGE only,
              which INCLUDED TRANSITION -- inconsistent with the full page's
              `isDirectional = dir === "BUY" || dir === "SELL"` guard. The
              backend never actually emits TRANSITION today (dormant), but
              if it ever did, zone/SL/TP would all be null for it and this
              card -- unlike the page -- would have rendered a visibly
              broken "Entry: – SL:" block. Aligned to the page's check. */}
          {(dir === "BUY" || dir === "SELL") && (
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-white/45">
              <div>Entry: <span className="text-white/70">{outlook.preferred_entry_zone_low}–{outlook.preferred_entry_zone_high}</span></div>
              <div>SL: <span className="text-white/70">{outlook.suggested_sl}</span></div>
              <div>Status: <span className="text-white/70">{(outlook.status || "").replace(/_/g, " ")}</span></div>
              <div>Next: <span className="text-white/70">hourly</span></div>
            </div>
          )}
          <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-white/35">{outlook.reasoning}</p>
          <p className="mt-2 text-[10px] text-white/25">
            Updated {outlook.generated_at || outlook.published_at || outlook.created_at || outlook.ts || "time unavailable"}
            {requestFailed ? " · refresh failed; showing last known data" : ""}
          </p>
        </div>
      )}
    </Link>
  );
}
