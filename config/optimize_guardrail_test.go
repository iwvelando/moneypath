package config

import "testing"

// Chapter 03, Optimizer block: a lasts guardrail applies to a target's
// scenario when one of its investments is among the scenario's resolved
// lists, and those include common as the scenario's options change it. A
// brokerage kept in common holds the target; an option that removes it
// leaves nothing for the guardrail to read.
func TestLastsGuardrailReadsCommonAsTheScenarioResolvesIt(t *testing.T) {
	const plan = `
version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 1000}
guardrails:
  - {name: Brokerage lasts, kind: lasts, investments: [Brokerage]}
common:
  investments:
    - {name: Brokerage, startingValue: 1000}
choices:
  - name: Savings
    options:
      - name: Keep
      - name: Cash out
        remove: {investments: [Brokerage]}
scenarios:
  - name: kept
    select: {Savings: Keep}
    events:
      - name: Spending
        amount: -100
        optimize: {field: amount, min: -500, max: 0, guardrail: Brokerage lasts}
  - name: cashed out
    select: {Savings: Cash out}
    events:
      - name: Spending
        amount: -100
        optimize: {field: amount, min: -500, max: 0, guardrail: Brokerage lasts}
`
	cfg, _, err := Parse([]byte(plan))
	if err != nil {
		t.Fatal(err)
	}
	var got []Problem
	for _, p := range Check(cfg, mustMonth(t, "2026-01")) {
		if p.Level == LevelError {
			got = append(got, p)
		}
	}
	const at = "scenarios.1.events.0.optimize.guardrail"
	const want = "Guardrail “Brokerage lasts” checks investments this scenario does not have, so it cannot hold this value."
	if len(got) != 1 || got[0].Path != at || got[0].Message != want {
		t.Errorf("errors = %+v, want only %q at %s", got, want, at)
	}
}
