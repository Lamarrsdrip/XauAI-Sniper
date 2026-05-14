import React from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowRight, Check, Cloud, Lock, Pause, Shield, Smartphone, Zap } from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";

const benefits = [
  "No VPS setup",
  "No MT5 left running at home",
  "Pause anytime",
  "Trade alerts",
  "Broker funds stay with you",
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
              <span className="block truncate text-sm font-bold sm:text-base">XauAI Cloud</span>
              <span className="block truncate font-mono text-[9px] uppercase tracking-[0.22em] text-white/38">copy trading hub</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/cloud/login" className="rounded-full px-3 py-2 text-xs font-semibold text-white/62 transition hover:text-white" data-testid="nav-login">Log in</Link>
            <Link to="/cloud/signup" className="rounded-full bg-emerald-300 px-4 py-2 text-xs font-extrabold uppercase tracking-wider text-[#06110c] transition hover:bg-emerald-200" data-testid="nav-signup">Start</Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:px-8 md:py-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-200" data-testid="hero-badge">
              <Cloud className="h-3.5 w-3.5" /> Cloud execution
            </div>
            <h1 className="max-w-3xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl" data-testid="hero-title">
              Your gold bot, running from the cloud.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/62" data-testid="hero-subtitle">
              Connect your MT5 account once. XauAI Cloud mirrors the master signals, shows live reasoning, and gives you a simple mobile control center.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/cloud/signup" className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 py-3.5 text-sm font-extrabold text-[#06110c] transition hover:bg-emerald-200" data-testid="hero-cta-signup">
                Start free trial <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/cloud/login" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/[0.1]" data-testid="hero-cta-login">
                Open dashboard
              </Link>
            </div>
            <p className="mt-4 text-xs leading-5 text-white/38">No trading result is guaranteed. Use demo first and keep risk sized to your account.</p>
          </div>

          <div className="relative">
            <div className="rounded-[32px] border border-white/10 bg-white/[0.055] p-3 shadow-2xl shadow-black/40">
              <div className="rounded-[24px] border border-white/10 bg-[#0b1118] p-4">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/35">Today</div>
                    <div className="mt-1 font-mono text-3xl font-black text-emerald-300">+$847.32</div>
                  </div>
                  <button className="rounded-full bg-red-400/12 px-3 py-2 text-xs font-bold text-red-200">
                    <Pause className="mr-1 inline h-3.5 w-3.5" /> Pause
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["Balance", "$10,247"],
                    ["Trades", "15"],
                    ["Win rate", "80%"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                      <div className="font-mono text-[9px] uppercase tracking-widest text-white/35">{k}</div>
                      <div className="mt-1 font-mono text-sm font-bold">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/[0.24] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-white/35">Bot activity</span>
                    <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  </div>
                  <div className="space-y-3 text-xs leading-5 text-white/58">
                    <p><span className="font-mono text-emerald-300">FIRE</span> · XAUUSD BUY copied to account</p>
                    <p><span className="font-mono text-amber-200">SOFT</span> · SMART-GUARD reduced risk on B setup</p>
                    <p><span className="font-mono text-sky-200">SYNC</span> · Worker heartbeat received</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button className="rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-extrabold text-[#06110c]">Resume</button>
                  <button className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-bold">Risk</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 md:px-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Smartphone, title: "Phone-first", body: "Dashboard, pause, billing, and status are clean on mobile." },
              { icon: Shield, title: "Broker-safe", body: "Your deposits and withdrawals stay with your broker." },
              { icon: Activity, title: "Live reasoning", body: "See why the master bot fired, paused, or skipped a trade." },
              { icon: Lock, title: "Encrypted", body: "Credentials are stored securely and can be removed anytime." },
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
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200">Simple setup</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight">Three steps. Then monitor.</h2>
              <div className="mt-6 space-y-3">
                {["Create cloud account", "Connect your MT5 login", "Choose plan and let the worker run"].map((step, i) => (
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
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200">Pricing</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight">Simple plans, no lock-in.</h2>
              <p className="mt-2 text-sm leading-6 text-white/52">Start on trial, connect demo first, then choose the cloud level that fits your account size.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                ["Starter", "$50", "For smaller accounts testing cloud execution", ["Master signal copy", "Email alerts", "Pause/resume", "30-day history"]],
                ["Pro", "$100", "For active accounts that need priority monitoring", ["Everything in Starter", "Priority queue", "Telegram + email", "Advanced controls"]],
              ].map(([name, price, body, items]) => (
                <div key={name} className="rounded-3xl border border-white/10 bg-black/[0.2] p-5">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-white/35">{name}</div>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-4xl font-black">{price}</span>
                    <span className="pb-1 text-sm text-white/45">/mo</span>
                  </div>
                  <p className="mt-2 text-sm text-white/52">{body}</p>
                  <div className="mt-5 space-y-2">
                    {items.map((item) => (
                      <div key={item} className="flex items-center gap-2 text-sm text-white/70">
                        <Check className="h-4 w-4 text-emerald-300" /> {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-16 text-center md:px-8">
          <div className="rounded-[30px] border border-white/10 bg-white/[0.055] p-6 sm:p-10">
            <Zap className="mx-auto mb-4 h-8 w-8 text-amber-200" />
            <h2 className="text-3xl font-black tracking-tight">Put the master EA on autopilot.</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/55">
              Start with demo, verify execution, then scale only when the results match your risk plan.
            </p>
            <Link to="/cloud/signup" className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-300 px-7 py-3.5 text-sm font-extrabold text-[#06110c]">
              Start free trial <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
