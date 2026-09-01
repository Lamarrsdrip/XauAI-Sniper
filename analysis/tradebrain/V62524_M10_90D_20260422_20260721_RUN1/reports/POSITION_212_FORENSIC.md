# Position 212 forensic conclusion

Position 212 opened SELL at 4146.63 with structural SL 4157.23 and original risk USD 678.37. Its recorded peak was USD 295.04 / 0.435R and final result was -USD 686.08 / -1.011R.

The full June 19 tester log establishes the exact sequence:

1. At 14:30:37, the canonical GIVEBACK_45 authority requested a profitable close at +0.166R after a +0.340R recorded peak.
2. The owner GENERAL 10-minute extension armed, restored the immutable structural SL, and suppressed the original close until 14:40:37.
3. At the deadline the position was -0.329R. The owner R manager issued `OWNER_R_EXIT_GENERAL_10M_DEADLINE`.
4. The generic loss-close firewall rejected that already-approved deadline request as `LOSS_CLOSE_BLOCKED`. No order was sent to the broker.
5. The EA repeated the internally blocked request 417 times through 15:01:36.
6. At 15:01:37 the broker structural SL closed the position at 4157.35.

Root cause: two internal authorities conflicted. The owner extension contract required a close at T+600, while the generic loss-close firewall prohibited it once floating P/L became negative.

Repair: `XAU_ConfirmedGeneralDeadlineClose()` bypasses the generic firewall only when the close reason is the exact GENERAL deadline, the owner profile is GENERAL, the extension is armed and fully broker-confirmed, and current time is at or after the persisted deadline. Every other losing close retains the unchanged firewall. The existing owner-floor validation still runs afterward.

Evidence: `../raw/POSITION_212_FULL_LOG_EVENTS_UTF8.log`.
