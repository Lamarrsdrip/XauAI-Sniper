import React from "react";
import { Apple, ArrowRight, CheckCircle2, MonitorSmartphone, Play, Wifi } from "lucide-react";

function StoreBadge({ icon: Icon, top, bottom }) {
  return (
    <div aria-disabled="true"
      className="pointer-events-none inline-flex min-w-[190px] select-none items-center gap-3 rounded-2xl border border-white/[0.14] bg-black/25 px-4 py-3">
      <Icon className="h-6 w-6 text-white/90" />
      <span className="min-w-0 text-left leading-tight">
        <span className="block font-mono text-[8px] uppercase tracking-[0.14em] text-white/65">{top}</span>
        <span className="block text-[14px] font-bold text-white">{bottom}</span>
      </span>
      <span className="ml-auto rounded-full bg-[#F3C969]/14 px-2 py-1 font-mono text-[8px] font-bold uppercase tracking-wider text-[#F3C969]">Soon</span>
    </div>
  );
}

export default function ComingSoonAppsSection() {
  return (
    <section className="border-y border-white/[0.06] bg-[#07080B]" data-testid="mobile-apps-roadmap">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
        <div className="overflow-hidden rounded-[30px] border border-white/[0.10] bg-[radial-gradient(circle_at_85%_0%,rgba(243,201,105,0.16),transparent_38%),linear-gradient(145deg,#101116,#090A0E)]">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_.95fr]">
            <div className="p-6 md:p-9">
              <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-[#F3C969]">Mobile roadmap</div>
              <h2 className="mt-3 max-w-xl font-heading text-[2rem] font-semibold leading-tight tracking-tight text-white md:text-[2.55rem]">
                Command Center is already mobile. Native apps are the next layer.
              </h2>
              <p className="mt-4 max-w-xl text-[13px] leading-6 text-white/75">
                Today, customers can use the full web Command Center from iPhone, Android or desktop and install it as a PWA. Dedicated native iOS and Android apps are planned — without pretending unreleased store listings already exist.
              </p>

              <div className="mt-5 grid max-w-lg gap-2 sm:grid-cols-2">
                {[
                  ["Live today", "Installable mobile web app"],
                  ["Live today", "Bot monitoring & control"],
                  ["Live today", "Analytics, support & education"],
                  ["Roadmap", "Dedicated App Store / Play apps"],
                ].map(([tag, text]) => (
                  <div key={text} className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5">
                    <CheckCircle2 className={`h-3.5 w-3.5 flex-none ${tag === "Roadmap" ? "text-[#F3C969]" : "text-[#2FD3A0]"}`} />
                    <div>
                      <div className="font-mono text-[7.5px] uppercase tracking-[0.13em] text-white/58">{tag}</div>
                      <div className="mt-0.5 text-[10.5px] font-semibold text-white/84">{text}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <a href="/command"
                  className="inline-flex items-center gap-2 rounded-full bg-[#F3C969] px-5 py-3 text-[12px] font-black text-black transition hover:brightness-105">
                  Open Command Center <ArrowRight className="h-3.5 w-3.5" />
                </a>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-3 text-[10.5px] text-white/72">
                  <Wifi className="h-3.5 w-3.5" /> Works in your mobile browser now
                </div>
              </div>
            </div>

            <div className="border-t border-white/[0.06] bg-black/20 p-6 md:p-9 lg:border-l lg:border-t-0">
              <div className="mx-auto max-w-sm">
                <div className="relative mx-auto w-[245px] rounded-[36px] border border-white/[0.14] bg-[#050507] p-3 shadow-[0_30px_70px_rgba(0,0,0,.45)]">
                  <div className="rounded-[28px] bg-[#0C0D12] p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#F3C969]/12"><MonitorSmartphone className="h-4 w-4 text-[#F3C969]" /></span>
                      <span className="h-2 w-2 rounded-full bg-[#2FD3A0]" />
                    </div>
                    <div className="mt-5 font-mono text-[8px] uppercase tracking-[0.17em] text-white/58">XauCloud</div>
                    <div className="mt-1 text-[19px] font-black text-white">Command Center</div>
                    <div className="mt-4 space-y-2">
                      {["Trading Bot", "AI Brain", "Analytics", "Support Center", "Forex Academy"].map((x, i) => (
                        <div key={x} className="flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${i === 0 ? "bg-[#2FD3A0]" : "bg-[#F3C969]/80"}`} />
                          <span className="text-[10.5px] font-semibold text-white/82">{x}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col items-stretch gap-2">
                  <StoreBadge icon={Apple} top="Planned for" bottom="Apple App Store" />
                  <StoreBadge icon={Play} top="Planned for" bottom="Google Play" />
                </div>
                <p className="mt-3 text-center font-mono text-[8px] uppercase tracking-[0.13em] text-white/55">
                  Store badges activate only after official listings exist
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
