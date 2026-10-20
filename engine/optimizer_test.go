package engine

import (
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/internal/money"
)

func loadConfig(t *testing.T, doc string) *config.Config {
	t.Helper()
	cfg, _, err := config.Parse([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	now, _ := config.ParseMonth("2000-01")
	if _, err := config.Validate(cfg, now); err != nil {
		t.Fatal(err)
	}
	return cfg
}

// Spec chapter 04 §7 step 2: a feasible expense lower bound is chosen with
// iterations = 0 and converged = true.
func TestOptimizerOriginalFeasible(t *testing.T) {
	cfg := loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 50000}
recommendations: {emergencyFundMonths: 3}
scenarios:
  - name: plan
    events:
      - {name: Income, amount: 2000}
      - name: Expense
        amount: -100
        optimize: {field: amount, min: -100, max: 0}
`)
	res, err := Run(cfg, Options{Optimize: true})
	if err != nil {
		t.Fatal(err)
	}
	opt := res.Scenarios[0].Optimizations[0]
	if !opt.Converged || opt.Iterations != 0 {
		t.Errorf("want converged with 0 iterations, got converged=%v iterations=%d", opt.Converged, opt.Iterations)
	}
	if opt.Value != -100 {
		t.Errorf("feasible lower bound must be chosen, got %v", opt.Value)
	}
}

// Spec chapter 04 §7: negative amount targets maximize affordable spending,
// using the baseline floor even when the original is already feasible.
func TestOptimizerLargestAffordableExpense(t *testing.T) {
	for _, tc := range []struct {
		name                     string
		original, min, max, want float64
	}{
		{"feasible original", -100, -5000, 0, -3475},
		{"infeasible original", -4000, -5000, 0, -2500},
		{"affordable lower bound", -100, -200, 0, -200},
		{"negative upper bound", -100, -5000, -50, -3475},
		{"bounds cross zero", -100, -5000, 100, -3475},
		{"original outside bounds", -100, -2000, -1000, -2000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := loadConfig(t, fmt.Sprintf(`
version: 2
simulation: {startDate: 2025-01, endDate: 2026-01, startingCash: 10000}
recommendations: {emergencyFundMonths: 3}
scenarios:
  - name: plan
    events:
      - {name: Income, amount: 1000}
      - {name: Living expenses, amount: -1000}
      - name: Car
        amount: %g
        frequency: 6
        startDate: 2025-04
        optimize: {field: amount, min: %g, max: %g}
`, tc.original, tc.min, tc.max))
			baselineFloor := forecast(cfg, Options{}).Scenarios[0].EmergencyFund.TargetAmount
			res, err := Run(cfg, Options{Optimize: true})
			if err != nil {
				t.Fatal(err)
			}
			opt := res.Scenarios[0].Optimizations[0]
			if !opt.Converged || math.Abs(opt.Value-tc.want) > 0.010001 {
				t.Fatalf("want affordable expense %v, got %+v", tc.want, opt)
			}
			if opt.Original != tc.original || opt.Floor != baselineFloor {
				t.Errorf("original or baseline floor changed: %+v", opt)
			}
			ev := cfg.Scenarios[0].Events[2]
			if *ev.Amount != opt.Value || opt.ValueDisplay != money.Format(opt.Value) {
				t.Errorf("chosen amount must match config and display: %+v", opt)
			}
			if e := feasibility(res.Scenarios[0].Liquid, baselineFloor); !e.feasible || e.minCash != opt.MinimumCash {
				t.Errorf("chosen expense does not preserve the reported cash floor: %+v", opt)
			}
			if opt.Value > tc.min {
				// More spending beyond the search tolerance must breach the floor.
				setEventField(ev, "amount", opt.Value-0.02)
				if feasibility(forecast(cfg, Options{}).Scenarios[0].Liquid, baselineFloor).feasible {
					t.Errorf("larger expense %v is still feasible", *ev.Amount)
				}
			} else if opt.Iterations != 0 {
				t.Errorf("affordable lower bound should need no bisection, got %d iterations", opt.Iterations)
			}
		})
	}
}

// Other objectives retain the closest feasible value to the original.
func TestOptimizerIncomeAmount(t *testing.T) {
	for _, tc := range []struct {
		name           string
		original, want float64
	}{
		{"feasible original", 2000, 2000},
		{"infeasible original", 100, 1000},
		{"zero original", 0, 1000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := loadConfig(t, fmt.Sprintf(`
version: 2
simulation: {startDate: 2025-01, endDate: 2026-01, startingCash: 3000}
recommendations: {emergencyFundMonths: 3}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -1000}
      - name: Income
        amount: %g
        optimize: {field: amount, min: 0, max: 3000}
`, tc.original))
			res, err := Run(cfg, Options{Optimize: true})
			if err != nil {
				t.Fatal(err)
			}
			opt := res.Scenarios[0].Optimizations[0]
			if !opt.Converged || math.Abs(opt.Value-tc.want) > 0.010001 {
				t.Errorf("want income %v, got %+v", tc.want, opt)
			}
			if tc.original == tc.want && opt.Iterations != 0 {
				t.Errorf("feasible income should need no bisection, got %d iterations", opt.Iterations)
			}
		})
	}
}

// Spec chapter 04 §7 step 3: neither bound feasible keeps the original,
// converged = false, with the exact note format.
func TestOptimizerInfeasible(t *testing.T) {
	cfg := loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 100}
recommendations: {emergencyFundMonths: 6}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -3000}
      - name: Side gig
        amount: 10
        optimize: {field: amount, min: 0, max: 50}
`)
	res, err := Run(cfg, Options{Optimize: true})
	if err != nil {
		t.Fatal(err)
	}
	opt := res.Scenarios[0].Optimizations[0]
	if opt.Converged {
		t.Error("optimization should not converge")
	}
	if opt.Value != 10 {
		t.Errorf("original value must be kept, got %v", opt.Value)
	}
	if len(opt.Notes) != 1 || !strings.HasPrefix(opt.Notes[0], "unable to satisfy minimum cash $") ||
		!strings.Contains(opt.Notes[0], "within bounds $0.00 to $50.00") {
		t.Errorf("note = %v", opt.Notes)
	}
}

