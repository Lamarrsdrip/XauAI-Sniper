import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { Bell, BellOff, Compass, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { API } from "@/lib/api";

// Mirrors AIThoughtFeed's local axios convention -- self-contained, droppable panel.
const outlookAxios = axios.create({ baseURL: API, withCredentials: true });
outlookAxios.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("cloud_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

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
export default function AIMarketOutlookCard({ linked = true }) {
  const [outlook, setOutlook] = useState(null);
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!linked) { setLoading(false); return; }
    try {
      const [{ data: cur }, { data: pr }] = await Promise.all([
        outlookAxios.get("/outlook/current"),
        outlookAxios.get("/outlook/notifications/prefs"),
      ]);
      setOutlook(cur?.outlook || null);
      setPrefs(pr?.prefs || null);
    } catch (_) { /* silent — advisory feature, must never disrupt the dashboard */ }
    setLoading(false);
  }, [linked]);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const toggleNotifications = useCallback(async (e) => {
    e.preventDefault(); e.stopPropagation();
    const nextTier = prefs?.tier && prefs.tier !== "OFF" ? "OFF" : "HOURLY_PLUS_RESULTS";
    try {
      const { data } = await outlookAxios.post("/outlook/notifications/prefs", { tier: nextTier, notify_all_devices: true });
      setPrefs(data?.prefs || { tier: nextTier });
    } catch (_) { /* ignore — user can retry from the full page settings */ }
  }, [prefs]);

  const dir = outlook?.primary_direction || "NO_VALID_OUTLOOK";
  const style = directionStyle(dir);
  const notifOn = prefs?.tier && prefs.tier !== "OFF";

  return (
    <Link to="/ai-market-outlook" className={`${CARD} block p-4 hover:border-amber-300/20 transition`} data-testid="ai-market-outlook-card">
      <div className="flex items-center justify-between">
        <span className={MONO_LABEL}>AI Market Outlook</span>
        <button onClick={toggleNotifications} title={notifOn ? "Notifications on" : "Enable hourly outlook alerts"}
                className="rounded-full p-1.5 hover:bg-white/[0.06] transition" data-testid="outlook-bell">
          {notifOn ? <Bell className="h-3.5 w-3.5 text-amber-300" /> : <BellOff className="h-3.5 w-3.5 text-white/30" />}
        </button>
      </div>

      {!linked ? (
        <p className="mt-3 text-[12px] text-white/40">Connect your license to receive hourly outlooks.</p>
      ) : loading ? (
        <p className="mt-3 text-[12px] text-white/40">Loading outlook…</p>
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
              <span className="font-mono text-[11px] text-white/40">{outlook.confidence_pct}% confidence</span>
            )}
          </div>
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
        </div>
      )}
    </Link>
  );
}
