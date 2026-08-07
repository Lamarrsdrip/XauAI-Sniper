import React from "react";
import { Apple, Play } from "lucide-react";

// Public marketing: a tasteful "native apps are coming" roadmap item.
// Disabled/coming-soon badges only — NEVER fake download links. Deliberately
// compact so it reads as a professional roadmap note, not a homepage takeover.
function StoreBadge({ icon: Icon, top, bottom }) {
  return (
    <div
      aria-disabled="true"
      className="pointer-events-none inline-flex select-none items-center gap-3 rounded-2xl border border-white/[0.09] bg-white/[0.03] px-5 py-3 opacity-80"
    >
      <Icon className="h-6 w-6 text-white/70" />
      <span className="text-left leading-tight">
        <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">{top}</span>
        <span className="block text-[15px] font-bold text-white/85">{bottom}</span>
      </span>
      <span className="ml-1 rounded-full border border-[#C9962E]/30 bg-[#F3C969]/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#F3C969]">
        Soon
      </span>
    </div>
  );
}

export default function ComingSoonAppsSection() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-16 text-center">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#F3C969]/70">Roadmap</div>
      <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">XauCloud Mobile Apps</h2>
      <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-white/45">
        Everything in Command Center is being packaged as dedicated native apps for iPhone and Android.
        The web app already runs as an installable PWA today.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <StoreBadge icon={Apple} top="Coming soon to the" bottom="App Store" />
        <StoreBadge icon={Play} top="Coming soon to" bottom="Google Play" />
      </div>
    </section>
  );
}
