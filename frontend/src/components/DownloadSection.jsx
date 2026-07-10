import React, { useEffect, useState } from "react";
import { DownloadSimple, FileCode, Package, Warning, ShieldCheck, CloudArrowUp, Spinner, CheckCircle, ChartLineUp } from "@phosphor-icons/react";

export default function DownloadSection({ api }) {
  const [info, setInfo]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [xiInfo, setXiInfo]     = useState(null);
  const [xiLoading, setXiLoading] = useState(true);

  useEffect(() => {
    fetch(`${api}/download/info`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setInfo(d); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`${api}/download/xauindex/info`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setXiInfo(d); setXiLoading(false); })
      .catch(() => setXiLoading(false));
  }, [api]);

  const version  = info?.version  || "v6.20.6";
  const edition  = info?.edition  || "RECOVERED TRADE EXPANSION MANAGER";
  const filename = info?.filename || "XAUUSD_AI_Sniper_EA_v6.20.6.mq5";
  const sizeKb   = info?.size_kb;
  const checksum = info?.checksum_sha256_12;

  return (
    <div className="bg-[#07090d] text-white" data-testid="download-section">
      <div className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">

        {/* Header */}
        <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-200">
              <DownloadSimple size={12} weight="bold" /> Download center
            </span>
            <h2 className="mt-5 max-w-3xl font-heading text-3xl font-semibold tracking-tight sm:text-5xl" data-testid="download-title">
              {loading
                ? "Loading latest build…"
                : `Latest release: ${version} — ${edition}.`}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58">
              Customer downloads are automatically sanitized — cloud fanout and operator tokens are stripped. The file you download runs fully standalone on your MT5.
            </p>
            <p className="mt-3 max-w-2xl rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-[12px] leading-5 text-white/45">
              <span className="font-semibold text-amber-200">Gold-only v6.20.6.</span> Adds Counter-Excursion Capture — a separately-owned tactical strategy that reacts to genuinely blocked signals with real immediate opposite-direction pressure, off by default. Recovered trades that survived deep MAE still protect the recovery and hold for meaningful own-R while structure and momentum remain valid.
            </p>
          </div>
          <a href="/command" className="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-5 py-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-300/15">
            <CloudArrowUp size={16} weight="bold" /> Open Command Center
          </a>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.08fr_0.92fr]">

          {/* Primary EA card */}
          <div className="rounded-[28px] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/20 md:p-7" data-testid="download-ea-card">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-4">
                <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10">
                  <FileCode size={25} weight="duotone" className="text-amber-200" />
                </div>
                <div>
                  <h3 className="font-heading text-2xl font-semibold">Expert Advisor (.mq5)</h3>
                  {loading
                    ? <p className="mt-2 flex items-center gap-2 text-sm text-white/40"><Spinner size={13} className="animate-spin" /> Fetching release info…</p>
                    : <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
                        {version} · {edition}. Dual AI (Claude + GPT) advises trade quality, while Trade Mode decides how strict blockers should be. Trade Thesis Monitor scores open positions live every candle — exits when the original reason is gone, not when a timer runs out.
                      </p>}
                </div>
              </div>
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-300 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#06110c]">
                <CheckCircle size={10} weight="fill" /> Stable
              </span>
            </div>

            {/* Release metadata */}
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Version", loading ? "—" : version],
                ["Size",    loading ? "—" : sizeKb ? `${sizeKb} KB` : "MQ5 source"],
                ["SHA-256", loading ? "—" : checksum ? checksum : "—"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-white/10 bg-black/[0.24] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">{k}</div>
                  <div className="mt-1 truncate font-mono text-sm font-bold" title={v}>{v}</div>
                </div>
              ))}
            </div>

            {/* Filename display */}
            {!loading && filename && (
              <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 px-4 py-2.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">Filename · </span>
                <span className="font-mono text-[11px] text-white/55 break-all">{filename}</span>
              </div>
            )}

            {/* Download buttons */}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href={`${api}/download/ea`} data-testid="download-ea-button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-6 py-3.5 text-sm font-extrabold text-black transition hover:bg-amber-200">
                <DownloadSimple size={17} weight="bold" />
                {loading ? "Download .MQ5" : `Download ${version} .MQ5`}
              </a>
              <a href="/command"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.1]">
                Command setup
              </a>
            </div>
          </div>

          {/* Package card */}
          <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-5 md:p-7" data-testid="download-package-card">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-300/10">
                <Package size={24} weight="duotone" className="text-sky-200" />
              </div>
              <div>
                <h3 className="font-heading text-xl font-semibold">Complete package</h3>
                <p className="mt-2 text-sm leading-6 text-white/55">
                  {loading ? "Loading…" : `${version} EA bundle as a ZIP. Includes the .mq5 and supporting files.`}
                </p>
              </div>
            </div>
            <a href={`${api}/download/package`} data-testid="download-package-button"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.1]">
              <DownloadSimple size={17} weight="bold" /> Download ZIP
            </a>

            <div className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.08] p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-200">
                <ShieldCheck size={18} weight="fill" /> Safer by design
              </div>
              <p className="text-sm leading-6 text-white/56">
                Operator cloud tokens and fanout settings are stripped before any customer download. The file you receive runs fully standalone on your MT5 — no data leaves your machine by default.
              </p>
            </div>

            {/* Release pipeline note */}
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/25">Release pipeline</div>
              <p className="mt-1 text-[12px] leading-5 text-white/38">
                Version info is read live from the EA file. Upgrading the production build automatically updates the download button, filename, version badge, and checksum — no manual edits needed.
              </p>
            </div>
          </div>
        </div>

        {/* Warning */}
        <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4" data-testid="download-warning">
          <div className="flex items-start gap-3">
            <Warning size={19} weight="fill" className="mt-0.5 flex-none text-amber-200" />
            <p className="text-sm leading-6 text-white/62">
              Backtest before live use. This tool can improve discipline and risk control, but no trading system can guarantee profit. Start on demo and verify execution with your broker.
            </p>
          </div>
        </div>

        {/* ─── XauIndex — a SEPARATE product/download, kept visually distinct ─── */}
        <div className="mt-16 border-t border-white/10 pt-12" data-testid="xauindex-download-section">
          <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-200">
                <ChartLineUp size={12} weight="bold" /> A different bot
              </span>
              <h2 className="mt-4 max-w-2xl font-heading text-2xl font-semibold tracking-tight sm:text-4xl">
                XauIndex {xiLoading ? "" : (xiInfo?.version || "v3.1.0")} — Gold + Index, one EA.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/58">
                Not the same bot as above. XauAI Sniper (Gold-only, {version}) stays pure gold, maintained
                on its own. XauIndex is a separate product built on the same proven exit engine, with
                Gold + Index market auto-detection added in. Attach it to XAUUSD and it trades gold exactly
                the same way. Attach it to an index chart and it now runs a real entry engine — market
                structure, liquidity, trend continuation, pullback and breakout setups, volatility-regime
                filtering, momentum — but ships log-only by default: it evaluates and shows its reasoning
                live, and won't place a real index trade until you explicitly enable it after validating on
                your own demo/index feed.
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-emerald-300/15 bg-emerald-300/[0.03] p-5 shadow-2xl shadow-black/20 md:p-7" data-testid="download-xauindex-card">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-4">
                <div className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10">
                  <ChartLineUp size={25} weight="duotone" className="text-emerald-200" />
                </div>
                <div>
                  <h3 className="font-heading text-2xl font-semibold">XauIndex Expert Advisor (.mq5)</h3>
                  {xiLoading
                    ? <p className="mt-2 flex items-center gap-2 text-sm text-white/40"><Spinner size={13} className="animate-spin" /> Fetching release info…</p>
                    : <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">
                        {xiInfo?.version || "v3.1.0"} · Same dual-AI quality gate and Trade Thesis Monitor as XauAI Sniper, plus automatic Gold/Index detection and a real index entry engine (structure, liquidity, trend, breakout, volatility, momentum). Log-only by default until you enable live index trading.
                      </p>}
                </div>
              </div>
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-300 px-3 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#06110c]">
                <CheckCircle size={10} weight="fill" /> New
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ["Version", xiLoading ? "—" : (xiInfo?.version || "v3.1.0")],
                ["Size",    xiLoading ? "—" : xiInfo?.size_kb ? `${xiInfo.size_kb} KB` : "MQ5 source"],
                ["SHA-256", xiLoading ? "—" : (xiInfo?.checksum_sha256_12 || "—")],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-white/10 bg-black/[0.24] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">{k}</div>
                  <div className="mt-1 truncate font-mono text-sm font-bold" title={v}>{v}</div>
                </div>
              ))}
            </div>

            {!xiLoading && xiInfo?.filename && (
              <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/20 px-4 py-2.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-white/30">Filename · </span>
                <span className="font-mono text-[11px] text-white/55 break-all">{xiInfo.filename}</span>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href={`${api}/download/xauindex/ea`} data-testid="download-xauindex-button"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 py-3.5 text-sm font-extrabold text-black transition hover:bg-emerald-200">
                <DownloadSimple size={17} weight="bold" />
                {xiLoading ? "Download .MQ5" : `Download XauIndex ${xiInfo?.version || "v3.1.0"} .MQ5`}
              </a>
              <a href={`${api}/download/xauindex/package`} data-testid="download-xauindex-package-button"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.1]">
                <Package size={17} weight="bold" /> Download ZIP
              </a>
            </div>

            <p className="mt-5 text-[11px] leading-5 text-white/35">
              Index Mode is monitoring-only in this release — it detects and logs, it never places an index
              trade. Gold trading on this build behaves the same as XauAI Sniper's exit/risk engine.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
