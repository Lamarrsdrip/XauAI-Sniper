import React from "react";
import { Link } from "react-router-dom";
import { Cloud, Zap, Shield, Smartphone, TrendingUp, Check, ArrowRight } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";

export default function CloudLanding() {
  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <InstallAppPrompt />
      {/* Nav */}
      <nav className="sticky top-0 z-40 backdrop-blur-xl bg-[#050505]/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 min-w-0" data-testid="cloud-logo-link">
            <Cloud className="w-5 h-5 sm:w-6 sm:h-6 text-[#D4AF37] flex-none" />
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
              Never run MT5 <br className="hidden sm:block" />on your phone <span className="text-[#D4AF37]">again.</span>
            </h1>
            <p className="text-base sm:text-lg text-white/70 mb-6 sm:mb-8 max-w-xl leading-relaxed" data-testid="hero-subtitle">
              XauAi Cloud hosts the trading engine for you. Connect your broker account once — we trade gold on your behalf, 24/7, from our servers. Your funds stay safely with your broker.
            </p>
            <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-6 sm:mb-8">
              <Link to="/cloud/signup" className="px-6 py-3 bg-[#D4AF37] text-black font-semibold rounded-full hover:bg-[#E5C558] transition-colors inline-flex items-center justify-center gap-2" data-testid="hero-cta-signup">
                Start 7-day free trial <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="#how-it-works" className="px-6 py-3 border border-white/10 rounded-full hover:bg-white/5 transition-colors text-center" data-testid="hero-cta-learn">How it works</a>
            </div>
            <div className="flex flex-wrap gap-4 sm:gap-6 text-xs sm:text-sm text-white/50">
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#D4AF37]" /> No VPS needed</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#D4AF37]" /> No MT5 install</div>
              <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#D4AF37]" /> Pause anytime</div>
            </div>
          </div>

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

      {/* Features */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-4 sm:px-6 py-12 sm:py-20 border-t border-white/5">
        <div className="text-center mb-10 sm:mb-16">
          <div className="text-[10px] sm:text-xs font-mono tracking-[0.3em] text-[#D4AF37] mb-3">HOW IT WORKS</div>
          <h2 className="text-3xl sm:text-4xl font-bold mb-3" data-testid="howworks-title">Three steps. That's it.</h2>
          <p className="text-white/60 text-sm sm:text-base max-w-xl mx-auto">No downloads. No configuration. No technical skills required.</p>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
          {[
            {n:"01",icon:<Smartphone className="w-6 h-6" />,title:"Sign up",body:"Email + password. Start your 7-day free trial instantly, no payment required."},
            {n:"02",icon:<Shield className="w-6 h-6" />,title:"Connect broker",body:"Enter your MT5 login once. We encrypt and store it securely — only your executor can read it."},
            {n:"03",icon:<Zap className="w-6 h-6" />,title:"We trade. You watch.",body:"Our bot runs 24/7 on our servers. Every trade mirrors to your account, sized to your balance."},
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
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-8 sm:gap-10 text-center">
          <div data-testid="trust-1">
            <Shield className="w-8 h-8 text-[#D4AF37] mx-auto mb-3" />
            <div className="font-bold mb-2">Your funds never leave your broker</div>
            <div className="text-sm text-white/60">We only execute trades on your behalf. Deposits & withdrawals stay between you and your broker.</div>
          </div>
          <div data-testid="trust-2">
            <Cloud className="w-8 h-8 text-[#D4AF37] mx-auto mb-3" />
            <div className="font-bold mb-2">Credentials encrypted at rest</div>
            <div className="text-sm text-white/60">Fernet-AES encryption with per-install keys. Even our database dumps can't reveal your password.</div>
          </div>
          <div data-testid="trust-3">
            <TrendingUp className="w-8 h-8 text-[#D4AF37] mx-auto mb-3" />
            <div className="font-bold mb-2">One-click pause</div>
            <div className="text-sm text-white/60">Stop all new trades instantly. Your open positions remain untouched and close normally.</div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5 py-6 sm:py-8 text-center text-xs sm:text-sm text-white/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>© 2026 XauAi — by emriz.eth</div>
          <Link to="/" className="hover:text-white/70" data-testid="footer-diy-link">Prefer DIY? Buy a PIN →</Link>
        </div>
      </footer>
    </div>
  );
}
