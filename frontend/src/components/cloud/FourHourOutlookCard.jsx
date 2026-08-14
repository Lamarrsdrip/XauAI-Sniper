// XauCloud 4H Outlook — dashboard card + expanded professional analysis.
// DISPLAY ONLY. Reads the live backend forecast; renders nothing it fabricates.
// BUY reads bullish (green), SELL bearish (red), NEUTRAL neutral. Mobile-first.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Clock, Compass, ChevronRight } from "lucide-react";
import * as AK from "@/lib/appkit";
import { fetch4HOutlook, mark4HSeen } from "@/lib/fourHourOutlook";

const DIR_META = {
  BUY: { tone: "profit", text: "text-profit", Icon: TrendingUp, word: "BUY", label: "Bullish" },
  SELL: { tone: "loss", text: "text-loss", Icon: TrendingDown, word: "SELL", label: "Bearish" },
  NEUTRAL: { tone: "neutral", text: "text-white/70", Icon: Minus, word: "NEUTRAL", label: "No strong bias" },
};

const STATUS_LABEL = {
  ACTIVE: { txt: "ACTIVE", tone: "profit" },
  WAIT_FOR_ENTRY: { txt: "WAIT FOR ENTRY", tone: "gold" },
  NO_QUALIFYING_OPPORTUNITY: { txt: "NO OPPORTUNITY", tone: "neutral" },
  INVALIDATED: { txt: "INVALIDATED", tone: "loss" },
  EXPIRED: { txt: "EXPIRED", tone: "neutral" },
};

