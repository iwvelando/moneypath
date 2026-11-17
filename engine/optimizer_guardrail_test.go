package engine

import (
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

// payoffPlan is a plan whose house loan is paid off by threshold once cash
// and the brokerage can cover it, so more income clears the loan sooner.
// INCOME is the income event, with its optimize block if any; GUARDRAILS
// and RECOMMENDATIONS are spliced in whole.
const payoffPlan = `
version: 2
simulation: {startDate: 2025-06, endDate: 2026-12, startingCash: 6000}
RECOMMENDATIONS
guardrails:
GUARDRAILS
scenarios:
  - name: plan
    events:
INCOME
      - {name: Spending, amount: -2600}
    loans:
      - {name: House loan, principal: 60000, interestRate: 4, term: 180, startDate: 2023-01, earlyPayoffThreshold: 5000}
    investments:
      - {name: Brokerage, startingValue: 45000, annualReturnRate: 6, withdrawalTaxRate: 15, fundLoanPayoffs: true}
`

func payoffConfig(t *testing.T, recommendations, guardrails, income string) *config.Config {
	t.Helper()
	return loadConfig(t, strings.NewReplacer(
		"RECOMMENDATIONS", recommendations, "GUARDRAILS", guardrails, "INCOME", income,
	).Replace(payoffPlan))
}

// Spec chapter 04 §7 step 3: with neither bound holding a cash floor, the
// original value is kept, the bound with the greater margin is reported with
// its guardrail result, and the note names the guardrail.
func TestOptimizerGuardrailInfeasibleCashFloor(t *testing.T) {
	cfg := loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 100}
recommendations: {emergencyFundMonths: 0}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 100000}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -3000}
      - name: Side gig
        amount: 10
        optimize: {field: amount, min: 0, max: 50, guardrail: Cushion}
