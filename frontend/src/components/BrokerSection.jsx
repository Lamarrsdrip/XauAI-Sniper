import React from "react";
import { ArrowSquareOut, Gift } from "@phosphor-icons/react";

const REF = "https://join.trade.com/c/lp07/?lp=6&affid=1064237198";

export default function BrokerSection() {
  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="broker-section">
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-8">

        <div className="flex flex-col items-center justify-between gap-6 rounded-[28px] border border-emerald-300/15 bg-emerald-300/[0.05] px-8 py-9 sm:flex-row">
          <div className="flex items-center gap-5">
            <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-300/10">
              <Gift size={24} weight="duotone" className="text-emerald-300" />
            </div>
            <div>
              <div className="font-heading text-lg font-semibold">Trade.com — Official Partner</div>
              <div className="mt-0.5 text-sm text-white/45">
                Open an MT5 account and get a <span className="font-bold text-emerald-300">75% deposit bonus</span> on every deposit.
              </div>
            </div>
          </div>
          <a href={REF} target="_blank" rel="noopener noreferrer" data-testid="broker-signup-btn"
            className="inline-flex flex-none items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-5 py-2.5 text-sm font-bold text-emerald-200 transition hover:bg-emerald-300/15">
            Open Account <ArrowSquareOut size={14} weight="bold" />
          </a>
        </div>

      </div>
    </div>
  );
}
