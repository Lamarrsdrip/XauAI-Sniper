import React from "react";
import { DownloadSimple, FileCode, Package, Warning } from "@phosphor-icons/react";

export default function DownloadSection({ api }) {
  return (
    <div className="bg-[#F8F9FA] border-t border-gray-100" data-testid="download-section">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-24">
        <div className="mb-12">
          <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-gray-400 bg-white border border-gray-200 px-3 py-1.5 rounded-full"><DownloadSimple size={12} weight="bold" className="inline mr-1" />DOWNLOAD CENTER</span>
          <h2 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight mt-6 text-[#111]" data-testid="download-title">Get the Expert Advisor</h2>
          <p className="text-gray-500 mt-2">Download v4.2.3 — Loss Armor + Runner Protection + 8 Setups.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
          <div className="bg-white border border-gray-200 rounded-3xl p-8 card-hover" data-testid="download-ea-card">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 bg-[#C5A059]/10 border border-[#C5A059]/20 rounded-2xl flex items-center justify-center"><FileCode size={22} weight="duotone" className="text-[#C5A059]" /></div>
              <div>
                <h3 className="font-heading text-lg font-medium text-[#111]">Expert Advisor (.mq5)</h3>
                <p className="text-sm text-gray-400 mt-1">v4.2.3 — Loss Armor + Momentum Runner Guard</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-5 text-[10px] font-mono text-gray-300 tracking-wide">
              <span>XAUUSD_AI_Sniper_EA.mq5</span><span>|</span><span>~82 KB</span><span>|</span><span>v4.2.3</span>
            </div>
            <a href={`${api}/download/ea`} data-testid="download-ea-button"
              className="inline-flex items-center gap-2 bg-[#111] text-white rounded-full px-6 py-3 font-semibold text-sm hover:bg-gray-800 transition-colors">
              <DownloadSimple size={16} weight="bold" /> DOWNLOAD .MQ5
            </a>
          </div>
          <div className="bg-white border border-gray-200 rounded-3xl p-8 card-hover" data-testid="download-package-card">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 bg-gray-100 border border-gray-200 rounded-2xl flex items-center justify-center"><Package size={22} weight="duotone" className="text-gray-400" /></div>
              <div>
                <h3 className="font-heading text-lg font-medium text-[#111]">Complete Package (.zip)</h3>
                <p className="text-sm text-gray-400 mt-1">Full bundle with docs and config templates</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-5 text-[10px] font-mono text-gray-300 tracking-wide">
              <span>AI_Sniper_EA_Package.zip</span><span>|</span><span>Complete Bundle</span>
            </div>
            <a href={`${api}/download/package`} data-testid="download-package-button"
              className="inline-flex items-center gap-2 bg-white text-[#111] border border-gray-200 rounded-full px-6 py-3 font-medium text-sm hover:border-gray-400 transition-colors">
              <DownloadSimple size={16} weight="bold" /> DOWNLOAD ZIP
            </a>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3" data-testid="download-warning">
          <Warning size={18} weight="fill" className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[#111] mb-1">Important Notice</p>
            <p className="text-sm text-gray-500 leading-relaxed">This EA is for educational and research purposes. Backtest thoroughly and start with a demo account. Trading involves significant risk.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
