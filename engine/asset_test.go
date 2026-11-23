package engine

import (
	"math"
	"os"
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

func readCase(t *testing.T, name string) string {
	t.Helper()
	doc, err := os.ReadFile("../testdata/conformance/" + name + "/config.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return string(doc)
}

func at(t *testing.T, res *Result, date string) int {
	t.Helper()
	return int(month(t, date) - res.Start)
}

// Spec chapter 04 §1.2: a fixed asset keeps its value from its first month
// until its sale, and is worth nothing before and after.
func TestAssetValueOverItsLife(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2027-12, startingCash: 0}
scenarios:
  - name: a
    assets: [{name: Boat, value: 1000, startDate: 2026-04, sellDate: 2027-02}]
`)
	sr := res.Scenarios[0]
	for date, want := range map[string]float64{
		"2026-03": 0, "2026-04": 1000, "2027-01": 1000, "2027-02": 0, "2027-12": 0,
	} {
		if got := sr.Assets[at(t, res, date)]; got != want {
			t.Errorf("assets in %s = %v, want %v", date, got, want)
		}
	}
}

// Spec chapter 04 §1.2: appreciation drifts monthly, A(m) = (1+a)^k · ρ^j
// counted from the asset's first month, computed as D is. An asset that
// follows inflation and is owned from the start is D(m) times its value to
// the bit, so it reads its value in today's dollars (§12).
func TestAppreciationDriftsLikeTheDeflator(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-06, endDate: 2036-05, startingCash: 0, inflationRate: 3}
scenarios:
  - name: a
    assets:
      - {name: House, value: 450000, appreciation: inflation}
      - {name: Car, value: 30000, appreciation: -15, startDate: 2030-01}
`)
	sr := res.Scenarios[0]
	d := res.Deflator()
	car := NewDeflator(month(t, "2030-01"), -15)
	carFirst := at(t, res, "2030-01")
	for i := range sr.Assets {
		m := res.Start + config.Month(i)
		want := 450000 * d.At(m)
		if i >= carFirst {
			want += 30000 * car.At(m)
		}
		if sr.Assets[i] != want {
			t.Fatalf("assets in %s = %v, want %v", m, sr.Assets[i], want)
		}
	}
	today := d.Path(sr)
	for i := range carFirst {
		if today.Assets[i] != 450000 {
			t.Fatalf("the house in today's dollars in %s = %v, want 450000 exactly", res.Start+config.Month(i), today.Assets[i])
		}
	}
	// One year after the purchase the car is worth exactly 85 %.
	if got := sr.Assets[at(t, res, "2031-01")] - 450000*d.At(month(t, "2031-01")); math.Abs(got-25500) > 1e-9 {
		t.Errorf("car a year on = %v, want 25500", got)
	}
}

// Spec chapter 04 §3.5: the legacy date sale written with an asset settles as
// one payment. Its cash is the legacy case's to the bit's neighbourhood, and
// its net worth now counts the house, R08.1's evidence: 104,406.68 the month
// before the sale and 97,218.72 in it.
func TestAssetSaleSettlesAsTheLegacySale(t *testing.T) {
	legacy := runDoc(t, readCase(t, "loan-payoff-date-sell")).Scenarios[0]
	res := runDoc(t, readCase(t, "asset-sale-by-date"))
	sr := res.Scenarios[0]
	assertBalanceSheet(t, sr)
	for i := range sr.Liquid {
		if math.Abs(sr.Liquid[i]-legacy.Liquid[i]) > 1e-6 {
			t.Fatalf("liquid[%d] = %v, legacy %v", i, sr.Liquid[i], legacy.Liquid[i])
		}
	}
	if sr.EmergencyFund.TargetAmount != legacy.EmergencyFund.TargetAmount {
		t.Errorf("emergency fund %v, legacy %v", sr.EmergencyFund.TargetAmount, legacy.EmergencyFund.TargetAmount)
	}
	for date, want := range map[string]float64{"2026-08": 104406.68, "2026-09": 97218.72} {
		if got := cents(sr.NetWorth[at(t, res, date)]); got != want {
			t.Errorf("net worth in %s = %.2f, want %.2f", date, got, want)
		}
	}
	sale := at(t, res, "2026-09")
	if got := sr.Notes[sale]; len(got) != 1 || got[0] != "selling asset House for 210000.00 with 12000.00 selling costs" {
		t.Errorf("sale notes = %q", got)
	}
	if sr.Liabilities[sale] != 0 || sr.Assets[sale] != 0 || sr.Equity[sale] != 0 {
		t.Errorf("after the sale: liabilities %v, assets %v, equity %v", sr.Liabilities[sale], sr.Assets[sale], sr.Equity[sale])
	}
	if want := sr.Assets[sale-1] - sr.Liabilities[sale-1]; sr.Equity[sale-1] != want {
		t.Errorf("equity before the sale = %v, want %v", sr.Equity[sale-1], want)
	}
}

