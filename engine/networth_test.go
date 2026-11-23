package engine

import (
	"maps"
	"math"
	"os"
	"reflect"
	"slices"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

// owedEverywhere is what a debtFree that lists no loans reads in each month:
// every loan name of the path, summed in sorted order (spec chapter 04 §10).
func owedEverywhere(sr *ScenarioResult) []float64 {
	out := make([]float64, len(sr.Liquid))
	for _, name := range slices.Sorted(maps.Keys(sr.Owed)) {
		for i, v := range sr.Owed[name] {
			out[i] += v
		}
	}
	return out
}

// assertBalanceSheet checks spec chapter 04 §1, step 6, in every month of a
// path: liabilities are what a debtFree with no loans listed reads, to the
// bit, and net worth is total less liabilities.
func assertBalanceSheet(t *testing.T, sr *ScenarioResult) {
	t.Helper()
	n := len(sr.Liquid)
	if len(sr.Liabilities) != n || len(sr.NetWorth) != n {
		t.Fatalf("%s: %d liabilities and %d net worth for %d months", sr.Name, len(sr.Liabilities), len(sr.NetWorth), n)
	}
	owed := owedEverywhere(sr)
	for i := range n {
		if sr.Liabilities[i] != owed[i] {
			t.Errorf("%s: liabilities[%d] = %v, owed on every loan %v", sr.Name, i, sr.Liabilities[i], owed[i])
		}
		if want := sr.Total[i] - sr.Liabilities[i]; sr.NetWorth[i] != want {
			t.Errorf("%s: netWorth[%d] = %v, want total less liabilities %v", sr.Name, i, sr.NetWorth[i], want)
		}
	}
	if want := sr.NetWorth[n-1]; sr.KeyFigures.EndingNetWorth != want {
		t.Errorf("%s: endingNetWorth = %v, want the last month's %v", sr.Name, sr.KeyFigures.EndingNetWorth, want)
	}
}

func cents(v float64) float64 { return math.Round(v*100) / 100 }

// Spec chapter 04 §1: a sale by date ends the mortgage in its month, so the
// liabilities are its balance before it and nothing from it, and net worth
// jumps by about the sale price.
func TestNetWorthOfAPropertySale(t *testing.T) {
	doc, err := os.ReadFile("../testdata/conformance/loan-payoff-date-sell/config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	res := runDoc(t, string(doc))
	sr := res.Scenarios[0]
	assertBalanceSheet(t, sr)
	for _, c := range []struct {
		date     string
		netWorth float64
	}{
		{"2026-08", -105593.32},
		{"2026-09", 97218.72},
	} {
		i := int(month(t, c.date) - res.Start)
		if got := cents(sr.NetWorth[i]); got != c.netWorth {
			t.Errorf("net worth in %s = %.2f, want %.2f", c.date, got, c.netWorth)
		}
	}
	sale := int(month(t, "2026-09") - res.Start)
	for i, v := range sr.Liabilities {
		if owes := v != 0; owes != (i < sale) {
			t.Errorf("liabilities[%s] = %v", res.Start+config.Month(i), v)
		}
	}
}

// Spec chapter 04 §1: with no loans, nothing is owed and net worth is total,
// exactly.
func TestNetWorthWithoutLoansIsTotal(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: -500}
scenarios:
  - name: no loans
    events:
      - {name: Pay, amount: 3000}
      - {name: Living, amount: -3100}
    investments:
      - {name: Fund, startingValue: 1000, annualReturnRate: 5}
`)
	sr := res.Scenarios[0]
	assertBalanceSheet(t, sr)
	for i := range sr.Liquid {
		if sr.Liabilities[i] != 0 || sr.NetWorth[i] != sr.Total[i] {
			t.Errorf("month %d: liabilities %v, net worth %v, total %v", i, sr.Liabilities[i], sr.NetWorth[i], sr.Total[i])
		}
	}
	// Negative cash lowers total and net worth alike; it is no liability.
	if sr.Liquid[0] >= 0 {
		t.Fatalf("the plan's cash is not negative: %v", sr.Liquid[0])
	}
}

// Spec chapter 04 §1: a loan that began before the plan owes from the first
// month, after that month's payment; one that starts inside the plan owes
// nothing before its start month.
func TestLiabilitiesOfLoansBeforeAndInsideThePlan(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 20000}
scenarios:
  - name: two loans
    events:
      - {name: Pay, amount: 3000}
    loans:
      - {name: Student loan, principal: 24000, interestRate: 5, term: 120, startDate: 2021-07}
      - {name: Car, principal: 18000, interestRate: 4, term: 48, startDate: 2026-06, escrow: 50}
`)
	sr := res.Scenarios[0]
	assertBalanceSheet(t, sr)
	// 55 payments of a 120-month loan of 24,000 at 5 %, by the closed form.
	r := 5.0 / 1200
	pay := 24000 * r / (1 - math.Pow(1+r, -120))
	grown := math.Pow(1+r, 55)
	if want := 24000*grown - pay*(grown-1)/r; math.Abs(sr.Liabilities[0]-want) > 0.005 {
		t.Errorf("first month's liabilities = %.4f, want %.4f", sr.Liabilities[0], want)
	}
	carStart := int(month(t, "2026-06") - res.Start)
	for i := range carStart {
		if sr.Owed["Car"][i] != 0 {
			t.Errorf("the car owes %v in month %d, before its start", sr.Owed["Car"][i], i)
		}
	}
	car := sr.Owed["Car"][carStart]
	if car <= 17000 || car >= 18000 {
		t.Errorf("the car owes %v after its first payment", car)
	}
}

