// XauCloud 4H Outlook — dashboard card + expanded analysis. DISPLAY ONLY.
// Compact, phone-first, and defensively guarded so no forecast shape can throw.
// BUY reads bullish (green), SELL bearish (red), NEUTRAL neutral.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Clock, ChevronRight } from "lucide-react";
import * as AK from "@/lib/appkit";
import { fetch4HOutlook, mark4HSeen } from "@/lib/fourHourOutlook";

const DIR = {
  BUY: { tone: "profit", text: "text-profit", bg: "bg-profit/12", Icon: TrendingUp, label: "Bullish" },
  SELL: { tone: "loss", text: "text-loss", bg: "bg-loss/12", Icon: TrendingDown, label: "Bearish" },
  NEUTRAL: { tone: "neutral", text: "text-white/65", bg: "bg-white/[0.06]", Icon: Minus, label: "No strong bias" },
};
const STATUS = {
  ACTIVE: { txt: "ACTIVE", tone: "profit" },
  WAIT_FOR_ENTRY: { txt: "WAIT FOR ENTRY", tone: "gold" },
  NO_QUALIFYING_OPPORTUNITY: { txt: "NO SETUP", tone: "neutral" },
  INVALIDATED: { txt: "INVALIDATED", tone: "loss" },
  EXPIRED: { txt: "EXPIRED", tone: "neutral" },
};

const fmtRemaining = (iso) => {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
};
const pips = (mv) => (Array.isArray(mv) && mv.length === 2 ? `${mv[0]}–${mv[1]}` : "—");
const zone = (z) => (Array.isArray(z) && z.length === 2 ? `${z[0]}–${z[1]}` : "—");
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return "—"; } };

// Every code here means "no verified live XAUUSD data reached Manual
// Trading" -- distinct from a healthy feed with no qualifying setup, which
// is a normal `available:true` doc (see STATUS.NO_QUALIFYING_OPPORTUNITY
// below) and never routes through this unavailable state at all.
const UNAVAILABLE_REASON = {
  EA_FEED_MISSING: "Manual Trading Intelligence temporarily unavailable — no live XAUUSD quote has reached the server yet.",
  LIVE_MARKET_STALE: "Manual Trading Intelligence temporarily unavailable — the last verified XAUUSD quote is stale.",
  DATABASE_READ_TIMEOUT: "Manual Trading Intelligence temporarily unavailable — market-data database is slow to respond.",
  DATABASE_UNAVAILABLE: "Manual Trading Intelligence temporarily unavailable — market-data database is unreachable.",
};
const DEFAULT_UNAVAILABLE = "Manual Trading Intelligence temporarily unavailable — waiting for verified live XAUUSD data.";
function unavailableMessage(reason) {
  const code = String(reason || "").split(" ")[0];
  return UNAVAILABLE_REASON[code] || DEFAULT_UNAVAILABLE;
}

