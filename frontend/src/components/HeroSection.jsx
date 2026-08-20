import React from "react";
import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  RadioTower,
  LockKeyhole,
  Activity,
} from "lucide-react";

function ProductPreview({ goldPrice }) {
  const hasQuote = goldPrice?.available === true && Number.isFinite(goldPrice?.bid);
  const price = hasQuote ? goldPrice.bid.toFixed(2) : "—";

  return (
    <div className="relative mx-auto w-full max-w-[500px] lg:mx-0" data-testid="hero-live-visual">
      <div className="relative overflow-hidden rounded-[26px] border border-white/[0.10] bg-[#0A0B0F] shadow-[0_32px_90px_rgba(0,0,0,.52)]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#2FD3A0]" />
            <span className="text-[11px] font-semibold text-white/82">XauCloud Command Center</span>
          </div>
          <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/38">Live product environment</span>
        </div>

        <div className="grid gap-px bg-white/[0.06] sm:grid-cols-[0.82fr_1.18fr]">
          <div className="bg-[#0B0C10] p-4">
            <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/42">Connected market</div>
            <div className="mt-1 text-[21px] font-black text-white">XAUUSD</div>
            <div className="mt-4 border-t border-white/[0.06] pt-4">
              <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/42">Gold bid</div>
              <div className="mt-1 font-mono text-[18px] font-black text-[#F3C969]">{price}</div>
            </div>

            <div className="mt-5 space-y-2">
              {[
                ["EA heartbeat", "Connected", "green"],
                ["Risk controls", "Active", "gold"],
                ["Remote visibility", "Ready", "white"],
              ].map(([label, value, tone]) => (
                <div key={label} className="flex items-center justify-between border-b border-white/[0.06] py-2 last:border-0">
                  <span className="text-[10px] text-white/48">{label}</span>
                  <span className={`font-mono text-[9px] font-bold ${tone === "green" ? "text-[#2FD3A0]" : tone === "gold" ? "text-[#F3C969]" : "text-white/78"}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0D0E13] p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { icon: RadioTower, title: "Live monitoring", body: "Heartbeat, positions, P&L, blocks and system state." },
                { icon: Sparkles, title: "Decision visibility", body: "See AI reasoning, confidence and current trade context." },
                { icon: LockKeyhole, title: "Protected controls", body: "Sensitive actions remain confirmation and PIN protected." },
                { icon: Activity, title: "Activity history", body: "Follow trade lifecycle and system events from one place." },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                  <Icon className="h-4 w-4 text-[#F3C969]" />
                  <div className="mt-2 text-[10.5px] font-bold text-white/84">{title}</div>
                  <div className="mt-1 text-[9.5px] leading-4 text-white/43">{body}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#2FD3A0]/15 bg-[#2FD3A0]/[0.04] px-3 py-2.5 text-[10px] text-white/66">
              <ShieldCheck className="h-4 w-4 flex-none text-[#2FD3A0]" />
              Monitor from phone or desktop while execution remains on MT5 / VPS.
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-8 -right-2 hidden w-[170px] rounded-[22px] border border-white/[0.10] bg-[#090A0E] p-3 shadow-2xl sm:block">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold text-white/75">Mobile Command Center</span>
          <Smartphone className="h-3.5 w-3.5 text-[#F3C969]" />
        </div>
        <div className="mt-3 space-y-2">
          <div className="rounded-lg bg-white/[0.04] p-2">
            <div className="text-[7px] uppercase tracking-[0.14em] text-white/35">Status</div>
            <div className="mt-1 text-[10px] font-black text-[#2FD3A0]">Connected</div>
          </div>
          <div className="rounded-lg bg-white/[0.04] p-2">
            <div className="text-[7px] uppercase tracking-[0.14em] text-white/35">Access</div>
            <div className="mt-1 text-[10px] font-black text-white/80">Anywhere</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HeroSection({ goldPrice }) {
  return (
    <div className="relative overflow-hidden bg-[#06070A] text-white" data-testid="hero-section">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.08]" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20">
        <div className="grid items-center gap-14 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="text-left">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#F3C969]/20 bg-[#F3C969]/[0.06] px-3.5 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#2FD3A0]" />
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#F3C969]">XAUUSD automation · MetaTrader 5</span>
              </div>
              <a
                href="https://www.mql5.com/en/market/product/188838"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-white/[0.10] px-3.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/62 transition hover:border-white/20 hover:text-white"
              >
                Available on MQL5 ↗
              </a>
            </div>

            <h1
              className="mt-7 max-w-3xl font-heading text-[2.85rem] font-semibold leading-[0.98] tracking-[-0.04em] sm:text-6xl lg:text-[4.25rem]"
              data-testid="hero-title"
            >
              Professional automation for
              <span className="block text-[#F3C969]">XAUUSD trading.</span>
            </h1>

            <p className="mt-6 max-w-xl text-[15px] leading-7 text-white/64">
              XauCloud combines a Gold-focused MT5 Expert Advisor with a professional Command Center for monitoring, decision visibility, risk controls, analytics, support and trader education.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#purchase"
                data-testid="hero-buy-btn"
                className="inline-flex min-w-[170px] items-center justify-center gap-2 rounded-full bg-[#F3C969] px-7 py-3.5 text-[13.5px] font-extrabold text-black transition hover:brightness-105"
              >
                Get XauCloud <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="/command"
                className="inline-flex min-w-[190px] items-center justify-center gap-2 rounded-full border border-[#F3C969]/35 bg-transparent px-7 py-3.5 text-[13.5px] font-semibold text-white transition hover:bg-[#F3C969]/[0.06]"
              >
                Explore Command Center
              </a>
            </div>

            <div className="mt-9 grid max-w-xl grid-cols-2 gap-x-7 gap-y-4">
              {[
                "Automated XAUUSD execution",
                "Risk-aware position controls",
                "Command Center visibility",
                "Support & Forex Academy",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 border-t border-white/[0.08] pt-3">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-[#F3C969]" />
                  <span className="text-[11px] leading-4 text-white/60">{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-7 font-mono text-[9px] uppercase tracking-[0.13em] text-white/34">
              Trading involves risk · Historical results are not guarantees · You remain in control
            </div>
          </div>

          <ProductPreview goldPrice={goldPrice} />
        </div>
      </div>
    </div>
  );
}