// Spec chapter 04 §3.6: after its loan ends, escrow is billed each December
// while the asset is held, and the sale bills the months of its year. The
// sale in 2037-03 costs three months' escrow, and no December after it.
func TestEscrowWhileHeldEndsAtTheSale(t *testing.T) {
	res := runDoc(t, readCase(t, "asset-long-plan"))
	sell, keep := res.Scenarios[0], res.Scenarios[1]
	d := res.Deflator()
	s := at(t, res, "2037-03")
	// Up to the sale month the two paths are the same.
	for i := range s {
		if sell.Liquid[i] != keep.Liquid[i] {
			t.Fatalf("paths differ before the sale, in %s", res.Start+config.Month(i))
		}
	}
	price := 450000 * d.At(month(t, "2037-03"))
	g := growth(t, 3, "2026-06", "2037-03")
	wantStep := price - 0.06*price - 3*600*g - 2500*g
	if got := (sell.Liquid[s] - sell.Liquid[s-1]) - (keep.Liquid[s] - keep.Liquid[s-1]); math.Abs(got-wantStep) > 1e-6 {
		t.Errorf("the sale month moves cash by %v more than keeping, want %v", got, wantStep)
	}
	dec := at(t, res, "2037-12")
	gd := growth(t, 3, "2026-06", "2037-12")
	if got := (keep.Liquid[dec] - keep.Liquid[dec-1]) - (sell.Liquid[dec] - sell.Liquid[dec-1]); math.Abs(got-(2500*gd-12*600*gd)) > 1e-6 {
		t.Errorf("December after the sale: keeping moves cash by %v more than selling, want only its escrow", got)
	}
	assertBalanceSheet(t, sell)
	assertBalanceSheet(t, keep)
}

// growth is (1 + rate/100)^k, k the plan year of m counted from start, as an
// amount that grows at rate does (spec chapter 04 §2.1).
func growth(t *testing.T, rate float64, start, m string) float64 {
	t.Helper()
	f := 1.0
	for range int(month(t, m)-month(t, start)) / 12 {
		f *= 1 + rate/100
	}
	return f
}

// Spec chapter 04 §3.5: a secured loan's threshold payoff does not fire in its
// asset's sale month; the sale pays the loan off.
func TestThresholdDoesNotFireInTheSaleMonth(t *testing.T) {
	plan := `version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 500000}
scenarios:
  - name: a
    assets: [{name: Car, value: 20000, sellDate: 2026-06}]
    loans:
      - {name: Car loan, asset: Car, principal: 15000, interestRate: 6, term: 60, startDate: 2025-01, earlyPayoffThreshold: THRESHOLD}
`
	// A threshold that holds from the first month pays the loan off then.
	early := runDoc(t, strings.Replace(plan, "THRESHOLD", "1000", 1)).Scenarios[0]
	if got := early.Notes[0]; len(got) != 1 || !strings.HasPrefix(got[0], "paying off asset Car loan") {
		t.Fatalf("2026-01 notes = %q, want the threshold payoff", got)
	}
	if got := early.Notes[5]; len(got) != 1 || !strings.HasPrefix(got[0], "selling asset Car for 20000.00") {
		t.Errorf("2026-06 notes = %q, want the sale alone", got)
	}
	// With cash only from a windfall in the sale month, the threshold could
	// fire only then, and it does not.
	res := runDoc(t, strings.Replace(strings.Replace(plan, "startingCash: 500000", "startingCash: 0", 1),
		"THRESHOLD", "1", 1)+"    events: [{name: Windfall, amount: 1000000, startDate: 2026-06, endDate: 2026-06}]\n")
	for i, notes := range res.Scenarios[0].Notes {
		for _, n := range notes {
			if strings.HasPrefix(n, "paying off") {
				t.Errorf("threshold fired in %s: %q", res.Start+config.Month(i), n)
			}
		}
	}
}

