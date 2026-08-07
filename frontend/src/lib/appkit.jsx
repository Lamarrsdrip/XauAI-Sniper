// ── XauCloud AppKit ───────────────────────────────────────────────────────
// Exchange-class component vocabulary (Bybit/Binance-tier). Replaces the old
// card-wall system. Philosophy: FEW dense panels, each holding compact list
// rows / segmented modules / feeds — NOT many floating bordered cards. Numbers
// are inline and prominent, not boxed. Secondary detail drills down or opens
// in a sheet. Premium black + metallic gold, touch-first, high density.
import React, { useEffect } from "react";
import { ChevronRight, ChevronLeft, X } from "lucide-react";

export const cx = (...p) => p.filter(Boolean).join(" ");

const TONE_TEXT = { gold: "text-gold-300", profit: "text-profit", loss: "text-loss", muted: "text-white/45", white: "text-white", neutral: "text-white/80" };
export const toneText = (t) => TONE_TEXT[t] || "text-white";

const CHIP = {
  gold: "bg-gold-300/12 text-gold-300",
  profit: "bg-profit/14 text-profit",
  loss: "bg-loss/14 text-loss",
  info: "bg-sky-300/12 text-sky-200",
  neutral: "bg-white/[0.07] text-white/55",
};

const DOT = { gold: "bg-gold-300", profit: "bg-profit", loss: "bg-loss", neutral: "bg-white/40", info: "bg-sky-300" };

// ── Screen: vertical rhythm for a page (tight, exchange-like) ───────────────
export function Screen({ children, className = "" }) {
  return <div className={cx("space-y-2.5", className)}>{children}</div>;
}

