# Support

> **Template notice:** this document needs the owner's real contact
> details filled in before publishing. The placeholders below
> (`[SUPPORT_EMAIL]`, `[MARKET_LISTING_URL]`) are not real and must be
> replaced before this file goes out with the product.

## Before asking for help

1. Check the **Experts** log tab — most "it's not trading" questions are
   answered directly by a logged reason (e.g. a wrong-symbol warning,
   "Algo Trading" being disabled, a stated block reason for the current
   bar).
2. Check `FAQ.md` and `KNOWN_LIMITATIONS.md` in this folder.
3. Confirm "Allow Algo Trading" is enabled both on the terminal toolbar
   and in the EA's own Common-tab properties.
4. Confirm you're attached to a gold symbol your broker actually offers —
   see `SYMBOL_COMPATIBILITY.md`.

## What this product does not have

There is no cloud dashboard, no built-in remote support channel, and no
telemetry sent anywhere from this EA — everything it knows about its own
state is in the local Experts log and its local trade-memory files on
your own machine (see `INSTALLATION.md`). Support happens entirely
through whatever channel the Market listing itself provides, not through
the EA reaching out anywhere.

## Contact

- Email: `[SUPPORT_EMAIL]` — *owner to fill in a real support address.*
- MQL5 Market listing / product page messaging: `[MARKET_LISTING_URL]` —
  *owner to fill in the actual listing URL once published.*

## Reporting a suspected bug

Please include:

- Broker name and exact symbol string (e.g. `XAUUSDm`).
- EA version (`1.00`) and magic number (`26080301`), both visible in the
  startup log.
- The relevant Experts-log lines around the issue (a few lines before and
  after is usually enough).
- Whether this was on a demo or live account, and whether Strategy Tester
  was involved.

Since this build makes no network calls, any connectivity-flavored error
message is a broker/terminal connection issue, not this EA reaching out
to anything external.
