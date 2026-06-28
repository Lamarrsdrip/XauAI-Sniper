import React from "react";
import { Monitor, WhatsappLogo } from "@phosphor-icons/react";

export default function SupportSection() {
  return (
    <div className="bg-[#060609] border-t border-white/[0.06]" data-testid="support-section">
      <div className="mx-auto max-w-7xl px-4 py-20 md:px-8 md:py-28">

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-[24px] border border-emerald-300/20 bg-emerald-300/[0.06] p-8">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-300/20 bg-black/20">
              <Monitor size={22} weight="duotone" className="text-emerald-300" />
            </div>
            <h3 className="mb-2 font-heading text-xl font-semibold text-white">Free VPS Activation</h3>
            <p className="text-[13px] leading-6 text-white/52">
              After purchase, I'll remotely help you activate the bot on your VPS. No technical experience needed.
            </p>
          </div>

          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-8">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.1] bg-black/20">
              <WhatsappLogo size={22} weight="duotone" className="text-white/60" />
            </div>
            <h3 className="mb-2 font-heading text-xl font-semibold text-white">WhatsApp Support</h3>
            <p className="text-[13px] leading-6 text-white/52">
              Direct support for all license holders. Any broker, any account size.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