`)
	res, err := Run(cfg, Options{Optimize: true})
	if err != nil {
		t.Fatal(err)
	}
	opt := res.Scenarios[0].Optimizations[0]
	if opt.Converged || opt.Value != 10 {
		t.Errorf("want the original kept and not converged, got value %v converged %v", opt.Value, opt.Converged)
	}
	want := "unable to hold guardrail “Cushion” within bounds $0.00 to $50.00"
	if len(opt.Notes) != 1 || opt.Notes[0] != want {
		t.Errorf("notes = %q, want [%q]", opt.Notes, want)
	}
	g := opt.Guardrail
	if g == nil || g.Name != "Cushion" || g.Result != GuardrailBreaks {
		t.Fatalf("guardrail = %+v, want Cushion breaking", g)
	}
	// The upper bound earns $50 a month more, so it has the greater margin.
	// Cash falls every month, so the lowest is the last: 100 + 24 × (50 − 3000).
	if opt.Floor != 100000 || round2(opt.MinimumCash) != -70700 || round2(opt.Headroom) != -170700 {
		t.Errorf("floor/min/headroom = %v/%v/%v, want 100000/-70700/-170700", opt.Floor, opt.MinimumCash, opt.Headroom)
	}
	if round2(g.Margin) != round2(opt.Headroom) {
		t.Errorf("guardrail margin %v differs from headroom %v", g.Margin, opt.Headroom)
	}
}

// Spec chapter 04 §7 step 3, debtFree: a bound with a cleared month beats
// one without, and of two with one, more months to spare wins. A debtFree
// has no dollar floor, so floor, minimum cash and headroom stay zero.
func TestOptimizerGuardrailInfeasibleDebtFree(t *testing.T) {
	const guardrail = "  - {name: Early, kind: debtFree, startDate: 2025-08}"
	for _, tc := range []struct {
		name     string
		min, max string
		months   int
	}{
		// $2,600 never clears the loan inside the plan; $3,600 clears it in 2025-12.
		{"cleared beats not cleared", "2600", "3600", -4},
		// $3,200 clears it in 2026-04 and $3,600 in 2025-12.
		{"more months to spare wins", "3200", "3600", -4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := payoffConfig(t, "recommendations: {emergencyFundMonths: 0}", guardrail,
				"      - name: Income\n        amount: 3400\n        optimize: {field: amount, min: "+tc.min+", max: "+tc.max+", guardrail: Early}")
			res, err := Run(cfg, Options{Optimize: true})
			if err != nil {
				t.Fatal(err)
			}
			opt := res.Scenarios[0].Optimizations[0]
			if opt.Converged || opt.Value != 3400 {
				t.Errorf("want the original kept and not converged, got value %v converged %v", opt.Value, opt.Converged)
			}
			g := opt.Guardrail
			if g == nil || g.Result != GuardrailBreaks || !g.HasTightest || g.MarginMonths != tc.months {
				t.Fatalf("guardrail = %+v, want a break cleared with %d months to spare", g, tc.months)
			}
			if opt.Floor != 0 || opt.MinimumCash != 0 || opt.Headroom != 0 {
				t.Errorf("a debt-free target has no dollar floor, got %v/%v/%v", opt.Floor, opt.MinimumCash, opt.Headroom)
			}
			want := "unable to hold guardrail “Early” within bounds $" + thousands(tc.min) + " to $" + thousands(tc.max)
			if len(opt.Notes) != 1 || opt.Notes[0] != want {
				t.Errorf("notes = %q, want [%q]", opt.Notes, want)
			}
		})
	}
}

func thousands(whole string) string { return whole[:1] + "," + whole[1:] + ".00" }

// Spec chapter 04 §7 setup: the emergency-fund prerequisite belongs to the
// targets held to it. With the recommendation disabled, a plan that also has
// such a target still fails.
func TestOptimizerEmergencyFundTargetStillNeedsTheRecommendation(t *testing.T) {
	cfg := payoffConfig(t, "recommendations: {emergencyFundMonths: 0}",
		"  - {name: Paid off, kind: debtFree, startDate: 2026-12}",
		"      - name: Income\n        amount: 3200\n        optimize: {field: amount, min: 3000, max: 3600, guardrail: Paid off}\n"+
			"      - name: Bonus\n        amount: 10\n        optimize: {field: amount, min: 0, max: 50}")
	if _, err := Run(cfg, Options{Optimize: true}); err == nil {
		t.Fatal("expected an error: the Bonus target is held to a disabled emergency fund")
	}
}

// Spec chapter 04 §7: every value chosen is one that was evaluated, so the
// chosen value holds its guardrail on the final forecast, whatever the kind.
func TestOptimizerGuardrailChosenValueHolds(t *testing.T) {
	for _, tc := range []struct{ name, guardrail, optimize string }{
		// The payoff draws cash to nothing from about $3,000 of income, and
		// $2,800 is too little to hold the floor, so only a lower bound
		// between the two holds (the search's limit when feasibility changes
		// more than once).
		{"cash floor", "  - {name: G, kind: cashFloor, amount: 3000}",
			"{field: amount, min: 2900, max: 3600, guardrail: G}"},
		{"lasts", "  - {name: G, kind: lasts, investments: [Brokerage], amount: 30000}",
			"{field: amount, min: 2600, max: 3600, guardrail: G}"},
		{"debt-free", "  - {name: G, kind: debtFree, startDate: 2026-03}",
			"{field: amount, min: 2600, max: 4000, guardrail: G}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := payoffConfig(t, "", tc.guardrail,
				"      - name: Income\n        amount: 3300\n        optimize: "+tc.optimize)
			res, err := Run(cfg, Options{Optimize: true})
			if err != nil {
				t.Fatal(err)
			}
			sr := res.Scenarios[0]
			opt := sr.Optimizations[0]
			if !opt.Converged {
				t.Fatalf("not converged: %v", opt.Notes)
			}
			if opt.Guardrail == nil || opt.Guardrail.Result != GuardrailHolds {
				t.Errorf("adjustment's guardrail = %+v, want holds", opt.Guardrail)
			}
			if got := sr.Guardrails[0]; opt.Guardrail == nil || got != *opt.Guardrail {
				t.Errorf("final forecast's guardrail %+v differs from the adjustment's %+v", got, opt.Guardrail)
			}
		})
	}
}
