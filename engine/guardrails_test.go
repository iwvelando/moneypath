package engine

import (
	"math"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

func cashFloor(t *testing.T, amount float64, startDate, endDate string) *config.Guardrail {
	t.Helper()
	g := &config.Guardrail{Name: "Cushion", Kind: config.GuardrailCashFloor, Amount: &amount}
	g.ResolvedStart, g.ResolvedEnd = month(t, "1900-01"), month(t, "2999-12")
	if startDate != "" {
		g.ResolvedStart = month(t, startDate)
	}
	if endDate != "" {
		g.ResolvedEnd = month(t, endDate)
	}
	return g
}

func path(liquid ...float64) *ScenarioResult {
	return &ScenarioResult{Liquid: liquid, Total: liquid}
}

// Spec chapter 04 §10: a cash floor holds when every month of its window,
// the opening row included, has at least the floor in whole cents. The
// tightest month is the earliest with the least cash, and the margin is the
// cash there less the floor.
func TestCashFloorHoldsOverEveryMonth(t *testing.T) {
	got := EvaluateGuardrail(cashFloor(t, 400, "", ""), month(t, "2025-01"), path(1000, 600, 400, 900, 400))
	want := GuardrailResult{Name: "Cushion", Kind: "cashFloor", Result: GuardrailHolds, Tightest: month(t, "2025-03"), Margin: 0}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §10: one cent below the floor breaks it, while a value
// below it only by float noise does not.
func TestCashFloorComparesWholeCents(t *testing.T) {
	start := month(t, "2025-01")
	if got := EvaluateGuardrail(cashFloor(t, 400.01, "", ""), start, path(1000, 400)); got.Result != GuardrailBreaks || got.FirstBreach != month(t, "2025-02") {
		t.Errorf("one cent short: got %+v, want a breach in 2025-02", got)
	}
	if got := EvaluateGuardrail(cashFloor(t, 400, "", ""), start, path(1000, 399.996)); got.Result != GuardrailHolds {
		t.Errorf("float noise: got %+v, want holds", got)
	}
}

func TestCashFloorRoundsBothSidesOfTheBoundary(t *testing.T) {
	start := month(t, "2025-01")
	for _, tc := range []struct {
		name    string
		cash    float64
		outcome GuardrailOutcome
	}{
		{"one cent below", 399.994, GuardrailBreaks},
		{"same cent", 400.001, GuardrailHolds},
		{"one cent above", 400.006, GuardrailHolds},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := EvaluateGuardrail(cashFloor(t, 400.004, "", ""), start, path(tc.cash))
			if got.Result != tc.outcome {
				t.Errorf("cash %.3f against floor 400.004: got %s, want %s", tc.cash, got.Result, tc.outcome)
			}
		})
	}
}

func TestCashFloorTightestMonthKeepsTheEarliestWholeCentTie(t *testing.T) {
	start := month(t, "2025-01")
	got := EvaluateGuardrail(cashFloor(t, 400, "", ""), start, path(400.004, 399.996))
	if got.Result != GuardrailHolds || got.Tightest != start {
		t.Errorf("got %+v, want holds with the opening month tightest", got)
	}
	if math.Abs(got.Margin-0.004) > 1e-10 {
		t.Errorf("margin = %.12f, want the unrounded opening margin 0.004", got.Margin)
	}
}

// Spec chapter 04 §10: the first breach is the earliest failing month, and
// the tightest month can come after it, with the lowest margin in the window.
func TestCashFloorFirstBreachBeforeTheTightestMonth(t *testing.T) {
	got := EvaluateGuardrail(cashFloor(t, 700, "", ""), month(t, "2025-01"), path(1000, 600, 400, 900, 400))
	want := GuardrailResult{
		Name: "Cushion", Kind: "cashFloor", Result: GuardrailBreaks,
		FirstBreach: month(t, "2025-02"), Tightest: month(t, "2025-03"), Margin: -300,
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §10: cash that starts below the floor breaks in the
// opening month; the same floor from a later month is judged from there.
func TestCashFloorWindowStartsWhereItSays(t *testing.T) {
	start := month(t, "2025-01")
	series := path(1000, 1100, 1200)
	if got := EvaluateGuardrail(cashFloor(t, 1050, "", ""), start, series); got.Result != GuardrailBreaks || got.FirstBreach != start {
		t.Errorf("from the start: got %+v, want a breach in 2025-01", got)
	}
	got := EvaluateGuardrail(cashFloor(t, 1050, "2025-02", ""), start, series)
	want := GuardrailResult{Name: "Cushion", Kind: "cashFloor", Result: GuardrailHolds, Tightest: month(t, "2025-02"), Margin: 50}
	if got != want {
		t.Errorf("from 2025-02: got %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §10: the window is clipped to the recorded months, and a
// window with none of them does not apply, whichever side it misses on.
func TestCashFloorWindowIsClippedToThePlan(t *testing.T) {
	start := month(t, "2025-01")
	series := path(1000, 300, 900)
	got := EvaluateGuardrail(cashFloor(t, 500, "2024-01", "2025-02"), start, series)
	if got.Result != GuardrailBreaks || got.FirstBreach != month(t, "2025-02") || got.Tightest != month(t, "2025-02") {
		t.Errorf("clipped: got %+v", got)
	}
	for _, w := range [][2]string{{"2025-04", ""}, {"2020-01", "2024-12"}} {
		got := EvaluateGuardrail(cashFloor(t, 500, w[0], w[1]), start, series)
		want := GuardrailResult{Name: "Cushion", Kind: "cashFloor", Result: GuardrailDoesNotApply}
		if got != want {
			t.Errorf("window %v: got %+v, want %+v", w, got, want)
		}
	}
}

// Spec chapter 03, Guardrails: a negative floor is an overdraft limit.
func TestCashFloorMayBeNegative(t *testing.T) {
	got := EvaluateGuardrail(cashFloor(t, -250, "", ""), month(t, "2025-01"), path(100, -200, -500, -800))
	want := GuardrailResult{
		Name: "Cushion", Kind: "cashFloor", Result: GuardrailBreaks,
		FirstBreach: month(t, "2025-03"), Tightest: month(t, "2025-04"), Margin: -550,
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §10: every reported scenario carries one result per
// guardrail, in the plan's order; a plan without guardrails carries none.
func TestRunEvaluatesEveryGuardrailOnEveryScenario(t *testing.T) {
	cfg, _, err := config.Parse([]byte(`
version: 2
simulation: {startDate: 2025-01, endDate: 2025-03, startingCash: 1000}
guardrails:
  - {name: Low, kind: cashFloor, amount: 0}
  - {name: High, kind: cashFloor, amount: 1050}
scenarios:
  - name: grows
    events: [{name: Pay, amount: 100}]
  - name: parked
    active: false
`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := config.Validate(cfg, month(t, "2025-01")); err != nil {
		t.Fatal(err)
	}
	res, err := Run(cfg, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Scenarios) != 1 {
		t.Fatalf("want one active scenario, got %d", len(res.Scenarios))
	}
	got := res.Scenarios[0].Guardrails
	if len(got) != 2 || got[0].Name != "Low" || got[0].Result != GuardrailHolds || got[1].Name != "High" || got[1].Result != GuardrailBreaks {
		t.Errorf("guardrails = %+v", got)
	}

	cfg.Guardrails = nil
	res, err = Run(cfg, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Scenarios[0].Guardrails != nil {
		t.Errorf("a plan without guardrails reported %+v", res.Scenarios[0].Guardrails)
	}
}
