package engine

import (
	"math"
	"strings"
	"testing"
)

func cashPlan(rate string, body string) string {
	return "version: 2\nsimulation:\n  startDate: 2025-01\n  endDate: 2025-05\n  startingCash: 1200\n" +
		rate + body
}

func liquidOf(t *testing.T, doc string) []float64 {
	t.Helper()
	res, err := Run(loadConfig(t, doc), Options{})
	if err != nil {
		t.Fatal(err)
	}
	return res.Scenarios[0].Liquid
}

func assertSeries(t *testing.T, got, want []float64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("series length = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if math.Abs(got[i]-want[i]) > 1e-9 {
			t.Errorf("month %d: liquid = %.6f, want %.6f\nfull series: %v", i, got[i], want[i], got)
		}
	}
}

// Spec chapter 04 §1.1: with no rate configured, cash does not grow — the
// worst-case assumption of a non-interest-bearing account.
func TestCashInterestDefaultsToNone(t *testing.T) {
	got := liquidOf(t, cashPlan("", "scenarios: [{name: a}]\n"))
	assertSeries(t, got, []float64{1200, 1200, 1200, 1200, 1200})
}

// Spec chapter 04 §1.1: monthly rate = annual / 12, compounding — each
// month's interest joins the balance the next month earns on. The initial row
// carries no interest.
func TestCashInterestCompoundsMonthly(t *testing.T) {
	got := liquidOf(t, cashPlan("  cashInterestRate: 12\n", "scenarios: [{name: a}]\n"))
	// 1% a month.
	assertSeries(t, got, []float64{1200, 1212, 1224.12, 1236.3612, 1248.724812})
}

// Spec chapter 04 §1.1: the base is the previous month's ending balance, so
// money arriving this month (or leaving it) does not change this month's
// interest — it starts earning next month, as a new investment contribution
// does.
func TestCashInterestIsOnPriorBalance(t *testing.T) {
	doc := cashPlan("  cashInterestRate: 12\n", `scenarios:
  - name: a
    events:
      - {name: Windfall, amount: 1000, startDate: 2025-02, endDate: 2025-02}
      - {name: Bill, amount: -500, startDate: 2025-03, endDate: 2025-03}
`)
	got := liquidOf(t, doc)
	feb := 1200 + 12.0 + 1000   // interest on 1200 only, not on the windfall
	mar := feb + feb*0.01 - 500 // interest on the full February balance
	apr := mar + mar*0.01       // interest on the post-bill balance
	assertSeries(t, got, []float64{1200, feb, mar, apr, apr * 1.01})
}

// Spec chapter 04 §1.1: only positive balances earn. Negative cash is debt and
// is not charged the savings rate; it earns again once it is back above zero.
func TestCashInterestIgnoresNegativeBalance(t *testing.T) {
	doc := cashPlan("  cashInterestRate: 12\n", `scenarios:
  - name: a
    events:
      - {name: Purchase, amount: -2000, startDate: 2025-02, endDate: 2025-02}
      - {name: Refund, amount: 1000, startDate: 2025-04, endDate: 2025-04}
`)
	got := liquidOf(t, doc)
	feb := 1200 + 12.0 - 2000 // -788
	mar := feb                // negative: no interest and no charge
	apr := mar + 1000         // still no interest this month (prior balance negative)
	assertSeries(t, got, []float64{1200, feb, mar, apr, apr * 1.01})
}

// Spec chapter 04 §1.1: one rate for the simulation, applied in every scenario
// and independently in each.
func TestCashInterestAppliesToEveryScenario(t *testing.T) {
	doc := cashPlan("  cashInterestRate: 12\n", `scenarios:
  - name: a
  - name: b
    events:
      - {name: Bill, amount: -200, startDate: 2025-02, endDate: 2025-02}
`)
	res, err := Run(loadConfig(t, doc), Options{})
	if err != nil {
		t.Fatal(err)
	}
	assertSeries(t, res.Scenarios[0].Liquid, []float64{1200, 1212, 1224.12, 1236.3612, 1248.724812})
	feb := 1200 + 12.0 - 200
	assertSeries(t, res.Scenarios[1].Liquid, []float64{1200, feb, feb * 1.01, feb * 1.01 * 1.01, feb * 1.01 * 1.01 * 1.01})
}

// Spec chapter 04 §1.1: total = cash (with its interest) + investment values.
func TestCashInterestFlowsIntoTotal(t *testing.T) {
	doc := cashPlan("  cashInterestRate: 12\n", `scenarios:
  - name: a
    investments:
      - {name: Fund, startingValue: 1000}
`)
	res, err := Run(loadConfig(t, doc), Options{})
	if err != nil {
		t.Fatal(err)
	}
	sr := res.Scenarios[0]
	if math.Abs(sr.Total[1]-(1212+1000)) > 1e-9 {
		t.Errorf("total[1] = %.6f, want 2212", sr.Total[1])
	}
}

// Spec chapter 04 §1.1 + §5: interest is neither an expense nor part of the
// starting balance, so the emergency-fund figures ignore it.
func TestCashInterestLeavesEmergencyFundAlone(t *testing.T) {
	body := `scenarios:
  - name: a
    events:
      - {name: Rent, amount: -100}
`
	with, err := Run(loadConfig(t, cashPlan("  cashInterestRate: 12\n", body)), Options{})
	if err != nil {
		t.Fatal(err)
	}
	without, err := Run(loadConfig(t, cashPlan("", body)), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if *with.Scenarios[0].EmergencyFund != *without.Scenarios[0].EmergencyFund {
		t.Errorf("emergency fund changed with interest:\n with    %+v\n without %+v",
			*with.Scenarios[0].EmergencyFund, *without.Scenarios[0].EmergencyFund)
	}
}

// Spec chapter 04 §1 step 3 + §1.1: the threshold check sees the interest the
// month just earned. Balance 1169.50 against a 1070.00 payoff is 99.50 short
// of the 100.00 margin; a month of interest at 1% (11.695) clears it.
func TestCashInterestCountsTowardThresholdPayoff(t *testing.T) {
	plan := func(rate string) string {
		return "version: 2\nsimulation:\n  startDate: 2025-01\n  endDate: 2025-04\n  startingCash: 1169.50\n" + rate + `scenarios:
  - name: a
    loans:
      - name: Loan
        principal: 1200
        interestRate: 0
        term: 120
        startDate: 2024-01
        earlyPayoffThreshold: 100
`
	}
	with, err := Run(loadConfig(t, plan("  cashInterestRate: 12\n")), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if notes := with.Scenarios[0].Notes[1]; len(notes) != 1 || !strings.Contains(notes[0], "paying off asset Loan for 1070.00") {
		t.Errorf("with interest, want a payoff note in the first month, got %q", notes)
	}
	without, err := Run(loadConfig(t, plan("")), Options{})
	if err != nil {
		t.Fatal(err)
	}
	for i, notes := range without.Scenarios[0].Notes {
		if len(notes) != 0 {
			t.Errorf("without interest the threshold is never met, but month %d has notes %q", i, notes)
		}
	}
}
