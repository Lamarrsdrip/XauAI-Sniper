# AI Sniper EA - PRD

## Architecture
Frontend: React + Tailwind | Backend: FastAPI + MongoDB | EA: MQL5 with ML | Payments: Paystack (NGN) | Auth: JWT

## Centralized ML System
- ALL users' trade patterns stored in MongoDB (global learning)
- EA submits trade outcomes to server after each trade
- Before each trade, EA asks server for confidence adjustment based on ALL users' historical data
- Server analyzes: market condition + strategy + time of day + day of week + RSI similarity
- Weighted win rate calculation: Strategy (40%) + Time (35%) + RSI (25%)
- Skip trade flag: If time slot has <30% win rate globally, blocks the trade entirely
- Local ML as fallback if server unreachable

## Implemented (Iterations 1-7)
- MQL5 EA: multi-strategy, AI classification, cloud ML + local ML fallback
- Admin Portal (/admin): JWT auth, 5 tabs (Licenses, Settings, EA Config, Payments, Account)
- Admin account: Change email/password with current password verification
- Centralized ML: /api/ml/submit-pattern, /api/ml/get-confidence, /api/ml/stats
- Paystack ₦300,000/PIN, Gmail auto-delivery, live XAUUSD ticker
- Public: Overview, Buy, How It Works, Setup Guide, Visual Walkthrough, Performance, Download

## Admin: admin@aisniper.com / Admin@2026!

## Backlog
P1: Telegram alerts, Smart Money Concepts, PIN expiry
P2: Referral system, customer dashboard, multi-language
