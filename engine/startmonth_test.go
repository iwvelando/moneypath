package engine

import (
	"math"
	"testing"
)

// Spec chapter 04 §1: startingCash is the balance at the end of the month
// before the start, so the start month is simulated like any other. An event
// dated there counts, and a loan starting there bills its down payment and its
// first payment. Starting the loan a month later saves nothing.
func TestStartMonthActivityIsSimulated(t *testing.T) {
	res, err := Run(loadConfig(t, `
version: 2
simulation: {startDate: 2026-01, endDate: 2026-04, startingCash: 50000.00}
recommendations: {emergencyFundMonths: 0}
scenarios:
  - name: car at start
    events:
      - {name: Bonus, amount: 500.00, startDate: 2026-01, endDate: 2026-01}
    loans:
      - {name: Car, principal: 30000.00, downPayment: 5000.00, interestRate: 0, term: 25, startDate: 2026-01}
  - name: car next month
    loans:
      - {name: Car, principal: 30000.00, downPayment: 5000.00, interestRate: 0, term: 25, startDate: 2026-02}
`), Options{})
	if err != nil {
		t.Fatal(err)
	}
	assertSeries(t, res.Scenarios[0].Liquid, []float64{44500, 43500, 42500, 41500})
	assertSeries(t, res.Scenarios[1].Liquid, []float64{50000, 44000, 43000, 42000})
}

// Spec chapter 04 §4: an investment's startingValue is read like
// startingCash, so it grows in the start month.
func TestStartMonthInvestmentsGrow(t *testing.T) {
	res, err := Run(loadConfig(t, cashPlan("", `scenarios:
  - name: a
    investments:
      - {name: Fund, startingValue: 1000, annualReturnRate: 12}
`)), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Scenarios[0].Total[0]; math.Abs(got-(1200+1010)) > 1e-9 {
		t.Errorf("total at the start month = %.6f, want 2210", got)
	}
}

// Spec chapter 04 §3.2: payments dated before the start are never billed, and
// the payment dated in the start month is.
func TestStartMonthBillsALoanThatStartedEarlier(t *testing.T) {
	got := liquidOf(t, cashPlan("", `scenarios:
  - name: a
    loans:
      - {name: Card, principal: 1200, interestRate: 0, term: 12, startDate: 2024-11}
`))
	assertSeries(t, got, []float64{1100, 1000, 900, 800, 700})
}

// Spec chapter 04 §5: the fund's starting balance is startingCash, before the
// start month's own spending, and the average covers the start month and the
// eleven after it.
func TestEmergencyFundStartsFromStartingCash(t *testing.T) {
	res, err := Run(loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-03, startingCash: 1200}
recommendations: {emergencyFundMonths: 6}
scenarios:
  - name: a
    events:
      - {name: Rent, amount: -100}
      - {name: Deposit, amount: -1200, startDate: 2025-01, endDate: 2025-01}
      - {name: Repair, amount: -2400, startDate: 2026-01, endDate: 2026-01}
`), Options{})
	if err != nil {
		t.Fatal(err)
	}
	ef := res.Scenarios[0].EmergencyFund
	if ef.InitialLiquid != 1200 {
		t.Errorf("initial liquid = %v, want the starting cash 1200", ef.InitialLiquid)
	}
	// 2025-01 … 2025-12: twelve rents and the deposit; the repair falls in the
	// thirteenth month.
	if math.Abs(ef.AverageMonthlyExpenses-200) > 1e-9 {
		t.Errorf("average monthly expenses = %v, want 200", ef.AverageMonthlyExpenses)
	}
	if math.Abs(ef.Shortfall-0) > 1e-9 || math.Abs(ef.TargetAmount-1200) > 1e-9 {
		t.Errorf("target = %v, shortfall = %v; want 1200 and 0", ef.TargetAmount, ef.Shortfall)
	}
}
