# XAU v5.8.38 Regression Audit - Entry Timing Memory

## Screenshot Case

- Account grew from about 100k to about 181k, then gave back roughly 40k after v5.8.37.
- The visible bad sequence was not only direction failure. The main failure was entry timing:
  - Gold moved strongly from the 4380 area toward 4500.
  - The EA missed or blocked earlier parts of the move.
  - It later accepted large BUY entries near 4502 / 4497 / 4495.
  - Those entries were near the exhausted end of the move and then clustered additional exposure.

## Regression Finding

v5.8.37 fixed one A+ post-sweep trap, but it did not track where the signal idea first appeared. Because of that, a later A/A+ confirmation could still be treated as high quality even after price had already travelled far from the original signal zone.

That means the grading system could still behave like:

- more confirmation later = higher grade

instead of:

- better timing and location = higher quality

## v5.8.38 Patch

The EA now tracks first signal context:

- `signalFirstSeenPrice`
- `signalFirstSeenTime`
- `originalSetupDirection`
- `originalSetupScore`
- `reasonBlockedAtFirstSignal`

It logs delayed-entry quality:

- `entryPrice`
- `missedMoveDistance`
- `missedMoveATR`
- `candlesSinceSignal`
- `distanceFromEMA`
- `distanceFromVWAP`
- `spikeDetected`
- `lateEntryVeto`
- `lotReductionReason`
- `whyTradeAllowedAfterDelay`

It blocks the screenshot-style failure:

- If the same BUY idea was first seen much lower and price already moved too far, the EA marks the later entry as `LATE-CHASE ENTRY BLOCK`.
- A late entry can only pass after a real pullback/retest/structure confirmation.
- If a late retest is valid, size is forced down instead of opening full A/A+ size.
- Pyramid adds are blocked when the base trade was already a late chase and is not protected.

## Blocked Trade Memory

Blocked signals are now stored as virtual trades in:

`XAUAI_BlockedTradeMemory_<symbol>.csv`

The EA monitors blocked ideas after:

- 5 minutes
- 10 minutes
- 15 minutes
- 30 minutes
- 60 minutes

It records max favorable move, max adverse move, and whether the block likely protected or missed profit. After enough samples, blocked-memory can allow a small scout entry for patterns that repeatedly prove the hard block was too strict.

## Proof Status

Local checks completed:

- `git diff --check`
- `python3 -m py_compile backend/server.py`

MQL5 must still be compiled in MetaEditor with F7 because this environment cannot run the MT5 compiler.
