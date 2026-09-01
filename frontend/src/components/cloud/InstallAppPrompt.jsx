import React, { useEffect, useState } from "react";
import { Download, Share, PlusSquare, X, Smartphone, ChevronRight } from "lucide-react";

const DISMISSED_KEY = "xauai_install_dismissed_at";
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function detectPlatform() {
  const ua = window.navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || /Mobi/i.test(ua);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;
  return { isIOS, isAndroid, isMobile, isStandalone };
}

/**
 * InstallAppPrompt
 * Shows a native-like "Install as app" banner on mobile the first time
 * a user visits /command. iOS → instruction card (Safari can't do programmatic
 * install). Android/Chrome → uses beforeinstallprompt and one-tap install.
 */
export default function InstallAppPrompt() {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [platform] = useState(detectPlatform());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Skip if already installed (running in standalone mode)
    if (platform.isStandalone) return;
    // Skip if dismissed recently
    const dismissedAt = parseInt(localStorage.getItem(DISMISSED_KEY) || "0", 10);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_COOLDOWN_MS) return;

    // Listen for Android/Chrome beforeinstallprompt
    const onBIP = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // For iOS — no programmatic API. Just show if mobile, after short delay
    if (platform.isIOS) {
      const t = setTimeout(() => setShow(true), 1200);
      return () => { clearTimeout(t); window.removeEventListener("beforeinstallprompt", onBIP); };
    }
    // For Android without BIP event within 3s, still show instructions card
    const fallbackTimer = setTimeout(() => {
      if (platform.isMobile && !platform.isStandalone) setShow(true);
    }, 2500);
    return () => {
      clearTimeout(fallbackTimer);
      window.removeEventListener("beforeinstallprompt", onBIP);
    };
  }, [platform]);

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    setShow(false);
  };

  const installNow = async () => {
    if (!deferredPrompt) { setExpanded(true); return; }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShow(false);
    }
    setDeferredPrompt(null);
  };

  if (!show || platform.isStandalone) return null;

  // Detect if there's a bottom nav on this page (/command/dashboard has one on mobile)
  const hasBottomNav = typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/command/dashboard") || window.location.pathname.startsWith("/cloud/dashboard"));
  const bottomOffset = hasBottomNav ? 76 : 12;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-[70] p-3 sm:p-4"
      style={{ paddingBottom: `calc(env(safe-area-inset-bottom) + ${bottomOffset}px)` }}
      data-testid="install-app-banner"
    >
      <div className="max-w-md mx-auto bg-gradient-to-br from-[#111] to-[#0a0a0a] border border-[#D4AF37]/30 rounded-2xl shadow-[0_20px_60px_-10px_rgba(212,175,55,0.3)] overflow-hidden">
        {/* Collapsed */}
        {!expanded && (
          <div className="p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#D4AF37] flex items-center justify-center text-black flex-none">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white text-sm">Install Command Center app</div>
              <div className="text-[11px] text-white/60">
                {platform.isIOS ? "Tap Share → Add to Home Screen" : "One-tap install — opens like a native app"}
              </div>
            </div>
            <button
              onClick={platform.isIOS ? () => setExpanded(true) : installNow}
              data-testid="install-app-btn"
              className="px-3.5 py-2 bg-[#D4AF37] text-black text-xs font-bold rounded-full hover:bg-[#E5C558] transition-colors flex items-center gap-1 flex-none"
            >
              {platform.isIOS ? <>Show me <ChevronRight className="w-3 h-3" /></> : <>Install <Download className="w-3 h-3" /></>}
            </button>
            <button
              onClick={dismiss}
              data-testid="install-dismiss-btn"
              className="p-1.5 text-white/40 hover:text-white/80 transition-colors flex-none"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {/* Expanded — iOS step-by-step */}
        {expanded && (
          <div className="p-5" data-testid="install-app-expanded">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="font-bold text-white text-base">Add to Home Screen</div>
                <div className="text-xs text-white/60">3 quick steps — feels just like a native app</div>
              </div>
              <button onClick={dismiss} className="p-1 text-white/40 hover:text-white/80" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="space-y-3 mb-4">
              <li className="flex gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-[#D4AF37] text-black text-xs font-bold flex items-center justify-center flex-none">1</span>
                <div className="flex-1">
                  <div className="text-white font-medium flex items-center gap-1.5">
                    Tap the <Share className="w-4 h-4 text-[#D4AF37]" /> Share button
                  </div>
                  <div className="text-[11px] text-white/50">At the bottom of Safari (or in the address bar on other browsers)</div>
                </div>
              </li>
              <li className="flex gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-[#D4AF37] text-black text-xs font-bold flex items-center justify-center flex-none">2</span>
                <div className="flex-1">
                  <div className="text-white font-medium flex items-center gap-1.5">
                    Tap <PlusSquare className="w-4 h-4 text-[#D4AF37]" /> "Add to Home Screen"
                  </div>
                  <div className="text-[11px] text-white/50">Scroll down in the share menu if you don't see it</div>
                </div>
              </li>
              <li className="flex gap-3 text-sm">
                <span className="w-6 h-6 rounded-full bg-[#D4AF37] text-black text-xs font-bold flex items-center justify-center flex-none">3</span>
                <div className="flex-1">
                  <div className="text-white font-medium">Tap "Add"</div>
                  <div className="text-[11px] text-white/50">XauCloud Command Center will appear on your home screen and open full-screen like a real app</div>
                </div>
              </li>
            </ol>
            <button
              onClick={dismiss}
              data-testid="install-got-it-btn"
              className="w-full py-2.5 bg-[#D4AF37] text-black text-sm font-bold rounded-xl hover:bg-[#E5C558] transition-colors"
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
