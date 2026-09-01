# 4807 persistence evaluation

The original final replay reached 8,206 completed scans from 8,206 started scans, with zero `failedFinal` snapshots and one superseded bar. It also reported 12,435 wrong-handle recoveries, 37,307 transient 4807 waits, and 37,307 data waits.

The equal wait counters were not two independent measurements: `XAU_HandlePersistentStable4807()` incremented both counters for the same 4807 observation. The production repair removes that double classification and adds a separate persistent-4807 recovery counter.

The repaired key-event tail repeatedly shows the current 3-distinct-tick / 2-second policy waiting at 0 and 1 seconds, then becoming READY at 3 seconds without losing the bar. Because the supplied evidence proves zero bar loss but does not contain a post-repair controlled full replay for alternative thresholds, this release does not change the 3-tick / 2-second operational threshold. Raising it without a matched replay would be an unproven trading change.

Decision: preserve the proven persistence policy; repair counter semantics and extraction only. A future threshold experiment must compare at least 3/2, 4/3 and 5/4 on identical real ticks and preserve zero failed-final bars before promotion.
