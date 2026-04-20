import React from "react";
import { DownloadSimple, FileCode, Package, Warning } from "@phosphor-icons/react";

export default function DownloadSection({ api }) {
  return (
    <div className="border-t border-white/[0.06]" data-testid="download-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-24">
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] bg-white/[0.03] mb-4">
            <DownloadSimple size={12} weight="duotone" className="text-[#D4AF37]" />
            <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-white/40">DOWNLOAD CENTER</span>
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl font-medium tracking-tight text-white" data-testid="download-title">Get the Expert Advisor</h2>
          <p className="text-white/40 mt-2 max-w-2xl">Download the complete MQL5 Expert Advisor package for MetaTrader 5.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-white/[0.06] mb-10">
          <div className="bg-[#0E1118] p-8" data-testid="download-ea-card">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 border border-[#D4AF37]/20 bg-[#D4AF37]/5 flex items-center justify-center flex-shrink-0">
                <FileCode size={22} weight="duotone" className="text-[#D4AF37]" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-medium text-white">Expert Advisor (.mq5)</h3>
                <p className="text-sm text-white/35 mt-1">v3.1 Smart — GPT-5.2 AI + ML + News Filter. Ready to compile.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-5 text-[10px] font-mono text-white/20 tracking-wide">
              <span>XAUUSD_AI_Sniper_EA.mq5</span>
              <span className="text-white/10">|</span>
              <span>~35 KB</span>
              <span className="text-white/10">|</span>
              <span>v3.1</span>
            </div>
            <a href={`${api}/download/ea`} data-testid="download-ea-button"
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#D4AF37] text-black font-semibold text-sm tracking-wide hover:bg-white transition-colors duration-200">
              <DownloadSimple size={16} weight="bold" /> DOWNLOAD .MQ5
            </a>
          </div>
          <div className="bg-[#0E1118] p-8" data-testid="download-package-card">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 border border-white/[0.08] bg-white/[0.03] flex items-center justify-center flex-shrink-0">
                <Package size={22} weight="duotone" className="text-white/40" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-medium text-white">Complete Package (.zip)</h3>
                <p className="text-sm text-white/35 mt-1">Full bundle with docs and config templates.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-5 text-[10px] font-mono text-white/20 tracking-wide">
              <span>AI_Sniper_EA_Package.zip</span>
              <span className="text-white/10">|</span>
              <span>Complete Bundle</span>
            </div>
            <a href={`${api}/download/package`} data-testid="download-package-button"
              className="inline-flex items-center gap-2 px-6 py-3 border border-white/[0.1] text-white/70 font-medium text-sm tracking-wide hover:border-[#D4AF37] hover:text-[#D4AF37] transition-all duration-200">
              <DownloadSimple size={16} weight="bold" /> DOWNLOAD ZIP
            </a>
          </div>
        </div>

        <div className="border border-[#D4AF37]/20 bg-[#D4AF37]/[0.03] p-5 flex items-start gap-3" data-testid="download-warning">
          <Warning size={18} weight="fill" className="text-[#D4AF37] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-white/80 mb-1">Important Notice</p>
            <p className="text-sm text-white/35 leading-relaxed">
              This EA is for educational and research purposes. Backtest thoroughly and start with a demo account.
              Trading involves significant risk. Past performance does not guarantee future results.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
