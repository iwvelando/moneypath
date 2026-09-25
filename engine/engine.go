// Package engine implements the moneypath simulation core
// (spec chapter 04). It is pure: config in, results out — no I/O,
// no clock reads, no logging.
package engine

import (
	"fmt"
	"math"

	"github.com/iwvelando/moneypath/config"
)

// Options tunes a Run. The caller supplies everything environmental.
type Options struct {
	// Optimize runs the chapter 04 §7 optimizer before the final forecast.
	Optimize bool
	// EmergencyFundMonths overrides recommendations.emergencyFundMonths
	// when non-nil (0 disables the recommendation).
	EmergencyFundMonths *float64
}

// Result is the outcome of one Run. Scenario series all share the
// simulation window [Start, End]; series index i is month Start+i.
type Result struct {
	Start, End config.Month
	Scenarios  []*ScenarioResult
}

type ScenarioResult struct {
	Name          string
	Liquid        []float64
	Total         []float64
	Notes         [][]string
	EmergencyFund *EmergencyFund
	Optimizations []*Optimization
}

type EmergencyFund struct {
	TargetMonths           float64
	AverageMonthlyExpenses float64
	TargetAmount           float64
	InitialLiquid          float64
	FundedMonths           float64
	Shortfall              float64
	Surplus                float64
}

type Optimization struct {
	TargetName      string
	Field           string
	Original        float64 // raw numeric original (dates as month index)
	Value           float64 // raw numeric chosen value
	OriginalDisplay string
	ValueDisplay    string
	Floor           float64
	MinimumCash     float64
	Headroom        float64
	Iterations      int
	Converged       bool
	Notes           []string
}

// round2 rounds to cents; every comparison that decides behavior uses it
// (spec chapter 04 preamble).
func round2(x float64) float64 { return math.Round(x*100) / 100 }

// ceilCents snaps up to the next cent, the value space the optimizer searches
// for amounts (spec chapter 04 §7). A value already within floating-point
// noise of a cent is taken as that cent, so snapping twice cannot walk a
// value upward one cent at a time.
func ceilCents(x float64) float64 {
	c := x * 100
	if r := math.Round(c); math.Abs(c-r) < 1e-9 {
		return r / 100
	}
	return math.Ceil(c) / 100
}

// Run simulates every active scenario of a validated config. With
// opts.Optimize it first runs the optimizer, writing the chosen values
// back into cfg (so a re-serialized cfg reflects them).
func Run(cfg *config.Config, opts Options) (*Result, error) {
	if opts.Optimize {
		return runOptimized(cfg, opts)
	}
	return forecast(cfg, opts), nil
}

func emergencyMonths(cfg *config.Config, opts Options) float64 {
	if opts.EmergencyFundMonths != nil {
		return *opts.EmergencyFundMonths
	}
	return cfg.ResolvedEmergencyFundMonths
}

func forecast(cfg *config.Config, opts Options) *Result {
	res := &Result{
		Start: cfg.Simulation.ResolvedStart,
		End:   cfg.Simulation.ResolvedEnd,
	}
	for _, sc := range cfg.Scenarios {
		if !sc.ResolvedActive {
			continue
		}
		res.Scenarios = append(res.Scenarios, simulateScenario(cfg, sc, emergencyMonths(cfg, opts)))
	}
	return res
}

