import React from "react";

export default function FinalCtaSection() {
  return (
    <div className="bg-[#060609] border-t border-white/[0.06] text-white" data-testid="final-cta-section">
      <div className="mx-auto max-w-2xl px-4 py-16 text-center md:px-8 md:py-20">
        <h2 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Let XauCloud watch Gold, qualify the setup, and manage the execution.
        </h2>
        <a href="#purchase"
          className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-9 py-3.5 text-[14px] font-extrabold text-black transition hover:bg-amber-200">
          Get XauCloud
        </a>
      </div>
    </div>
  );
}
