package engine

import (
	"reflect"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

func scenarioOf(liquid, total []float64) *ScenarioResult {
	return &ScenarioResult{Liquid: liquid, Total: total}
}

// breakEvens compares one series pair, used for both cash and total.
func breakEvens(t *testing.T, a, b []float64) []BreakEven {
	t.Helper()
	return Compare(month(t, "2025-01"), scenarioOf(a, a), scenarioOf(b, b)).Cash.BreakEven
}

// Spec chapter 04 §9: the difference is the first scenario minus the second,
// month by month and unrounded, for cash and for total separately.
func TestCompareReportsTheDifferenceForCashAndTotal(t *testing.T) {
	got := Compare(month(t, "2025-01"),
		scenarioOf([]float64{5000, 4000.25, 6000}, []float64{9000, 8000, 9500}),
		scenarioOf([]float64{5000, 4500, 5000}, []float64{9000, 9100, 9600.5}))
	if want := []float64{0, -499.75, 1000}; !reflect.DeepEqual(got.Cash.Difference, want) {
		t.Errorf("cash difference = %v, want %v", got.Cash.Difference, want)
	}
	if want := []float64{0, -1100, -100.5}; !reflect.DeepEqual(got.Total.Difference, want) {
		t.Errorf("total difference = %v, want %v", got.Total.Difference, want)
	}
}

// Spec chapter 04 §9: a month led by the scenario that was behind is a
// break-even month, reported with the scenario that moves ahead; cash and
// total are walked independently.
func TestCompareReportsTheMonthTheOtherScenarioMovesAhead(t *testing.T) {
	got := Compare(month(t, "2025-01"),
		scenarioOf([]float64{100, 90, 95, 120}, []float64{100, 90, 110, 120}),
		scenarioOf([]float64{100, 100, 100, 100}, []float64{100, 100, 100, 100}))
	if want := []BreakEven{{Month: month(t, "2025-04"), FirstAhead: true}}; !reflect.DeepEqual(got.Cash.BreakEven, want) {
		t.Errorf("cash break-even = %v, want %v", got.Cash.BreakEven, want)
	}
	if want := []BreakEven{{Month: month(t, "2025-03"), FirstAhead: true}}; !reflect.DeepEqual(got.Total.BreakEven, want) {
		t.Errorf("total break-even = %v, want %v", got.Total.BreakEven, want)
	}
}

// Spec chapter 04 §9: every change of lead is reported, in month order.
func TestCompareReportsEveryCrossing(t *testing.T) {
	got := breakEvens(t, []float64{10, 5, 15, 5, 15}, []float64{10, 10, 10, 10, 10})
	want := []BreakEven{
		{Month: month(t, "2025-03"), FirstAhead: true},
		{Month: month(t, "2025-04"), FirstAhead: false},
		{Month: month(t, "2025-05"), FirstAhead: true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("break-even = %v, want %v", got, want)
	}
}

// Spec chapter 04 §9: a level month before an overtaking is not the
// break-even month; the first month the other scenario is ahead is.
func TestCompareSkipsALevelMonthBeforeAnOvertaking(t *testing.T) {
	got := breakEvens(t, []float64{10, 5, 10, 10, 12}, []float64{10, 10, 10, 10, 10})
	want := []BreakEven{{Month: month(t, "2025-05"), FirstAhead: true}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("break-even = %v, want %v", got, want)
	}
}

// Spec chapter 04 §9: a scenario that is caught but not passed, and pulls
// away again, has not been overtaken.
func TestCompareIgnoresALeadLostToALevelMonthAndRegained(t *testing.T) {
	if got := breakEvens(t, []float64{10, 15, 10, 15}, []float64{10, 10, 10, 10}); len(got) != 0 {
		t.Errorf("break-even = %v, want none", got)
	}
}

// Spec chapter 04 §9: the first lead taken from a level start overtakes
// nobody.
func TestCompareTheFirstLeadFromALevelStartIsNotABreakEven(t *testing.T) {
	if got := breakEvens(t, []float64{10, 10, 12, 14}, []float64{10, 10, 10, 10}); len(got) != 0 {
		t.Errorf("break-even = %v, want none", got)
	}
}

// Spec chapter 04 §9: the lead is decided by rounding both balances to whole
// cents, so values that round to the same amount never report a crossing.
func TestCompareDecidesTheLeadInWholeCents(t *testing.T) {
	got := breakEvens(t, []float64{10, 5, 10.004, 9.996, 10.01}, []float64{10, 10, 10, 10, 10})
	want := []BreakEven{{Month: month(t, "2025-05"), FirstAhead: true}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("break-even = %v, want %v", got, want)
	}
}

// Rounding the difference instead of both balances loses a real lead across
// a rounding boundary, even when the raw gap is smaller than half a cent.
func TestCompareRoundsBothBalancesAtTheCentBoundary(t *testing.T) {
	for _, c := range []struct {
		name string
		last float64
		want []BreakEven
	}{
		{"below", 10.0049, []BreakEven{}},
		{"at", 10.005, []BreakEven{{Month: month(t, "2025-03"), FirstAhead: true}}},
		{"above", 10.0051, []BreakEven{{Month: month(t, "2025-03"), FirstAhead: true}}},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := breakEvens(t, []float64{10.004, 9, c.last}, []float64{10.004, 10.004, 10.004})
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("break-even = %v, want %v", got, c.want)
			}
		})
	}
}

// Spec chapter 04 §9: a crossing in the last recorded month is reported.
func TestCompareReportsACrossingInTheFinalMonth(t *testing.T) {
	got := breakEvens(t, []float64{10, 5, 5, 11}, []float64{10, 10, 10, 10})
	want := []BreakEven{{Month: month(t, "2025-04"), FirstAhead: true}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("break-even = %v, want %v", got, want)
	}
}

// Spec chapter 04 §9: swapping the pair negates the difference and keeps the
// months, each with the same scenario moving ahead.
func TestCompareOfTheSwappedPairMirrorsTheFirst(t *testing.T) {
	a := scenarioOf([]float64{10, 5, 15}, []float64{10, 5, 15})
	b := scenarioOf([]float64{10, 10, 10}, []float64{10, 10, 10})
	got := Compare(month(t, "2025-01"), b, a)
	if want := []float64{0, 5, -5}; !reflect.DeepEqual(got.Cash.Difference, want) {
		t.Errorf("difference = %v, want %v", got.Cash.Difference, want)
	}
	if want := []BreakEven{{Month: month(t, "2025-03"), FirstAhead: false}}; !reflect.DeepEqual(got.Cash.BreakEven, want) {
		t.Errorf("break-even = %v, want %v", got.Cash.BreakEven, want)
	}
}

// Spec chapter 04 §1 and §9: a plan with only its initial row has one
// difference and no break-even month.
func TestCompareOfAPlanWithOnlyItsInitialRow(t *testing.T) {
	cfg, _, err := config.Parse([]byte(`
version: 2
simulation: {startDate: 2025-03, endDate: 2025-03, startingCash: 1200}
scenarios:
  - name: with a fund
    investments:
      - {name: Fund, startingValue: 800, annualReturnRate: 6}
  - name: without
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
	got := res.Compare(res.Scenarios[0], res.Scenarios[1])
	want := Comparison{
		Cash:  SeriesComparison{Difference: []float64{0}, BreakEven: []BreakEven{}},
		Total: SeriesComparison{Difference: []float64{800}, BreakEven: []BreakEven{}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Compare = %+v, want %+v", got, want)
	}
}
