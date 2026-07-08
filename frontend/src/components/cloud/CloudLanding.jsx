import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, KeyRound, Lock, RadioTower, Shield, Smartphone, Terminal, Activity } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";

const FEATURES = [
  { icon: Smartphone, title: "Phone-first", body: "Add to your home screen. Check bot status, open trades, and alerts without opening MT5." },
  { icon: Terminal,   title: "Your MT5 / VPS", body: "The EA runs on your own terminal. The dashboard monitors and queues safe commands remotely." },
  { icon: Activity,   title: "Live heartbeat", body: "See the bot state, open trades, daily P&L, AI decisions, and any errors — all in real time." },
  { icon: Lock,       title: "PIN protected", body: "Dangerous actions need license key, confirmation, command queue, EA validation, and audit log." },
];

const INCLUDED = [
  "Live bot heartbeat",
  "MT5 / VPS ready",
  "License activation",
  "AI Director status",
  "ML learning state",
  "PIN-safe remote commands",
  "Structured activity feed",
  "Mobile-first dashboard",
];

export default function CloudLanding() {
  return (
    <div className="min-h-screen bg-[#060609] text-white">
      <InstallAppPrompt />

      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#060609]/90 backdrop-blur-2xl">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between gap-3 px-4 md:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" data-testid="cloud-logo-link">
            <XauAiLogo size={32} className="flex-none" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">XAU AI Sniper Command Center</span>
              <span className="block truncate font-mono text-[9px] uppercase tracking-[0.22em] text-white/35">v6.17.12 · Scan Watchdog Timing Fix</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/command/login" className="rounded-full px-3 py-2 text-[13px] font-medium text-white/55 transition hover:text-white" data-testid="nav-login">Log in</Link>
            <Link to="/command/signup" className="rounded-full bg-emerald-400 px-4 py-2 text-[13px] font-bold text-black transition hover:bg-emerald-300" data-testid="nav-signup">Create account</Link>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:px-8 md:py-16 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/[0.08] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300" data-testid="hero-badge">
              <RadioTower className="h-3 w-3" /> Live bot monitor · v6.17.12
            </div>
            <h1 className="max-w-2xl font-heading text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl" data-testid="hero-title">
              Monitor and control your gold bot from anywhere.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-white/55" data-testid="hero-subtitle">
              Buy the licensed XAU AI Sniper EA, run it on your own MT5 or VPS, then use the Command Center for live heartbeat, AI Director decisions, ML state, trade activity, and PIN-protected remote commands.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link to="/command/signup"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-400 px-6 py-3.5 text-[13px] font-bold text-black transition hover:bg-emerald-300"
                data-testid="hero-cta-signup">
                Create Command Center <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/command/login"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.04] px-6 py-3.5 text-[13px] font-semibold text-white transition hover:bg-white/[0.08]"
                data-testid="hero-cta-login">
                Log in
              </Link>
            </div>
            <p className="mt-4 text-[11px] leading-5 text-white/28">Trading is risky. Start on demo. Verify broker execution before going live.</p>
          </div>

          {/* Dashboard preview */}
          <div>
            <div className="rounded-[28px] border border-white/[0.09] bg-[#0c0d11] p-4 shadow-2xl shadow-black/50">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-white/30">Bot status</div>
                  <div className="mt-0.5 flex items-center gap-2 font-mono text-xl font-black text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> ONLINE
                  </div>
                </div>
                <div className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1.5 text-[11px] font-bold text-amber-200">
                  <KeyRound className="mr-1 inline h-3 w-3" /> PIN safe
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                {[["Equity","$12,847"],["AI conf.","87%"],["State","Managing"]].map(([k,v]) => (
                  <div key={k} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
                    <div className="font-mono text-[9px] uppercase tracking-widest text-white/30">{k}</div>
                    <div className="mt-1 font-mono text-[12px] font-bold">{v}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3 mb-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">AI Director feed</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </div>
                <div className="space-y-2 text-[11px] leading-5 text-white/52">
                  <p><span className="font-mono text-violet-300">AI</span> · Claude ALLOW · confidence 87%</p>
                  <p><span className="font-mono text-amber-200">BLOCK</span> · Spread guard delayed entry</p>
                  <p><span className="font-mono text-sky-300">ML</span> · 18 matching samples WR 67%</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-emerald-400 px-3 py-2.5 text-center text-[12px] font-bold text-black">Resume</div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-center text-[12px] font-semibold">Force sync</div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature cards */}
        <section className="mx-auto max-w-7xl px-4 pb-12 md:px-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
                <Icon className="mb-4 h-5 w-5 text-amber-200" />
                <h3 className="text-[14px] font-semibold">{title}</h3>
                <p className="mt-2 text-[13px] leading-6 text-white/48">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works + What you get */}
        <section className="mx-auto max-w-7xl px-4 pb-12 md:px-8">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200 mb-2">How it works</div>
              <h2 className="text-2xl font-semibold tracking-tight mb-5">Buy, install, activate, monitor.</h2>
              <div className="space-y-2.5">
                {["Buy a license and download the EA v6.17.12", "Install it on MT5 or your VPS, add your PIN", "Open /command — see heartbeat, AI decisions, trades, blocks, and errors"].map((step, i) => (
                  <div key={step} className="flex items-center gap-3 rounded-xl bg-black/[0.18] px-3 py-3">
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-emerald-400 font-mono text-[11px] font-black text-black">{i + 1}</span>
                    <span className="text-[13px] text-white/75">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-emerald-300/20 bg-emerald-300/[0.05] p-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-300 mb-2">What you get</div>
              <h2 className="text-2xl font-semibold tracking-tight mb-5">Everything in one dashboard.</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {INCLUDED.map((item) => (
                  <div key={item} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/[0.14] px-3 py-2.5">
                    <Check className="h-3.5 w-3.5 flex-none text-emerald-400" />
                    <span className="text-[13px] text-white/72">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-3xl px-4 pb-16 text-center md:px-8">
          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-8">
            <Shield className="mx-auto mb-4 h-7 w-7 text-amber-200" />
            <h2 className="text-2xl font-semibold tracking-tight">Run the bot locally. See everything remotely.</h2>
            <p className="mx-auto mt-3 max-w-lg text-[13px] leading-6 text-white/48">
              The Command Center is for licensed users who want live status, AI Director decisions, ML state, alerts, and queue-based safe controls — without sitting beside MT5.
            </p>
            <Link to="/command/signup" className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-400 px-7 py-3.5 text-[13px] font-bold text-black hover:bg-emerald-300 transition">
              Create Command Center <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
