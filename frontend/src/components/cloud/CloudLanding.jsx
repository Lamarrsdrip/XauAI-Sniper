import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  KeyRound,
  Lock,
  RadioTower,
  Shield,
  Smartphone,
  Terminal,
  Activity,
  Bell,
  ListChecks,
  Share,
  PlusSquare,
} from "lucide-react";
import InstallAppPrompt from "./InstallAppPrompt";
import XauAiLogo from "./XauAiLogo";
import Seo from "../Seo";

const FEATURES = [
  { icon: RadioTower, title: "Live bot status", body: "Heartbeat, system state, open positions, P&L and operational alerts in one place." },
  { icon: Activity, title: "Decision visibility", body: "Follow current trade context, AI confidence, blockers and decisions without reading terminal logs." },
  { icon: Bell, title: "Alerts that matter", body: "See important trade, system and risk events without drowning in technical noise." },
  { icon: Lock, title: "Protected remote actions", body: "Sensitive commands remain behind confirmation, PIN protection, queue validation and audit history." },
];

const INCLUDED = [
  "Live EA heartbeat",
  "Open trade visibility",
  "AI decision context",
  "M10 / market intelligence status",
  "Trade and position history",
  "Risk and system alerts",
  "PIN-safe remote commands",
  "Phone-first experience",
];

