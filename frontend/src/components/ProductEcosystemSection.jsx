import React from "react";
import { BarChart3, Bot, Brain, GraduationCap, Headphones, LineChart, ShieldCheck, Smartphone } from "lucide-react";

const ITEMS = [
  { icon: Bot, title: "Gold-focused EA", body: "The MT5 Expert Advisor handles qualification, sizing, execution and position management for XAUUSD." },
  { icon: Smartphone, title: "Command Center", body: "See connection status, bot state, market context and controls from a phone or desktop." },
  { icon: Brain, title: "Decision visibility", body: "AI Brain and activity views make blockers, evidence and system decisions easier to understand." },
  { icon: BarChart3, title: "Verified analytics", body: "Review account and strategy statistics from reported trading data instead of marketing screenshots alone." },
  { icon: Headphones, title: "Integrated support", body: "Customers can open support tickets directly inside Command Center and keep the whole conversation in one place." },
  { icon: GraduationCap, title: "Forex Academy", body: "A structured beginner-to-advanced learning path covers market mechanics, risk, psychology, gold and testing." },
  { icon: LineChart, title: "Pattern intelligence", body: "Pattern education and live context sit beside market evidence — without fabricating detections the backend did not report." },
  { icon: ShieldCheck, title: "Built around control", body: "No martingale, explicit risk rules, protected trade management and clear boundaries between automation and owner control." },
];

export default function ProductEcosystemSection() {
  return (
    <section className="border-t border-white/[0.06] bg-[#050609]" data-testid="product-ecosystem-section">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
        <div className="grid gap-8 lg:grid-cols-[.82fr_1.18fr] lg:gap-12">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-[#F3C969]/70">More than an EA</div>
            <h2 className="mt-3 max-w-lg font-heading text-[2.1rem] font-semibold leading-[1.08] tracking-tight text-white md:text-[2.7rem]">
              One XauCloud ecosystem from execution to understanding.
            </h2>
            <p className="mt-4 max-w-lg text-[13px] leading-6 text-white/45">
              The trading engine is only one layer. XauCloud is being built as a complete customer operating experience: automation, visibility, analytics, support and education — tied to the same account.
            </p>
            <div className="mt-6 rounded-2xl border border-[#F3C969]/12 bg-[#F3C969]/[0.045] p-4">
              <div className="text-[12px] font-bold text-[#F3C969]">Built for real use, not demo-only screens.</div>
              <p className="mt-1.5 text-[11px] leading-5 text-white/42">
                Live surfaces are backed by the existing XauCloud services. Where data is unavailable, the product should say so instead of inventing status, performance or signals.
              </p>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {ITEMS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="group rounded-2xl border border-white/[0.07] bg-[#0C0D12] p-4 transition hover:border-[#F3C969]/16 hover:bg-[#101116]">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F3C969]/9 text-[#F3C969]">
                  <Icon className="h-[17px] w-[17px]" />
                </span>
                <h3 className="mt-3 text-[13.5px] font-bold text-white">{title}</h3>
                <p className="mt-1.5 text-[11.5px] leading-5 text-white/42">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
