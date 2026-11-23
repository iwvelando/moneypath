package app

import (
	"encoding/json"
	"reflect"
	"testing"
)

// A plan with choices, a loan on one path only and an inactive scenario.
const netWorthPlan = `
version: 2
simulation: {startDate: 2026-01, endDate: 2027-12, startingCash: 25000}
common:
  events:
    - {name: Salary, amount: 4000}
    - {name: Living, amount: -3000}
choices:
  - name: Car
    options:
      - {name: None}
      - name: Buy
        loans:
          - {name: Car, principal: 12000, interestRate: 3, term: 36, startDate: 2026-04}
scenarios:
  - name: car
    select: {Car: Buy}
  - name: no car
    select: {Car: None}
  - name: set aside
    active: false
    select: {Car: Buy}
`

type netWorthResults struct {
	Scenarios []string `json:"scenarios"`
	Rows      []struct {
		Values []struct {
			Total       float64  `json:"total"`
			Liabilities *float64 `json:"liabilities"`
			NetWorth    *float64 `json:"netWorth"`
		} `json:"values"`
	} `json:"rows"`
	Metrics []struct {
		KeyFigures struct {
			EndingNetWorth *float64 `json:"endingNetWorth"`
		} `json:"keyFigures"`
	} `json:"metrics"`
	Comparisons []struct {
		Scenario int                   `json:"scenario"`
		Against  int                   `json:"against"`
		NetWorth *seriesComparisonJSON `json:"netWorth"`
	} `json:"comparisons"`
	Flip *struct {
		NetWorth *struct {
			Difference []float64           `json:"difference"`
			BreakEven  []flipBreakEvenJSON `json:"breakEven"`
		} `json:"netWorth"`
	} `json:"flip"`
}

// Spec chapter 02, Results JSON: every row value carries liabilities and net
// worth, the key figures end with net worth, and every comparison and the
// flip compare net worth (chapter 04 §1, §8, §9).
func TestResultsJSONCarriesNetWorth(t *testing.T) {
	f := forecastWith(t, netWorthPlan, ForecastInput{Flip: &Flip{Scenario: "car", Choice: "Car", Option: "None"}})
	raw, err := ResultsJSON(f, "test")
	if err != nil {
		t.Fatal(err)
	}
	var got netWorthResults
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if want := []string{"car", "no car"}; !reflect.DeepEqual(got.Scenarios, want) {
		t.Fatalf("scenarios %v, want %v", got.Scenarios, want)
	}
	for s, sr := range f.Result.Scenarios {
		for i, row := range got.Rows {
			v := row.Values[s]
			if v.Liabilities == nil || v.NetWorth == nil {
				t.Fatalf("%s row %d has no liabilities or net worth", sr.Name, i)
			}
			if *v.Liabilities != sr.Liabilities[i] || *v.NetWorth != sr.NetWorth[i] {
				t.Errorf("%s row %d: liabilities %v, net worth %v; want %v, %v", sr.Name, i, *v.Liabilities, *v.NetWorth, sr.Liabilities[i], sr.NetWorth[i])
			}
		}
		if e := got.Metrics[s].KeyFigures.EndingNetWorth; e == nil || *e != sr.KeyFigures.EndingNetWorth {
			t.Errorf("%s endingNetWorth %v, want %v", sr.Name, e, sr.KeyFigures.EndingNetWorth)
		}
	}
	// The car owes from its start; the path without it owes nothing and its
	// net worth is its total.
	if got.Rows[2].Values[0].Liabilities == nil || *got.Rows[2].Values[0].Liabilities != 0 || *got.Rows[3].Values[0].Liabilities == 0 {
		t.Errorf("the car's liabilities do not start in 2026-04")
	}
	for i, row := range got.Rows {
		if v := row.Values[1]; *v.Liabilities != 0 || *v.NetWorth != v.Total {
			t.Errorf("no car, row %d: liabilities %v, net worth %v, total %v", i, *v.Liabilities, *v.NetWorth, v.Total)
		}
	}
	if len(got.Comparisons) != 2 {
		t.Fatalf("%d comparisons", len(got.Comparisons))
	}
	for _, c := range got.Comparisons {
		want := f.Result.Compare(f.Result.Scenarios[c.Scenario], f.Result.Scenarios[c.Against]).NetWorth
		if c.NetWorth == nil || !reflect.DeepEqual(c.NetWorth.Difference, want.Difference) {
			t.Errorf("comparison %d minus %d: net worth %+v, want %v", c.Scenario, c.Against, c.NetWorth, want.Difference)
			continue
		}
		if c.NetWorth.BreakEven == nil || len(c.NetWorth.BreakEven) != len(want.BreakEven) {
			t.Errorf("comparison %d minus %d: net worth break-even %v, want %v", c.Scenario, c.Against, c.NetWorth.BreakEven, want.BreakEven)
		}
	}
	if got.Flip == nil || got.Flip.NetWorth == nil {
		t.Fatalf("the flip compares no net worth")
	}
	want := f.Flip.Comparison.NetWorth
	if !reflect.DeepEqual(got.Flip.NetWorth.Difference, want.Difference) || got.Flip.NetWorth.BreakEven == nil {
		t.Errorf("flip net worth %+v, want %v", got.Flip.NetWorth, want)
	}
	// Without the car the path owes nothing, so it leads in net worth from
	// the month the car starts.
	if want.Difference[3] <= 0 {
		t.Errorf("flip net worth difference in 2026-04 = %v, want the flipped path ahead", want.Difference[3])
	}
}
