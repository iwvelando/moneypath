package engine

import (
	"math"
	"reflect"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

// Spec chapter 04 §12: no inflation rate, no today's dollars.
func TestNoDeflatorWithoutAnInflationRate(t *testing.T) {
	if d := NewDeflator(month(t, "2026-01"), 0); d != nil {
		t.Errorf("a rate of 0 has a deflator: %+v", d)
	}
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 100}
scenarios: [{name: plan}]
`)
	if d := res.Deflator(); d != nil {
		t.Errorf("a plan without a rate has a deflator: %+v", d)
	}
	if got := res.Deflator().Result(res); got != nil {
		t.Errorf("a plan without a rate reads in today's dollars: %+v", got)
	}
}

// Spec chapter 04 §12: D(start) = 1, D is exactly the growth factor of an
// amount that follows inflation on each anniversary, and it rises by ρ, the
// twelfth root of a year's inflation, in each month between.
func TestTheDeflator(t *testing.T) {
	start := month(t, "2026-06")
	d := NewDeflator(start, 3)
	g := growthOf(t, "inflation")
	rho := math.Sqrt(math.Sqrt(math.Cbrt(1.03)))
	if math.Abs(math.Pow(rho, 12)-1.03) > 1e-14 {
		t.Fatalf("ρ^12 = %v", math.Pow(rho, 12))
	}
	if got := d.At(start); got != 1 {
		t.Errorf("D(start) = %v, want 1", got)
	}
	if got := d.At(start + 1); got != rho {
		t.Errorf("D(start+1) = %v, want ρ = %v", got, rho)
	}
	for k := 1; k <= 40; k++ {
		m := start + config.Month(12*k)
		want := 1.0
		for range k {
			want *= 1.03
		}
		if got := d.At(m); got != want {
			t.Errorf("D(%s) = %v, want exactly %v", m, got, want)
		}
		if got, f := d.At(m), g.Factor(start, m); got != f {
			t.Errorf("D(%s) = %v, but an amount following inflation grows by %v", m, got, f)
		}
		// The month before an anniversary: k−1 whole years times eleven ρ,
		// each power multiplied out on its own.
		years, months := 1.0, 1.0
		for range k - 1 {
			years *= 1.03
		}
		for range 11 {
			months *= rho
		}
		if got, before := d.At(m-1), years*months; got != before {
			t.Errorf("D(%s) = %v, want %v", m-1, got, before)
		}
	}
}

// Spec chapter 04 §12: a negative rate, falling prices, reads higher in
// today's dollars than in nominal ones.
func TestTheDeflatorOfFallingPrices(t *testing.T) {
	start := month(t, "2026-01")
	d := NewDeflator(start, -2)
	if got := d.At(start + 12); got != 0.98 {
		t.Errorf("D a year on = %v, want 0.98", got)
	}
	for m := start + 1; m < start+36; m++ {
		if !(d.At(m) < d.At(m-1)) {
			t.Errorf("D(%s) = %v does not fall from %v", m, d.At(m), d.At(m-1))
		}
	}
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2027-12, startingCash: 1000, inflationRate: -2}
scenarios: [{name: plan}]
`)
	today := res.Deflator().Result(res).Scenarios[0]
	if got := today.KeyFigures.EndingCash; !(got > 1000) {
		t.Errorf("ending cash in today's dollars %v, want more than 1000", got)
	}
	if got := today.KeyFigures.LowestCashDate.String(); got != "2026-01" {
		t.Errorf("lowest cash in today's dollars at %s, want the start", got)
	}
}

// Spec chapter 04 §12: the series are divided month by month, the key
// figures read from them (so the lowest month can move), and the notes and
// emergency fund carried as they are.
func TestTodaysDollarsConvertsTheSeries(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2028-12, startingCash: 25000, inflationRate: 3.0}
scenarios:
  - name: steady
    events:
      - {name: Pay, amount: 4000}
      - {name: Living, amount: -4000}
    investments:
      - {name: Fund, startingValue: 1000, annualReturnRate: 0}
