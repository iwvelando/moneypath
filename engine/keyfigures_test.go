package engine

import (
	"math"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

// Spec chapter 04 §8: lowest cash is the least recorded liquid, start month
// included, and the ending figures are the last recorded month's.
func TestKeyFiguresReadTheRecordedSeries(t *testing.T) {
	start := month(t, "2025-01")
	got := keyFigures(start,
		[]float64{5000, 4200, 1800.25, 2600, 3100},
		[]float64{9000, 8300, 6000, 6900, 7500.5})
	want := KeyFigures{
		LowestCash:     1800.25,
		LowestCashDate: month(t, "2025-03"),
		EndingCash:     3100,
		EndingTotal:    7500.5,
	}
	if got != want {
		t.Errorf("KeyFigures = %+v, want %+v", got, want)
	}
}

// Spec chapter 04 §8: when several months share the lowest cash, the earliest
// is reported.
func TestKeyFiguresLowestCashTieGoesToTheEarliestMonth(t *testing.T) {
	got := keyFigures(month(t, "2025-01"), []float64{5000, 3000, 5000, 3000, 6000}, []float64{5000, 3000, 5000, 3000, 6000})
	if got.LowestCashDate != month(t, "2025-02") || got.LowestCash != 3000 {
		t.Errorf("lowest cash = %v at %s, want 3000 at 2025-02", got.LowestCash, got.LowestCashDate)
	}
}

// Spec chapter 04 §8: months are compared in whole cents, so a later month
// that is lower only by float noise does not take the place of an earlier one,
// and the value reported is the earlier month's own.
func TestKeyFiguresLowestCashComparesWholeCents(t *testing.T) {
	got := keyFigures(month(t, "2025-01"), []float64{100, 50.004, 50.001, 60}, []float64{100, 50.004, 50.001, 60})
	if got.LowestCashDate != month(t, "2025-02") || got.LowestCash != 50.004 {
		t.Errorf("lowest cash = %v at %s, want 50.004 at 2025-02", got.LowestCash, got.LowestCashDate)
	}
}

// Spec chapter 04 §8: cash that never falls after the start month reports
// that month's cash and the start month.
func TestKeyFiguresLowestCashCanBeTheStartMonth(t *testing.T) {
	got := keyFigures(month(t, "2025-01"), []float64{5000, 5500, 6000}, []float64{5000, 5500, 6000})
	if got.LowestCashDate != month(t, "2025-01") || got.LowestCash != 5000 {
		t.Errorf("lowest cash = %v at %s, want 5000 at 2025-01", got.LowestCash, got.LowestCashDate)
	}
}

// Spec chapter 04 §1 and §8: a plan whose start is its end simulates and
// records that one month, and every key figure describes it.
func TestKeyFiguresOfAPlanOfOneMonth(t *testing.T) {
	cfg, _, err := config.Parse([]byte(`
version: 2
simulation: {startDate: 2025-03, endDate: 2025-03, startingCash: 1200}
common:
  investments:
    - {name: Fund, startingValue: 800, annualReturnRate: 6}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -900}
`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := config.Validate(cfg, month(t, "2025-03")); err != nil {
		t.Fatal(err)
	}
	res, err := Run(cfg, Options{})
	if err != nil {
		t.Fatal(err)
	}
	got := res.Scenarios[0].KeyFigures
	// The month's rent is paid and the fund grows half a percent.
	if got.LowestCash != 300 || got.LowestCashDate != month(t, "2025-03") || got.EndingCash != 300 ||
		math.Abs(got.EndingTotal-(300+800*1.005)) > 1e-9 {
		t.Errorf("KeyFigures = %+v, want cash 300 in 2025-03 and a total of 1104", got)
	}
}
