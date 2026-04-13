# AI Sniper EA - XAUUSD Trading Bot - PRD

## Architecture
- **Frontend**: React + Tailwind CSS | **Backend**: FastAPI + MongoDB | **EA**: MQL5 (~1000+ lines with ML)
- **Payments**: Paystack (Naira, ₦300,000/PIN) | **Gold Price**: Live scraping Google/Yahoo Finance

## What's Implemented (Iterations 1-4)
- Complete MQL5 EA: multi-strategy (Trend/Range/Breakout), AI market classification, pattern memory ML, PIN validation
- Web dashboard: hero, performance charts, architecture explorer, configurator with profit presets
- PIN License System: generate (manual for seller), validate (EA calls API), revoke, delete
- Paystack payment: ₦300,000/PIN, auto-PIN generation after payment (needs Paystack key in .env)
- Live XAUUSD ticker: scraped from Google Finance (~$4,700-5,000 range)
- How It Works: 8-step tutorial + 6 FAQs
- Setup Guide: 10-step beginner guide ("Even a 10-Year-Old Can Follow This")
- Visual Walkthrough: 6-scene interactive demo covering MT5 install → VPS setup
- Profit presets: Conservative (20%), Moderate (35%), Aggressive (50% weekly)

## To activate Paystack payments:
1. Get your secret key from dashboard.paystack.com > Settings > API Keys
2. Add to /app/backend/.env: `PAYSTACK_SECRET_KEY=sk_live_xxxxx`
3. Restart backend

## Backlog
P1: Telegram alerts, email PIN delivery, Smart Money Concepts, PIN expiration
P2: Admin auth, live MT5 analytics, referral system, VPS partner integration
