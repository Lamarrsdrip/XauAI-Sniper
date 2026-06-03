import React from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Check, KeyRound, Lock, RadioTower, Shield, Smartphone, Terminal, Zap } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";

const benefits = [
  "Live bot heartbeat",
  "MT5/VPS ready",
  "License activation",
  "PIN-safe remote commands",
  "Structured activity feed",
  "Mobile-first dashboard",
];

export default function CloudLanding() {
  return (
    <div className="min-h-screen bg-[#07090d] text-white">
      <InstallAppPrompt />

      <nav className="sticky top-0 z-40 border-b border-white/10 bg-[#07090d]/[0.88] backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 md:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-3" data-testid="cloud-logo-link">
            <XauAiLogo size={34} className="flex-none" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold sm:text-base">XAU AI Sniper Command Center</span>
              <span className="block truncate font-mono text-[9px] uppercase tracking-[0.22em] text-white/38">bot activity monitor</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/command/login" className="rounded-full px-3 py-2 text-xs font-semibold text-white/62 transition hover:text-white" data-testid="nav-login">Log in</Link>
            <Link to="/command/signup" className="rounded-full bg-emerald-300 px-4 py-2 text-xs font-extrabold uppercase tracking-wider text-[#06110c] transition hover:bg-emerald-200" data-testid="nav-signup">Create account</Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:px-8 md:py-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-200" data-testid="hero-badge">
              <RadioTower className="h-3.5 w-3.5" /> Phone dashboard for your MT5 bot
            </div>
            <h1 className="max-w-3xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl" data-testid="hero-title">
              Monitor and control your gold bot from anywhere.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/62" data-testid="hero-subtitle">
              Buy the licensed XAU AI Sniper EA, install it on your own MT5 or VPS, activate your license key, then use the Command Center for live heartbeat, activity logs, alerts, and PIN-protected remote commands.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/command/signup" className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 py-3.5 text-sm font-extrabold text-[#06110c] transition hover:bg-emerald-200" data-testid="hero-cta-signup">
                Create Command Center <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/command/login" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.1]" data-testid="hero-cta-login">
                Log in
              </Link>
            </div>
            <p className="mt-4 text-xs leading-5 text-white/38">Trading is risky. Start on demo, verify your broker execution, and keep risk sized to your account.</p>
          </div>

          <div className="relative">
            <div className="rounded-[32px] border border-white/10 bg-white/[0.055] p-3 shadow-2xl shadow-black/40">
              <div className="rounded-[24px] border border-white/10 bg-[#0b1118] p-4">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Bot status</div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-2xl font-black text-emerald-300">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /> ONLINE
                    </div>
                  </div>
                  <div className="rounded-full bg-amber-300/12 px-3 py-2 text-xs font-bold text-amber-100">
                    <KeyRound className="mr-1 inline h-3.5 w-3.5" /> PIN safe
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["Equity", "$245k"],
                    ["Open", "2"],
                    ["State", "Managing"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                      <div className="font-mono text-[9px] uppercase tracking-widest text-white/35">{k}</div>
                      <div className="mt-1 font-mono text-sm font-bold">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/[0.24] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-white/35">Live activity feed</span>
                    <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  </div>
                  <div className="space-y-3 text-xs leading-5 text-white/58">
                    <p><span className="font-mono text-emerald-300">TRADE</span> · XAUUSD SELL managed by EA</p>
                    <p><span className="font-mono text-amber-200">BLOCK</span> · Spread guard delayed fresh entry</p>
                    <p><span className="font-mono text-sky-200">SYNC</span> · Startup intelligence memory loaded</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-emerald-300 px-4 py-3 text-center text-sm font-extrabold text-[#06110c]">Resume</div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-center text-sm font-bold">Force sync</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 md:px-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Smartphone, title: "Phone-first", body: "Add the Command Center to your phone home screen and check bot status like an app." },
              { icon: Terminal, title: "Your MT5/VPS", body: "The EA runs on your own terminal. The dashboard monitors and queues safe commands." },
              { icon: Activity, title: "Live heartbeat", body: "Offline bot, disabled Algo Trading, MT5 disconnect, and errors become clear alerts." },
              { icon: Lock, title: "PIN protected", body: "Dangerous actions require PIN, confirmation, command queue, EA validation, and audit log." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.045] p-5">
                <Icon className="mb-4 h-6 w-6 text-amber-200" />
                <h3 className="font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/52">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 md:px-8">
          <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.045] p-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200">How it works</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight">Buy, install, activate, monitor.</h2>
              <div className="mt-6 space-y-3">
                {["Buy a license and download the EA", "Install it on MT5 or your VPS", "Open /command to monitor heartbeat, trades, blocks, and errors"].map((step, i) => (
                  <div key={step} className="flex items-center gap-3 rounded-2xl bg-black/[0.22] p-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-300 font-mono text-xs font-black text-[#06110c]">{i + 1}</span>
                    <span className="text-sm font-semibold text-white/80">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-emerald-300/20 bg-emerald-300/[0.08] p-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-emerald-200">What you get</div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {benefits.map((benefit) => (
                  <div key={benefit} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/[0.18] p-3">
                    <Check className="h-4 w-4 flex-none text-emerald-300" />
                    <span className="text-sm text-white/76">{benefit}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-7xl px-4 pb-16 md:px-8">
          <div className="rounded-[30px] border border-white/10 bg-white/[0.045] p-6 sm:p-8">
            <div className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200">License flow</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight">Licensed bot, not copy trading.</h2>
              <p className="mt-2 text-sm leading-6 text-white/52">Users buy the EA license, run it on their own MT5/VPS, and use the Command Center for visibility and safe controls.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                ["License", "Download EA", "Get the EA file, license key, setup guide, version history, and changelog."],
                ["Command Center", "Monitor remotely", "Watch heartbeat, open trades, blocked trades, errors, sync state, and queued command acknowledgements."],
              ].map(([name, title, body]) => (
                <div key={name} className="rounded-3xl border border-white/10 bg-black/[0.2] p-5">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">{name}</div>
                  <div className="mt-2 text-2xl font-black">{title}</div>
                  <p className="mt-2 text-sm leading-6 text-white/52">{body}</p>
                  <div className="mt-5 flex items-center gap-2 text-sm text-white/70">
                    <Shield className="h-4 w-4 text-emerald-300" /> Built for your own MT5 account
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-16 text-center md:px-8">
          <div className="rounded-[30px] border border-white/10 bg-white/[0.055] p-6 sm:p-10">
            <Zap className="mx-auto mb-4 h-8 w-8 text-amber-200" />
            <h2 className="text-3xl font-black tracking-tight">Run the bot locally. See everything remotely.</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/55">
              The Command Center is for licensed users who want live status, activity, alerts, and safe queue-based control without sitting beside MT5 all day.
            </p>
            <Link to="/command/signup" className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-300 px-7 py-3.5 text-sm font-extrabold text-[#06110c]">
              Create Command Center <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