// Spec chapter 04 §5: a sale settlement is one payment, counted as an expense
// only when it is positive: an underwater sale that costs cash.
func TestEmergencyFundCountsAPositiveSettlementOnce(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 0}
scenarios:
  - name: a
    assets: [{name: Car, value: 10000, sellDate: 2026-02, sellCosts: 10}]
    loans:
      - {name: Car loan, asset: Car, principal: 30000, interestRate: 0, term: 30, startDate: 2025-12}
`)
	sr := res.Scenarios[0]
	// January: one payment of 1000. February: the sale settles the loan's
	// 28,000 less 10,000 plus 1,000 of costs, 19,000 out of cash.
	if got := sr.Liquid[1] - sr.Liquid[0]; math.Abs(got+19000) > 1e-9 {
		t.Errorf("sale month moves cash by %v, want -19000", got)
	}
	if got := sr.EmergencyFund.AverageMonthlyExpenses; math.Abs(got-20000.0/12) > 1e-9 {
		t.Errorf("average expenses = %v, want 20000/12", got)
	}
}

// Spec chapter 04 §1: with no assets, net worth is total less liabilities and
// assets and equity are 0 in every month.
func TestNoAssetsNoBalanceSheetChange(t *testing.T) {
	res := runDoc(t, readCase(t, "net-worth"))
	for _, sr := range res.Scenarios {
		for i := range sr.Liquid {
			if sr.Assets[i] != 0 || sr.Equity[i] != 0 {
				t.Fatalf("%s: assets %v, equity %v", sr.Name, sr.Assets[i], sr.Equity[i])
			}
			if sr.NetWorth[i] != sr.Total[i]-sr.Liabilities[i] {
				t.Fatalf("%s: net worth moved", sr.Name)
			}
		}
	}
	if res.HasAssets {
		t.Error("a plan without assets says it has some")
	}
	if !runDoc(t, readCase(t, "asset-choices")).HasAssets {
		t.Error("a plan with assets says it has none")
	}
}

// Spec chapter 04 §1: equity is each asset's value less what the loans
// secured on it owe; an unsecured loan lowers net worth but not equity.
func TestEquityCountsOnlySecuredLoans(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2026-03, startingCash: 0}
scenarios:
  - name: a
    assets: [{name: Car, value: 10000}, {name: Bike, value: 500}]
    loans:
      - {name: Car loan, asset: Car, principal: 12000, interestRate: 0, term: 12, startDate: 2026-01}
      - {name: Personal, principal: 3000, interestRate: 0, term: 3, startDate: 2026-01}
`)
	sr := res.Scenarios[0]
	assertBalanceSheet(t, sr)
	if got, want := sr.Equity[0], 10000.0-11000+500; got != want {
		t.Errorf("equity = %v, want %v: the car underwater, the bike in full, the personal loan not at all", got, want)
	}
}

// Spec chapter 04 §3.5: a secured loan whose threshold payoff fires before its
// asset's sale pays the payoff from cash then, as an unsecured loan does; the
// later sale has no loan left to settle.
func TestThresholdBeforeTheSalePaysOffFromCash(t *testing.T) {
	plan := `version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 500000}
scenarios:
  - name: a
    assets: [{name: Car, value: 20000, sellDate: 2026-06}]
    loans:
      - {name: Car loan, ASSETprincipal: 15000, interestRate: 6, term: 60, startDate: 2025-01, earlyPayoffThreshold: 1000}
`
	secured := runDoc(t, strings.Replace(plan, "ASSET", "asset: Car, ", 1)).Scenarios[0]
	unsecured := runDoc(t, strings.Replace(plan, "ASSET", "", 1)).Scenarios[0]
	for i := range 5 {
		if secured.Liquid[i] != unsecured.Liquid[i] {
			t.Fatalf("liquid[%d] = %v secured, %v unsecured: the threshold payoff must be paid from cash", i, secured.Liquid[i], unsecured.Liquid[i])
		}
	}
	if got := secured.Liquid[5] - secured.Liquid[4]; math.Abs(got-20000) > 1e-9 {
		t.Errorf("sale month moves cash by %v, want the price alone, 20000", got)
	}
	assertBalanceSheet(t, secured)
}
