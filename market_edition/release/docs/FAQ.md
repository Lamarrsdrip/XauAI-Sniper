# FAQ

**Does this need an internet connection to trade?**
No. It makes zero outbound network calls of any kind — confirmed by
direct source inspection (`WebRequest`, `#import`, `ShellExecute`, and
`.dll` calls all count 0 in the compiled build). It only needs your
broker's normal price/trade connection, same as any EA.

**Do I need to add a URL to the WebRequest whitelist?**
No. There is nothing to whitelist.

**Does this use AI?**
No, by design. This EA was forked from a cloud-connected product that did
call an external AI/LLM service for some decisions; every network call
site that fed those decisions has had its network body removed, so this
build always falls through to the same deterministic local logic. This
was done deliberately for MQL5 Market compliance and to keep the product
fully self-contained — not because AI was accidentally left out. Some
input names and internal comments still say "AI" (e.g. "AI Trading
Committee," "AI Director," "AI Exit Brain") because they're inherited
group/feature names from the source codebase; none of them call an
external model in this build. See `KNOWN_LIMITATIONS.md` for the specific
inert inputs.

**What broker or account type does this need?**
Any MT5 broker offering XAUUSD (or an equivalent gold symbol name — see
`SYMBOL_COMPATIBILITY.md`). No specific account type is required beyond
whatever your broker requires for algorithmic/EA trading and margin
trading on gold.

**What VPS specification do I need?**
This is a single-symbol MT5 EA with no network dependency, so its
resource footprint is modest. A typical minimum for a single-symbol MT5
EA — 1 vCPU, 1–2 GB RAM — is a reasonable starting point. This has not
been separately load-tested for this exact build; if you plan to run
several EAs or terminals on the same VPS, size up accordingly and monitor
actual usage rather than assuming the minimum is sufficient for a
multi-EA setup.

**What happens if the VPS restarts or the terminal is closed and
reopened?**
The source code includes restart-reconciliation logic — on `OnInit` it
reloads its local trade-memory files, reconciles against any already-open
position for its symbol/magic number, and restores loss-streak and
exit-management state from terminal-persistent storage rather than
starting blind. This logic is present and unchanged from the source
product. That said, this exact build has not had a dedicated
restart/recovery test performed against it (see `KNOWN_LIMITATIONS.md`) —
if this matters for your deployment, test a restart on a demo account
before relying on it live.

**What license/PIN do I need to enter?**
None from this EA. MQL5 Marketplace licensing (per-account activation) is
handled by the platform itself at purchase — this build has no custom PIN
or activation step of its own. The legacy `InpLicensePIN` input can be
left blank.

**Can someone remotely pause, stop, or trade my account through this
EA?**
No. The remote command channel that existed in the source cloud product
has been removed completely from this build — there is no code path left
that can receive or act on a remote command.

**Does it use martingale or grid sizing?**
No. Every position is sized from a fixed risk-percentage target against
its own real stop-loss distance; size does not increase after a loss.

**What does the local trade-memory / trade-history feature do?**
It keeps a local, disk-persisted record of this installation's own recent
closed trades and can use that history to add caution to a new candidate
that closely resembles a recent cluster of losses. It's local to this
installation only — see `STRATEGY_OVERVIEW.md`.

**Why does the log show "idle" most of the time?**
That's expected. The EA only trades a qualifying graded setup — most
ticks and most bars, no such setup exists yet. An idle status with a
stated reason is the EA telling you why it isn't trading right now, not
an error.

**Where can I see exactly what was removed and verified for this
build?**
`audits/xaucloud/17_market_edition_claude_xaucloud.md` in the source
repository has the full removal record. `KNOWN_LIMITATIONS.md` in this
doc set states plainly what has and hasn't been tested for this exact
compiled version.
