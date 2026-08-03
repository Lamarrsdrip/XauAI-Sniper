# Position 130 execution anomaly

The broker-confirmed SELL opened at 4481.11 with structural SL 4490.84 and 1.18 lots. At 01:00:00 the tester reported the stop trigger at 4490.84 but filled the closing deal at 4535.29, with spread 6,017 points and final P/L -USD 6,398.67.

The close was 44.45 price units beyond the requested stop, equal to approximately 4.570 original R beyond the stop and -5.576R total. This is execution-path contamination, not evidence that the entry fingerprint itself normally loses 5.576R.

Policy:

- retain the trade in raw replay performance;
- set `learning_eligible=N` and quarantine position 130 from pattern training;
- do not delete or rewrite the row;
- classify future broker-SL closes as telemetry anomalies when fill beyond requested SL is at least 0.25R or the preceding quote gap is at least 300 seconds;
- never let this telemetry alter entry, direction, lot, risk, stop, target or exit behavior.

The updated CSV appends broker deal reason, requested SL, actual close, beyond-SL points/R, preceding quote-gap duration, first available tick, deal fee, net P/L including fees, and quarantine status.

Evidence: `../raw/POSITION_130_FULL_LOG_EVENTS_UTF8.log`.
