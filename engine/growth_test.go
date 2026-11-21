package engine

import (
	"math"
	"reflect"
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

// deltas is each month's change in cash, the first from startingCash.
func deltas(startingCash float64, liquid []float64) []float64 {
	out := make([]float64, len(liquid))
	prev := startingCash
	for i, v := range liquid {
		out[i] = v - prev
		prev = v
	}
	return out
}

func scenarioNamed(t *testing.T, res *Result, name string) *ScenarioResult {
	t.Helper()
	for _, sr := range res.Scenarios {
		if sr.Name == name {
			return sr
		}
	}
	t.Fatalf("no scenario %q", name)
	return nil
}

func runDoc(t *testing.T, doc string) *Result {
	t.Helper()
	res, err := Run(loadConfig(t, doc), Options{})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// Spec chapter 04 §2.1: an amount steps once a year, on the plan's
// anniversaries, and holds as written throughout the first year. The
// acceptance numbers of the assignment: a rent tracking 3 % inflation and a
// salary growing 4 % a year, in a plan starting 2026-06.
func TestGrowthStepsOnThePlansAnniversaries(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-06, endDate: 2029-05, startingCash: 0, inflationRate: 3.0}
scenarios:
  - name: rent
    events: [{name: Rent, amount: -2000.00, growth: inflation}]
  - name: salary
    events: [{name: Salary, amount: 5000.00, growth: 4}]
`)
	start := month(t, "2026-06")
	at := func(s string) int { return int(month(t, s) - start) }
	for _, c := range []struct {
		scenario string
		month    string
		want     float64
	}{
		{"rent", "2026-06", -2000},
		{"rent", "2027-05", -2000},
		{"rent", "2027-06", -2060},
		{"rent", "2028-05", -2060},
		{"rent", "2028-06", -2121.80},
		{"rent", "2029-05", -2121.80},
		{"salary", "2026-06", 5000},
		{"salary", "2027-05", 5000},
		{"salary", "2027-06", 5200},
		{"salary", "2028-06", 5408},
	} {
		got := deltas(0, scenarioNamed(t, res, c.scenario).Liquid)[at(c.month)]
		if math.Abs(got-c.want) > 1e-9 {
			t.Errorf("%s in %s: %.6f, want %.2f", c.scenario, c.month, got, c.want)
		}
	}
}

// Spec chapter 04 §2.1: a one-off event dated in the plan's sixth year moves
// its amount grown by five years, counted from the plan's start, not its own.
func TestAOneOffEventGrowsFromThePlansStart(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-06, endDate: 2031-12, startingCash: 0, inflationRate: 3.0}
scenarios:
  - name: plan
    events: [{name: Roof, amount: -10000, growth: inflation, startDate: 2031-07, endDate: 2031-07}]
`)
	liquid := res.Scenarios[0].Liquid
	i := int(month(t, "2031-07") - month(t, "2026-06"))
	want := -10000 * 1.03 * 1.03 * 1.03 * 1.03 * 1.03
	if got := deltas(0, liquid)[i]; got != want {
		t.Errorf("roof: %.6f, want %.6f", got, want)
	}
	if liquid[i-1] != 0 {
		t.Errorf("before the roof: %v", liquid[i-1])
	}
}

// Spec chapter 04 §10: a cash floor that grows can break a path whose cash
// never moves, and its tightest month is the month of least margin. The
// acceptance numbers: $25,000 of cash held level by matching pay and costs,
// against a $20,000 floor tracking 3 % inflation.
func TestAGrowingFloorBreaksALevelPath(t *testing.T) {
	plan := func(growth string) string {
		return `version: 2
simulation: {startDate: 2026-01, endDate: 2045-12, startingCash: 25000.00, inflationRate: 3.0}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 20000.00` + growth + `}
common:
  events:
    - {name: Pay, amount: 5000.00, growth: inflation}
    - {name: Costs, amount: -5000.00, growth: inflation}
scenarios: [{name: level}]
`
	}
	got := runDoc(t, plan(", growth: inflation")).Scenarios[0].Guardrails[0]
	if got.Result != GuardrailBreaks || got.FirstBreach != month(t, "2034-01") {
		t.Errorf("growing floor: %+v, want a first breach in 2034-01", got)
	}
	if got.Tightest != month(t, "2045-01") || math.Abs(got.Margin-(-10070.12)) > 0.005 {
		t.Errorf("growing floor: tightest %s margin %.4f, want 2045-01 at -10070.12", got.Tightest, got.Margin)
	}

	fixed := runDoc(t, plan("")).Scenarios[0].Guardrails[0]
	if fixed.Result != GuardrailHolds || fixed.Tightest != month(t, "2026-01") || math.Abs(fixed.Margin-5000) > 1e-6 {
		t.Errorf("fixed floor: %+v, want holds, tightest 2026-01 at 5000", fixed)
	}
}

