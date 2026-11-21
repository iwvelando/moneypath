# 05 — CSV download

*Status: **Contract** — the format is byte-pinned by the conformance fixtures and by
native↔WASM parity. See SPEC.md.*

The web app's "Download CSV" serves this text exactly as the engine renders it (chapter
02): the forecast of every active scenario, month by month.

## Format (normative — conformance fixtures match byte-for-byte)

All fields double-quoted. Dates ascending. One column triple per scenario (five columns
with today's dollars, below), ordered as scenarios appear in the config (inactive
scenarios omitted entirely). A scenario defined by a `select` is a column triple like
any other; choices and options do not appear:

```
"date","liquid (<scenario1>)","total (<scenario1>)","notes (<scenario1>)",…
"2025-06","30000.00","55000.00","",…
"2025-07","31200.50","56430.75","scenario Retirement savings: contribution (reduces cash balance) +350.00, growth +43.55",…
```

- Money as plain `%.2f` (no symbol, no thousands separators). An amount that rounds to
  zero is `0.00`, never `-0.00`.
- Notes joined with `,` inside the quoted field; empty string when none.
- A date some scenario lacks (different simulation spans cannot happen in v2 — all
  scenarios share the window — but defensive rendering uses `""`).
- Rows end with `\n`, including the last.
- **Today's dollars.** When the plan's `simulation.inflationRate` is set and not 0,
  each scenario has five columns rather than three: liquid and total in today's dollars
  (chapter 04 §12) follow its total, before its notes. Their headers name the plan's
  start month, the month whose prices they hold, as `YYYY-MM`:

  ```
  "date","liquid (Base)","total (Base)","liquid in 2026-06 dollars (Base)","total in 2026-06 dollars (Base)","notes (Base)",…
  "2026-06","25020.00","75528.33","25020.00","75528.33","…",…
  ```

  The nominal columns and their headers are the same as without the rate. A plan whose
  rate is absent or 0 has no such columns.
- If there are no results, the CSV is just the literal header
  `Date,Scenario,Liquid,Total,Notes`.

The CSV carries the forecast only. Comparisons between scenarios, a flipped path and
guardrail results (chapter 02, Results JSON) are not part of it, so a plan with
guardrails renders the same CSV as the plan without them.
