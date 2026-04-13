import React from "react";
import { DownloadSimple, FileCode, Package, Warning } from "@phosphor-icons/react";

export default function DownloadSection({ api }) {
  return (
    <div
      className="bg-muted/30 border-t border-border"
      data-testid="download-section"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-4">
            <DownloadSimple size={12} weight="bold" />
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
              DOWNLOAD CENTER
            </span>
          </div>
          <h2
            className="font-heading text-2xl sm:text-3xl font-bold tracking-tight"
            data-testid="download-title"
          >
            Get the Expert Advisor
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Download the complete MQL5 Expert Advisor package ready for
            MetaTrader 5.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* EA File */}
          <div className="border border-border bg-card p-6" data-testid="download-ea-card">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 bg-primary/10 flex items-center justify-center flex-shrink-0">
                <FileCode size={24} weight="duotone" className="text-primary" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-semibold">
                  Expert Advisor (.mq5)
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Complete MQL5 source code for the AI Sniper EA. Ready to
                  compile in MetaEditor.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-4 text-xs font-mono text-muted-foreground">
              <span>XAUUSD_AI_Sniper_EA.mq5</span>
              <span className="text-border">|</span>
              <span>~25 KB</span>
              <span className="text-border">|</span>
              <span>v2.0</span>
            </div>
            <a
              href={`${api}/download/ea`}
              data-testid="download-ea-button"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold text-sm tracking-wide hover:-translate-y-[1px] transition-transform duration-150 shadow-[2px_2px_0px_hsl(0,0%,4%)]"
            >
              <DownloadSimple size={16} weight="bold" />
              DOWNLOAD .MQ5 FILE
            </a>
          </div>

          {/* Full Package */}
          <div className="border border-border bg-card p-6" data-testid="download-package-card">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Package size={24} weight="duotone" className="text-primary" />
              </div>
              <div>
                <h3 className="font-heading text-lg font-semibold">
                  Complete Package (.zip)
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Full package including EA source, documentation, and
                  configuration templates.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-4 text-xs font-mono text-muted-foreground">
              <span>AI_Sniper_EA_Package.zip</span>
              <span className="text-border">|</span>
              <span>Complete Bundle</span>
            </div>
            <a
              href={`${api}/download/package`}
              data-testid="download-package-button"
              className="inline-flex items-center gap-2 px-6 py-3 border border-border text-foreground font-bold text-sm tracking-wide hover:border-foreground hover:-translate-y-[1px] transition-all duration-150"
            >
              <DownloadSimple size={16} weight="bold" />
              DOWNLOAD ZIP PACKAGE
            </a>
          </div>
        </div>

        {/* Warning notice */}
        <div className="border border-[hsl(43,74%,49%)] bg-[hsl(43,74%,49%)]/5 p-4 flex items-start gap-3" data-testid="download-warning">
          <Warning size={18} weight="fill" className="text-primary flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground mb-1">
              Important Notice
            </p>
            <p className="text-sm text-muted-foreground">
              This Expert Advisor is provided for educational and research
              purposes. Always backtest thoroughly and start with a demo account.
              Trading involves significant risk of loss. Past performance does
              not guarantee future results.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