function InterfacePreview() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/[0.10] bg-[#0A0B0F] shadow-[0_30px_90px_rgba(0,0,0,.45)]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          <span className="text-[11px] font-semibold text-white/80">Command Center</span>
        </div>
        <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-white/34">Product overview</span>
      </div>

      <div className="grid gap-px bg-white/[0.06] md:grid-cols-[0.72fr_1.28fr]">
        <div className="bg-[#0B0C10] p-4">
          <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-white/35">EA connection</div>
          <div className="mt-1 text-lg font-black text-emerald-300">Online</div>

          <div className="mt-5 space-y-3">
            {[
              ["Account", "Connected"],
              ["Open positions", "Visible"],
              ["AI state", "Available"],
              ["Remote control", "PIN safe"],
            ].map(([k, v]) => (
              <div key={k} className="border-b border-white/[0.06] pb-3 last:border-0">
                <div className="text-[9px] text-white/35">{k}</div>
                <div className="mt-1 text-[11px] font-bold text-white/76">{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#0D0E13] p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["Current status", "See what the EA is doing now."],
              ["Trade context", "Understand why a trade is active, blocked or waiting."],
              ["Activity", "Follow important system and trading events."],
              ["Controls", "Queue protected actions without sitting beside MT5."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
                <div className="text-[10.5px] font-bold text-white/82">{title}</div>
                <div className="mt-1 text-[9.5px] leading-4 text-white/42">{body}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-[#F3C969]/15 bg-[#F3C969]/[0.04] px-3 py-3 text-[10px] leading-5 text-white/58">
            The Command Center does not replace MT5. Your EA continues to run on your own terminal or VPS; the Command Center gives you a professional remote view and protected control layer.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CloudLanding() {
  return (
    <div className="min-h-screen bg-[#060609] text-white">
      <Seo
        title="XauCloud Command Center — Monitor Your Gold Trading Bot Remotely"
        description="XauCloud Command Center gives licensed users a professional remote view of EA heartbeat, trades, AI decisions, alerts, history and protected commands."
        path="/command"
      />
      <InstallAppPrompt />

      <nav className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#060609]/94 backdrop-blur-2xl">
        <div className="mx-auto flex h-[64px] max-w-7xl items-center justify-between gap-3 px-4 md:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" data-testid="cloud-logo-link">
            <XauAiLogo size={32} className="flex-none" />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">XauCloud Command Center</span>
              <span className="block truncate font-mono text-[8px] uppercase tracking-[0.20em] text-white/30">Remote monitoring & control</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/command/login" className="rounded-full px-3 py-2 text-[12px] font-medium text-white/54 transition hover:text-white" data-testid="nav-login">Log in</Link>
            <Link to="/command/signup" className="rounded-full bg-[#F3C969] px-4 py-2.5 text-[12px] font-bold text-black transition hover:brightness-105" data-testid="nav-signup">Create account</Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="mx-auto grid max-w-7xl gap-12 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#F3C969]/20 bg-[#F3C969]/[0.06] px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.20em] text-[#F3C969]" data-testid="hero-badge">
              <RadioTower className="h-3 w-3" /> XauCloud Command Center
            </div>
            <h1 className="max-w-2xl font-heading text-4xl font-semibold leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-[3.7rem]" data-testid="hero-title">
              Your XauCloud trading system, visible from anywhere.
            </h1>
            <p className="mt-5 max-w-xl text-[14px] leading-7 text-white/54" data-testid="hero-subtitle">
              Monitor EA heartbeat, open trades, P&L, AI decision context, alerts and protected remote actions without keeping MT5 open in front of you.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/command/signup"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F3C969] px-6 py-3.5 text-[13px] font-bold text-black transition hover:brightness-105"
                data-testid="hero-cta-signup"
              >
                Create Command Center <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/command/login"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/[0.11] px-6 py-3.5 text-[13px] font-semibold text-white transition hover:bg-white/[0.04]"
                data-testid="hero-cta-login"
              >
                Log in
              </Link>
            </div>

            <div className="mt-8 border-y border-white/[0.07] py-4">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 h-5 w-5 flex-none text-[#F3C969]" />
                <div>
                  <div className="text-[12px] font-bold text-white/84">Use Command Center like an app</div>
                  <div className="mt-1 text-[11px] leading-5 text-white/44">
                    On iPhone: Share <Share className="mx-1 inline h-3 w-3 text-[#F3C969]" /> → <PlusSquare className="mx-1 inline h-3 w-3 text-[#F3C969]" /> Add to Home Screen. On supported Android browsers, install directly when prompted.
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-4 text-[10.5px] leading-5 text-white/26">Trading is risky. Verify broker execution and account settings before live use.</p>
          </div>

          <InterfacePreview />
        </section>

        <section className="border-y border-white/[0.06] bg-[#08090C]">
          <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
            <div className="grid gap-8 lg:grid-cols-[0.65fr_1.35fr]">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#F3C969]">What Command Center does</div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">The operating view around your EA.</h2>
                <p className="mt-3 max-w-md text-[12.5px] leading-6 text-white/43">
                  Execution remains on MT5 / VPS. Command Center turns the system into something you can actually monitor and understand from anywhere.
                </p>
              </div>
              <div className="grid gap-x-7 gap-y-6 sm:grid-cols-2">
                {FEATURES.map(({ icon: Icon, title, body }) => (
                  <div key={title} className="border-t border-white/[0.09] pt-4">
                    <Icon className="h-4 w-4 text-[#F3C969]" />
                    <h3 className="mt-3 text-[13px] font-semibold">{title}</h3>
                    <p className="mt-2 text-[12px] leading-6 text-white/43">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-14 md:px-8 md:py-20">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#F3C969]">How it works</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">From MT5 to your phone in four steps.</h2>

              <div className="mt-7 border-y border-white/[0.08]">
                {[
                  ["01", "Install XauCloud", "Run the licensed EA on your MT5 terminal or VPS."],
                  ["02", "Connect your account", "Activate the license and connect the EA to your Command Center profile."],
                  ["03", "Monitor the system", "See heartbeat, trades, AI context, alerts and activity remotely."],
                  ["04", "Use protected controls", "Queue supported remote actions through confirmation and PIN-safe workflows."],
                ].map(([n, title, body]) => (
                  <div key={n} className="grid grid-cols-[48px_1fr] gap-3 border-b border-white/[0.07] py-4 last:border-0">
                    <div className="font-mono text-[10px] font-black text-[#F3C969]">{n}</div>
                    <div>
                      <div className="text-[12.5px] font-bold text-white/82">{title}</div>
                      <div className="mt-1 text-[11px] leading-5 text-white/40">{body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#F3C969]">Included</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">One place for the information that matters.</h2>
              <div className="mt-7 grid gap-2 sm:grid-cols-2">
                {INCLUDED.map((item) => (
                  <div key={item} className="flex items-center gap-2.5 border-b border-white/[0.07] py-3">
                    <Check className="h-3.5 w-3.5 flex-none text-emerald-300" />
                    <span className="text-[12px] text-white/62">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-white/[0.06] bg-[#08090C]">
          <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#F3C969]">Add to Home Screen</div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Keep XauCloud one tap away.</h2>
                <p className="mt-3 max-w-2xl text-[12.5px] leading-6 text-white/43">
                  Add Command Center to your phone before you even log in. It opens full-screen and gives you fast access to monitoring, alerts and account controls.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full border border-white/[0.10] px-4 py-2 text-white/68">iPhone · Add to Home Screen</span>
                <span className="rounded-full border border-white/[0.10] px-4 py-2 text-white/68">Android · Install when available</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-16 text-center md:px-8">
          <Shield className="mx-auto h-6 w-6 text-[#F3C969]" />
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">Run execution on MT5. Run visibility from anywhere.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-[13px] leading-6 text-white/43">
            XauCloud Command Center is the professional monitoring and control layer around the licensed EA — built for users who want to understand what the system is doing without sitting beside the terminal.
          </p>
          <Link to="/command/signup" className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#F3C969] px-7 py-3.5 text-[13px] font-bold text-black transition hover:brightness-105">
            Create Command Center <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </main>
    </div>
  );
}
