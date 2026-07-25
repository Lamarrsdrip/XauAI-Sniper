import React from "react";
import { Target, Robot, Scales, ProhibitInset } from "@phosphor-icons/react";

const FACTS = [
  { icon: Target, label: "Built exclusively for XAUUSD" },
  { icon: Robot, label: "Fully automated execution" },
  { icon: Scales, label: "Account-relative risk sizing" },
  { icon: ProhibitInset, label: "No grid or martingale" },
];

export default function TrustStrip() {
  return (
    <div className="bg-[#060609] border-t border-white/[0.06]" data-testid="trust-strip">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {FACTS.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
              <Icon size={16} weight="duotone" className="flex-none text-amber-300" />
              <span className="text-[12px] font-medium leading-4 text-white/65">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
