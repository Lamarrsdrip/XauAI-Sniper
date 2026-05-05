import React from "react";
import { Link } from "react-router-dom";
import { Zap, Shield, Lock, Pause, Activity, Check, ArrowRight, Sparkles } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";

export default function CloudLanding() {
  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <InstallAppPrompt />

      {/* Nav */}
      <nav className="sticky top-0 z-40 backdrop-blur-xl bg-[#050505]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 min-w-0" data-testid="cloud-logo-link">
            <XauAiLogo size={28} className="flex-none" />
            <span className="font-bold tracking-tight text-sm sm:text-lg truncate">XauAi Cloud</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3 flex-none">
            <Link to="/cloud/login" className="text-xs sm:text-sm text-white/70 hover:text-white transition-colors" data-testid="nav-login">Log in</Link>
            <Link to="/cloud/signup" className="px-3 py-1.5 sm:px-4 sm:py-2 bg-[#D4AF37] text-black font-semibold rounded-full text-[11px] sm:text-sm hover:bg-[#E5C558] transition-colors whitespace-nowrap" data-testid="nav-signup">Start trial</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-10 sm:pb-16">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 text-[#D4AF37] text-[10px] sm:text-xs font-mono tracking-wider mb-4 sm:mb-6" data-testid="hero-badge">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-pulse" />
              LIVE · FULLY AUTOMATED
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] mb-4 sm:mb-6" data-testid="hero-title">
              Stop babysitting MT5. <br className="hidden sm:block" />
              <span className="text-[#D4AF37]">Let your trades run themselves.</span>
            </h1>

            <p className="text-base sm:text-lg text-white/70 mb-3 leading-relaxed max-w-xl" data-testid="hero-subtitle">
              XauAi Cloud connects your trading account once — and handles the rest.
              <span className="block text-white/50 mt-1">No VPS. No laptop. No stress.</span>
            </p>
            <p className="text-sm sm:text-base text-white/60 mb-6 sm:mb-8 max-w-xl leading-relaxed" data-testid="hero-subtitle-2">
              Our system runs your gold (XAUUSD) strategy <span className="text-white">24/7 from secure servers</span>,
              copying trades directly to your account in real time — while your funds remain safely with your broker.
            </p>

            <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6 sm:mb-8">
              <Link to="/cloud/signup" className="px-6 py-3 bg-[#D4AF37] text-black font-semibold rounded-full hover:bg-[#E5C558] transition-colors inline-flex items-center justify-center gap-2 group" data-testid="hero-cta-signup">
                Start 7-day free trial
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a href="#how-it-works" className="px-6 py-3 border border-white/10 rounded-full hover:bg-white/5 transition-colors text-center" data-testid="hero-cta-learn">How it works</a>
            </div>

            <div className="flex flex-wrap gap-4 sm:gap-6 text-xs sm:text-sm text-white/50">
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#D4AF37]" /> No VPS needed</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#D4AF37]" /> No MT5 install</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#D4AF37]" /> Pause anytime</div>
            </div>
          </div>

          {/* Dashboard mockup (preserved) */}
          <div className="relative mt-6 lg:mt-0">
            <div className="absolute inset-0 bg-gradient-to-br from-[#D4AF37]/10 via-transparent to-transparent blur-3xl" />
            <div className="relative bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl sm:rounded-3xl p-5 sm:p-8 backdrop-blur-sm" data-testid="hero-mockup">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-green-500/60" />
                </div>
                <div className="font-mono text-[9px] sm:text-xs text-white/40">XAUAI CLOUD · DASHBOARD</div>
              </div>
              <div className="mb-4">
                <div className="text-[10px] sm:text-xs text-white/40 uppercase tracking-widest mb-1">Today's P&L</div>
                <div className="text-3xl sm:text-4xl font-bold text-green-400 font-mono">+$847.32</div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
                <div className="bg-white/5 rounded-lg sm:rounded-xl p-2.5 sm:p-3">
                  <div className="text-[9px] sm:text-[10px] text-white/40 uppercase mb-1">Balance</div>
                  <div className="font-mono font-semibold text-sm sm:text-base">$10,247</div>
                </div>
                <div className="bg-white/5 rounded-lg sm:rounded-xl p-2.5 sm:p-3">
                  <div className="text-[9px] sm:text-[10px] text-white/40 uppercase mb-1">Wins</div>
                  <div className="font-mono font-semibold text-sm sm:text-base text-green-400">12</div>
                </div>
                <div className="bg-white/5 rounded-lg sm:rounded-xl p-2.5 sm:p-3">
                  <div className="text-[9px] sm:text-[10px] text-white/40 uppercase mb-1">Losses</div>
                  <div className="font-mono font-semibold text-sm sm:text-base text-red-400">3</div>
                </div>
              </div>
              <div className="h-20 sm:h-24 bg-gradient-to-t from-[#D4AF37]/5 to-transparent rounded-xl flex items-end justify-between px-3 py-2">
                {[40,50,45,60,55,70,75,68,85,92,88,100].map((h,i)=>(<div key={i} className="w-1 sm:w-1.5 bg-gradient-to-t from-[#D4AF37]/60 to-[#D4AF37] rounded-t" style={{height:`${h}%`}} />))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trader headline strip */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-6 sm:pb-12">
        <div className="border-y border-white/5 py-6 sm:py-8 text-center">
          <div className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="trader-headline">
            Trade smarter, <span className="text-[#D4AF37]">not harder.</span>
          </div>
          <p className="text-white/60 text-sm sm:text-base mt-2 max-w-2xl mx-auto">
            You don't need to stay online, monitor charts, or worry about missing moves.
            <span className="block text-white/80 mt-1 font-medium">We execute. You monitor results.</span>
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20 border-t border-white/5">
        <div className="text-center mb-10 sm:mb-16">
          <div className="text-[10px] sm:text-xs font-mono tracking-[0.3em] text-[#D4AF37] mb-3">HOW IT WORKS</div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-3" data-testid="howworks-title">Three steps. That's it.</h2>
          <p className="text-white/60 text-sm sm:text-base max-w-xl mx-auto">No downloads. No configuration. No technical skills required.</p>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
          {[
            {n:"01", icon:<Lock className="w-6 h-6" />,     title:"Connect your trading account", body:"Enter your MT5 login once. Encrypted at rest — only your executor can read it."},
            {n:"02", icon:<Sparkles className="w-6 h-6" />, title:"Activate XauAi Cloud",          body:"Pick a plan, start your 7-day free trial. We auto-assign you to a cloud executor."},
            {n:"03", icon:<Zap className="w-6 h-6" />,      title:"Trades execute automatically — 24/7", body:"Our XauAi engine fires gold signals, mirrors them to your account in real time, sized to your balance."},
          ].map((f,i)=>(
            <div key={i} className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl p-5 sm:p-6" data-testid={`feature-${i}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/20 flex items-center justify-center text-[#D4AF37]">{f.icon}</div>
                <div className="font-mono text-2xl sm:text-3xl text-white/10 font-bold">{f.n}</div>
              </div>
              <h3 className="text-lg sm:text-xl font-bold mb-2">{f.title}</h3>
              <p className="text-white/60 text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Key Benefits */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-12 sm:pb-20">
        <div className="text-center mb-8 sm:mb-10">
          <div className="text-[10px] sm:text-xs font-mono tracking-[0.3em] text-[#D4AF37] mb-3">WHY XAUAI CLOUD</div>
          <h2 className="text-3xl sm:text-4xl font-bold" data-testid="benefits-title">Built for traders who want results, not screen time.</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 sm:gap-4 max-w-2xl mx-auto" data-testid="benefits-grid">
          {[
            "No VPS or setup needed",
            "No MT5 running on your phone",
            "Real-time trade execution",
            "Fully automated gold trading",
            "Pause anytime, full control",
            "Funds stay with your broker",
          ].map((b,i)=>(
            <div key={i} className="flex items-center gap-3 p-3 sm:p-4 bg-white/[0.03] border border-white/10 rounded-xl" data-testid={`benefit-${i}`}>
              <div className="w-8 h-8 rounded-full bg-[#D4AF37]/15 border border-[#D4AF37]/30 flex items-center justify-center flex-none">
                <Check className="w-4 h-4 text-[#D4AF37]" />
              </div>
              <span className="text-white/85 text-sm sm:text-base">{b}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20 border-t border-white/5">
        <div className="text-center mb-10 sm:mb-12">
          <div className="text-[10px] sm:text-xs font-mono tracking-[0.3em] text-[#D4AF37] mb-3">PRICING</div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">Simple. Honest. No lock-in.</h2>
          <p className="text-white/60 text-sm sm:text-base">7 days free. Cancel anytime.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
          <div className="bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 rounded-2xl sm:rounded-3xl p-6 sm:p-8" data-testid="plan-starter">
            <div className="text-[10px] sm:text-xs font-mono tracking-widest text-white/40 mb-2">STARTER</div>
            <div className="flex items-baseline gap-1 mb-1"><span className="text-4xl sm:text-5xl font-bold">$50</span><span className="text-white/50">/month</span></div>
            <div className="text-sm text-white/50 mb-5 sm:mb-6">For accounts up to $5,000</div>
            <ul className="space-y-3 mb-6 sm:mb-8 text-sm">
              {["Full XauAi bot execution","Trade mirroring to your account","Email trade alerts","Pause/resume anytime","30-day trade history"].map((f,i)=>(<li key={i} className="flex gap-2"><Check className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-none" /><span className="text-white/80">{f}</span></li>))}
            </ul>
            <Link to="/cloud/signup" className="block text-center py-3 border border-white/20 rounded-full hover:bg-white/5 transition-colors" data-testid="plan-starter-cta">Start trial</Link>
          </div>
          <div className="bg-gradient-to-br from-[#D4AF37]/15 to-[#D4AF37]/5 border border-[#D4AF37]/40 rounded-2xl sm:rounded-3xl p-6 sm:p-8 relative" data-testid="plan-pro">
            <div className="absolute -top-3 right-4 sm:right-6 px-3 py-1 bg-[#D4AF37] text-black text-[10px] font-mono font-bold rounded-full">RECOMMENDED</div>
            <div className="text-[10px] sm:text-xs font-mono tracking-widest text-[#D4AF37] mb-2">PRO</div>
            <div className="flex items-baseline gap-1 mb-1"><span className="text-4xl sm:text-5xl font-bold">$100</span><span className="text-white/50">/month</span></div>
            <div className="text-sm text-white/50 mb-5 sm:mb-6">For accounts $5,000+</div>
            <ul className="space-y-3 mb-6 sm:mb-8 text-sm">
              {["Everything in Starter","Priority execution queue","Telegram + Email alerts","Full trade history & analytics","Priority support","Advanced risk controls"].map((f,i)=>(<li key={i} className="flex gap-2"><Check className="w-4 h-4 text-[#D4AF37] mt-0.5 flex-none" /><span className="text-white/80">{f}</span></li>))}
            </ul>
            <Link to="/cloud/signup" className="block text-center py-3 bg-[#D4AF37] text-black font-semibold rounded-full hover:bg-[#E5C558] transition-colors" data-testid="plan-pro-cta">Start trial</Link>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20 border-t border-white/5">
        <div className="text-center mb-8 sm:mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2" data-testid="trust-title">Your funds stay in your broker.</h2>
          <p className="text-white/60 text-sm sm:text-base">We don't hold your money — we only execute trades.</p>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-8 sm:gap-10 text-center">
          <div data-testid="trust-1">
            <Shield className="w-8 h-8 text-[#D4AF37] mx-auto mb-3" />
            <div className="font-bold mb-2">Funds never leave your broker</div>
            <div className="text-sm text-white/60">We only place trades on your behalf. Deposits & withdrawals stay between you and your broker.</div>
          </div>
          <div data-testid="trust-2">
            <Lock className="w-8 h-8 text-[#D4AF37] mx-auto mb-3" />
            <div className="font-bold mb-2">Credentials encrypted at rest</div>
            <div className="text-sm text-white/60">Fernet-AES with per-install keys. Even our database dumps can't reveal your password.</div>
          </div>
          <div data-testid="trust-3">
            <Pause className="w-8 h-8 text-[#D4AF37] mx-auto mb-3" />
            <div className="font-bold mb-2">One-click pause</div>
            <div className="text-sm text-white/60">Stop new trades instantly. Open positions stay untouched and close normally.</div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16 text-center">
        <div className="text-2xl sm:text-3xl font-bold mb-4">Ready to put gold trading on autopilot?</div>
        <Link to="/cloud/signup" className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#D4AF37] text-black font-semibold rounded-full hover:bg-[#E5C558] transition-colors" data-testid="closing-cta">
          Start 7-day free trial <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="text-xs text-white/40 mt-3">No payment. Cancel anytime.</div>
      </section>

      <footer className="border-t border-white/5 py-6 sm:py-8 text-center text-xs sm:text-sm text-white/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <XauAiLogo size={16} />
            <span>© 2026 XauAi — by emriz.eth</span>
          </div>
          <Link to="/" className="hover:text-white/70 inline-flex items-center gap-1" data-testid="footer-diy-link">
            <Activity className="w-3.5 h-3.5" /> Prefer DIY? Buy a PIN →
          </Link>
        </div>
      </footer>
    </div>
  );
}