// Spec chapter 04 §10: the tightest month is the earliest of least margin in
// whole cents, which need not be the month of least balance.
func TestTightestMonthIsTheLeastMargin(t *testing.T) {
	g := cashFloor(t, 1000, "", "")
	g.Growth = growthOf(t, "10")
	// 2025-01 starts the plan; the floor is 1000 in 2025, 1100 in 2026.
	start := month(t, "2025-01")
	liquid := make([]float64, 24)
	for i := range liquid {
		liquid[i] = 1500
	}
	liquid[2] = 1200  // the least balance, margin 200
	liquid[14] = 1250 // margin 150: the least margin
	liquid[20] = 1250 // the same margin later
	got := EvaluateGuardrail(g, start, path(liquid...))
	if got.Result != GuardrailHolds || got.Tightest != month(t, "2026-03") || math.Abs(got.Margin-150) > 1e-9 {
		t.Errorf("got %+v, want holds, tightest 2026-03 at 150", got)
	}
}

// growthOf reads a growth as a plan would write it, resolved at an inflation
// rate of 3.
func growthOf(t *testing.T, written string) config.Growth {
	t.Helper()
	cfg := loadConfig(t, `version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 0, inflationRate: 3}
scenarios: [{name: plan, events: [{amount: 1, growth: `+written+`}]}]
`)
	return cfg.Scenarios[0].Events[0].Growth
}

// emptiedIn is the first month an account holds nothing, in whole cents.
func emptiedIn(t *testing.T, res *Result, account string) string {
	t.Helper()
	for i, v := range res.Scenarios[0].Holdings[account] {
		if round2(v) == 0 {
			return (res.Start + config.Month(i)).String()
		}
	}
	return "never"
}

// Spec chapter 04 §4 step 3: a withdrawal by amount grows like any event.
// The acceptance numbers: $400,000 at 5 %, drawing $2,000 a month from
// 2026-01, with inflation at 3 %.
func TestWithdrawalsThatTrackInflationEmptyTheAccountSooner(t *testing.T) {
	plan := func(growth string) string {
		return `version: 2
simulation: {startDate: 2026-01, endDate: 2065-12, startingCash: 0, inflationRate: 3.0}
scenarios:
  - name: retire
    investments:
      - name: Nest egg
        startingValue: 400000
        annualReturnRate: 5
        withdrawals: [{amount: 2000` + growth + `}]
`
	}
	if got := emptiedIn(t, runDoc(t, plan("")), "Nest egg"); got != "2061-11" {
		t.Errorf("fixed: emptied in %s, want 2061-11", got)
	}
	if got := emptiedIn(t, runDoc(t, plan(", growth: inflation")), "Nest egg"); got != "2046-10" {
		t.Errorf("tracking inflation: emptied in %s, want 2046-10", got)
	}
}

// Spec chapter 04 §4: contributions grow, and the note reports the amount
// that moved.
func TestContributionsGrow(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-06, endDate: 2027-06, startingCash: 0}
scenarios:
  - name: plan
    investments:
      - name: 401k
        contributionsFromCash: true
        contributions: [{amount: 500, growth: 4}]
`)
	notes := res.Scenarios[0].Notes
	if got := strings.Join(notes[11], "|"); got != "scenario 401k: contribution (reduces cash balance) +500.00" {
		t.Errorf("2027-05: %q", got)
	}
	if got := strings.Join(notes[12], "|"); got != "scenario 401k: contribution (reduces cash balance) +520.00" {
		t.Errorf("2027-06: %q", got)
	}
}

// Spec chapter 04 §3.2, §3.6: escrow grows in every payment, the refund at
// the loan's end is the escrow billed that calendar year, and each December
// after a kept property's payoff bills twelve times that December's escrow.
func TestEscrowGrowsThroughThePayoffAndTheDecembersAfter(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-06, endDate: 2030-12, startingCash: 0, inflationRate: 3.0}
scenarios:
  - name: plan
    loans:
      - {name: Home, principal: 12000, interestRate: 0, term: 30, startDate: 2026-06, escrow: 100, escrowGrowth: inflation}
`)
	start := month(t, "2026-06")
	paid := deltas(0, res.Scenarios[0].Liquid)
	at := func(s string) float64 { return -paid[int(month(t, s)-start)] }
	y1, y2, y3 := 100*1.03, 100*1.03*1.03, 100*1.03*1.03*1.03
	for _, c := range []struct {
		month string
		want  float64
	}{
		{"2026-06", 500},
		{"2027-05", 500},
		{"2027-06", 400 + y1},
		{"2028-05", 400 + y1},
		{"2028-06", 400 + y2},
		// The last payment, 2028-11, refunds Jan–May at the second year's
		// escrow and Jun–Nov at the third's.
		{"2028-11", 400 + y2 - (5*y1 + 6*y2)},
		{"2028-12", 12 * y2},
		{"2029-11", 0},
		{"2029-12", 12 * y3},
	} {
		if got := at(c.month); math.Abs(got-c.want) > 1e-9 {
			t.Errorf("%s: paid %.6f, want %.6f", c.month, got, c.want)
		}
	}
}