// ── Drill-down screen header with native back ───────────────────────────────
export function ScreenHeader({ title, sub, onBack, right }) {
  return (
    <div className="flex items-center gap-1.5 pb-1">
      {onBack && (
        <button onClick={onBack} aria-label="Back" className="no-select -ml-1.5 rounded-full p-1.5 text-white/60 active:scale-90">
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[1.35rem] font-black leading-tight tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 truncate text-[12px] text-white/40">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// ── Section label (quiet, above a panel) ────────────────────────────────────
export function Label({ children, className = "" }) {
  return <div className={cx("px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/30", className)}>{children}</div>;
}

// ── Panel: the primary container. A single raised block that HOLDS rows /
//    modules. Fewer, bigger panels — not a wall of little cards. ─────────────
export function Panel({ children, className = "", pad = false }) {
  return <div className={cx("overflow-hidden rounded-2xl bg-[#0C0D12]", pad && "p-4", className)}>{children}</div>;
}

// Panel header strip (title + optional action / "see all")
export function PanelHead({ title, right, onMore, moreLabel = "All" }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pb-1.5 pt-3">
      <span className="text-[13px] font-semibold text-white/85">{title}</span>
      {right || (onMore && (
        <button onClick={onMore} className="no-select inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-white/40 active:text-white/70">
          {moreLabel} <ChevronRight className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

// ── Row: dense list row. Label left, value right; optional sub, leading, tap.
export function Row({ label, value, sub, valueTone, leading, onClick, last = false, right, className = "" }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cx("flex w-full items-center gap-3 px-4 py-3 text-left", !last && "border-b border-white/[0.05]", onClick && "no-select active:bg-white/[0.03]", className)}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium text-white/85">{label}</div>
        {sub && <div className="mt-0.5 truncate text-[11.5px] text-white/40">{sub}</div>}
      </div>
      {value !== undefined && <div className={cx("nums flex-none text-[13.5px] font-semibold", toneText(valueTone))}>{value}</div>}
      {right}
      {onClick && <ChevronRight className="h-4 w-4 flex-none text-white/25" />}
    </Comp>
  );
}

// ── KeyValue: two inline figures side by side (equity / P&L header block) ────
export function BigStat({ label, value, tone, sub, className = "" }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/35">{label}</div>
      <div className={cx("nums mt-1 text-[1.55rem] font-black leading-none tracking-tight", toneText(tone))}>{value}</div>
      {sub && <div className="mt-1 truncate text-[11px] text-white/40">{sub}</div>}
    </div>
  );
}

// Small inline metric (label over value), for dense stat rows — not a boxed tile
export function Stat({ label, value, tone, className = "" }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="truncate text-[10.5px] uppercase tracking-wider text-white/35">{label}</div>
      <div className={cx("nums mt-0.5 truncate text-[14px] font-bold", toneText(tone))}>{value}</div>
    </div>
  );
}

// ── Chip: compact inline status/stat ────────────────────────────────────────
export function Chip({ children, tone = "neutral", icon: Icon, className = "" }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", CHIP[tone] || CHIP.neutral, className)}>
      {Icon && <Icon className="h-3 w-3" />}{children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse = false, className = "" }) {
  return (
    <span className={cx("relative inline-flex h-2 w-2 flex-none rounded-full", DOT[tone] || DOT.neutral, className)}>
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", DOT[tone] || DOT.neutral)} />}
    </span>
  );
}

// ── Segmented control: in-screen tabs / period selector ─────────────────────
export function SegTabs({ tabs, value, onChange, className = "" }) {
  return (
    <div className={cx("no-select flex rounded-xl bg-white/[0.05] p-0.5", className)}>
      {tabs.map((t) => {
        const val = typeof t === "string" ? t : t.value;
        const lbl = typeof t === "string" ? t : t.label;
        const active = val === value;
        return (
          <button key={val} onClick={() => onChange(val)}
            className={cx("flex-1 rounded-[9px] px-2 py-1.5 text-[12px] font-semibold transition-all", active ? "bg-gold-300 text-black" : "text-white/50 active:text-white")}>
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

// ── Event feed (timeline) ───────────────────────────────────────────────────
export function FeedItem({ time, title, detail, tone, onClick, last = false }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cx("flex w-full gap-3 px-4 py-2.5 text-left", onClick && "no-select active:bg-white/[0.03]")}>
      <div className="nums w-12 flex-none pt-0.5 text-[11px] text-white/35">{time}</div>
      <div className={cx("min-w-0 flex-1 border-l border-white/[0.07] pl-3", !last && "pb-0.5")}>
        <div className={cx("text-[13px] font-semibold", toneText(tone))}>{title}</div>
        {detail && <div className="mt-0.5 text-[12px] leading-4 text-white/45">{detail}</div>}
      </div>
      {onClick && <ChevronRight className="h-4 w-4 flex-none self-center text-white/20" />}
    </Comp>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────
const BTN = {
  primary: "bg-gold-300 text-black active:bg-gold-400",
  dark: "bg-white/[0.07] text-white active:bg-white/[0.12]",
  outline: "border border-white/[0.12] text-white/85 active:bg-white/[0.05]",
  profit: "bg-profit text-black",
  loss: "bg-loss text-black",
  ghost: "text-white/60 active:text-white",
};
export function Button({ variant = "primary", size = "md", className = "", children, ...props }) {
  const sizes = { sm: "px-3 py-1.5 text-[12px]", md: "px-4 py-2.5 text-[13px]", lg: "w-full px-5 py-3.5 text-[14px]" };
  return (
    <button {...props} className={cx("no-select inline-flex items-center justify-center gap-1.5 rounded-xl font-bold transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none", BTN[variant] || BTN.primary, sizes[size] || sizes.md, className)}>
      {children}
    </button>
  );
}

// ── Bottom sheet ────────────────────────────────────────────────────────────
export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/75 backdrop-blur-md animate-fade-in sm:items-center" onClick={onClose}>
      <div className="w-full rounded-t-[26px] bg-[#0C0D12] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-sheet-up sm:max-w-md sm:rounded-[26px] sm:pb-4" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-3 h-1 w-9 rounded-full bg-white/15 sm:hidden" />
        {title && (
          <div className="flex items-center justify-between px-5 pb-1 pt-3">
            <h3 className="text-[16px] font-bold">{title}</h3>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/40 active:text-white"><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="px-5 pt-2">{children}</div>
      </div>
    </div>
  );
}

// ── Empty state (quiet inline, not a boxed card) ────────────────────────────
export function Empty({ icon: Icon, title, body, action, className = "" }) {
  return (
    <div className={cx("px-4 py-8 text-center", className)}>
      {Icon && <Icon className="mx-auto mb-2.5 h-6 w-6 text-white/25" />}
      <div className="text-[13.5px] font-semibold text-white/70">{title}</div>
      {body && <p className="mx-auto mt-1.5 max-w-[16rem] text-[12px] leading-5 text-white/38">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Progressive disclosure (Technical details) ──────────────────────────────
export function Reveal({ label = "Details", children, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="no-select inline-flex items-center gap-1 text-[11.5px] font-semibold text-white/40 active:text-white/70">
        <ChevronRight className={cx("h-3.5 w-3.5 transition-transform", open && "rotate-90")} /> {label}
      </button>
      {open && <div className="mt-2 text-[12px] leading-5 text-white/55">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={cx("animate-pulse rounded-lg bg-white/[0.05]", className)} />;
}