func simulateScenario(cfg *config.Config, sc *config.Scenario, emMonths float64) *ScenarioResult {
	start, end := cfg.Simulation.ResolvedStart, cfg.Simulation.ResolvedEnd
	n := int(end - start) // iterated months
	sr := &ScenarioResult{
		Name:   sc.Name,
		Liquid: make([]float64, n+1),
		Total:  make([]float64, n+1),
		Notes:  make([][]string, n+1),
	}

	events := make([]*config.Event, 0, len(sc.Events)+len(cfg.Common.Events))
	events = append(events, sc.Events...)
	events = append(events, cfg.Common.Events...)

	var loans []*loanSim
	for _, l := range sc.Loans {
		loans = append(loans, buildLoanSchedule(l, end))
	}
	for _, l := range cfg.Common.Loans {
		loans = append(loans, buildLoanSchedule(l, end))
	}

	var invs []*invSim
	for _, inv := range sc.Investments {
		invs = append(invs, newInvSim(inv, "scenario"))
	}
	for _, inv := range cfg.Common.Investments {
		invs = append(invs, newInvSim(inv, "common"))
	}

	cash := cfg.Simulation.ResolvedStartingCash
	invTotal := 0.0
	for _, iv := range invs {
		invTotal += iv.value
	}
	sr.Liquid[0] = cash
	sr.Total[0] = cash + invTotal

	expenseSum := 0.0
	expenseMonths := 0

	for idx := 1; idx <= n; idx++ {
		m := start + config.Month(idx)

		// 1. Events.
		eventDelta := 0.0
		negEvents := 0.0
		for _, ev := range events {
			if ev.OccursAt(m) {
				eventDelta += *ev.Amount
				if *ev.Amount < 0 {
					negEvents += -*ev.Amount
				}
			}
		}

		// 2. Investments.
		cashContributions := 0.0
		withdrawalCash := 0.0
		var invNotes []string
		for _, iv := range invs {
			r := iv.processMonth(m)
			cashContributions += r.cashContribution
			withdrawalCash += r.netWithdrawal
			if r.note != "" {
				invNotes = append(invNotes, r.note)
			}
		}

		// 3. Threshold payoff checks (loan order: scenario, then common).
		projectedLiquid := cash + eventDelta - cashContributions + withdrawalCash
		var payoffNotes []string
		for _, ls := range loans {
			fired, notes, netCashEffect, proceeds := ls.checkThresholdPayoff(m, projectedLiquid, invs, end)
			if fired {
				payoffNotes = append(payoffNotes, notes...)
				withdrawalCash += proceeds
				projectedLiquid += netCashEffect
			}
		}

		// 4. Loans.
		loanDelta := 0.0
		positivePayments := 0.0
		for _, ls := range loans {
			if p, ok := ls.payments[m]; ok {
				loanDelta -= p
				if p > 0 {
					positivePayments += p
				}
			}
		}

		// 5. Cash.
		cash += eventDelta + loanDelta - cashContributions + withdrawalCash

		// 6. Record.
		invTotal = 0.0
		for _, iv := range invs {
			invTotal += iv.value
		}
		sr.Liquid[idx] = cash
		sr.Total[idx] = cash + invTotal
		sr.Notes[idx] = append(payoffNotes, invNotes...)

		// 7. Emergency-fund stats over the first 12 iterated months.
		if idx <= 12 {
			expenseSum += negEvents + positivePayments + cashContributions
			expenseMonths++
		}
	}

	if emMonths > 0 {
		ef := &EmergencyFund{TargetMonths: emMonths, InitialLiquid: sr.Liquid[0]}
		if expenseMonths > 0 {
			ef.AverageMonthlyExpenses = expenseSum / float64(expenseMonths)
		}
		ef.TargetAmount = ef.AverageMonthlyExpenses * emMonths
		if ef.AverageMonthlyExpenses != 0 {
			ef.FundedMonths = ef.InitialLiquid / ef.AverageMonthlyExpenses
		}
		ef.Shortfall = math.Max(0, ef.TargetAmount-ef.InitialLiquid)
		ef.Surplus = math.Max(0, ef.InitialLiquid-ef.TargetAmount)
		sr.EmergencyFund = ef
	}
	return sr
}

// Dates returns every month of the simulation window in order.
func (r *Result) Dates() []config.Month {
	out := make([]config.Month, 0, int(r.End-r.Start)+1)
	for m := r.Start; m <= r.End; m++ {
		out = append(out, m)
	}
	return out
}

func fmtSigned(x float64) string { return fmt.Sprintf("%+.2f", x) }
