#!/usr/bin/env python3
"""Build 60DAY_POST_EXIT_10_20_REPORT.html from the CSVs produced by
build_post_exit_report.py. Self-contained (inline CSS, embedded chart
PNGs as base64), sortable trade table via a small vanilla-JS sorter.
"""
import argparse
import base64
import json
from pathlib import Path

import pandas as pd


def b64_png(path: Path) -> str:
    if not path.exists():
        return ""
    return base64.b64encode(path.read_bytes()).decode("ascii")


def df_to_sortable_table(df: pd.DataFrame, table_id: str, max_rows: int = 500) -> str:
    cols = list(df.columns)
    thead = "".join(f'<th onclick="sortTable(\'{table_id}\',{i})">{c}</th>' for i, c in enumerate(cols))
    rows = []
    for _, r in df.head(max_rows).iterrows():
        cells = "".join(f"<td>{'' if pd.isna(v) else v}</td>" for v in r[cols])
        rows.append(f"<tr>{cells}</tr>")
    tbody = "".join(rows)
    note = f"<p class='note'>Showing first {max_rows} of {len(df)} rows.</p>" if len(df) > max_rows else ""
    return f"{note}<table id='{table_id}' class='sortable'><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True, type=Path)
    args = ap.parse_args()

    core = pd.read_csv(args.out_dir / "60DAY_POST_EXIT_10_20_CORE_TRADES.csv")
    all_win = pd.read_csv(args.out_dir / "60DAY_POST_EXIT_10_20_ALL_WINNERS.csv")
    cls = pd.read_csv(args.out_dir / "60DAY_POST_EXIT_CLASSIFICATION.csv")
    auth = pd.read_csv(args.out_dir / "60DAY_POST_EXIT_BY_EXIT_AUTHORITY.csv")
    regime_path = args.out_dir / "60DAY_POST_EXIT_BY_MARKET_REGIME.csv"
    regime = pd.read_csv(regime_path) if regime_path.exists() else pd.DataFrame()
    summaries = json.loads((args.out_dir / "_post_exit_summaries.json").read_text())

    has_20m = core["MISSED_R_20M"].notna().any()

    png_r10 = b64_png(args.out_dir / "60DAY_POST_EXIT_10M_MISSED_R.png")
    png_r20 = b64_png(args.out_dir / "60DAY_POST_EXIT_20M_MISSED_R.png")

    def summary_table(s):
        if s["n"] == 0:
            return "<p><em>No data (20-minute checkpoint pending rerun verification).</em></p>"
        return f"""<table class='kv'>
<tr><td>Analyzed</td><td>{s['n']}</td></tr>
<tr><td>With additional favorable movement</td><td>{s['n_with_additional_movement']}</td></tr>
<tr><td>Missing &ge; 0.10R</td><td>{s['n_missing_010R']}</td></tr>
<tr><td>Missing &ge; 0.25R</td><td>{s['n_missing_025R']}</td></tr>
<tr><td>Missing &ge; 0.50R</td><td>{s['n_missing_050R']}</td></tr>
<tr><td>Missing &ge; 1.00R</td><td>{s['n_missing_100R']}</td></tr>
<tr><td>Average missed R</td><td>{s['avg_missed_r']}</td></tr>
<tr><td>Median missed R</td><td>{s['median_missed_r']}</td></tr>
<tr><td>75th percentile</td><td>{s['p75_missed_r']}</td></tr>
<tr><td>90th percentile</td><td>{s['p90_missed_r']}</td></tr>
<tr><td>Maximum missed R</td><td>{s['max_missed_r']}</td></tr>
<tr><td>Total missed R</td><td>{s['total_missed_r']}</td></tr>
<tr><td>Returned to entry within window</td><td>{s['n_returned_to_entry']}</td></tr>
<tr><td>Original SL would have been crossed</td><td>{s['n_sl_crossed']}</td></tr>
</table>"""

    html = f"""<title>60-Day Post-Exit Missed R (10/20 min) Report</title>
<style>
body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }}
h1, h2, h3 {{ color: #0d47a1; }}
table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.85rem; }}
table.sortable th {{ cursor: pointer; background: #0d47a1; color: white; padding: 6px 8px; position: sticky; top: 0; }}
table.sortable td {{ padding: 4px 8px; border-bottom: 1px solid #ddd; }}
table.kv td {{ padding: 4px 10px; border-bottom: 1px solid #eee; }}
table.kv td:first-child {{ font-weight: 600; width: 60%; }}
.note {{ color: #666; font-style: italic; }}
.grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }}
.warn {{ background: #fff3e0; border-left: 4px solid #ef6c00; padding: 0.75rem 1rem; margin: 1rem 0; }}
img {{ max-width: 100%; }}
.scroll {{ overflow-x: auto; max-height: 600px; }}
</style>

<h1>60-Day Post-Exit Missed R Report -- 10 and 20 Minutes</h1>
<p>Source: 60-day M30-postfix replay (2026-05-18 to 2026-07-17), EX5 SHA-256
<code>430f8d11478d2d0a80df89f0baf0daa7a8a94534fad3c3d4b96e7a1bffc80bc9</code>.
Continues audit commit <code>f0f7246999b8a137a5d076e5b260dd7a79a89152</code>.</p>

{"" if has_20m else '''<div class="warn"><b>20-minute checkpoint status:</b> the EA's existing post-close
learning pipeline only has 5/10/15/30/60-minute checkpoints natively. A fully isolated,
non-decision-influencing 20-minute telemetry addition was implemented and an identical
60-day rerun launched to capture it, per this analysis's own required protocol
(reproduce the baseline before trusting new data). If you are reading this before that
rerun/verification completed, 20-minute figures below are empty rather than estimated
from the 10/15/30-minute checkpoints -- see 60DAY_POST_EXIT_METHOD_AND_LIMITATIONS.md
for current status.</div>'''}

<h2>10-Minute Summary</h2>
<div class="grid">
<div><h3>CORE profitable trades</h3>{summary_table(summaries['core_10m'])}</div>
<div><h3>All profitable positions (incl. pyramids)</h3>{summary_table(summaries['all_10m'])}</div>
</div>
<img src="data:image/png;base64,{png_r10}">

<h2>20-Minute Summary</h2>
<div class="grid">
<div><h3>CORE profitable trades</h3>{summary_table(summaries['core_20m'])}</div>
<div><h3>All profitable positions (incl. pyramids)</h3>{summary_table(summaries['all_20m'])}</div>
</div>
<img src="data:image/png;base64,{png_r20}">

<h2>Exit Classification (CORE profitable trades)</h2>
<table class='kv'>
{"".join(f"<tr><td>{r['classification']}</td><td>{r['count']}</td></tr>" for _, r in cls.iterrows())}
</table>

<h2>By Exit Authority</h2>
<div class="scroll">{df_to_sortable_table(auth, 'authTable')}</div>

<h2>By Market Condition</h2>
<div class="scroll">{df_to_sortable_table(regime, 'regimeTable') if not regime.empty else '<p><em>Not available (entry-timing/regime file not found).</em></p>'}</div>

<h2>All CORE Profitable Trades (sortable)</h2>
<div class="scroll">{df_to_sortable_table(core, 'coreTable')}</div>

<h2>All Profitable Positions Incl. Pyramids (sortable)</h2>
<div class="scroll">{df_to_sortable_table(all_win, 'allTable')}</div>

<h2>Plain-English Conclusion</h2>
<p>See 60DAY_POST_EXIT_10_20_SUMMARY.md for the full narrative. In short: this report
measures how much additional favorable R price moved in the 10 (and, once verified,
20) minutes after each profitable CORE trade's exit, using the EA's own real
post-close tracking data -- not candle-OHLC estimation.</p>

<script>
function sortTable(id, col) {{
  const table = document.getElementById(id);
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows);
  const asc = table.dataset.sortCol == col ? table.dataset.sortDir !== 'asc' : true;
  rows.sort((a, b) => {{
    const av = a.cells[col].innerText, bv = b.cells[col].innerText;
    const an = parseFloat(av), bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
    return asc ? av.localeCompare(bv) : bv.localeCompare(av);
  }});
  rows.forEach(r => tbody.appendChild(r));
  table.dataset.sortCol = col;
  table.dataset.sortDir = asc ? 'asc' : 'desc';
}}
</script>
"""

    (args.out_dir / "60DAY_POST_EXIT_10_20_REPORT.html").write_text(html)
    print("HTML report written.")


if __name__ == "__main__":
    main()
