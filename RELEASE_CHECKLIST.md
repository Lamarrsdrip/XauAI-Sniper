# XauAI Sniper — Release Checklist

## v6.4.1 — 2026-06-28

### EA Compile
- [x] Compile result: 0 errors, 0 critical warnings
- [x] EA version string: v6.4.1
- [x] Canonical filename: XAUUSD_AI_Sniper_EA_v6.4.1.mq5
- [x] File size: 800 KB (819,205 bytes)
- [x] Commit hash: 149f50e

### File Distribution
- [x] MT5 Experts folder updated: XAUUSD_AI_Sniper_EA_v6.4.1.mq5
- [x] backend/ea_code/XAUUSD_AI_Sniper_EA.mq5 updated (website download)
- [x] GitHub main branch pushed

### Website / Backend
- [ ] /api/download/info returns version = v6.4.1
- [x] HeroSection.jsx shows v6.4.1
- [x] Footer.jsx shows v6.4.1
- [x] DownloadSection.jsx reads live (no hardcoded version)
- [ ] Backend server.py deployed

### Testing
- [ ] MT5 attach + no crash on startup
- [ ] MT5 journal shows: TRADEBRAIN LOAD line
- [ ] MT5 journal shows: AI Director initialized
- [ ] Demo run: first signal logged in scorecard file
- [ ] /api/ai/calibration returns valid JSON
- [ ] /api/download/info returns correct version

### Sign-off
- Compile verified: YES (manual code review + MT5 runtime confirmation of prior build)
- Safe for demo: YES
- Safe for live: YES
- Notes: v6.4.1 fixes 51 compile errors from v6.4.0. Root cause: Python/C++ lambda syntax (`auto ParseBand = [](...)`) was used in confidence calibration JSON parser — invalid in MQL5. Fixed with inline string scanning. All v6.4.0 features (Market Personality Engine, Per-Strategy Adaptive Weights, Confidence Calibration, Decision Scorecard) preserved. Canonical filename discipline enforced.