`)
	d := res.Deflator()
	today := d.Result(res)
	if today.Start != res.Start || today.End != res.End || len(today.Scenarios) != 1 {
		t.Fatalf("today's dollars has a different shape: %+v", today)
	}
	nominal, sr := res.Scenarios[0], today.Scenarios[0]
	for i := range nominal.Liquid {
		m := res.Start + config.Month(i)
		if want := nominal.Liquid[i] / d.At(m); sr.Liquid[i] != want {
			t.Errorf("liquid in %s = %v, want %v", m, sr.Liquid[i], want)
		}
		if want := nominal.Total[i] / d.At(m); sr.Total[i] != want {
			t.Errorf("total in %s = %v, want %v", m, sr.Total[i], want)
		}
	}
	if nominal.Liquid[0] != 25000 || nominal.Liquid[len(nominal.Liquid)-1] != 25000 {
		t.Fatalf("the plan's cash is not level: %v", nominal.Liquid)
	}
	if got := nominal.KeyFigures.LowestCashDate.String(); got != "2026-01" {
		t.Errorf("nominal lowest cash at %s, want 2026-01", got)
	}
	end := res.End
	want := KeyFigures{
		LowestCash:     25000 / d.At(end),
		LowestCashDate: end,
		EndingCash:     25000 / d.At(end),
		EndingTotal:    26000 / d.At(end),
		EndingNetWorth: 26000 / d.At(end),
	}
	if sr.KeyFigures != want {
		t.Errorf("key figures in today's dollars %+v, want %+v", sr.KeyFigures, want)
	}
	if !reflect.DeepEqual(sr.Notes, nominal.Notes) {
		t.Errorf("notes changed: %v", sr.Notes)
	}
	if sr.EmergencyFund != nominal.EmergencyFund {
		t.Errorf("emergency fund %+v, want the nominal %+v", sr.EmergencyFund, nominal.EmergencyFund)
	}
	if sr.Name != nominal.Name {
		t.Errorf("name %q, want %q", sr.Name, nominal.Name)
	}
	// The nominal result is untouched.
	if nominal.Liquid[len(nominal.Liquid)-1] != 25000 || nominal.KeyFigures.EndingCash != 25000 {
		t.Errorf("converting changed the nominal result")
	}
}

// Spec chapter 04 §12: a guardrail keeps its result and months, and only its
// margin (at its tightest month) and owed (at its first breach) convert.
func TestTodaysDollarsConvertsGuardrailAmountsAtTheirMonths(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2028-12, startingCash: 25000, inflationRate: 3.0}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 24000, growth: inflation}
  - {name: Fixed, kind: cashFloor, amount: 20000}
  - {name: Car gone, kind: debtFree, loans: [Car], startDate: 2028-06}
  - {name: Car gone early, kind: debtFree, loans: [Car], startDate: 2026-01}
  - {name: Later, kind: cashFloor, amount: 1, startDate: 2030-01}
scenarios:
  - name: car
    events: [{name: Budget, amount: 250}]
    loans:
      - {name: Car, principal: 12000, interestRate: 0, term: 48, startDate: 2026-01}
`)
	d := res.Deflator()
	nominal := res.Scenarios[0].Guardrails
	today := d.Guardrails(nominal)
	if len(today) != len(nominal) {
		t.Fatalf("%d results, want %d", len(today), len(nominal))
	}
	for i, n := range nominal {
		want := n
		if n.HasTightest {
			want.Margin = n.Margin / d.At(n.Tightest)
		}
		if n.Result == GuardrailBreaks {
			want.Owed = n.Owed / d.At(n.FirstBreach)
		}
		if today[i] != want {
			t.Errorf("%s: %+v, want %+v", n.Name, today[i], want)
		}
	}
	if c := nominal[0]; c.Result != GuardrailBreaks || c.Tightest.String() != "2028-01" {
		t.Errorf("the growing cushion should break at 2028-01: %+v", c)
	}
	if c := nominal[2]; c.Result != GuardrailBreaks || c.Owed != 4500 || c.FirstBreach.String() != "2028-06" {
		t.Errorf("the car should be owed 4500 at 2028-06: %+v", c)
	}
	if got, want := today[2].Owed, 4500/d.At(month(t, "2028-06")); got != want {
		t.Errorf("owed in today's dollars %v, want %v", got, want)
	}
	if !reflect.DeepEqual(d.Result(res).Scenarios[0].Guardrails, today) {
		t.Errorf("the converted path's guardrails differ from the converted results")
	}
	if d.Guardrails(nil) != nil {
		t.Errorf("no guardrails convert to some")
	}
}

// Spec chapter 04 §12: a comparison keeps its break-even months, decided in
// nominal dollars, and divides each month's difference.
func TestTodaysDollarsConvertsAComparison(t *testing.T) {
	start := month(t, "2026-01")
	d := NewDeflator(start, 3)
	a := scenarioOf([]float64{100, 90, 120, 130}, []float64{200, 190, 220, 230})
	b := scenarioOf([]float64{100, 100, 100, 100}, []float64{200, 200, 200, 200})
	nominal := Compare(start, a, b)
	today := d.Comparison(nominal)
	if !reflect.DeepEqual(today.Cash.BreakEven, nominal.Cash.BreakEven) || !reflect.DeepEqual(today.Total.BreakEven, nominal.Total.BreakEven) {
		t.Errorf("break-even months moved: %+v, want %+v", today, nominal)
	}
	for i := range nominal.Cash.Difference {
		m := start + config.Month(i)
		if want := nominal.Cash.Difference[i] / d.At(m); today.Cash.Difference[i] != want {
			t.Errorf("cash difference in %s = %v, want %v", m, today.Cash.Difference[i], want)
		}
		if want := nominal.Total.Difference[i] / d.At(m); today.Total.Difference[i] != want {
			t.Errorf("total difference in %s = %v, want %v", m, today.Total.Difference[i], want)
		}
	}
	if nominal.Cash.Difference[2] != 20 {
		t.Errorf("converting changed the nominal comparison: %v", nominal.Cash.Difference)
	}
}

