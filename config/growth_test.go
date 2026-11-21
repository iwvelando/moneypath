package config

import (
	"math"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func ym(s string) Month {
	m, err := ParseMonth(s)
	if err != nil {
		panic(err)
	}
	return m
}

// growthPlan is a sound plan with one event whose growth is written as given.
func growthPlan(growth string) string {
	return `version: 2
simulation: {startDate: 2026-06, endDate: 2036-05, startingCash: 0, inflationRate: 3}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -2000, growth: ` + growth + `}
`
}

func TestGrowthReadsAWordOrANumber(t *testing.T) {
	now := ym("2026-01")
	cases := []struct {
		written   string
		inflation bool
		rate      float64
		fixed     bool
	}{
		{"fixed", false, 0, true},
		{"inflation", true, 3, false},
		{`"inflation"`, true, 3, false},
		{"4", false, 4, false},
		{"-2.5", false, -2.5, false},
		{"0", false, 0, false},
	}
	for _, c := range cases {
		cfg, problems := Load([]byte(growthPlan(c.written)), now)
		if cfg == nil || firstError(problems) != nil {
			t.Fatalf("growth: %s: %v", c.written, problems)
		}
		g := cfg.Scenarios[0].Events[0].Growth
		if g.Inflation() != c.inflation || g.Fixed() != c.fixed || g.Rate() != c.rate {
			t.Errorf("growth: %s read as inflation=%v fixed=%v rate=%v", c.written, g.Inflation(), g.Fixed(), g.Rate())
		}
	}
}

func TestGrowthLeftOutIsFixed(t *testing.T) {
	cfg, problems := Load([]byte(strings.Replace(growthPlan("fixed"), ", growth: fixed", "", 1)), ym("2026-01"))
	if cfg == nil || len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	g := cfg.Scenarios[0].Events[0].Growth
	if !g.Fixed() || g.Rate() != 0 {
		t.Errorf("absent growth: fixed=%v rate=%v", g.Fixed(), g.Rate())
	}
}

// Canonical form (spec chapter 03, Growth): fixed is written by leaving the
// key out, inflation as the word and a number as a number, after amount.
func TestGrowthCanonicalForm(t *testing.T) {
	for written, want := range map[string]string{
		"fixed":       "",
		"inflation":   "growth: inflation\n",
		`"inflation"`: "growth: inflation\n",
		"4.5":         "growth: 4.5\n",
		"0":           "growth: 0\n",
	} {
		cfg, problems := Load([]byte(growthPlan(written)), ym("2026-01"))
		if cfg == nil || firstError(problems) != nil {
			t.Fatalf("growth: %s: %v", written, problems)
		}
		out, err := yaml.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		if want == "" {
			if strings.Contains(string(out), "growth") {
				t.Errorf("growth: fixed echoed as\n%s", out)
			}
		} else if !strings.Contains(string(out), "amount: -2000\n          "+want) {
			t.Errorf("growth: %s echoed as\n%s", written, out)
		}
	}
}

func TestInflationRateIsWrittenAfterTheCashRate(t *testing.T) {
	cfg, _ := Load([]byte(`version: 2
simulation: {inflationRate: 2.5, cashInterestRate: 4, startDate: 2026-06, endDate: 2030-01, startingCash: 0}
scenarios: [{name: plan}]
`), ym("2026-01"))
	out, err := yaml.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "cashInterestRate: 4\n    inflationRate: 2.5\n") {
		t.Errorf("echoed as\n%s", out)
	}
}

