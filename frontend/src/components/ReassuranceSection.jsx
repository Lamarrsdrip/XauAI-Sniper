import React from "react";
import { Desktop, LockKey, Headset, ArrowSquareOut, Infinity as InfinityIcon, Warning } from "@phosphor-icons/react";

const BROKER_REF = "https://join.trade.com/c/lp07/?lp=6&affid=1064237198";

const POINTS = [
  { icon: Desktop, text: "Runs inside your own MetaTrader 5 — a standalone build, nothing shared." },
  { icon: LockKey, text: "No customer API key required. You keep full control of your broker account." },
  { icon: Headset, text: "Free VPS activation and WhatsApp support included after purchase." },
  { icon: InfinityIcon, text: "Lifetime license — future updates included, no recurring fee." },
];

export default function ReassuranceSection() {
  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="reassurance-section">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">

        <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.03] p-6 md:p-8">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Straightforward, by design.
          </h2>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {POINTS.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3">
                <Icon size={17} weight="duotone" className="mt-0.5 flex-none text-amber-300" />
                <span className="text-[13px] leading-6 text-white/60">{text}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] px-5 py-4 sm:flex-row sm:items-center" data-testid="broker-section">
            <span className="text-[13px] text-white/60">Need an MT5 broker? Trade.com works well with XauCloud.</span>
            <a href={BROKER_REF} target="_blank" rel="noopener noreferrer" data-testid="broker-signup-btn"
              className="inline-flex flex-none items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-[12px] font-bold text-emerald-200 transition hover:bg-emerald-300/15">
              Open Account <ArrowSquareOut size={13} weight="bold" />
            </a>
          </div>

          <div className="mt-4 flex items-start gap-2.5 text-[11px] leading-5 text-white/30">
            <Warning size={13} weight="fill" className="mt-0.5 flex-none" />
            <span>Trade.com link is an affiliate link. Trading losses remain possible — no system can guarantee profit.</span>
          </div>
        </div>

      </div>
    </div>
  );
}