// Spec chapter 04 §3.3: an extra principal payment grows, and is still
// capped at what remains.
func TestExtraPrincipalGrows(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-06, endDate: 2028-06, startingCash: 0}
scenarios:
  - name: plan
    loans:
      - name: Car
        principal: 20000
        interestRate: 0
        term: 100
        startDate: 2026-06
        extraPrincipalPayments: [{amount: 1000, growth: 10, frequency: 12, startDate: 2026-07}]
`)
	owed := res.Scenarios[0].Owed["Car"]
	start := month(t, "2026-06")
	// 200 a month; 1000 extra in 2026-07 and 1100 in 2027-07.
	if got, want := owed[int(month(t, "2026-07")-start)], 20000-400-1000.0; !near(got, want) {
		t.Errorf("2026-07: owed %.2f, want %.2f", got, want)
	}
	if got, want := owed[int(month(t, "2027-07")-start)], 20000-200*14-1000-1100.0; !near(got, want) {
		t.Errorf("2027-07: owed %.2f, want %.2f", got, want)
	}
}

// Spec chapter 04 §5: the emergency fund reads the plan's first year, in
// which nothing has grown, so growth never moves its target.
func TestEmergencyFundIgnoresGrowth(t *testing.T) {
	plan := func(growth string) string {
		return `version: 2
simulation: {startDate: 2026-06, endDate: 2030-12, startingCash: 1000, inflationRate: 3.0}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -2000` + growth + `}
      - {name: Pay, amount: 4000` + growth + `}
    loans:
      - {name: Home, principal: 12000, interestRate: 3, term: 30, startDate: 2026-06, escrow: 100` + strings.ReplaceAll(growth, "growth", "escrowGrowth") + `}
`
	}
	fixed := runDoc(t, plan("")).Scenarios[0].EmergencyFund
	grown := runDoc(t, plan(", growth: inflation")).Scenarios[0].EmergencyFund
	if *fixed != *grown {
		t.Errorf("grown %+v, fixed %+v", *grown, *fixed)
	}
}

// Spec chapter 03, Growth: growth 0, and inflation at a rate of 0, are
// exactly fixed, in every figure.
func TestGrowthOfNothingIsFixed(t *testing.T) {
	plan := func(rate, growth string) string {
		escrow := strings.ReplaceAll(growth, ", growth", "\n        escrowGrowth")
		return `version: 2
simulation: {startDate: 2026-06, endDate: 2032-12, startingCash: 1000.37` + rate + `}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 900.10` + growth + `}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -2000.13` + growth + `}
      - {name: Pay, amount: 4000.07` + growth + `}
    loans:
      - name: Home
        principal: 12000
        interestRate: 3.1
        term: 50
        startDate: 2026-06
        escrow: 100.03` + escrow + `
        extraPrincipalPayments: [{amount: 50.01, frequency: 6` + growth + `}]
    investments:
      - name: 401k
        annualReturnRate: 6.1
        contributions: [{amount: 300.11` + growth + `}]
        withdrawals: [{amount: 100.07, startDate: 2030-01` + growth + `}]
`
	}
	want := runDoc(t, plan("", ""))
	for _, variant := range [][2]string{
		{", inflationRate: 3", ", growth: 0"},
		{"", ", growth: inflation"},
		{", inflationRate: 0", ", growth: inflation"},
		{", inflationRate: 0", ", growth: fixed"},
	} {
		got := runDoc(t, plan(variant[0], variant[1]))
		// The result records the rate, which only today's dollars read
		// (chapter 04 §12); every nominal figure must be the same.
		got.InflationRate = 0
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%v: the results differ from fixed", variant)
		}
	}
}

// Spec chapter 04 §7: a target held to a growing floor reports the floor at
// its tightest month, beside the balance and the headroom there.
func TestOptimizerReportsAGrowingFloorAtTheTightestMonth(t *testing.T) {
	cfg := loadConfig(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2030-12, startingCash: 25000, inflationRate: 3.0}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 20000, growth: inflation}
scenarios:
  - name: plan
    events:
      - name: Spending
        amount: -10
        optimize: {field: amount, min: -500, max: 0, guardrail: Cushion}
`)
	res, err := Run(cfg, Options{Optimize: true})
	if err != nil {
		t.Fatal(err)
	}
	o := res.Scenarios[0].Optimizations[0]
	g := o.Guardrail
	if g == nil || g.Result != GuardrailHolds || !o.Converged {
		t.Fatalf("got %+v", o)
	}
	k := int(g.Tightest-month(t, "2026-01")) / 12
	floor := 20000.0
	for range k {
		floor *= 1.03
	}
	if !near(o.Floor, floor) || !near(o.Headroom, o.MinimumCash-floor) || !near(o.Headroom, g.Margin) {
		t.Errorf("floor %.4f minCash %.4f headroom %.4f at %s; want floor %.4f", o.Floor, o.MinimumCash, o.Headroom, g.Tightest, floor)
	}
	if k == 0 {
		t.Errorf("the tightest month %s is in the first year, so the floor has not grown", g.Tightest)
	}
}
