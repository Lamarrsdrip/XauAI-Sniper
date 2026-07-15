# v6.24.0 merged entry authorities

The normal strategy now has one owner for each decision dimension. Advisory modules may log context but cannot independently veto or resize an otherwise valid entry.

1. **Signal / Direction** — produces one direction, setup, score and grade.
2. **Structure** — hard-blocks only when the current SMC break and HTF consensus both oppose the candidate.
3. **Freshness / Extension** — owns first candidate time and price, live ATR travel, best available entry, reset, remaining reward and candidate generation. It blocks only a genuinely consumed extension with poor remaining reward, no reset and independent exhaustion evidence.
4. **Timing** — preserves the owner-required 120–180 second delay (150 seconds by default). PRIMARY, RE_ENTRY and PYRAMID use separate clocks so they cannot reset one another. No grade bypass exists. Release always follows a live freshness recheck.
5. **News** — blocks only the protected pre-news/release-cooldown or scheduled high-impact window. Post-release interpretation is not a second veto.
6. **Re-entry / Pyramid state** — owns better-price reset, favorable spacing, configured add count, max-open state and a 30-second duplicate-send safeguard.
7. **Risk / Execution** — owns configured single/basket risk, exposure direction, total lots, margin, broker volume/stops and cross-instance collision safety.
8. **Final Entry Arbiter** — records convergence once. It does not repeat strategy analysis.

`OpenTrade` contains operational safety and broker execution only. AI, personality, regime, memory, TradeBrain, Active Direction and similar modules are telemetry or descriptive context in the normal path.

The isolated Counter-Excursion experiment remains separate and was not imported into, used to invert, or allowed to block the normal strategy.