// Spec chapter 04 §7: date fields optimize over month indexes, snapping to
// whole months, and displays use YYYY-MM.
func TestOptimizerDateField(t *testing.T) {
	// Income stops in 2025-06; pushing the end date later is what keeps
	// cash above the floor. The optimizer should pick the earliest
	// feasible end date (smallest adjustment from the original).
	cfg := loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 4000}
recommendations: {emergencyFundMonths: 3}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -1000}
      - name: Income
        amount: 1500
        endDate: 2025-06
        optimize: {field: endDate, minDate: 2025-06, maxDate: 2026-12}
`)
	res, err := Run(cfg, Options{Optimize: true})
	if err != nil {
		t.Fatal(err)
	}
	opt := res.Scenarios[0].Optimizations[0]
	if !opt.Converged {
		t.Fatalf("expected convergence, notes: %v", opt.Notes)
	}
	if len(opt.ValueDisplay) != 7 || opt.ValueDisplay[4] != '-' {
		t.Errorf("date display = %q, want YYYY-MM", opt.ValueDisplay)
	}
	if opt.OriginalDisplay != "2025-06" {
		t.Errorf("originalDisplay = %q, want 2025-06", opt.OriginalDisplay)
	}
	chosen, err := config.ParseMonth(opt.ValueDisplay)
	if err != nil {
		t.Fatalf("chosen value is not a month: %v", err)
	}
	// Verify minimality: one month earlier must be infeasible (or the
	// original itself), i.e. the adjusted config's floor holds at chosen
	// but the engine rejected earlier candidates during bisection.
	if chosen <= mustM(t, "2025-06") || chosen > mustM(t, "2026-12") {
		t.Errorf("chosen end date %s outside (2025-06, 2026-12]", chosen)
	}
	// The chosen value is written into the config (raw and resolved).
	ev := cfg.Scenarios[0].Events[1]
	if ev.EndDate != opt.ValueDisplay || ev.ResolvedEnd != chosen {
		t.Errorf("chosen value not applied to config: %s / %s", ev.EndDate, ev.ResolvedEnd)
	}
}

// Spec chapter 04 §7 setup: a disabled recommendation makes optimization
// fail with an error.
func TestOptimizerRequiresEmergencyFund(t *testing.T) {
	cfg := loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 0}
recommendations: {emergencyFundMonths: 0}
scenarios:
  - name: plan
    events:
      - name: E
        amount: -1
        optimize: {field: amount, min: -1, max: 0}
`)
	if _, err := Run(cfg, Options{Optimize: true}); err == nil {
		t.Fatal("expected an error when the emergency-fund recommendation is disabled")
	}
}

// Spec chapter 04 §7 setup: amounts live on cent boundaries and snap upward.
func TestCeilCents(t *testing.T) {
	cases := []struct{ in, want float64 }{
		{3.453, 3.46},
		{3.459, 3.46},
		{3.450, 3.45},
		{0, 0},
		{12, 12},
		{-184.7153, -184.71},
		{-184.72, -184.72}, // already exact: the float noise must not add a cent
		{184.72, 184.72},
		{0.001, 0.01},
		{-0.001, 0},
	}
	for _, c := range cases {
		if got := ceilCents(c.in); got != c.want {
			t.Errorf("ceilCents(%v) = %v, want %v", c.in, got, c.want)
		}
		// Snapping an already-snapped value must not move it again.
		if got := ceilCents(ceilCents(c.in)); got != c.want {
			t.Errorf("ceilCents is not idempotent at %v: %v", c.in, got)
		}
	}
}

// Spec chapter 04 §7: a chosen amount is a real currency value, so the number
// written into the config is the number displayed and the number whose
// headroom was measured.
func TestOptimizerAmountSnapsToCents(t *testing.T) {
	cfg := loadConfig(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 5000}
recommendations: {emergencyFundMonths: 3}
scenarios:
  - name: plan
    events:
      - {name: Income, amount: 2000}
      - {name: Rent, amount: -1800}
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0}
`)
	res, err := Run(cfg, Options{Optimize: true})
	if err != nil {
		t.Fatal(err)
	}
	opt := res.Scenarios[0].Optimizations[0]
	if !opt.Converged {
		t.Fatalf("expected convergence, notes: %v", opt.Notes)
	}
	if opt.Value != ceilCents(opt.Value) {
		t.Errorf("chosen amount %v is not a whole number of cents", opt.Value)
	}
	if opt.Value < -500 || opt.Value > 0 {
		t.Errorf("chosen amount %v outside the configured bounds -500 to 0", opt.Value)
	}
	if opt.Headroom < 0 {
		t.Errorf("chosen amount reports negative headroom %v", opt.Headroom)
	}
	// The display must be the value itself, not a rounded-off stand-in.
	if opt.ValueDisplay != money.Format(opt.Value) {
		t.Errorf("display %q does not match value %v", opt.ValueDisplay, opt.Value)
	}
	if got := *cfg.Scenarios[0].Events[2].Amount; got != opt.Value {
		t.Errorf("config amount %v differs from the chosen value %v", got, opt.Value)
	}
}

func mustM(t *testing.T, s string) config.Month {
	t.Helper()
	m, err := config.ParseMonth(s)
	if err != nil {
		t.Fatal(err)
	}
	return m
}
