import React, { useState } from "react";
import {
  MagnifyingGlass,
  Brain,
  Strategy,
  Gauge,
  Crosshair,
  ShieldCheck,
  Lightbulb,
  Target,
  CaretDown,
  CaretUp,
} from "@phosphor-icons/react";

const STEP_ICONS = [MagnifyingGlass, Brain, Strategy, Gauge, Crosshair, ShieldCheck, Lightbulb, Target];

export default function HowItWorksSection({ data }) {
  const [expandedStep, setExpandedStep] = useState(null);
  const [expandedFaq, setExpandedFaq] = useState(null);

  if (!data) return null;

  const section = data.sections?.[0];
  if (!section) return null;

  return (
    <div className="bg-muted/30 border-t border-border" data-testid="how-it-works-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-muted border border-border mb-4">
            <Lightbulb size={12} weight="bold" />
            <span className="text-xs font-mono font-medium tracking-[0.15em] text-muted-foreground">
              COMPLETE GUIDE
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight" data-testid="how-it-works-title">
            {section.title}
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">{section.subtitle}</p>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-12">
          {section.steps?.map((step, i) => {
            const Icon = STEP_ICONS[i] || Lightbulb;
            const isExpanded = expandedStep === i;
            return (
              <div
                key={step.id}
                className="border border-border bg-card overflow-hidden metric-card"
                data-testid={`how-step-${step.id}`}
              >
                <button
                  className="w-full text-left px-5 py-4 flex items-start gap-4"
                  onClick={() => setExpandedStep(isExpanded ? null : i)}
                  data-testid={`how-step-btn-${step.id}`}
                >
                  <div className="w-10 h-10 bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon size={20} weight="duotone" className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs font-bold text-primary">
                        STEP {String(step.id).padStart(2, "0")}
                      </span>
                    </div>
                    <h4 className="font-heading text-base font-semibold tracking-tight">
                      {step.title}
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                  <div className="flex-shrink-0 mt-2">
                    {isExpanded ? (
                      <CaretUp size={16} className="text-muted-foreground" />
                    ) : (
                      <CaretDown size={16} className="text-muted-foreground" />
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-5 pb-4 ml-14" data-testid={`how-step-detail-${step.id}`}>
                    <div className="border-l-2 border-primary/30 pl-4 py-2 bg-primary/5">
                      <p className="text-sm text-foreground leading-relaxed">{step.detail}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Visual flow diagram */}
        <div className="border border-border bg-card mb-10" data-testid="flow-diagram">
          <div className="border-b border-border overflow-hidden">
            <img
              src="https://static.prod-images.emergentagent.com/jobs/a0d76eb0-1956-4da1-ad00-cd40d1b3f75f/images/73712160ad8cf86a17345fa0ce9460d2c140bc118fd596547ad81c65b671c5ce.png"
              alt="AI Sniper Trading Flow"
              className="w-full h-48 object-cover"
              data-testid="flow-diagram-image"
            />
          </div>
          <div className="p-6">
          <h4 className="text-xs font-bold tracking-[0.15em] text-muted-foreground mb-4">
            TRADING FLOW
          </h4>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {["SCAN MARKET", "CLASSIFY", "SELECT STRATEGY", "SCORE CONFIDENCE", "EXECUTE / SKIP", "MANAGE TRADE", "LEARN FROM RESULT", "REPEAT"].map(
              (step, i) => (
                <React.Fragment key={step}>
                  <div className="px-3 py-2 bg-muted border border-border text-xs font-bold tracking-wide text-center min-w-[100px]">
                    {step}
                  </div>
                  {i < 7 && (
                    <div className="text-primary font-mono text-lg font-bold hidden sm:block">
                      &rarr;
                    </div>
                  )}
                </React.Fragment>
              )
            )}
          </div>
          </div>
        </div>

        {/* FAQ */}
        {data.faq && (
          <div data-testid="faq-section">
            <h3 className="font-heading text-xl font-bold tracking-tight mb-4">
              Frequently Asked Questions
            </h3>
            <div className="space-y-2">
              {data.faq.map((item, i) => (
                <div key={i} className="border border-border bg-card" data-testid={`faq-${i}`}>
                  <button
                    className="w-full text-left px-5 py-3 flex items-center justify-between"
                    onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                    data-testid={`faq-btn-${i}`}
                  >
                    <span className="text-sm font-medium">{item.q}</span>
                    {expandedFaq === i ? (
                      <CaretUp size={14} className="text-muted-foreground flex-shrink-0" />
                    ) : (
                      <CaretDown size={14} className="text-muted-foreground flex-shrink-0" />
                    )}
                  </button>
                  {expandedFaq === i && (
                    <div className="px-5 pb-3">
                      <p className="text-sm text-muted-foreground">{item.a}</p>
                    </div>
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
