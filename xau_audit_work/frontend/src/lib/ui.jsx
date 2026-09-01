// ── XauCloud design system ────────────────────────────────────────────────
// One source of truth for the app's visual language: deep-black surfaces,
// refined metallic gold (gold-300) for brand/active/actions, green for
// profit, red for loss. Compact by default — premium ≠ oversized. Every
// customer + admin screen imports its primitives from here so the app reads
// as one coherent native application, not 15 unrelated card designs.
//
// Depends on the `gold` / `ink` / `panel` colors and `sheet-up|fade-in|
// scale-in` animations added to tailwind.config.js, and the safe-area/native
// utilities in index.css.
import React, { useEffect } from "react";
import { ChevronRight, X } from "lucide-react";

// classnames helper — filters falsy so `cx("a", cond && "b")` is clean.
export const cx = (...parts) => parts.filter(Boolean).join(" ");

// ── Raw token strings (for bespoke layouts that can't use a primitive) ──────
export const T = {
  page:      "bg-ink text-white",
  card:      "rounded-2xl border border-white/[0.07] bg-panel",
  cardInset: "rounded-xl border border-white/[0.06] bg-white/[0.02]",
  label:     "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35",
  hair:      "border-white/[0.07]",
  gold:      "text-gold-300",
  muted:     "text-white/45",
  faint:     "text-white/30",
};

// Tone → tint classes. gold = brand/attention, profit/loss = P&L, neutral =
// quiet, info = informational, warn = needs-attention (soft gold, not muddy).
const TONE = {
  gold:    { pill: "bg-gold-300/12 text-gold-300 border-gold-300/25", tint: "border-gold-300/18 bg-gold-300/[0.06]", dot: "bg-gold-300" },
  profit:  { pill: "bg-profit/12 text-profit border-profit/25",       tint: "border-profit/18 bg-profit/[0.06]",     dot: "bg-profit"  },
  loss:    { pill: "bg-loss/12 text-loss border-loss/25",             tint: "border-loss/18 bg-loss/[0.06]",         dot: "bg-loss"    },
  info:    { pill: "bg-sky-300/12 text-sky-200 border-sky-300/25",    tint: "border-sky-300/18 bg-sky-300/[0.06]",   dot: "bg-sky-300" },
  warn:    { pill: "bg-gold-300/10 text-gold-200 border-gold-300/20", tint: "border-gold-300/15 bg-gold-300/[0.05]", dot: "bg-gold-200"},
  neutral: { pill: "bg-white/[0.06] text-white/55 border-white/[0.08]",tint:"border-white/[0.07] bg-panel",          dot: "bg-white/40"},
};
export const tone = (t) => TONE[t] || TONE.neutral;

// ── Small type helpers ──────────────────────────────────────────────────────
export function SectionLabel({ children, className = "" }) {
  return <div className={cx(T.label, className)}>{children}</div>;
}

// ── Status dot: connection / bot state at a glance ──────────────────────────
export function StatusDot({ tone: t = "neutral", pulse = false, className = "" }) {
  return (
    <span className={cx("relative inline-flex h-2 w-2 flex-none rounded-full", tone(t).dot, className)}>
      {pulse && <span className={cx("absolute inset-0 rounded-full opacity-60 animate-ping", tone(t).dot)} />}
    </span>
  );
}

// ── Pill / badge ────────────────────────────────────────────────────────────
export function Pill({ tone: t = "neutral", children, className = "" }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold", tone(t).pill, className)}>
      {children}
    </span>
  );
}

