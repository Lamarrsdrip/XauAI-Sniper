import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import XauAiLogo from "./cloud/XauAiLogo";

/**
 * Sticky bottom banner shown on the DIY landing page (/) that funnels
 * scroll-through visitors to /cloud. Hides on:
 *   - any /cloud* route
 *   - after the user dismisses it (sessionStorage)
 *   - until the user has scrolled past 600px (so it doesn't fight the hero)
 */
export default function CloudFunnelBanner() {
  const location = useLocation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (location.pathname.startsWith("/cloud")) { setShow(false); return; }
    if (sessionStorage.getItem("xauai_cloud_banner_dismissed") === "1") return;
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [location.pathname]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-4 sm:pb-4 pointer-events-none"
      data-testid="cloud-funnel-banner"
    >
      <div className="pointer-events-auto max-w-3xl mx-auto bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#D4AF37]/30 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.6)] flex items-center gap-2 sm:gap-3 pl-3 sm:pl-4 pr-2 py-2">
        <XauAiLogo size={26} solid className="flex-none" />
        <div className="flex-1 min-w-0 text-white text-xs sm:text-sm">
          <span className="font-semibold">Don't want to set up?</span>
          <span className="text-white/60"> Skip to XauAi Cloud →</span>
        </div>
        <Link
          to="/cloud"
          data-testid="cloud-funnel-cta"
          className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 bg-[#D4AF37] text-black font-semibold rounded-full text-xs hover:bg-[#E5C558] transition-colors whitespace-nowrap"
        >
          Try free <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <Link
          to="/cloud"
          data-testid="cloud-funnel-cta-mobile"
          className="sm:hidden inline-flex items-center gap-1 px-3 py-1.5 bg-[#D4AF37] text-black font-semibold rounded-full text-xs whitespace-nowrap"
        >
          Try free <ArrowRight className="w-3.5 h-3.5" />
        </Link>
        <button
          onClick={() => { sessionStorage.setItem("xauai_cloud_banner_dismissed", "1"); setShow(false); }}
          aria-label="Dismiss"
          data-testid="cloud-funnel-dismiss"
          className="flex-none w-7 h-7 rounded-full text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
