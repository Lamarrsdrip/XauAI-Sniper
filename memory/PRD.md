# AI Sniper EA - PRD

## Architecture
Frontend: React + Tailwind | Backend: FastAPI + MongoDB | EA: MQL5 with ML | Payments: Paystack (NGN) | Auth: JWT

## Implemented (Iterations 1-6)
- MQL5 EA: multi-strategy, AI classification, enhanced pattern memory ML with loss avoidance, time-slot filtering, dynamic thresholds, streak awareness
- Admin Portal (/admin): JWT auth, 5 tabs: Licenses, Settings, EA Config, Payments, Account
- Account management: Change admin email and password (requires current password verification)
- Settings: Paystack key, PIN price (₦), Gmail email for auto PIN delivery
- Public Site: Overview, Buy (Paystack ₦300,000), How It Works, Setup Guide, Visual Walkthrough, Performance, Download
- Each user runs their own EA independently - trades never clash, pattern learning is local per user

## Enhanced AI/ML Features
- Loss avoidance: Skips trades during historically losing time slots (>65% loss rate)
- Dynamic threshold: Tightens confidence requirement when recent win rate drops below 60%
- Streak awareness: Requires higher confidence after 2+ consecutive losses
- Wider ML adjustment range (-20 to +20) for more impact from learning
- Pattern memory persists across sessions (saved to file)

## Admin: admin@aisniper.com / Admin@2026!

## Backlog
P1: Telegram alerts, Smart Money Concepts, PIN expiry tiers
P2: Referral system, multi-language, customer dashboard
