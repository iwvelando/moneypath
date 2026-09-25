package engine

import (
	"math"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

func simpleEvent(t *testing.T, amount float64, start, end string, freq int) *config.Event {
	t.Helper()
	ev := &config.Event{Amount: &amount, ResolvedFrequency: freq}
	ev.ResolvedStart = month(t, start)
	ev.ResolvedEnd = month(t, end)
	return ev
}

// Spec chapter 04 §4 step 1: growth compounds on the balance BEFORE this
// month's contribution, so new money starts compounding the following month.
func TestGrowthBeforeContribution(t *testing.T) {
	iv := newInvSim(&config.Investment{
		Name: "A", StartingValue: 1200, AnnualReturnRate: 12,
		Contributions: []*config.Event{simpleEvent(t, 600, "2025-02", "2025-02", 1)},
	}, "scenario")
	res := iv.processMonth(month(t, "2025-02"))
	// growth = 1200 * 0.01 = 12 (not (1200+600)*0.01 = 18)
	wantValue := 1200 + 12 + 600.0
	if math.Abs(iv.value-wantValue) > 1e-9 {
		t.Errorf("value = %.4f, want %.4f (growth before contribution)", iv.value, wantValue)
	}
	if res.note != "scenario A: contribution +600.00, growth +12.00" {
		t.Errorf("note = %q", res.note)
	}
}

// Spec chapter 04 §4 steps 1+4: tax drag on positive growth, withdrawal tax
// on the growth portion only, growth-first withdrawal accounting.
func TestWithdrawalGrowthFirst(t *testing.T) {
	iv := newInvSim(&config.Investment{
		Name: "B", StartingValue: 1000, AnnualReturnRate: 12,
		TaxRate: 25, WithdrawalTaxRate: 10,
		Withdrawals: []*config.Event{simpleEvent(t, 500, "2025-01", "2025-01", 1)},
	}, "common")
	res := iv.processMonth(month(t, "2025-01"))
	// growth 10, tax 2.5, afterTax 7.5 → value 1007.5, growthBalance 7.5.
	// withdrawal 500: fromGrowth 7.5, fromBasis 492.5; wTax = 0.75.
	if math.Abs(res.netWithdrawal-(500-0.75)) > 1e-9 {
		t.Errorf("net withdrawal = %.4f, want 499.25", res.netWithdrawal)
	}
	if math.Abs(iv.value-507.5) > 1e-9 {
		t.Errorf("value = %.4f, want 507.50", iv.value)
	}
	want := "common B: withdrawal +500.00 (basis +492.50, growth +7.50), growth +10.00, tax 2.50, withdrawal tax 0.75"
	if res.note != want {
		t.Errorf("note = %q\nwant   %q", res.note, want)
	}
}

// Spec chapter 04 §4 step 3: percentage withdrawals use the post-growth,
// post-contribution balance; the note shows the percentage.
func TestPercentageWithdrawal(t *testing.T) {
	pct := 4.0
	ev := &config.Event{Percentage: &pct, ResolvedFrequency: 12}
	ev.ResolvedStart = month(t, "2025-01")
	ev.ResolvedEnd = month(t, "2030-01")
	iv := newInvSim(&config.Investment{
		Name: "C", StartingValue: 10000, Withdrawals: []*config.Event{ev},
	}, "scenario")
	res := iv.processMonth(month(t, "2025-01"))
	if math.Abs(res.netWithdrawal-400) > 1e-9 {
		t.Errorf("net withdrawal = %.4f, want 400 (4%% of 10000)", res.netWithdrawal)
	}
	want := "scenario C: withdrawal (4.00%) +400.00 (basis +400.00)"
	if res.note != want {
		t.Errorf("note = %q\nwant   %q", res.note, want)
	}
}

// Spec chapter 04 §4 step 1: a negative-growth month shifts any
// growth-balance deficit into basis (floor both at 0).
func TestNegativeGrowthShiftsToBasis(t *testing.T) {
	iv := newInvSim(&config.Investment{
		Name: "D", StartingValue: 1200, AnnualReturnRate: -12,
	}, "scenario")
	iv.processMonth(month(t, "2025-01"))
	if iv.growthBalance != 0 {
		t.Errorf("growthBalance = %.4f, want 0", iv.growthBalance)
	}
	if math.Abs(iv.basis-1188) > 1e-9 {
		t.Errorf("basis = %.4f, want 1188 (deficit shifted)", iv.basis)
	}
	if math.Abs(iv.value-1188) > 1e-9 {
		t.Errorf("value = %.4f, want 1188", iv.value)
	}
}

// Spec chapter 04 §3.5: netLiquidationValue and the gross-up needed to net
// a target amount through withdrawal tax.
func TestPayoffFundingWithdrawal(t *testing.T) {
	iv := newInvSim(&config.Investment{
		Name: "E", StartingValue: 0, WithdrawalTaxRate: 20, FundLoanPayoffs: true,
	}, "scenario")
	iv.value, iv.basis, iv.growthBalance = 1000, 600, 400
	// nlv = 1000 − 0.2·min(1000,400) = 920.
	if math.Abs(iv.netLiquidationValue()-920) > 1e-9 {
		t.Errorf("nlv = %.4f, want 920", iv.netLiquidationValue())
	}
	// Net 160 with g·(1−t) = 320 available in growth: gross = 160/0.8 = 200.
	net, note := iv.withdrawNet(160)
	if math.Abs(net-160) > 1e-9 {
		t.Errorf("net = %.4f, want 160", net)
	}
	want := "scenario E: loan payoff withdrawal +200.00 (growth +200.00), withdrawal tax 40.00"
	if note != want {
		t.Errorf("note = %q\nwant   %q", note, want)
	}
	if math.Abs(iv.value-800) > 1e-9 || math.Abs(iv.growthBalance-200) > 1e-9 {
		t.Errorf("state after = value %.2f growth %.2f, want 800/200", iv.value, iv.growthBalance)
	}

	// Beyond available growth: net 700 from value 800 (growth 200, t 0.2):
	// gross = 700 + 0.2·200 = 740; nets 740 − 40 = 700.
	net2, _ := iv.withdrawNet(700)
	if math.Abs(net2-700) > 1e-9 {
		t.Errorf("net2 = %.4f, want 700", net2)
	}
}
