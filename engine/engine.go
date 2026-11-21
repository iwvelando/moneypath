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
}

// Result is the outcome of one Run. Scenario series all share the
// simulation window [Start, End]; series index i is month Start+i.
type Result struct {
	Start, End config.Month
	Scenarios  []*ScenarioResult
}

type ScenarioResult struct {
	Name   string
	Liquid []float64
	Total  []float64
	Notes  [][]string
	// Owed is the principal each loan name owes at the end of each month,
	// summed over the path's loans with that name, and Holdings each account
	// name's value; both are index-aligned with Liquid. They are read by
	// guardrails only, never written to the CSV (spec chapter 04 §10).
	Owed       map[string][]float64
	Holdings   map[string][]float64
	KeyFigures KeyFigures
	// Guardrails holds one result per guardrail of the plan, in its order;
	// nil when it has none (spec chapter 04 §10).
	Guardrails    []GuardrailResult
	EmergencyFund *EmergencyFund
	Optimizations []*Optimization
}

// KeyFigures are the per-scenario figures a comparison between scenarios
// turns on (spec chapter 04 §8).
type KeyFigures struct {
	LowestCash     float64
	LowestCashDate config.Month
	EndingCash     float64
	EndingTotal    float64
}

// keyFigures reads a scenario's key figures from its recorded series, whose
// index i is month start+i. Lowest cash is decided in whole cents and the
// earliest month attaining it wins (spec chapter 04 §8).
func keyFigures(start config.Month, liquid, total []float64) KeyFigures {
	if len(liquid) == 0 || len(total) == 0 {
		return KeyFigures{LowestCashDate: start}
	}
	lowest := 0
	for i, v := range liquid {
		if round2(v) < round2(liquid[lowest]) {
			lowest = i
		}
	}
	return KeyFigures{
		LowestCash:     liquid[lowest],
		LowestCashDate: start + config.Month(lowest),
		EndingCash:     liquid[len(liquid)-1],
		EndingTotal:    total[len(total)-1],
	}
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
	// Floor, MinimumCash and Headroom are zero for a target held to a
	// debtFree guardrail, which has no dollar floor (spec chapter 04 §7).
	Floor       float64
	MinimumCash float64
	Headroom    float64
	// Guardrail is the result of the guardrail the target is held to, on the
	// reported value's forecast; nil for a target held to the emergency fund.
	Guardrail  *GuardrailResult
	Iterations int
	Converged  bool
	Notes      []string
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
	var out *Result
	if opts.Optimize {
		var err error
		if out, err = runOptimized(cfg, opts); err != nil {
			return nil, err
		}
	} else {
		out = forecast(cfg, opts)
	}
	// Guardrails describe the forecast that is reported: with the optimizer,
	// the final one (spec chapter 04 §10).
	for _, sr := range out.Scenarios {
		sr.Guardrails = EvaluateGuardrails(cfg.Guardrails, out.Start, sr)
	}
	return out, nil
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
		res.Scenarios = append(res.Scenarios, simulateScenario(cfg, sc, cfg.ResolvedEmergencyFundMonths))
	}
	return res
}

func simulateScenario(cfg *config.Config, sc *config.Scenario, emMonths float64) *ScenarioResult {
	start, end := cfg.Simulation.ResolvedStart, cfg.Simulation.ResolvedEnd
	// Every month from start through end is simulated and recorded (spec
	// chapter 04 §1); validation refuses an end before the start.
	n := int(end-start) + 1
	sr := &ScenarioResult{
		Name:   sc.Name,
		Liquid: make([]float64, n),
		Total:  make([]float64, n),
		Notes:  make([][]string, n),
	}

	// The scenario's two resolved lists (spec chapter 04 §1): its own entries
	// with those its selected options add, then common as those options
	// change it. The shared list is the scenario's own, not one for the plan.
	own, shared := sc.Resolved, sc.ResolvedShared

	events := make([]*config.Event, 0, len(own.Events)+len(shared.Events))
	events = append(events, own.Events...)
	events = append(events, shared.Events...)

	var loans []*loanSim
	for _, l := range own.Loans {
		loans = append(loans, buildLoanSchedule(l, start, end))
	}
	for _, l := range shared.Loans {
		loans = append(loans, buildLoanSchedule(l, start, end))
	}

	var invs []*invSim
	for _, inv := range own.Investments {
		invs = append(invs, newInvSim(inv, "scenario", start))
	}
	for _, inv := range shared.Investments {
		invs = append(invs, newInvSim(inv, "common", start))
	}

	sr.Owed = make(map[string][]float64, len(loans))
	for _, ls := range loans {
		if sr.Owed[ls.l.Name] == nil {
			sr.Owed[ls.l.Name] = make([]float64, n)
		}
	}
	sr.Holdings = make(map[string][]float64, len(invs))
	for _, iv := range invs {
		if sr.Holdings[iv.inv.Name] == nil {
			sr.Holdings[iv.inv.Name] = make([]float64, n)
		}
	}

	// startingCash and each startingValue are balances at the end of the
	// month before start, so the start month's own activity is simulated.
	startingCash := cfg.Simulation.ResolvedStartingCash
	cash := startingCash
	cashRate := cfg.Simulation.CashInterestRate / 100 / 12

	expenseSum := 0.0
	expenseMonths := 0

	for idx := 0; idx < n; idx++ {
		m := start + config.Month(idx)

		// 1. Cash interest (§1.1) on the prior month's balance, then events.
		// Only a positive balance earns; debt is not charged the savings rate.
		cashInterest := math.Max(0, cash) * cashRate
		eventDelta := 0.0
		negEvents := 0.0
		for _, ev := range events {
			if ev.OccursAt(m) {
				// Grown from the plan's start (§2.1).
				amount := ev.AmountAt(start, m)
				eventDelta += amount
				if amount < 0 {
					negEvents += -amount
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
		projectedLiquid := cash + cashInterest + eventDelta - cashContributions + withdrawalCash
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
		cash += cashInterest + eventDelta + loanDelta - cashContributions + withdrawalCash

		// 6. Record.
		invTotal := 0.0
		for _, iv := range invs {
			invTotal += iv.value
			sr.Holdings[iv.inv.Name][idx] += iv.value
		}
		for _, ls := range loans {
			sr.Owed[ls.l.Name][idx] += ls.owedAt(m)
		}
		sr.Liquid[idx] = cash
		sr.Total[idx] = cash + invTotal
		sr.Notes[idx] = append(payoffNotes, invNotes...)

		// 7. Emergency-fund stats over the first 12 simulated months.
		if idx < 12 {
			expenseSum += negEvents + positivePayments + cashContributions
			expenseMonths++
		}
	}

	sr.KeyFigures = keyFigures(start, sr.Liquid, sr.Total)

	if emMonths > 0 {
		ef := &EmergencyFund{TargetMonths: emMonths, InitialLiquid: startingCash}
		if expenseMonths > 0 {
			ef.AverageMonthlyExpenses = expenseSum / float64(expenseMonths)
		}
		ef.TargetAmount = ef.AverageMonthlyExpenses * emMonths
		if ef.AverageMonthlyExpenses != 0 {
			ef.FundedMonths = ef.InitialLiquid / ef.AverageMonthlyExpenses
		}
		// A gap under half a cent is float noise, not a shortfall (§5).
		if gap := ef.TargetAmount - ef.InitialLiquid; round2(gap) != 0 {
			ef.Shortfall = math.Max(0, gap)
			ef.Surplus = math.Max(0, -gap)
		}
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
