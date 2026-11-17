package app

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

const debtAndAccountsPlan = `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-06, startingCash: 10000}
recommendations: {emergencyFundMonths: 0}
guardrails:
  - {name: Car gone by April, kind: debtFree, startDate: 2025-04, loans: [Car]}
  - {name: Car gone by February, kind: debtFree, startDate: 2025-02, loans: [Car]}
  - {name: Debt-free by May, kind: debtFree, startDate: 2025-05, endDate: 2025-05}
  - {name: Fund lasts, kind: lasts, investments: [Fund]}
  - {name: Keep 1000, kind: lasts, investments: [Fund], amount: 1000}
  - {name: Old fund lasts, kind: lasts, investments: [Old fund]}
scenarios:
  - name: a
    loans:
      - {name: Car, principal: 300, interestRate: 0, term: 3, startDate: 2025-01}
      - {name: Boat, principal: 1200, interestRate: 0, term: 12, startDate: 2025-01}
    investments:
      - {name: Fund, startingValue: 1500, withdrawals: [{amount: 100}]}
  - name: parked
    active: false
    investments:
      - {name: Old fund}
`

// Spec chapter 02, Results JSON: a debtFree reports its cleared month and
// months to spare instead of a margin, and what it owes at a breach; a lasts
// reports like a cash floor, and does not apply on a path without its
// accounts.
func TestResultsJSONCarriesDebtFreeAndLasts(t *testing.T) {
	// The car owes 200, 100, 0; the boat owes 1100 down to 600; the fund holds
	// 1400 down to 900.
	got := runPlan(t, debtAndAccountsPlan, false)["metrics"].([]any)[0].(map[string]any)["guardrails"]
	var want any
	if err := json.Unmarshal([]byte(`[
		{"name":"Car gone by April","kind":"debtFree","result":"holds","tightestDate":"2025-03","marginMonths":1},
		{"name":"Car gone by February","kind":"debtFree","result":"breaks","firstBreachDate":"2025-02","owed":100,"tightestDate":"2025-03","marginMonths":-1},
		{"name":"Debt-free by May","kind":"debtFree","result":"breaks","firstBreachDate":"2025-05","owed":700},
		{"name":"Fund lasts","kind":"lasts","result":"holds","tightestDate":"2025-06","margin":900},
		{"name":"Keep 1000","kind":"lasts","result":"breaks","firstBreachDate":"2025-06","tightestDate":"2025-06","margin":-100},
		{"name":"Old fund lasts","kind":"lasts","result":"doesNotApply"}]`), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("guardrails =\n %v\nwant\n %v", got, want)
	}
}

// Spec chapter 04 §10: the per-loan and per-account balances guardrails read
// are not written to the CSV.
func TestCSVDoesNotCarryLoanOrAccountBalances(t *testing.T) {
	without := debtAndAccountsPlan[:strings.Index(debtAndAccountsPlan, "guardrails:")] + debtAndAccountsPlan[strings.Index(debtAndAccountsPlan, "scenarios:"):]
	if runPlan(t, debtAndAccountsPlan, false)["csv"] != runPlan(t, without, false)["csv"] {
		t.Error("the CSV depends on the guardrails")
	}
}

// The R04.1 worked example on examples/choices.yaml: only selling clears the
// mortgage by 2030, and the brokerage lasts on every path.
func TestChoicesExampleDebtFreeAndLasts(t *testing.T) {
	f := forecastOf(t, example(t, "choices.yaml"), false)
	type want struct {
		result, breach, cleared string
		marginMonths            int
		owed                    float64
	}
	wants := map[string]want{
		"as we are":          {"breaks", "2030-01", "", 0, 194640.48},
		"sell":               {"holds", "", "2027-06", 31, 0},
		"sell and freelance": {"holds", "", "2027-06", 31, 0},
	}
	for _, sc := range f.Result.Scenarios {
		if len(sc.Guardrails) != 3 {
			t.Fatalf("%s: want three guardrails, got %+v", sc.Name, sc.Guardrails)
		}
		g, w := sc.Guardrails[1], wants[sc.Name]
		if g.Name != "Mortgage gone by 2030" {
			t.Fatalf("%s: second guardrail is %q", sc.Name, g.Name)
		}
		have := want{result: string(g.Result), marginMonths: g.MarginMonths, owed: g.Owed}
		if g.Result == "breaks" {
			have.breach = g.FirstBreach.String()
		}
		if g.HasTightest {
			have.cleared = g.Tightest.String()
		}
		if math.Abs(have.owed-w.owed) < 0.005 {
			have.owed = w.owed
		}
		if have != w {
			t.Errorf("%s: got %+v, want %+v", sc.Name, have, w)
		}
		if l := sc.Guardrails[2]; l.Name != "Brokerage lasts" || l.Result != "holds" {
			t.Errorf("%s: brokerage guardrail = %+v, want holds", sc.Name, l)
		}
	}
}

// Spec chapter 02, Results JSON, flip: the flipped path carries its own
// debtFree and lasts results, those of the same scenario written by hand.
func TestFlipCarriesDebtFreeAndLasts(t *testing.T) {
	doc := example(t, "choices.yaml")
	f, err := flipOf(t, doc, false, Flip{Scenario: "as we are", Choice: "Housing", Option: "Sell and rent"})
	if err != nil {
		t.Fatal(err)
	}
	hand := forecastOf(t, doc, false)
	want := hand.Result.Scenarios[1].Guardrails // "sell" is "as we are" with the house sold
	if !reflect.DeepEqual(f.Flip.Flipped.Guardrails, want) {
		t.Errorf("flipped guardrails = %+v, want %+v", f.Flip.Flipped.Guardrails, want)
	}
	if f.Flip.Original.Guardrails[1].Result != "breaks" || f.Flip.Flipped.Guardrails[1].Result != "holds" {
		t.Errorf("mortgage guardrail: scenario %+v, flipped %+v", f.Flip.Original.Guardrails[1], f.Flip.Flipped.Guardrails[1])
	}
}
