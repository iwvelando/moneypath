package app

import (
	"encoding/json"
	"math"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// Three targets, one per kind of floor: a cash floor, a debt-free and the
// emergency fund. The house loan is paid off by threshold once cash and the
// brokerage cover it, so spending less brings the payoff forward.
const optimizerGuardrailPlan = `
version: 2
simulation: {startDate: 2025-06, endDate: 2026-12, startingCash: 6000}
recommendations: {emergencyFundMonths: 3}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 5000}
  - {name: Paid off, kind: debtFree, startDate: 2026-06}
scenarios:
  - name: cushion
    events:
      - {name: Income, amount: 2000}
      - {name: Rent, amount: -1800}
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0, guardrail: Cushion}
  - name: payoff
    events:
      - {name: Income, amount: 3200}
      - name: Spending
        amount: -2600
        optimize: {maxIterations: 60, guardrail: Paid off, field: amount, min: -3200, max: -2000}
    loans:
      - {name: House loan, principal: 60000, interestRate: 4, term: 180, startDate: 2023-01, earlyPayoffThreshold: 5000}
    investments:
      - {name: Brokerage, startingValue: 45000, annualReturnRate: 6, withdrawalTaxRate: 15, fundLoanPayoffs: true}
  - name: emergency fund
    events:
      - {name: Income, amount: 2000}
      - {name: Rent, amount: -1800}
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0}
`

func optimizationsOf(t *testing.T, out map[string]any, scenario int) map[string]any {
	t.Helper()
	opts := out["metrics"].([]any)[scenario].(map[string]any)["optimizations"].([]any)
	if len(opts) != 1 {
		t.Fatalf("scenario %d: want one optimization, got %d", scenario, len(opts))
	}
	return opts[0].(map[string]any)
}

// Spec chapter 02, Results JSON: an adjustment held to a guardrail carries
// that guardrail's result on the chosen value's forecast. A cash floor keeps
// floor, minimumCash and headroom; a debt-free has none of the three; an
// adjustment held to the emergency fund has no guardrail.
func TestOptimizationsCarryTheirGuardrail(t *testing.T) {
	out := runPlan(t, optimizerGuardrailPlan, true)

	cushion := optimizationsOf(t, out, 0)
	var want any
	if err := json.Unmarshal([]byte(`{"name":"Cushion","kind":"cashFloor","result":"holds","tightestDate":"2026-12","margin":0.12}`), &want); err != nil {
		t.Fatal(err)
	}
	got := cushion["guardrail"].(map[string]any)
	got["margin"] = round2(got["margin"].(float64))
	if !reflect.DeepEqual(got, want) {
		t.Errorf("cash-floor guardrail = %v, want %v", got, want)
	}
	if cushion["floor"] != 5000.0 || round2(cushion["minimumCash"].(float64)) != 5000.12 || round2(cushion["headroom"].(float64)) != 0.12 {
		t.Errorf("cash-floor figures = %v / %v / %v", cushion["floor"], cushion["minimumCash"], cushion["headroom"])
	}

	payoff := optimizationsOf(t, out, 1)
	for _, key := range []string{"floor", "minimumCash", "headroom"} {
		if _, ok := payoff[key]; ok {
			t.Errorf("a debt-free adjustment carries %s", key)
		}
	}
	if err := json.Unmarshal([]byte(`{"name":"Paid off","kind":"debtFree","result":"holds","tightestDate":"2026-06","marginMonths":0}`), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(payoff["guardrail"], want) {
		t.Errorf("debt-free guardrail = %v, want %v", payoff["guardrail"], want)
	}

	fund := optimizationsOf(t, out, 2)
	if _, ok := fund["guardrail"]; ok {
		t.Errorf("an emergency-fund adjustment carries a guardrail: %v", fund["guardrail"])
	}
	for _, key := range []string{"floor", "minimumCash", "headroom"} {
		if _, ok := fund[key]; !ok {
			t.Errorf("an emergency-fund adjustment lacks %s", key)
		}
	}
}

// Spec chapter 03, Optimizer block, canonical form: guardrail is the block's
// last key, and an empty one is left out.
func TestOptimizerGuardrailIsEchoedLast(t *testing.T) {
	echoed := runPlan(t, optimizerGuardrailPlan, false)["configYaml"].(string)
	if !regexp.MustCompile(`min: -3200\n *max: -2000\n *maxIterations: 60\n *guardrail: Paid off\n`).MatchString(echoed) {
		t.Errorf("guardrail is not the optimizer block's last key:\n%s", echoed)
	}
	blank := strings.Replace(optimizerGuardrailPlan, "guardrail: Cushion", `guardrail: ""`, 1)
	if echoed := runPlan(t, blank, false)["configYaml"].(string); strings.Count(echoed, "guardrail:") != 1 {
		t.Errorf("an empty guardrail is echoed:\n%s", echoed)
	}
}

// Spec chapter 02, Results JSON, flip: the flipped path is optimized as that
// scenario would be, so a target held to a guardrail is held to it there too.
func TestFlippedPathIsHeldToTheSameGuardrail(t *testing.T) {
	plan := `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 5000}
recommendations: {emergencyFundMonths: 3}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 4000}
choices:
  - name: Rent
    options:
      - name: Cheap
        events: [{name: Rent, amount: -1800}]
      - name: Dear
        events: [{name: Rent, amount: -1850}]
scenarios:
  - name: plan
    select: {Rent: Cheap}
    events:
      - {name: Income, amount: 2000}
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0, guardrail: Cushion}
`
	f, err := flipOf(t, plan, true, Flip{Scenario: "plan", Choice: "Rent", Option: "Dear"})
	if err != nil {
		t.Fatal(err)
	}
	for name, path := range map[string][]float64{"original": f.Flip.Original.Liquid, "flipped": f.Flip.Flipped.Liquid} {
		lowest := path[0]
		for _, v := range path {
			lowest = min(lowest, v)
		}
		// Held to the cushion, each path's lowest cash lands within a cent
		// a month of $4,000.00.
		if round2(lowest) < 4000 || lowest > 4000.18 {
			t.Errorf("%s path: lowest cash %.2f is not held to the cushion", name, lowest)
		}
	}
	if g := f.Flip.Flipped.Guardrails; len(g) != 1 || g[0].Result != "holds" {
		t.Errorf("flipped path guardrails = %+v, want the cushion holding", g)
	}
}

func round2(x float64) float64 { return math.Round(x*100) / 100 }
