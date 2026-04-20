import React from "react";
import { Check, ArrowSquareOut, Gift } from "@phosphor-icons/react";
const REF = "https://join.trade.com/c/lp07/?lp=6&affid=1064237198";

export default function BrokerSection() {
  return (
    <div className="border-t border-gray-100" data-testid="broker-section">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-24">
        <div className="text-center mb-10">
          <span className="text-[10px] font-mono font-bold tracking-[0.2em] text-[#C5A059] bg-[#C5A059]/10 border border-[#C5A059]/20 px-3 py-1.5 rounded-full">OFFICIAL BROKER PARTNER</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="grid grid-cols-1 lg:grid-cols-5">
            <div className="lg:col-span-2 p-10 flex flex-col items-center justify-center text-center border-b lg:border-b-0 lg:border-r border-gray-100">
              <div className="font-heading text-2xl font-semibold text-[#111] mb-4">Trade.com</div>
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 border border-emerald-200 rounded-full mb-3">
                <Gift size={16} weight="fill" className="text-emerald-600" />
                <span className="font-mono text-lg font-black text-emerald-600">75% DEPOSIT BONUS</span>
              </div>
              <p className="text-xs text-gray-400">on every deposit through our partner link</p>
            </div>
            <div className="lg:col-span-3 p-10">
              <h3 className="font-heading text-xl font-medium text-[#111] mb-4" data-testid="broker-title">Trade with Trade.com</h3>
              <p className="text-sm text-gray-500 mb-6 leading-relaxed max-w-lg">Create your MT5 account on Trade.com to use XauAI Sniper. Get a 75% bonus on every deposit.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
                {["75% bonus on all deposits", "MT5 platform supported", "Low spreads on XAUUSD", "Fast withdrawals", "Regulated broker", "24/7 support"].map((f) => (
                  <div key={f} className="flex items-center gap-2">
                    <Check size={14} weight="bold" className="text-emerald-500 flex-shrink-0" />
                    <span className="text-sm text-gray-600">{f}</span>
                  </div>
                ))}
              </div>
              <a href={REF} target="_blank" rel="noopener noreferrer" data-testid="broker-signup-btn"
                className="inline-flex items-center gap-2 bg-[#111] text-white rounded-full px-6 py-3 font-semibold text-sm hover:bg-gray-800 transition-colors">
                CREATE ACCOUNT <ArrowSquareOut size={16} weight="bold" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
