package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// A plan whose option buys a car, so only one path holds an asset.
const assetPlan = `
version: 2
simulation: {startDate: 2026-01, endDate: 2027-12, startingCash: 25000, inflationRate: 3}
common:
  events:
    - {name: Salary, amount: 4000}
    - {name: Living, amount: -3000}
choices:
  - name: Car
    options:
      - {name: None}
      - name: Buy
        assets: [{name: Car, value: 15000, appreciation: -15, startDate: 2026-04}]
        loans:
          - {name: Car loan, asset: Car, principal: 12000, interestRate: 3, term: 36, startDate: 2026-04}
scenarios:
  - name: car
    select: {Car: Buy}
  - name: no car
    select: {Car: None}
`

type assetResults struct {
	Rows []struct {
		Values []map[string]any `json:"values"`
	} `json:"rows"`
	TodaysDollars struct {
		Rows []struct {
			Values []map[string]any `json:"values"`
		} `json:"rows"`
	} `json:"todaysDollars"`
}

// Spec chapter 02, Results JSON: assets and equity are in every row value,
// in both readings, when the plan lists an asset anywhere, and in none when
// it lists none.
func TestResultsJSONCarriesAssetsAndEquity(t *testing.T) {
	f := forecastWith(t, assetPlan, ForecastInput{})
	raw, err := ResultsJSON(f, "test")
	if err != nil {
		t.Fatal(err)
	}
	var got assetResults
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	d := f.Result.Deflator()
	today := d.Result(f.Result)
	for s, sr := range f.Result.Scenarios {
		for i, row := range got.Rows {
			v := row.Values[s]
			if v["assets"] != sr.Assets[i] || v["equity"] != sr.Equity[i] {
				t.Errorf("%s row %d: assets %v, equity %v; want %v, %v", sr.Name, i, v["assets"], v["equity"], sr.Assets[i], sr.Equity[i])
			}
			tv := got.TodaysDollars.Rows[i].Values[s]
			if tv["assets"] != today.Scenarios[s].Assets[i] || tv["equity"] != today.Scenarios[s].Equity[i] {
				t.Errorf("%s row %d in today's dollars: assets %v, equity %v", sr.Name, i, tv["assets"], tv["equity"])
			}
		}
	}
	// The car is worth its value from its purchase on the path that buys it,
	// and the path without it reports 0.
	if v := got.Rows[3].Values[0]["assets"]; v != 15000.0 {
		t.Errorf("car in 2026-04 = %v, want 15000", v)
	}
	if v := got.Rows[3].Values[1]["assets"]; v != 0.0 {
		t.Errorf("no car in 2026-04 = %v, want 0", v)
	}
	if !strings.Contains(f.CSV, `"equity (no car)"`) {
		t.Errorf("CSV lacks the balance-sheet columns:\n%s", f.CSV[:200])
	}

	plain := forecastWith(t, netWorthPlan, ForecastInput{})
	raw, err = ResultsJSON(plain, "test")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"assets"`) || strings.Contains(string(raw), `"equity"`) {
		t.Error("a plan without assets reports assets or equity")
	}
}

// Spec chapter 04 §11: a month that would put a secured loan's first payment
// at or after its asset's sale breaks a rule of chapter 03, so the question is
// refused, naming the first such month.
func TestEarliestRefusesALoanMovedPastItsAssetsSale(t *testing.T) {
	doc := `version: 2
simulation: {startDate: 2026-01, endDate: 2028-12, startingCash: 50000}
guardrails: [{name: Cushion, kind: cashFloor, amount: 0}]
scenarios:
  - name: a
    assets: [{name: Car, value: 15000, sellDate: 2027-06}]
    loans: [{name: Car loan, asset: Car, principal: 12000, interestRate: 3, term: 36, startDate: 2026-04}]
`
	_, err := askEarliest(t, doc, false, Earliest{Scenario: "a", Entry: "scenarios.0.loans.0", Field: "startDate",
		From: "2026-01", To: "2027-12", Guardrails: []string{"Cushion"}})
	want := "Scenario “a”, loan “Car loan”: With its first payment in 2027-06, it would not start before “Car” is sold (2027-06), which pays it off. Choose a range that ends by 2027-05."
	if err == nil || err.Error() != want {
		t.Fatalf("refusal %v\nwant %s", err, want)
	}
	f, err := askEarliest(t, doc, false, Earliest{Scenario: "a", Entry: "scenarios.0.loans.0", Field: "startDate",
		From: "2026-01", To: "2027-05", Guardrails: []string{"Cushion"}})
	if err != nil || f.Earliest == nil {
		t.Fatalf("a range before the sale is refused: %v", err)
	}
}
