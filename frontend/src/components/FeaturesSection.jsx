import React, { useState, useEffect, useRef, useCallback } from "react";
import { Brain, ShieldCheck, Shuffle, Newspaper, Lightning, CloudArrowUp, ChartLine, Funnel, CaretLeft, CaretRight } from "@phosphor-icons/react";

const CARDS = [
  {
    icon: Brain,
    title: "AI Market Analysis",
    body: "Claude and GPT jointly analyze every setup and agree before a trade opens.",
    tone: "text-violet-300",
    border: "border-violet-300/20",
    glow: "bg-violet-300/[0.07]",
  },
  {
    icon: ChartLine,
    title: "Trade Thesis Monitor",
    body: "Every open trade is scored live against the exact reason it was entered — BOS direction, HTF trend, momentum, and structure. When the thesis dies the bot exits immediately, not when a timer runs out.",
    tone: "text-amber-300",
    border: "border-amber-300/20",
    glow: "bg-amber-300/[0.07]",
    badge: "NEW v6.17.1",
  },
  {
    icon: Funnel,
    title: "AI Quality Gate",
    body: "A+ and A trades are only taken at full size when the AI strongly agrees. If AI weakly disagrees the trade is blocked entirely. If AI weakly agrees the lot is reduced. Weak AI signals can never silently become full-size trades.",
    tone: "text-rose-300",
    border: "border-rose-300/20",
    glow: "bg-rose-300/[0.07]",
    badge: "NEW v6.17.1",
  },
  {
    icon: ShieldCheck,
    title: "Smart Risk Management",
    body: "Position sizing is based on account balance, stop distance, and grade — never reduced after losing trades.",
    tone: "text-sky-300",
    border: "border-sky-300/20",
    glow: "bg-sky-300/[0.07]",
  },
  {
    icon: Shuffle,
    title: "Gold + Index Market Detection (XauIndex)",
    body: "A separate product, XauIndex, built on the same exit engine as XauAI Sniper. Attach it to XAUUSD or an index chart — it auto-detects which market it's on and adapts. Gold Mode is the full, live-tested strategy. Index Mode currently runs detection and diagnostics only, honestly, until a real index strategy has been tested and shipped. See the download section below.",
    tone: "text-emerald-300",
    border: "border-emerald-300/20",
    glow: "bg-emerald-300/[0.07]",
    badge: "NEW · XauIndex v1.0.0",
  },
  {
    icon: Shuffle,
    title: "Adaptive Strategy Engine",
    body: "Nine strategies compete on every bar. Only the highest-probability one fires.",
    tone: "text-emerald-300",
    border: "border-emerald-300/20",
    glow: "bg-emerald-300/[0.07]",
  },
  {
    icon: Newspaper,
    title: "News Protection",
    body: "Automatically pauses before NFP, CPI, and FOMC events without any setup.",
    tone: "text-amber-200",
    border: "border-amber-300/20",
    glow: "bg-amber-300/[0.07]",
  },
  {
    icon: Lightning,
    title: "Auto Trade Execution",
    body: "Fully automated from signal to exit. No charts to watch, no manual trades.",
    tone: "text-rose-300",
    border: "border-rose-300/20",
    glow: "bg-rose-300/[0.07]",
  },
  {
    icon: CloudArrowUp,
    title: "Live Command Center",
    body: "Monitor AI decisions, equity, and trade status in real time from your phone.",
    tone: "text-teal-300",
    border: "border-teal-300/20",
    glow: "bg-teal-300/[0.07]",
  },
];

const TOTAL = CARDS.length;

export default function FeaturesSection() {
  const [index, setIndex] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const [animated, setAnimated] = useState(true);
  const trackRef = useRef(null);
  const containerRef = useRef(null);
  const touchStartX = useRef(null);

  const goTo = useCallback((raw) => {
    const next = ((raw % TOTAL) + TOTAL) % TOTAL;
    if (next === 0 && index === TOTAL - 1) {
      setAnimated(false);
      setIndex(0);
    } else {
      setAnimated(true);
      setIndex(next);
    }
  }, [index]);

  useEffect(() => {
    if (!animated) {
      const t = setTimeout(() => setAnimated(true), 40);
      return () => clearTimeout(t);
    }
  }, [animated]);

  useEffect(() => {
    const t = setTimeout(() => goTo(index + 1), 4200);
    return () => clearTimeout(t);
  }, [index, goTo]);

  useEffect(() => {
    const track = trackRef.current;
    const container = containerRef.current;
    if (!track || !container) return;
    const card = track.children[index];
    if (!card) return;
    const maxX = track.scrollWidth - container.offsetWidth;
    setTranslateX(Math.min(card.offsetLeft, Math.max(0, maxX)));
  }, [index]);

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 48) { setAnimated(true); goTo(index + (diff > 0 ? 1 : -1)); }
    touchStartX.current = null;
  };

  return (
    <div className="bg-[#060609] border-t border-white/[0.06]" data-testid="features-section">
      <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">

        <div className="mb-10 flex items-end justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
              Features
            </span>
            <h2 className="mt-4 max-w-lg font-heading text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Built for every market condition.
            </h2>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <button onClick={() => { setAnimated(true); goTo(index - 1); }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white">
              <CaretLeft size={15} weight="bold" />
            </button>
            <button onClick={() => { setAnimated(true); goTo(index + 1); }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white">
              <CaretRight size={15} weight="bold" />
            </button>
          </div>
        </div>

        <div ref={containerRef} className="overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div
            ref={trackRef}
            className="flex"
            style={{
              transform: `translateX(-${translateX}px)`,
              transition: animated ? "transform 0.52s cubic-bezier(0.4,0,0.2,1)" : "none",
            }}
          >
            {CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title}
                  className="flex-none w-full px-2 sm:w-1/2 lg:w-1/3">
                  <div className={`rounded-[24px] border ${card.border} ${card.glow} p-7 h-full`}>
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div className={`inline-flex h-11 w-11 flex-none items-center justify-center rounded-2xl border ${card.border} bg-black/20`}>
                        <Icon size={21} weight="duotone" className={card.tone} />
                      </div>
                      {card.badge && (
                        <span className={`mt-1 rounded-full border ${card.border} px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${card.tone}`}>
                          {card.badge}
                        </span>
                      )}
                    </div>
                    <h3 className="mb-2.5 font-heading text-[17px] font-semibold text-white">{card.title}</h3>
                    <p className="text-[13px] leading-6 text-white/52">{card.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-7 flex items-center justify-center gap-2">
          {CARDS.map((_, i) => (
            <button key={i} onClick={() => { setAnimated(true); goTo(i); }}
              className={`h-[5px] rounded-full transition-all duration-300 ${i === index ? "w-6 bg-amber-300" : "w-[5px] bg-white/20 hover:bg-white/35"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