// Spec chapter 04 §10 and §1: a debtFree with no loans listed holds exactly
// when liabilities round to 0 in every month of its window, and what it
// reports as owed at a breach is that month's liabilities.
func TestADebtFreeOfEveryLoanReadsTheLiabilities(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2028-12, startingCash: 30000}
scenarios:
  - name: pays off
    events:
      - {name: Pay, amount: 3000}
      - {name: Living, amount: -1500}
    loans:
      - {name: Car, principal: 9000, interestRate: 4, term: 24, startDate: 2025-06}
      - {name: Boat, principal: 6000, interestRate: 6, term: 60, startDate: 2026-03, earlyPayoffThreshold: 45000}
`)
	sr := res.Scenarios[0]
	assertBalanceSheet(t, sr)
	cleared := -1
	for i := len(sr.Liabilities) - 1; i >= 0 && cents(sr.Liabilities[i]) == 0; i-- {
		cleared = i
	}
	if cleared <= 0 {
		t.Fatalf("the debt never clears inside the plan: %v", sr.Liabilities)
	}
	for _, i := range []int{cleared - 1, cleared} {
		from := res.Start + config.Month(i)
		g := debtFree(t, from.String(), "")
		got := EvaluateGuardrail(g, res.Start, sr)
		holds := true
		for _, v := range sr.Liabilities[i:] {
			holds = holds && cents(v) == 0
		}
		if (got.Result == GuardrailHolds) != holds {
			t.Errorf("from %s: %s, but liabilities %v", from, got.Result, sr.Liabilities[i:])
		}
		if got.Result == GuardrailBreaks && got.Owed != sr.Liabilities[got.FirstBreach-res.Start] {
			t.Errorf("from %s: owed %v at %s, liabilities %v", from, got.Owed, got.FirstBreach, sr.Liabilities[got.FirstBreach-res.Start])
		}
	}
}

// Spec chapter 04 §8: the key figures end with net worth.
func TestKeyFiguresEndWithNetWorth(t *testing.T) {
	got := keyFigures(month(t, "2025-01"), []float64{5000, 4000}, []float64{9000, 8000}, []float64{-1000, 2500.5})
	if got.EndingNetWorth != 2500.5 {
		t.Errorf("endingNetWorth = %v, want 2500.5", got.EndingNetWorth)
	}
}

// Spec chapter 04 §9: net worth is compared like cash and total, and walked
// on its own, so it can change hands in another month than total.
func TestCompareNetWorth(t *testing.T) {
	a := &ScenarioResult{Liquid: []float64{10, 10, 10, 10}, Total: []float64{100, 120, 140, 160}, NetWorth: []float64{-50, -30, 20, 160}}
	b := &ScenarioResult{Liquid: []float64{10, 10, 10, 10}, Total: []float64{110, 115, 120, 125}, NetWorth: []float64{0, 0, 0, 125}}
	got := Compare(month(t, "2025-01"), a, b)
	if want := []float64{-50, -30, 20, 35}; !reflect.DeepEqual(got.NetWorth.Difference, want) {
		t.Errorf("net worth difference = %v, want %v", got.NetWorth.Difference, want)
	}
	if want := []BreakEven{{Month: month(t, "2025-03"), FirstAhead: true}}; !reflect.DeepEqual(got.NetWorth.BreakEven, want) {
		t.Errorf("net worth break-even = %v, want %v", got.NetWorth.BreakEven, want)
	}
	if want := []BreakEven{{Month: month(t, "2025-02"), FirstAhead: true}}; !reflect.DeepEqual(got.Total.BreakEven, want) {
		t.Errorf("total break-even = %v, want %v", got.Total.BreakEven, want)
	}
}

// Spec chapter 04 §12: liabilities, net worth, the ending net worth and a
// net-worth difference convert at their months; break-even months stay.
func TestTodaysDollarsConvertsNetWorth(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2027-12, startingCash: 25000, inflationRate: 3.0}
scenarios:
  - name: car
    events:
      - {name: Pay, amount: 1000}
    loans:
      - {name: Car, principal: 12000, interestRate: 0, term: 48, startDate: 2026-01}
  - name: cash
`)
	d := res.Deflator()
	today := d.Result(res)
	for s, nominal := range res.Scenarios {
		sr := today.Scenarios[s]
		for i := range nominal.Liquid {
			m := res.Start + config.Month(i)
			if want := nominal.Liabilities[i] / d.At(m); sr.Liabilities[i] != want {
				t.Errorf("%s: liabilities in %s = %v, want %v", nominal.Name, m, sr.Liabilities[i], want)
			}
			if want := nominal.NetWorth[i] / d.At(m); sr.NetWorth[i] != want {
				t.Errorf("%s: net worth in %s = %v, want %v", nominal.Name, m, sr.NetWorth[i], want)
			}
		}
		if want := nominal.KeyFigures.EndingNetWorth / d.At(res.End); sr.KeyFigures.EndingNetWorth != want {
			t.Errorf("%s: endingNetWorth = %v, want %v", nominal.Name, sr.KeyFigures.EndingNetWorth, want)
		}
	}
	nominal := res.Compare(res.Scenarios[0], res.Scenarios[1])
	converted := d.Comparison(nominal)
	if !reflect.DeepEqual(converted.NetWorth.BreakEven, nominal.NetWorth.BreakEven) {
		t.Errorf("net worth break-even moved: %v, want %v", converted.NetWorth.BreakEven, nominal.NetWorth.BreakEven)
	}
	for i, v := range nominal.NetWorth.Difference {
		m := res.Start + config.Month(i)
		if want := v / d.At(m); converted.NetWorth.Difference[i] != want {
			t.Errorf("net worth difference in %s = %v, want %v", m, converted.NetWorth.Difference[i], want)
		}
	}
	if len(nominal.NetWorth.BreakEven) == 0 {
		t.Errorf("the car never passes cash in net worth: %v", nominal.NetWorth.Difference)
	}
}
