# v6.22.0 experiment ACTIVE release checklist

This checklist applies only to `XAUUSD_AI_Sniper_EA_v6.22.0_ADAPTIVE_TREND_CAMPAIGN_EXP1`. It must not be used for production v6.23.x.

- [ ] Branch is `experiment/v6.22.0`; production main SHA was recorded before work.
- [ ] Source build marker is `v6220-campaign-manual-micro-transition-active-20260714`.
- [ ] Source and shipped preset both select `CAMPAIGN_TRANSITION_ACTIVE`.
- [ ] `CAMPAIGN_TRANSITION_ACTIVE_ASSERTION_PASSED` prints all safety thresholds at startup.
- [ ] Invalid ACTIVE relationships cause `OnInit` failure.
- [ ] PRIMARY, RE_ENTRY, RECOVERY, RETRY, PYRAMID, adaptive reversal, pending and post-campaign paths converge on `XAU_CampaignAuthorizedMarketSend`.
- [ ] No automated fresh order bypasses `[CAMPAIGN_ACTIVE_ENTRY_AUTHORITY]`.
- [ ] Exhaustion >=70 blocks old-direction entries, re-entry, recovery, retry and pyramids.
- [ ] Opposite entry requires persistent closed-bar microstructure, confidence separation and valid location.
- [ ] Bad location returns `WAIT_FOR_PULLBACK`; time alone cannot reset a consumed opportunity.
- [ ] Existing-position transition actions remain owned by the Adaptive Trend Campaign Manager.
- [ ] Early reversal campaigns require an armed campaign floor before their first pyramid.
- [ ] Restart tests preserve exhaustion, lifecycle, candidate, consumed opportunity, floor and pending close state.
- [ ] Full configured risk remains binary 15% or block; no reduced-lot fallback exists.
- [ ] Compile result is 0 errors and 0 warnings.
- [ ] Focused and full v6.22.0 suites pass; repository failure set is compared with baseline.
- [ ] EX5 SHA-256 is recorded and matches the installed binary.
- [ ] Target is confirmed isolated demo, with one chart instance, magic `62200001`, isolated memory and no Counter-Excursion.
- [ ] Rollback EX5 is preserved before installation.
- [ ] Journal proves exact build and `CAMPAIGN_TRANSITION_ACTIVE_ASSERTION_PASSED`.
- [ ] Production v6.23.1 files, branch and terminal installation remain unchanged.

Do not call the release fully live-observed until real logs have shown continuation allow, mature selectivity, exhaustion block, reversal preparation, wait-for-pullback and a market-provided opposite candidate.
