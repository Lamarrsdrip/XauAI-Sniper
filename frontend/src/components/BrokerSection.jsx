import React from "react";
import { Check, ArrowSquareOut, Gift } from "@phosphor-icons/react";

const TRADE_COM_REFERRAL = "https://join.trade.com/c/lp07/?lp=6&affid=1064237198";

export default function BrokerSection() {
  return (
    <div className="border-t border-white/[0.06]" data-testid="broker-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-20">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#D4AF37]/20 bg-[#D4AF37]/5 mb-4">
            <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#D4AF37]">
              OFFICIAL BROKER PARTNER
            </span>
          </div>
        </div>

        <div className="border border-white/[0.06] bg-[#0C0C0C] overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-5 items-stretch">
            <div className="lg:col-span-2 p-10 flex flex-col items-center justify-center text-center border-b lg:border-b-0 lg:border-r border-white/[0.06]">
              <div className="font-heading text-2xl font-semibold tracking-tight text-white mb-4">Trade.com</div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#00C853]/10 border border-[#00C853]/20 mb-3">
                <Gift size={16} weight="fill" className="text-[#00C853]" />
                <span className="font-mono text-lg font-black text-[#00C853]">75% DEPOSIT BONUS</span>
              </div>
              <p className="text-xs text-white/30">on every deposit through our partner link</p>
            </div>

            <div className="lg:col-span-3 p-10">
              <h3 className="font-heading text-xl font-medium tracking-tight mb-4 text-white" data-testid="broker-title">
                Trade with Trade.com
              </h3>
              <p className="text-sm text-white/40 mb-6 leading-relaxed max-w-lg">
                Create your MT5 account on Trade.com to use XauAI Sniper.
                Get a 75% bonus on every deposit. More capital = more profit potential.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
                {["75% bonus on all deposits", "MT5 platform supported", "Low spreads on XAUUSD", "Fast withdrawals", "Regulated broker", "24/7 support"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <Check size={14} weight="bold" className="text-[#00C853] flex-shrink-0" />
                    <span className="text-sm text-white/60">{f}</span>
                  </div>
                ))}
              </div>
              <a href={TRADE_COM_REFERRAL} target="_blank" rel="noopener noreferrer" data-testid="broker-signup-btn"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#D4AF37] text-black font-semibold text-sm tracking-wide hover:bg-white transition-colors duration-200">
                CREATE ACCOUNT <ArrowSquareOut size={16} weight="bold" />
              </a>
              <p className="text-[11px] text-white/20 mt-3">
                Already have a Trade.com account? XauAI Sniper works with any MT5 broker.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
