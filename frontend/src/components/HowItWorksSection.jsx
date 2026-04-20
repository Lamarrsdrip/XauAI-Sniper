import React, { useState } from "react";
import { MagnifyingGlass, Brain, Strategy, Gauge, Crosshair, ShieldCheck, Lightbulb, Target, CaretDown, CaretUp } from "@phosphor-icons/react";

const ICONS = [MagnifyingGlass, Brain, Strategy, Gauge, Crosshair, ShieldCheck, Lightbulb, Target];

export default function HowItWorksSection({ data }) {
  const [expandedStep, setExpandedStep] = useState(null);
  const [expandedFaq, setExpandedFaq] = useState(null);
  if (!data) return null;
  const section = data.sections?.[0];
  if (!section) return null;

  return (
    <div className="border-t border-gray-100" data-testid="how-it-works-section">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-24">
        <div className="mb-12">
          <span className="text-[10px] font-mono font-medium tracking-[0.2em] text-gray-400 bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full"><Lightbulb size={12} weight="duotone" className="inline mr-1 text-[#C5A059]" />COMPLETE GUIDE</span>
          <h2 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight mt-6 text-[#111]" data-testid="how-it-works-title">{section.title}</h2>
          <p className="text-gray-500 mt-2 max-w-2xl">{section.subtitle}</p>
        </div>

        <div className="space-y-3 mb-16">
          {section.steps?.map((step, i) => {
            const Icon = ICONS[i] || Lightbulb;
            const open = expandedStep === i;
            return (
              <div key={step.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden card-hover" data-testid={`how-step-${step.id}`}>
                <button className="w-full text-left px-6 py-5 flex items-start gap-4" onClick={() => setExpandedStep(open ? null : i)} data-testid={`how-step-btn-${step.id}`}>
                  <div className="w-10 h-10 bg-[#C5A059]/10 border border-[#C5A059]/20 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Icon size={18} weight="duotone" className="text-[#C5A059]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-[10px] font-bold text-[#C5A059] tracking-[0.15em]">STEP {String(step.id).padStart(2, "0")}</span>
                    <h4 className="font-heading text-base font-medium text-[#111] mt-1">{step.title}</h4>
                    <p className="text-sm text-gray-400 mt-1">{step.description}</p>
                  </div>
                  {open ? <CaretUp size={14} className="text-gray-300 mt-2" /> : <CaretDown size={14} className="text-gray-300 mt-2" />}
                </button>
                {open && (
                  <div className="px-6 pb-5 ml-14" data-testid={`how-step-detail-${step.id}`}>
                    <div className="border-l-2 border-[#C5A059]/30 pl-4 py-2">
                      <p className="text-sm text-gray-500 leading-relaxed">{step.detail}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {data.faq && (
          <div data-testid="faq-section">
            <h3 className="font-heading text-xl font-medium text-[#111] mb-6">FAQ</h3>
            <div className="space-y-2">
              {data.faq.map((item, i) => (
                <div key={`faq-${item.q}`} className="bg-white border border-gray-200 rounded-2xl" data-testid={`faq-${i}`}>
                  <button className="w-full text-left px-5 py-4 flex items-center justify-between" onClick={() => setExpandedFaq(expandedFaq === i ? null : i)} data-testid={`faq-btn-${i}`}>
                    <span className="text-sm font-medium text-[#111]">{item.q}</span>
                    {expandedFaq === i ? <CaretUp size={14} className="text-gray-300" /> : <CaretDown size={14} className="text-gray-300" />}
                  </button>
                  {expandedFaq === i && <div className="px-5 pb-4"><p className="text-sm text-gray-500 leading-relaxed">{item.a}</p></div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