// ── Card: the standard compact surface ──────────────────────────────────────
// `tone` tints the whole card for emphasis (e.g. an active position). Header
// is optional; body padding is compact (px-4 py-3.5) — not the old 300px boxes.
export function Card({ title, subtitle, action, tone: t, children, className = "", bodyClassName = "" }) {
  const surface = t ? cx("rounded-2xl border", tone(t).tint) : T.card;
  return (
    <section className={cx(surface, "overflow-hidden", className)}>
      {(title || action) && (
        <div className={cx("flex items-start justify-between gap-3 border-b px-4 py-3", T.hair)}>
          <div className="min-w-0">
            {title && <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11.5px] leading-4 text-white/42">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cx("px-4 py-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

// ── Metric: a single compact figure. Dense — never 250px tall for one number.
export function Metric({ label, value, sub, icon: Icon, tone: t }) {
  const tint = t ? tone(t).tint : cx("border", T.hair, "bg-panel");
  return (
    <div className={cx("rounded-xl border p-3 min-w-0 overflow-hidden", tint)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={T.label}>{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5 opacity-35" />}
      </div>
      <div className="nums break-words text-[1.15rem] font-black leading-none tracking-tight">{value}</div>
      {sub && <div className="mt-1 break-words text-[11px] leading-4 text-white/40">{sub}</div>}
    </div>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
const BTN = {
  primary:   "bg-gold-300 text-black hover:bg-gold-200",
  secondary: "border border-white/[0.09] bg-white/[0.04] text-white/80 hover:text-white hover:bg-white/[0.07]",
  ghost:     "text-white/55 hover:text-white",
  danger:    "bg-loss text-black hover:brightness-110",
  profit:    "bg-profit text-black hover:brightness-110",
};
export function Button({ variant = "primary", size = "md", className = "", children, ...props }) {
  const sizes = { sm: "px-3 py-1.5 text-[11px]", md: "px-4 py-2.5 text-[13px]", lg: "px-5 py-3 text-[14px]" };
  return (
    <button
      {...props}
      className={cx(
        "no-select inline-flex items-center justify-center gap-1.5 rounded-xl font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
        BTN[variant] || BTN.primary, sizes[size] || sizes.md, className,
      )}
    >
      {children}
    </button>
  );
}

// ── ListRow: native settings-style row with a chevron (for More/Account/etc.)
export function ListRow({ icon: Icon, label, sub, value, tone: t = "neutral", onClick, trailing, last = false }) {
  const clickable = Boolean(onClick);
  return (
    <button
      type={clickable ? "button" : undefined}
      onClick={onClick}
      disabled={!clickable}
      className={cx(
        "no-select flex w-full items-center gap-3 px-4 py-3 text-left transition",
        !last && "border-b border-white/[0.06]",
        clickable && "hover:bg-white/[0.03] active:bg-white/[0.05]",
      )}
    >
      {Icon && (
        <span className={cx("flex-none rounded-xl border p-2", "border-white/[0.07] bg-white/[0.03]")}>
          <Icon className={cx("h-4 w-4", t === "neutral" ? "text-white/55" : tone(t).pill.split(" ")[1])} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{label}</span>
        {sub && <span className="mt-0.5 block truncate text-[11.5px] text-white/38">{sub}</span>}
      </span>
      {value !== undefined && <span className="nums flex-none text-[13px] text-white/50">{value}</span>}
      {trailing}
      {clickable && <ChevronRight className="h-4 w-4 flex-none text-white/25" />}
    </button>
  );
}

// A grouped list container — rounded card wrapping ListRows with a header label.
export function ListGroup({ label, children, className = "" }) {
  return (
    <div className={className}>
      {label && <SectionLabel className="mb-2 px-1">{label}</SectionLabel>}
      <div className={cx(T.card, "overflow-hidden")}>{children}</div>
    </div>
  );
}

// ── Segmented control (period / filter selectors) ───────────────────────────
export function Segmented({ options, value, onChange, className = "" }) {
  return (
    <div className={cx("no-select inline-flex rounded-xl border border-white/[0.07] bg-white/[0.03] p-0.5", className)}>
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const lbl = typeof o === "string" ? o : o.label;
        const active = val === value;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={cx(
              "rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition-all",
              active ? "bg-gold-300 text-black" : "text-white/50 hover:text-white/80",
            )}
          >
            {lbl}
          </button>
        );
      })}
    </div>
  );
}

// ── Bottom sheet (native modal for actions/details/confirmations) ───────────
export function Sheet({ open, onClose, title, children, maxWidth = "max-w-md" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 backdrop-blur-md animate-fade-in sm:items-center" onClick={onClose}>
      <div
        className={cx(
          "w-full rounded-t-[28px] border border-white/[0.09] bg-panel shadow-2xl animate-sheet-up sm:rounded-[28px]",
          "pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5", maxWidth,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-3 mb-1 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
        {title && (
          <div className="flex items-center justify-between px-5 pb-2 pt-3">
            <h3 className="text-[16px] font-bold">{title}</h3>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/40 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="px-5 pt-1">{children}</div>
      </div>
    </div>
  );
}

// ── Empty state — quiet, explains what's happening (never a giant blank box) ─
export function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/20 px-6 py-8 text-center">
      {Icon && <Icon className="mx-auto mb-3 h-6 w-6 text-gold-300/55" />}
      <div className="text-[14px] font-semibold">{title}</div>
      {body && <p className="mx-auto mt-1.5 max-w-xs text-[12px] leading-5 text-white/38">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Skeleton (loading) — no flashing, no layout shift ───────────────────────
export function Skeleton({ className = "" }) {
  return <div className={cx("animate-pulse rounded-lg bg-white/[0.05]", className)} />;
}

// ── Expandable "Technical details" disclosure (progressive disclosure) ──────
export function Disclosure({ label = "Technical details", children, defaultOpen = false }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/40 hover:text-white/70">
        <ChevronRight className={cx("h-3 w-3 transition-transform", open && "rotate-90")} /> {label}
      </button>
      {open && <div className="mt-2 rounded-xl border border-white/[0.06] bg-black/25 p-3 text-[11.5px] leading-5 text-white/55">{children}</div>}
    </div>
  );
}
