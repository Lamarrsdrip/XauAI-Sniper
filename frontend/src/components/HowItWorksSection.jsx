import React from "react";
import { MagnifyingGlass, Funnel, Lightning } from "@phosphor-icons/react";

const STEPS = [
  {
    icon: MagnifyingGlass,
    title: "Choose",
    body: "Choose the 3-day exploration or purchase a one-time MT5 license after reviewing genuine results.",
  },
  {
    icon: Funnel,
    title: "Activate",
    body: "After approval, activate your license and install the verified MT5 Expert Advisor.",
  },
  {
    icon: Lightning,
    title: "Monitor & Manage",
    body: "Connect Command Center to monitor your bot and use risk controls while the EA executes according to its settings.",
  },
];

export default function HowItWorksSection() {
  return (
    <div className="bg-[#ffffff] border-t border-[#e5e3dd] text-[#1c3032]" data-testid="how-it-works-section">
      <div className="mx-auto max-w-6xl px-5 py-12 md:px-8 md:py-16">

        <div className="mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dccaa6] bg-[#f7f1e5] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#90713e]">
            How it works
          </span>
          <h2 className="mt-4 font-heading text-[1.85rem] font-semibold tracking-tight sm:text-[2.45rem]" data-testid="how-it-works-title">
            From access to execution, simply.
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="rounded-[24px] border border-[#e1e1db] bg-[#f8f8f4] p-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl border border-[#dccaa6] bg-[#f7f1e5]">
                  <Icon size={18} weight="duotone" className="text-[#90713e]" />
                </div>
                <span className="font-mono text-[11px] font-bold text-[#6c7776]">0{i + 1}</span>
              </div>
              <h3 className="mb-2 font-heading text-[16px] font-semibold text-[#1c3032]">{title}</h3>
              <p className="text-[13px] leading-6 text-[#6c7776]">{body}</p>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
