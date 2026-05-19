import React from "react";
import { DownloadSimple, FileCode, Package, Warning, ShieldCheck, CloudArrowUp } from "@phosphor-icons/react";

export default function DownloadSection({ api }) {
  return (
    <div className="bg-[#07090d] text-white" data-testid="download-section">
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
        <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
              <DownloadSimple size={12} weight="bold" /> Download center
            </span>
            <h2 className="mt-5 max-w-3xl font-heading text-3xl font-semibold tracking-tight sm:text-5xl" data-testid="download-title">
              Latest master build: v5.8.25 Fast Volkill Fix.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58">
              This is the current build from this workspace. Public downloads are sanitized by the backend for customer safety; admin master download remains protected.
            </p>
          </div>
          <a href="/cloud" className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-5 py-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-300/15">
            <CloudArrowUp size={16} weight="bold" /> Use cloud copy
          </a>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/20 md:p-7" data-testid="download-ea-card">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-4">
                <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10">
                  <FileCode size={25} weight="duotone" className="text-amber-200" />
                </div>
                <div>
                  <h3 className="font-heading text-2xl font-semibold">Expert Advisor (.mq5)</h3>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
                    Includes v5.8.25 fast volkill fix, smart pyramid/rescue adds, adaptive XAU confirmation, stale-indicator recovery, live scan watchdogs, partial-close sync, adaptive daily caps, account-size scaling, profit-only basket locking, staged de-risk, and wider runner management.
                  </p>
                </div>
              </div>
              <span className="inline-flex w-fit rounded-full bg-emerald-300 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#06110c]">Current</span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Version", "5.8.25"],
                ["File", "MQ5 source"],
                ["Risk", "Account-sized"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-white/10 bg-black/[0.24] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">{k}</div>
                  <div className="mt-1 font-mono text-sm font-bold">{v}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href={`${api}/download/ea`} data-testid="download-ea-button" className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-6 py-3.5 text-sm font-extrabold text-black transition hover:bg-amber-200">
                <DownloadSimple size={17} weight="bold" /> Download v5.8.25 .MQ5
              </a>
              <a href="/cloud" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.1]">
                Cloud setup
              </a>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-5 md:p-7" data-testid="download-package-card">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-300/10">
                <Package size={24} weight="duotone" className="text-sky-200" />
              </div>
              <div>
                <h3 className="font-heading text-xl font-semibold">Complete package</h3>
                <p className="mt-2 text-sm leading-6 text-white/55">EA bundle with the code package used by the backend download center.</p>
              </div>
            </div>
            <a href={`${api}/download/package`} data-testid="download-package-button" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.1]">
              <DownloadSimple size={17} weight="bold" /> Download ZIP
            </a>

            <div className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.08] p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-200">
                <ShieldCheck size={18} weight="fill" /> Safer by design
              </div>
              <p className="text-sm leading-6 text-white/56">
                The customer endpoint strips cloud-master fanout settings before download. Use the admin portal only for protected master files.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4" data-testid="download-warning">
          <div className="flex items-start gap-3">
            <Warning size={19} weight="fill" className="mt-0.5 flex-none text-amber-200" />
            <p className="text-sm leading-6 text-white/62">
              Backtest before live use. This tool can improve discipline and risk control, but no trading system can guarantee profit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
