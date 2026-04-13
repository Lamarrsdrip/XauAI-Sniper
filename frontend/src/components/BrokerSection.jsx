import React from "react";
import { Handshake, Check, ArrowSquareOut, Gift } from "@phosphor-icons/react";

const TRADE_COM_REFERRAL = "https://join.trade.com/c/lp07/?lp=6&affid=1064237198";
const TRADE_COM_LOGO = "https://static.prod-images.emergentagent.com/jobs/a0d76eb0-1956-4da1-ad00-cd40d1b3f75f/images/4d54ff56f8cb5f6dda1e0a9743385e51fe1a4e645f8997eedc69687d66ebfd88.png";

export default function BrokerSection() {
  return (
    <div className="bg-muted/30 border-t border-border" data-testid="broker-section">
      <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-12">
        {/* Partner badge */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/30 mb-4">
            <Handshake size={12} weight="bold" className="text-primary" />
            <span className="text-xs font-mono font-bold tracking-[0.15em] text-primary">
              OFFICIAL BROKER PARTNER
            </span>
          </div>
        </div>

        <div className="border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-5 items-center">
            {/* Logo + Bonus */}
            <div className="lg:col-span-2 p-8 flex flex-col items-center text-center border-b lg:border-b-0 lg:border-r border-border">
              <img src={TRADE_COM_LOGO} alt="Trade.com" className="h-12 mb-4 object-contain" data-testid="broker-logo" />
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[hsl(142,71%,45%)]/10 border border-[hsl(142,71%,45%)]/30 mb-3">
                <Gift size={16} weight="fill" className="text-[hsl(142,71%,45%)]" />
                <span className="font-mono text-lg font-black text-[hsl(142,71%,45%)]">75% DEPOSIT BONUS</span>
              </div>
              <p className="text-xs text-muted-foreground">on every deposit through our partner link</p>
            </div>

            {/* Info + CTA */}
            <div className="lg:col-span-3 p-8">
              <h3 className="font-heading text-xl font-bold tracking-tight mb-3" data-testid="broker-title">
                Trade with Trade.com — Get 75% Bonus
              </h3>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                We highly recommend creating your MT5 account on <strong>Trade.com</strong> to use MrizAI Sniper.
                Sign up through our partner link and get a <strong>75% bonus on every deposit</strong> you make.
                More capital = more profit potential for the bot.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                {[
                  "75% bonus on all deposits",
                  "MT5 platform supported",
                  "Low spreads on XAUUSD",
                  "Fast withdrawals",
                  "Regulated broker",
                  "24/7 customer support",
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Check size={14} weight="bold" className="text-[hsl(142,71%,45%)] flex-shrink-0" />
                    <span className="text-sm">{f}</span>
                  </div>
                ))}
              </div>
              <a
                href={TRADE_COM_REFERRAL}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="broker-signup-btn"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-bold text-sm tracking-wide hover:-translate-y-[1px] transition-transform duration-150 shadow-[2px_2px_0px_hsl(0,0%,4%)]"
              >
                CREATE TRADE.COM ACCOUNT
                <ArrowSquareOut size={16} weight="bold" />
              </a>
              <p className="text-xs text-muted-foreground mt-3">
                Already have a Trade.com account? You can still use MrizAI Sniper with any MT5 broker.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