func TestEscrowAndGuardrailGrowthAreCanonical(t *testing.T) {
	cfg, problems := Load([]byte(`version: 2
simulation: {startDate: 2026-06, endDate: 2036-05, startingCash: 0, inflationRate: 3}
guardrails:
  - {growth: inflation, name: Cushion, kind: cashFloor, amount: 100}
common:
  loans:
    - {escrowGrowth: 2, name: Home, principal: 1000, interestRate: 0, term: 10, startDate: 2026-06, escrow: 10, mortgageInsurance: 0}
scenarios: [{name: plan}]
`), ym("2026-01"))
	if cfg == nil || firstError(problems) != nil {
		t.Fatalf("problems: %v", problems)
	}
	out, err := yaml.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"      amount: 100\n      growth: inflation\n",
		"      escrow: 10\n          escrowGrowth: 2\n",
	} {
		if !strings.Contains(string(out), want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
}

// An option's change can set growth like any other field, and a null takes
// it away, back to fixed (spec chapter 03, Choices).
func TestAChangeSetsGrowth(t *testing.T) {
	cfg, problems := Load([]byte(`version: 2
simulation: {startDate: 2026-06, endDate: 2036-05, startingCash: 0, inflationRate: 3}
common:
  events:
    - {name: Rent, amount: -2000, growth: inflation}
    - {name: Pay, amount: 3000}
choices:
  - name: Growth
    options:
      - name: Fixed
        change:
          events:
            - {name: Rent, set: {growth: ~}}
            - {name: Pay, set: {growth: 4}}
scenarios: [{name: plan, select: {Growth: Fixed}}]
`), ym("2026-01"))
	if cfg == nil || len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	shared := cfg.Scenarios[0].ResolvedShared.Events
	if !shared[0].Growth.Fixed() {
		t.Errorf("rent: growth %+v, want fixed", shared[0].Growth)
	}
	if shared[1].Growth.Rate() != 4 {
		t.Errorf("pay: growth %+v, want 4", shared[1].Growth)
	}
	if !cfg.Common.Events[0].Growth.Inflation() {
		t.Errorf("the baseline changed: %+v", cfg.Common.Events[0].Growth)
	}
}

// An entry an option changes is checked again as changed, and a growth of
// inflation there follows the plan's rate, whether the change sets it or
// leaves the baseline's in place.
func TestAChangedEntryFollowsTheInflationRate(t *testing.T) {
	cfg, problems := Load([]byte(`version: 2
simulation: {startDate: 2026-06, endDate: 2036-05, startingCash: 0, inflationRate: 3}
common:
  events:
    - {name: Rent, amount: -2000, growth: inflation}
    - {name: Pay, amount: 3000}
  loans:
    - {name: Home, principal: 100000, interestRate: 5, term: 360, startDate: 2026-06, escrow: 300, escrowGrowth: inflation}
choices:
  - name: Move
    options:
      - name: Bigger place
        change:
          events:
            - {name: Rent, set: {amount: -2500}}
            - {name: Pay, set: {growth: inflation}}
          loans:
            - {name: Home, set: {escrow: 400}}
scenarios: [{name: plan, select: {Move: Bigger place}}]
`), ym("2026-01"))
	if cfg == nil || len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	shared := cfg.Scenarios[0].ResolvedShared
	for _, ev := range shared.Events {
		if ev.Growth.Rate() != 3 {
			t.Errorf("%s: growth %+v, want the plan's 3", ev.Name, ev.Growth)
		}
	}
	if got := shared.Loans[0].EscrowGrowth.Rate(); got != 3 {
		t.Errorf("escrow: growth rate %v, want the plan's 3", got)
	}
}

// The factor is an integer power counted in plan years from the start, by
// repeated multiplication, and exactly 1 in the first year and for no growth
// (spec chapter 04 §2.1).
func TestGrowthFactor(t *testing.T) {
	start := ym("2026-06")
	at := func(s string) Month { return ym(s) }
	g := GrowthRate(3)
	g.resolve(0)
	cases := []struct {
		m    string
		want float64
	}{
		{"2026-06", 1},
		{"2027-05", 1},
		{"2027-06", 1.03},
		{"2028-06", 1.03 * 1.03},
		{"2031-06", 1.03 * 1.03 * 1.03 * 1.03 * 1.03},
		{"2026-05", 1 / 1.03},
		{"2025-06", 1 / 1.03},
		{"2025-05", 1 / (1.03 * 1.03)},
	}
	for _, c := range cases {
		if got := g.Factor(start, at(c.m)); got != c.want {
			t.Errorf("Factor(%s) = %v, want %v", c.m, got, c.want)
		}
	}
	none := GrowthWithInflation()
	none.resolve(0)
	for _, m := range []string{"2020-01", "2026-06", "2090-12"} {
		if got := none.Factor(start, at(m)); got != 1 {
			t.Errorf("no growth: Factor(%s) = %v", m, got)
		}
	}
	if got := (Growth{}).Factor(start, at("2040-01")); got != 1 {
		t.Errorf("an unresolved growth: %v", got)
	}
	shrink := GrowthRate(-10)
	shrink.resolve(0)
	if got := shrink.Factor(start, at("2028-06")); math.Abs(got-0.81) > 1e-15 {
		t.Errorf("shrinking: %v", got)
	}
}