export default function FourHourOutlookCard() {
  const [state, setState] = useState({ loading: true, available: false, outlook: null, reason: null });
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const seenRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await fetch4HOutlook();
      setState({ loading: false, available: !!data?.available, outlook: data?.outlook || null, reason: data?.reason || null });
    } catch {
      setState({ loading: false, available: false, outlook: null, reason: null });
    }
  }, []);

  useEffect(() => {
    load();
    const a = setInterval(load, 60000);
    const b = setInterval(() => tick((n) => n + 1), 30000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [load]);

  const o = state.outlook;
  const d = DIR[o?.direction] || DIR.NEUTRAL;
  const status = STATUS[o?.status] || STATUS.NO_QUALIFYING_OPPORTUNITY;
  const isNeutral = !o || o.direction === "NEUTRAL";
  const entry = o?.currentOpportunity || o?.opportunity || null;
  const isNew = !!o && o.seen === false && !seenRef.current;
  const changed = o?.changeEvent === "DIRECTION_FLIP" || o?.changeEvent === "INVALIDATION_BREACHED";

  const openSheet = useCallback(() => {
    setOpen(true);
    if (o && o.seen === false && !seenRef.current) { seenRef.current = true; mark4HSeen(); }
  }, [o]);

  const evidence = useMemo(() => {
    const e = (o && o.evidence) || {};
    return [
      ["Daily Structure", e.daily_structure], ["H4 Structure", e.h4_structure], ["H1 Structure", e.h1_structure],
      ["M10 Entry Context", e.m10_entry_context], ["Directional Runway", e.runway], ["Broker History", e.data_coverage],
    ].filter(([, v]) => v && v !== "n/a");
  }, [o]);

  // ---- loading / unavailable ----
  if (state.loading || !state.available || !o) {
    return (
      <AK.Panel className="p-3.5">
        <Head isNew={false} />
        <div className="mt-2 text-[12.5px] text-white/45">
          {state.loading ? "Loading market intelligence…" : unavailableMessage(state.reason)}
        </div>
      </AK.Panel>
    );
  }

  const Icon = d.Icon;

  return (
    <>
      <AK.Panel className="p-3.5">
        <Head isNew={isNew} />

        {changed && (
          <div className="mt-2 rounded-md bg-gold-300/10 px-2 py-1 text-[11px] font-semibold text-gold-300">
            Updated · {o.previousDirection} → {o.direction}
          </div>
        )}

        {/* Stable HTF thesis — this remains visible even when no entry is safe. */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={AK.cx("flex h-7 w-7 flex-none items-center justify-center rounded-lg", d.bg)}>
              <Icon size={16} className={d.text} />
            </span>
            <div className="min-w-0">
              <div className={AK.cx("truncate text-[1.15rem] font-black leading-none tracking-tight", d.text)}>{isNeutral ? "NO CLEAR THESIS" : o.direction + " — ACTIVE"}</div>
              <div className="mt-0.5 truncate text-[10.5px] text-white/40">{d.label} HTF thesis · 4H swing / multi-session</div>
            </div>
          </div>
          <div className="flex-none text-right">
            <div className="nums text-[1.05rem] font-black leading-none text-white">{o.confidence}%</div>
            <div className="mt-0.5 text-[10px] text-white/40">confidence</div>
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-white/[0.07] bg-white/[0.03] p-2.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wide text-white/40">Current trade opportunity</div>
          {entry ? <>
            <div className={AK.cx("mt-1 text-[13px] font-black", d.text)}>{entry.direction} {String(entry.family || "").replaceAll("_", " ")}</div>
            <div className="mt-1 flex justify-between gap-2 text-[11px]"><span className="text-white/45">Entry</span><span className="nums font-semibold text-white/90">{zone(entry.entryZone)}</span></div>
            <div className="mt-1 flex justify-between gap-2 text-[11px]"><span className="text-white/45">Targets</span><span className="nums font-semibold text-white/90">{pips(entry.expectedMovePips)} pips</span></div>
          </> : <div className="mt-1 text-[12px] text-gold-300">THESIS ACTIVE — WAITING FOR ENTRY</div>}
        </div>

        {/* Thesis context */}
        <div className="mt-2.5 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-white/40">Thesis runway</span>
          <span className="nums font-semibold text-white/90">{o.directionalRunwayPips ? o.directionalRunwayPips + " pips" : "—"}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-white/40">Next entry area</span>
          <span className="nums font-semibold text-white/90">{isNeutral ? "—" : zone(o.preferredZone)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-white/40">Entry status</span>
          <span className="nums font-semibold text-white/90">{entry ? "AVAILABLE" : "WAITING"}</span>
        </div>

        {/* status + time */}
        <div className="mt-2.5 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
          <AK.Chip tone={status.tone}>{status.txt}</AK.Chip>
          <span className="flex items-center gap-1 text-[11.5px] text-white/50"><Clock size={11} /><span className="nums">{fmtRemaining(o.expiresAt)}</span></span>
        </div>

        {!entry && !isNeutral && (
          <div className="mt-2 text-[11.5px] leading-snug text-gold-300/90">The {o.direction} thesis is still valid. Price needs a separate confirmation near {zone(o.preferredZone)} before an entry is shown.</div>
        )}
        {isNeutral && <div className="mt-2 text-[11.5px] leading-snug text-white/45">No high-confidence 200+ pip setup right now. Monitoring Gold…</div>}

        <button onClick={openSheet} className="no-select mt-2.5 flex w-full items-center justify-center gap-1 text-[12px] font-semibold text-gold-300 active:text-gold-300/70">
          View analysis <ChevronRight size={14} />
        </button>
      </AK.Panel>

      {/* expanded — bounded height + scroll so it never runs off a phone screen */}
      <AK.Sheet open={open} onClose={() => setOpen(false)} title={`Manual Trading Intelligence — ${o.direction}`}>
        <div className="max-h-[68vh] space-y-3 overflow-y-auto pb-1">
          <div className="grid grid-cols-2 gap-2">
            <Cell k="Thesis status" v={o.state || "NO SETUP"} tone="text-gold-300" />
            <Cell k="Current opportunity" v={entry ? entry.direction + " " + String(entry.family || "").replaceAll("_", " ") : "WAITING FOR ENTRY"} tone={entry ? d.text : "text-gold-300"} />
            <Cell k="Entry zone" v={entry ? zone(entry.entryZone) : (isNeutral ? "—" : zone(o.preferredZone))} />
            <Cell k="Invalidation" v={o.invalidation ?? "—"} tone={o.invalidation ? "text-loss" : "text-white"} />
            <Cell k="Current price" v={o.currentPrice ?? "—"} />
            <Cell k="Regime" v={o.regimeLabel || "—"} tone="text-gold-300" />
            <Cell k="Directional runway" v={o.directionalRunwayPips ? o.directionalRunwayPips + " pips" : "—"} />
            <Cell k="Confidence" v={`${o.confidence}%`} />
          </div>

          {Array.isArray((entry || o).targets) && (entry || o).targets.length > 0 && <div className="grid grid-cols-3 gap-2">{(entry || o).targets.map((t) => <Cell key={t.label} k={t.label} v={t.price + " · " + t.pips + "p"} />)}</div>}

          {Array.isArray(o.recentOpportunities) && o.recentOpportunities.length > 0 && <div className="rounded-xl border border-white/[0.06] p-3"><div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-white/40">Recent entries in this thesis</div>{o.recentOpportunities.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 py-1 text-[11px]"><span className="text-white/70">{item.direction} {String(item.family || "").replaceAll("_", " ")}</span><span className={item.status === "T1_REACHED" ? "text-profit" : item.status === "INVALIDATED" ? "text-loss" : "text-gold-300"}>{String(item.status || "").replaceAll("_", " ")}</span></div>)}</div>}

          <div className="overflow-hidden rounded-xl border border-white/[0.06]">
            {evidence.map(([k, v], i) => (
              <div key={k} className={AK.cx("flex items-center justify-between gap-3 px-3 py-2.5 text-[12.5px]", i < evidence.length - 1 && "border-b border-white/[0.05]")}>
                <span className="text-white/50">{k}</span>
                <span className="text-right font-semibold text-white/90">{String(v)}</span>
              </div>
            ))}
          </div>

          {o.reasoning && <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-[12.5px] leading-relaxed text-white/75">{o.reasoning}</div>}
          {o.invalidationReason && <div className="rounded-xl bg-loss/10 px-3 py-2.5 text-[12px] leading-relaxed text-loss/90">Invalidation: {o.invalidationReason}</div>}

          <div className="flex items-center justify-between text-[10.5px] text-white/35">
            <span>Updated {fmtTime(o.generatedAt)}</span>
            <span>Expires {fmtTime(o.expiresAt)}</span>
            <span>{o.dataStale ? "last good" : "live"}</span>
          </div>
          <div className="text-[10px] leading-snug text-white/30">Manual market intelligence — XauCloud's directional forecast, not an automatically executed EA trade. A higher-probability current bias, not a guarantee.</div>
        </div>
      </AK.Sheet>
    </>
  );
}

function Head({ isNew }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[10.5px] font-bold uppercase tracking-[0.06em] text-white/80">Manual Trading Intelligence</span>
          {isNew && <AK.Chip tone="gold">NEW</AK.Chip>}
        </div>
        <span className="flex-none rounded-md bg-gold-300/12 px-1.5 py-0.5 text-[9.5px] font-bold text-gold-300">4H</span>
      </div>
      <div className="mt-0.5 text-[10px] text-white/35">4H Swing Intelligence — High-Conviction XAUUSD Setups</div>
    </div>
  );
}

function Cell({ k, v, tone = "text-white" }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wide text-white/35">{k}</div>
      <div className={AK.cx("nums mt-0.5 truncate text-[13px] font-bold", tone)}>{v}</div>
    </div>
  );
}