// Spec chapter 04 §12: a one-month plan reads the same in both.
func TestTodaysDollarsOfAOneMonthPlan(t *testing.T) {
	res := runDoc(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2026-01, startingCash: 100, inflationRate: 5}
scenarios:
  - name: plan
    events: [{name: Pay, amount: 10}]
`)
	today := res.Deflator().Result(res)
	if !reflect.DeepEqual(today.Scenarios[0].Liquid, res.Scenarios[0].Liquid) ||
		today.Scenarios[0].KeyFigures != res.Scenarios[0].KeyFigures {
		t.Errorf("today's dollars %+v, want the nominal %+v", today.Scenarios[0], res.Scenarios[0])
	}
}

// Spec chapter 04 §7, §12: an optimizer summary records the month its
// figures describe, and only its floor, minimum cash and headroom convert,
// at that month.
func TestTodaysDollarsConvertsOptimizerFiguresAtTheirMonth(t *testing.T) {
	cfg := loadConfig(t, `version: 2
simulation: {startDate: 2026-01, endDate: 2028-12, startingCash: 25000, inflationRate: 3.0}
recommendations: {emergencyFundMonths: 3}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 20000, startDate: 2027-03}
  - {name: Car gone, kind: debtFree, loans: [Car], startDate: 2028-06}
scenarios:
  - name: spend
    events:
      - {name: Salary, amount: 4000}
      - {name: Living, amount: -4000}
      - name: Fun
        amount: -100
        optimize: {field: amount, min: -1000, max: 0}
  - name: held
    events:
      - {name: Salary, amount: 4000}
      - {name: Living, amount: -4000}
      - name: Trip
        amount: -1000
        startDate: 2026-06
        endDate: 2026-06
      - name: Fun
        amount: -100
        optimize: {field: amount, min: -1000, max: 0, guardrail: Cushion}
  - name: debt
    loans:
      - {name: Car, principal: 12000, interestRate: 0, term: 48, startDate: 2026-01}
    events:
      - {name: Budget, amount: 300}
      - name: Extra
        amount: 0
        frequency: 1
        optimize: {field: amount, min: 0, max: 1000, guardrail: Car gone}
`)
	res, err := Run(cfg, Options{Optimize: true})
	if err != nil {
		t.Fatal(err)
	}
	d := res.Deflator()
	today := d.Result(res)
	for i, sc := range res.Scenarios {
		if len(sc.Optimizations) != 1 {
			t.Fatalf("%s: %d optimizations", sc.Name, len(sc.Optimizations))
		}
		o := sc.Optimizations[0]
		switch sc.Name {
		case "spend":
			// The emergency fund: the month of the least cash after the floor
			// is first reached, here the last.
			if o.MinimumCashMonth != res.End {
				t.Errorf("spend: minimum cash month %s, want %s", o.MinimumCashMonth, res.End)
			}
			if sc.Liquid[len(sc.Liquid)-1] != o.MinimumCash {
				t.Errorf("spend: minimum cash %v is not the last month's %v", o.MinimumCash, sc.Liquid[len(sc.Liquid)-1])
			}
		case "held":
			if o.Guardrail == nil || o.MinimumCashMonth != o.Guardrail.Tightest {
				t.Errorf("held: minimum cash month %s, want the guardrail's tightest month %+v", o.MinimumCashMonth, o.Guardrail)
			}
		}
		want := *o
		// A debtFree target has no dollar figures to convert.
		if o.Guardrail == nil || o.Guardrail.Kind != config.GuardrailDebtFree {
			at := d.At(o.MinimumCashMonth)
			want.Floor, want.MinimumCash, want.Headroom = o.Floor/at, o.MinimumCash/at, o.Headroom/at
		}
		if want.Guardrail != nil {
			g := d.Guardrails([]GuardrailResult{*o.Guardrail})[0]
			want.Guardrail = &g
		}
		got := today.Scenarios[i].Optimizations[0]
		if !reflect.DeepEqual(*got, want) {
			t.Errorf("%s: %+v, want %+v", sc.Name, *got, want)
		}
		if got == o {
			t.Errorf("%s: the summary is shared, not converted", sc.Name)
		}
	}
}

// Spec chapter 04 §7: the month of the least cash is the earliest month of
// the suffix with it, over every month when the floor is never reached.
func TestFeasibilityRecordsTheMonthOfTheLeastCash(t *testing.T) {
	for _, c := range []struct {
		name   string
		liquid []float64
		floor  float64
		want   int
	}{
		{"reached, least later", []float64{5, 20, 12, 15, 12}, 10, 2},
		{"least before the floor is reached does not count", []float64{1, 20, 15, 18}, 10, 2},
		{"never reached", []float64{5, 3, 4, 3}, 10, 1},
	} {
		if got := feasibility(c.liquid, c.floor).minMonth; got != c.want {
			t.Errorf("%s: month %d, want %d", c.name, got, c.want)
		}
	}
}