function fmtRemaining(expiresAt) {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function pipRange(mv) {
  return Array.isArray(mv) ? `${mv[0]}–${mv[1]} pips` : "—";
}
function zoneRange(z) {
  return Array.isArray(z) ? `${z[0]}–${z[1]}` : "—";
}

export default function FourHourOutlookCard() {
  const [state, setState] = useState({ loading: true, available: false, outlook: null });
  const [open, setOpen] = useState(false);
  const [, forceTick] = useState(0);
  const seenRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await fetch4HOutlook();
      setState({ loading: false, available: !!data?.available, outlook: data?.outlook || null });
    } catch {
      setState({ loading: false, available: false, outlook: null });
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    const tick = setInterval(() => forceTick((n) => n + 1), 30000); // refresh countdown
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [load]);

  const o = state.outlook;
  const isNew = o && o.seen === false && !seenRef.current;
  const dir = DIR_META[o?.direction] || DIR_META.NEUTRAL;
  const status = STATUS_LABEL[o?.status] || STATUS_LABEL.NO_QUALIFYING_OPPORTUNITY;
  const directionChanged = o?.changeEvent === "DIRECTION_FLIP" || o?.changeEvent === "INVALIDATION_BREACHED";

  const clearNew = useCallback(() => {
    if (o && o.seen === false && !seenRef.current) {
      seenRef.current = true;
      mark4HSeen();
    }
  }, [o]);

  const evidenceRows = useMemo(() => {
    const e = o?.evidence || {};
    return [
      ["H4 Trend", e.h4_trend],
      ["H1 Structure", e.h1_structure],
      ["Market Structure", e.market_structure],
      ["Momentum", e.momentum],
      ["Price Action", e.price_action],
      ["Location", e.location],
      ["Volatility", e.volatility],
      ["Exhaustion", e.exhaustion],
      ["EA Regime", e.ea_regime],
    ].filter(([, v]) => v && v !== "n/a");
  }, [o]);

  // ---- unavailable / loading ----
  if (state.loading) {
    return (
      <AK.Panel>
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold tracking-wide text-white/80">4H OUTLOOK</div>
          <AK.Chip tone="neutral">MANUAL MARKET INTELLIGENCE</AK.Chip>
        </div>
        <div className="mt-3"><AK.Skeleton className="h-8 w-32" /></div>
      </AK.Panel>
    );
  }
  if (!state.available || !o) {
    return (
      <AK.Panel>
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-bold tracking-wide text-white/80">4H OUTLOOK</div>
          <AK.Chip tone="neutral">MANUAL MARKET INTELLIGENCE</AK.Chip>
        </div>
        <div className="mt-2 text-[13px] text-white/50">4H Outlook temporarily unavailable. Reconnecting to live Gold analysis…</div>
      </AK.Panel>
    );
  }

  const DirIcon = dir.Icon;

  return (
    <>
      <AK.Panel>
        {/* header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass size={14} className="text-gold-300" />
            <div className="text-[12px] font-bold tracking-wide text-white/80">4H OUTLOOK</div>
            {isNew && <AK.Chip tone="gold">NEW</AK.Chip>}
          </div>
          <AK.Chip tone="neutral">MANUAL MARKET INTELLIGENCE</AK.Chip>
        </div>

        {directionChanged && (
          <div className="mt-2 rounded-md bg-gold-300/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-gold-300">
            4H OUTLOOK UPDATED · {o.previousDirection} → {o.direction}
          </div>
        )}

        {/* direction — strongest hierarchy */}
        <div className="mt-2.5 flex items-end justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={AK.cx("inline-flex h-9 w-9 items-center justify-center rounded-lg", dir.tone === "profit" ? "bg-profit/14" : dir.tone === "loss" ? "bg-loss/14" : "bg-white/[0.07]")}>
              <DirIcon size={22} className={dir.text} />
            </span>
            <div>
              <div className={AK.cx("text-[1.9rem] font-black leading-none tracking-tight", dir.text)}>{dir.word}</div>
              <div className="mt-0.5 text-[11px] text-white/45">{dir.label} · next ~4h</div>
            </div>
          </div>
          <div className="text-right">
            <div className="nums text-[1.55rem] font-black leading-none text-white">{o.confidence}%</div>
            <div className="mt-0.5 text-[11px] text-white/45">confidence</div>
          </div>
        </div>

        {/* key numbers */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-white/[0.04] px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wide text-white/40">Expected Move</div>
            <div className="nums mt-0.5 text-[15px] font-bold text-white">{o.direction === "NEUTRAL" ? "—" : pipRange(o.expectedMovePips)}</div>
          </div>
          <div className="rounded-lg bg-white/[0.04] px-3 py-2">
            <div className="text-[10.5px] uppercase tracking-wide text-white/40">Preferred Entry</div>
            <div className="nums mt-0.5 text-[15px] font-bold text-white">{o.direction === "NEUTRAL" ? "—" : zoneRange(o.preferredZone)}</div>
          </div>
        </div>

        {/* status + time */}
        <div className="mt-2.5 flex items-center justify-between">
          <AK.Chip tone={status.tone}>{status.txt}</AK.Chip>
          <div className="flex items-center gap-1.5 text-[12px] text-white/55">
            <Clock size={12} />
            <span className="nums">{fmtRemaining(o.expiresAt)} remaining</span>
          </div>
        </div>

        {o.status === "WAIT_FOR_ENTRY" && (
          <div className="mt-2 text-[12px] text-gold-300/90">
            Bias remains {o.direction}. Current price {o.currentPrice} is extended from value — waiting for a pullback toward {zoneRange(o.preferredZone)}.
          </div>
        )}
        {o.direction === "NEUTRAL" && (
          <div className="mt-2 text-[12px] text-white/50">No high-confidence 200+ pip opportunity currently detected. Monitoring Gold…</div>
        )}

        <button
          onClick={() => {
            setOpen(true);
            clearNew();
          }}
          className="mt-3 flex w-full items-center justify-between rounded-lg bg-white/[0.05] px-3 py-2.5 text-[13px] font-semibold text-white/85 active:bg-white/[0.08]"
        >
          View Analysis
          <ChevronRight size={16} className="text-white/40" />
        </button>
      </AK.Panel>

      {/* ---- expanded professional analysis ---- */}
      <AK.Sheet open={open} onClose={() => setOpen(false)} title={`4H Outlook — ${dir.word}`}>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <DirIcon size={20} className={dir.text} />
              <span className={AK.cx("text-lg font-black", dir.text)}>{dir.word}</span>
            </div>
            <div className="text-right">
              <div className="nums text-lg font-black text-white">{o.confidence}%</div>
              <div className="text-[10px] text-white/40">confidence</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <AK.Stat label="Expected Move" value={o.direction === "NEUTRAL" ? "—" : pipRange(o.expectedMovePips)} />
            <AK.Stat label="Preferred Entry" value={o.direction === "NEUTRAL" ? "—" : zoneRange(o.preferredZone)} />
            <AK.Stat label="Invalidation" value={o.invalidation ?? "—"} tone="loss" />
            <AK.Stat label="Current Price" value={o.currentPrice} />
            <AK.Stat label="Regime" value={o.regimeLabel} tone="gold" />
            <AK.Stat label="Status" value={status.txt} tone={status.tone} />
          </div>

          <div className="rounded-lg border border-white/[0.06]">
            {evidenceRows.map(([k, v], i) => (
              <AK.Row key={k} label={k} value={String(v)} last={i === evidenceRows.length - 1} />
            ))}
          </div>

          <div className="rounded-lg bg-white/[0.04] px-3 py-2.5 text-[13px] leading-relaxed text-white/75">{o.reasoning}</div>

          <div className="flex items-center justify-between text-[11px] text-white/35">
            <span>Updated {o.generatedAt ? new Date(o.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
            <span>Expires {o.expiresAt ? new Date(o.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
            <span>{o.dataStale ? "data: last good" : "data: live"} · {o.dataSource}</span>
          </div>
          <div className="text-[10.5px] text-white/30">Manual market intelligence — XauCloud's directional forecast, not an automatically executed EA trade. A higher-probability current bias, not a guarantee.</div>
        </div>
      </AK.Sheet>
    </>
  );
}
