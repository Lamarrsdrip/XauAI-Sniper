import React, { useState } from "react";
import { Lightbulb, CaretDown, CaretUp, Warning, Star } from "@phosphor-icons/react";

export default function SetupGuideSection({ data }) {
  const [expandedStep, setExpandedStep] = useState(null);

  if (!data) return null;

  return (
    <div className="bg-background border-t border-border" data-testid="setup-guide-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-16">
        {/* Section header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/30 mb-4">
            <Star size={12} weight="fill" className="text-primary" />
            <span className="text-xs font-mono font-bold tracking-[0.15em] text-primary">
              BEGINNER FRIENDLY
            </span>
          </div>
          <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight" data-testid="setup-guide-title">
            {data.title}
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-base leading-relaxed">
            {data.intro}
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-3 mb-10">
          {data.steps?.map((step, i) => {
            const isExpanded = expandedStep === i;
            return (
              <div
                key={step.step}
                className="border border-border bg-card overflow-hidden metric-card"
                data-testid={`setup-step-${step.step}`}
              >
                <button
                  className="w-full text-left px-5 py-4 flex items-start gap-4"
                  onClick={() => setExpandedStep(isExpanded ? null : i)}
                  data-testid={`setup-step-btn-${step.step}`}
                >
                  <div className="w-10 h-10 bg-primary flex items-center justify-center flex-shrink-0">
                    <span className="font-mono text-sm font-black text-primary-foreground">
                      {String(step.step).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-heading text-base font-bold tracking-tight">
                      {step.title}
                    </h4>
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
                  <div className="px-5 pb-5 ml-14" data-testid={`setup-step-detail-${step.step}`}>
                    {/* Instructions */}
                    <ol className="space-y-2 mb-4">
                      {step.instructions?.map((inst, j) => (
                        <li key={j} className="flex items-start gap-3">
                          <span className="font-mono text-xs font-bold text-primary bg-primary/10 w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                            {j + 1}
                          </span>
                          <span className="text-sm leading-relaxed">{inst}</span>
                        </li>
                      ))}
                    </ol>
                    {/* Tip */}
                    {step.tip && (
                      <div className="border-l-2 border-primary/40 pl-4 py-2 bg-primary/5">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Lightbulb size={14} weight="fill" className="text-primary" />
                          <span className="text-xs font-bold tracking-wide text-primary">TIP</span>
                        </div>
                        <p className="text-sm text-foreground/80">{step.tip}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Important Notes */}
        {data.important_notes && (
          <div className="border border-[hsl(348,83%,47%)]/30 bg-[hsl(348,83%,47%)]/5 p-5" data-testid="important-notes">
            <div className="flex items-center gap-2 mb-3">
              <Warning size={18} weight="fill" className="text-[hsl(348,83%,47%)]" />
              <span className="text-sm font-bold text-[hsl(348,83%,47%)]">IMPORTANT - READ THIS!</span>
            </div>
            <ul className="space-y-2">
              {data.important_notes.map((note) => (
                <li key={note} className="text-sm text-foreground/80 flex items-start gap-2">
                  <span className="text-[hsl(348,83%,47%)] font-bold flex-shrink-0">!</span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
