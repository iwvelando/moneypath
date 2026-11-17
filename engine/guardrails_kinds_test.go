package engine

import (
	"math"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

func guardrail(t *testing.T, kind string, startDate, endDate string) *config.Guardrail {
	t.Helper()
	g := &config.Guardrail{Name: "G", Kind: kind}
	g.ResolvedStart, g.ResolvedEnd = month(t, "1900-01"), month(t, "2999-12")
	if startDate != "" {
		g.ResolvedStart = month(t, startDate)
	}
	if endDate != "" {
		g.ResolvedEnd = month(t, endDate)
	}
	return g
}

func debtFree(t *testing.T, deadline, endDate string, loans ...string) *config.Guardrail {
	g := guardrail(t, config.GuardrailDebtFree, deadline, endDate)
	g.Loans = loans
	return g
}

func lasts(t *testing.T, amount *float64, startDate string, investments ...string) *config.Guardrail {
	g := guardrail(t, config.GuardrailLasts, startDate, "")
	g.Investments, g.Amount = investments, amount
	return g
}

func owing(owed map[string][]float64) *ScenarioResult {
	n := 0
	for _, s := range owed {
		n = len(s)
	}
	return &ScenarioResult{Liquid: make([]float64, n), Total: make([]float64, n), Owed: owed}
}

func holding(n int, holdings map[string][]float64) *ScenarioResult {
	return &ScenarioResult{Liquid: make([]float64, n), Total: make([]float64, n), Holdings: holdings}
}

// Spec chapter 04 §10: a debtFree holds when nothing is owed from its deadline
// on. Its tightest month is the month the debt is cleared, and its margin the
// whole months from there to the deadline.
func TestDebtFreeClearedEarly(t *testing.T) {
	start := month(t, "2025-01")
	got := EvaluateGuardrail(debtFree(t, "2025-04", "", "Car"), start, owing(map[string][]float64{
		"Car": {300, 100, 0, 0, 0, 0},
	}))
	want := GuardrailResult{Name: "G", Kind: "debtFree", Result: GuardrailHolds,
		HasTightest: true, Tightest: month(t, "2025-03"), MarginMonths: 1}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §10: cleared after the deadline breaks it at the deadline,
// owing what is owed then, with a negative margin.
func TestDebtFreeClearedLate(t *testing.T) {
	start := month(t, "2025-01")
	got := EvaluateGuardrail(debtFree(t, "2025-02", "", "Car"), start, owing(map[string][]float64{
		"Car": {300, 200, 100.5, 0, 0},
	}))
	want := GuardrailResult{Name: "G", Kind: "debtFree", Result: GuardrailBreaks,
		FirstBreach: month(t, "2025-02"), Owed: 200,
		HasTightest: true, Tightest: month(t, "2025-04"), MarginMonths: -2}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §10: a loan taken out after the deadline breaks it, and debt
// in the window's last month leaves no cleared month.
func TestDebtFreeLaterLoanLeavesNoClearedMonth(t *testing.T) {
	start := month(t, "2025-01")
	got := EvaluateGuardrail(debtFree(t, "2025-02", ""), start, owing(map[string][]float64{
		"Car":  {100, 0, 0, 0, 0},
		"Boat": {0, 0, 0, 900, 800},
	}))
	want := GuardrailResult{Name: "G", Kind: "debtFree", Result: GuardrailBreaks,
		FirstBreach: month(t, "2025-04"), Owed: 900}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
	// The same debt after the window's end does not count.
	got = EvaluateGuardrail(debtFree(t, "2025-02", "2025-03"), start, owing(map[string][]float64{
		"Car":  {100, 0, 0, 0, 0},
		"Boat": {0, 0, 0, 900, 800},
	}))
	if got.Result != GuardrailHolds || got.Tightest != month(t, "2025-02") || got.MarginMonths != 0 {
		t.Errorf("window to 2025-03: got %+v, want holds, cleared 2025-02 with no months to spare", got)
	}
}

// Spec chapter 04 §10: only the listed loans count, and a listed loan the path
// does not have owes nothing, so the path is cleared from its first month.
func TestDebtFreeCountsOnlyTheListedLoans(t *testing.T) {
	start := month(t, "2025-01")
	series := owing(map[string][]float64{"Car": {300, 200, 100}})
	got := EvaluateGuardrail(debtFree(t, "2025-02", "", "Boat"), start, series)
	want := GuardrailResult{Name: "G", Kind: "debtFree", Result: GuardrailHolds,
		HasTightest: true, Tightest: start, MarginMonths: 1}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
	// With no loans at all on the path, every-loan holds too.
	got = EvaluateGuardrail(debtFree(t, "2025-02", ""), start, &ScenarioResult{Liquid: []float64{0, 0, 0}})
	if got != want {
		t.Errorf("no loans: got %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §10: what is owed is summed over the listed loans and
// compared in whole cents.
func TestDebtFreeSumsLoansInWholeCents(t *testing.T) {
	start := month(t, "2025-01")
	series := owing(map[string][]float64{
		"Car":  {0.003, 0.003},
		"Boat": {0.003, 0},
	})
	got := EvaluateGuardrail(debtFree(t, "2025-01", "", "Car", "Boat"), start, series)
	if got.Result != GuardrailBreaks || got.FirstBreach != start || math.Abs(got.Owed-0.006) > 1e-12 {
		t.Errorf("0.006 owed: got %+v, want a breach at the start owing 0.006", got)
	}
	if got.Tightest != month(t, "2025-02") || got.MarginMonths != -1 {
		t.Errorf("0.003 owed rounds to nothing: got %+v, want cleared 2025-02", got)
	}
}

func TestDebtFreeFirstBreachRoundsOwedToCents(t *testing.T) {
	start := month(t, "2025-01")
	for _, tc := range []struct {
		name   string
		owed   float64
		result GuardrailOutcome
	}{
		{"below half a cent", 0.0049, GuardrailHolds},
		{"half a cent", 0.005, GuardrailBreaks},
		{"above half a cent", 0.0051, GuardrailBreaks},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := EvaluateGuardrail(debtFree(t, "2025-01", "", "Car"), start,
				owing(map[string][]float64{"Car": {tc.owed}}))
			want := GuardrailResult{Name: "G", Kind: config.GuardrailDebtFree, Result: tc.result}
			if tc.result == GuardrailHolds {
				want.HasTightest, want.Tightest = true, start
			} else {
				want.FirstBreach, want.Owed = start, tc.owed
			}
			if got != want {
				t.Errorf("got %+v, want %+v", got, want)
			}
		})
	}
}

// Spec chapter 04 §10: a deadline before the plan is judged from its first
// month, and a window with no recorded month does not apply.
func TestDebtFreeWindowIsClipped(t *testing.T) {
	start := month(t, "2025-01")
	series := owing(map[string][]float64{"Car": {0, 0}})
	got := EvaluateGuardrail(debtFree(t, "2020-01", "", "Car"), start, series)
	if got.Result != GuardrailHolds || got.Tightest != start || got.MarginMonths != 0 {
		t.Errorf("deadline before the plan: got %+v, want holds, cleared at the start, no months to spare", got)
	}
	got = EvaluateGuardrail(debtFree(t, "2026-01", "", "Car"), start, series)
	if got != (GuardrailResult{Name: "G", Kind: "debtFree", Result: GuardrailDoesNotApply}) {
		t.Errorf("deadline after the plan: got %+v", got)
	}
}

// Spec chapter 04 §10: a lasts sums the listed accounts the path has; without
// an amount it breaks when they reach 0.00 together.
func TestLastsNeverEmptied(t *testing.T) {
	start := month(t, "2025-01")
	series := holding(4, map[string][]float64{
		"Brokerage": {300, 200, 0, 0},
		"IRA":       {50, 50, 50, 0.004},
		"Other":     {1000, 1000, 1000, 1000},
	})
	got := EvaluateGuardrail(lasts(t, nil, "", "Brokerage"), start, series)
	want := GuardrailResult{Name: "G", Kind: "lasts", Result: GuardrailBreaks,
		FirstBreach: month(t, "2025-03"), HasTightest: true, Tightest: month(t, "2025-03"), Margin: 0}
	if got != want {
		t.Errorf("Brokerage: got %+v, want %+v", got, want)
	}
	got = EvaluateGuardrail(lasts(t, nil, "", "Brokerage", "IRA"), start, series)
	if got.Result != GuardrailBreaks || got.FirstBreach != month(t, "2025-04") || got.Tightest != month(t, "2025-04") || math.Abs(got.Margin-0.004) > 1e-12 {
		t.Errorf("Brokerage and IRA: got %+v, want a breach at 0.004 in 2025-04", got)
	}
}

// Spec chapter 04 §10: with an amount, the accounts must hold at least that
// much, to the cent; the margin is the value less the amount.
func TestLastsAboveAnAmount(t *testing.T) {
	start := month(t, "2025-01")
	series := holding(3, map[string][]float64{"Fund": {900, 500, 700}})
	amount := 500.0
	got := EvaluateGuardrail(lasts(t, &amount, "", "Fund"), start, series)
	want := GuardrailResult{Name: "G", Kind: "lasts", Result: GuardrailHolds, HasTightest: true, Tightest: month(t, "2025-02"), Margin: 0}
	if got != want {
		t.Errorf("met exactly: got %+v, want %+v", got, want)
	}
	more := 500.01
	got = EvaluateGuardrail(lasts(t, &more, "2025-02", "Fund"), start, series)
	if got.Result != GuardrailBreaks || got.FirstBreach != month(t, "2025-02") || math.Abs(got.Margin+0.01) > 1e-9 {
		t.Errorf("a cent more: got %+v, want a breach in 2025-02 by 0.01", got)
	}
}

// Spec chapter 04 §10: a lasts whose accounts the path has none of does not
// apply to it.
func TestLastsWithoutTheAccountsDoesNotApply(t *testing.T) {
	got := EvaluateGuardrail(lasts(t, nil, "", "Old 401k"), month(t, "2025-01"), holding(2, map[string][]float64{"Fund": {1, 1}}))
	if got != (GuardrailResult{Name: "G", Kind: "lasts", Result: GuardrailDoesNotApply}) {
		t.Errorf("got %+v", got)
	}
}

// Spec chapter 04 §10: a simulated path records what each loan owes at the end
// of each month: nothing before it starts, what remains after its payment from
// its first month, and nothing from the month it ends. Loans with the same
// name are summed, and continuing escrow is not owed.
func TestSimulationRecordsWhatEachLoanOwes(t *testing.T) {
	res, err := Run(loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-06, startingCash: 50000}
recommendations: {emergencyFundMonths: 0}
scenarios:
  - name: a
    loans:
      - {name: Car, principal: 300, interestRate: 0, term: 3, startDate: 2025-01, escrow: 10}
      - {name: Car, principal: 200, interestRate: 0, term: 2, startDate: 2025-03}
      - {name: Boat, principal: 400, downPayment: 100, interestRate: 0, term: 3, startDate: 2025-04}
`), Options{})
	if err != nil {
		t.Fatal(err)
	}
	owed := res.Scenarios[0].Owed
	assertSeries(t, owed["Car"], []float64{200, 100, 100, 0, 0, 0})
	assertSeries(t, owed["Boat"], []float64{0, 0, 0, 200, 100, 0})
}

// Spec chapter 04 §10: a simulated path records each account's value at the
// end of each month, after any withdrawal that funds a loan payoff.
func TestSimulationRecordsEachAccountsValue(t *testing.T) {
	res, err := Run(loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-03, startingCash: 1500}
recommendations: {emergencyFundMonths: 0}
scenarios:
  - name: a
    investments:
      - {name: Brokerage, startingValue: 8000, fundLoanPayoffs: true}
    loans:
      - {name: Car, principal: 6000, interestRate: 0, term: 6, startDate: 2025-01, earlyPayoffThreshold: 1000}
`), Options{})
	if err != nil {
		t.Fatal(err)
	}
	sc := res.Scenarios[0]
	assertSeries(t, sc.Holdings["Brokerage"], []float64{8000, 3500, 3500})
	assertSeries(t, sc.Owed["Car"], []float64{5000, 0, 0})
}
