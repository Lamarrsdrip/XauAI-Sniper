import React, { useState } from "react";
import { MagnifyingGlass, Brain, Strategy, Gauge, Crosshair, ShieldCheck, Lightbulb, Target, CaretDown, CaretUp } from "@phosphor-icons/react";

const STEP_ICONS = [MagnifyingGlass, Brain, Strategy, Gauge, Crosshair, ShieldCheck, Lightbulb, Target];

export default function HowItWorksSection({ data }) {
  const [expandedStep, setExpandedStep] = useState(null);
  const [expandedFaq, setExpandedFaq] = useState(null);
  if (!data) return null;
  const section = data.sections?.[0];
  if (!section) return null;

  return (
    <div className="border-t border-white/[0.06]" data-testid="how-it-works-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-24">
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] bg-white/[0.03] mb-4">
            <Lightbulb size={12} weight="duotone" className="text-[#D4AF37]" />
            <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-white/40">COMPLETE GUIDE</span>
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl font-medium tracking-tight text-white" data-testid="how-it-works-title">{section.title}</h2>
          <p className="text-white/40 mt-2 max-w-2xl">{section.subtitle}</p>
        </div>

        <div className="space-y-2 mb-16">
          {section.steps?.map((step, i) => {
            const Icon = STEP_ICONS[i] || Lightbulb;
            const isExpanded = expandedStep === i;
            return (
              <div key={step.id} className="border border-white/[0.06] bg-[#0C0C0C] overflow-hidden metric-card" data-testid={`how-step-${step.id}`}>
                <button className="w-full text-left px-6 py-5 flex items-start gap-4" onClick={() => setExpandedStep(isExpanded ? null : i)} data-testid={`how-step-btn-${step.id}`}>
                  <div className="w-10 h-10 border border-[#D4AF37]/20 bg-[#D4AF37]/5 flex items-center justify-center flex-shrink-0">
                    <Icon size={18} weight="duotone" className="text-[#D4AF37]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-[10px] font-bold text-[#D4AF37] tracking-[0.2em]">STEP {String(step.id).padStart(2, "0")}</span>
                    <h4 className="font-heading text-base font-medium tracking-tight text-white mt-1">{step.title}</h4>
                    <p className="text-sm text-white/35 mt-1 leading-relaxed">{step.description}</p>
                  </div>
                  <div className="flex-shrink-0 mt-2">
                    {isExpanded ? <CaretUp size={14} className="text-white/30" /> : <CaretDown size={14} className="text-white/30" />}
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-6 pb-5 ml-14" data-testid={`how-step-detail-${step.id}`}>
                    <div className="border-l border-[#D4AF37]/30 pl-4 py-2">
                      <p className="text-sm text-white/50 leading-relaxed">{step.detail}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Trading flow */}
        <div className="border border-white/[0.06] bg-[#0C0C0C] p-8 mb-12" data-testid="flow-diagram">
          <h4 className="text-[10px] font-mono font-bold tracking-[0.2em] text-white/30 mb-6">TRADING FLOW</h4>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {["SCAN", "CLASSIFY", "STRATEGY", "CONFIDENCE", "EXECUTE", "MANAGE", "LEARN", "REPEAT"].map((step, i) => (
              <React.Fragment key={step}>                <div className="px-4 py-2 border border-white/[0.08] bg-white/[0.02] text-[10px] font-mono font-bold tracking-[0.1em] text-white/60 text-center">
                  {step}
                </div>
                {i < 7 && <span className="text-[#D4AF37] font-mono text-sm hidden sm:block">&rarr;</span>}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* FAQ */}
        {data.faq && (
          <div data-testid="faq-section">
            <h3 className="font-heading text-xl font-medium tracking-tight mb-6 text-white">FAQ</h3>
            <div className="space-y-1">
              {data.faq.map((item, i) => (
                <div key={`faq-${item.q}`} className="border border-white/[0.06] bg-[#0C0C0C]" data-testid={`faq-${i}`}>
                  <button className="w-full text-left px-5 py-4 flex items-center justify-between" onClick={() => setExpandedFaq(expandedFaq === i ? null : i)} data-testid={`faq-btn-${i}`}>
                    <span className="text-sm font-medium text-white/70">{item.q}</span>
                    {expandedFaq === i ? <CaretUp size={14} className="text-white/30" /> : <CaretDown size={14} className="text-white/30" />}
                  </button>
                  {expandedFaq === i && (
                    <div className="px-5 pb-4"><p className="text-sm text-white/40 leading-relaxed">{item.a}</p></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
