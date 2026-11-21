package engine

import (
	"maps"
	"slices"

	"github.com/iwvelando/moneypath/config"
)

// GuardrailOutcome is what a path's months say about one guardrail (spec
// chapter 04 §10).
type GuardrailOutcome string

const (
	GuardrailHolds        GuardrailOutcome = "holds"
	GuardrailBreaks       GuardrailOutcome = "breaks"
	GuardrailDoesNotApply GuardrailOutcome = "doesNotApply"
)

// GuardrailResult is one guardrail read from one path. FirstBreach is set
// only when the guardrail breaks, and so is Owed for a debtFree. Tightest and
// its margin are set when HasTightest is: unless the guardrail does not apply,
// and for a debtFree only when its debt is cleared.
type GuardrailResult struct {
	Name        string
	Kind        string
	Result      GuardrailOutcome
	FirstBreach config.Month
	HasTightest bool
	// Tightest is a debtFree's cleared month, and the month of least balance
	// for the other kinds.
	Tightest config.Month
	// Margin is a cashFloor's or a lasts' balance less its floor in the
	// tightest month, unrounded.
	Margin float64
	// MarginMonths is a debtFree's window's first month less its cleared month.
	MarginMonths int
	// Owed is what a debtFree's loans owe at its first breach, unrounded.
	Owed float64
}

// EvaluateGuardrails reads every guardrail from a simulated path whose
// series index i is month start+i. It is nil when there are none.
func EvaluateGuardrails(guardrails []*config.Guardrail, start config.Month, path *ScenarioResult) []GuardrailResult {
	if len(guardrails) == 0 {
		return nil
	}
	out := make([]GuardrailResult, len(guardrails))
	for i, g := range guardrails {
		out[i] = EvaluateGuardrail(g, start, path)
	}
	return out
}

// EvaluateGuardrail reads one validated guardrail from a simulated path whose
// series index i is month start+i. It adds nothing to the simulation, so any
// path the engine simulates can be evaluated (spec chapter 04 §10).
func EvaluateGuardrail(g *config.Guardrail, start config.Month, path *ScenarioResult) GuardrailResult {
	out := GuardrailResult{Name: g.Name, Kind: g.Kind, Result: GuardrailDoesNotApply}
	// The window, clipped to the recorded months; the opening row counts.
	first := max(g.ResolvedStart, start)
	last := min(g.ResolvedEnd, start+config.Month(len(path.Liquid)-1))
	if first > last {
		return out
	}
	if g.Kind == config.GuardrailDebtFree {
		debtFreeTest(&out, g, start, first, last, path)
		return out
	}
	balance, ok := guardrailBalance(g, start, path)
	if !ok {
		return out
	}
	floor := func(m config.Month) float64 { return guardrailFloor(g, start, m) }
	floorTest(&out, first, last, floor, balance, g.Kind == config.GuardrailLasts && g.Amount == nil)
	return out
}

// guardrailFloor is floor(m), the amount a cashFloor's or a lasts' balance is
// held to in month m of a plan that starts at start: its amount grown by its
// growth, or 0 for a lasts with none (spec chapter 04 §10).
func guardrailFloor(g *config.Guardrail, start, m config.Month) float64 {
	if g.Amount == nil {
		return 0
	}
	return *g.Amount * g.Growth.Factor(start, m)
}

// guardrailBalance is the balance a cashFloor or a lasts reads in month m:
// cash, or the combined value of the path's accounts with the listed names.
// It is false for a lasts that names no account the path has, and for a
// debtFree, which reads what is owed instead.
func guardrailBalance(g *config.Guardrail, start config.Month, path *ScenarioResult) (func(config.Month) float64, bool) {
	switch g.Kind {
	case config.GuardrailCashFloor:
		return func(m config.Month) float64 { return path.Liquid[m-start] }, true
	case config.GuardrailLasts:
		var accounts [][]float64
		for _, name := range g.Investments {
			if v, ok := path.Holdings[name]; ok {
				accounts = append(accounts, v)
			}
		}
		if len(accounts) == 0 {
			return nil, false
		}
		return func(m config.Month) float64 {
			total := 0.0
			for _, v := range accounts {
				total += v[m-start]
			}
			return total
		}, true
	}
	return nil, false
}

// floorTest reads a balance that must stay at or above a floor in every month
// from first through last, in whole cents, or strictly above it when strict
// is set; the tightest month is the earliest of the least margin in whole
// cents (spec chapter 04 §10).
func floorTest(out *GuardrailResult, first, last config.Month, floor, balance func(config.Month) float64, strict bool) {
	margin := func(m config.Month) float64 { return round2(balance(m)) - round2(floor(m)) }
	tightest := first
	breached := false
	for m := first; m <= last; m++ {
		b, f := round2(balance(m)), round2(floor(m))
		fails := b < f
		if strict {
			fails = b <= f
		}
		if !breached && fails {
			out.FirstBreach, breached = m, true
		}
		if round2(margin(m)) < round2(margin(tightest)) {
			tightest = m
		}
	}
	out.Result = GuardrailHolds
	if breached {
		out.Result = GuardrailBreaks
	}
	out.HasTightest, out.Tightest = true, tightest
	out.Margin = balance(tightest) - floor(tightest)
}

// debtFreeTest reads what a debtFree's loans owe from first through last, and
// the month the debt is cleared: the first of the last stretch, running to
// last and starting no earlier than start, in which nothing is owed (spec
// chapter 04 §10).
func debtFreeTest(out *GuardrailResult, g *config.Guardrail, start, first, last config.Month, path *ScenarioResult) {
	names := g.Loans
	if len(names) == 0 {
		// Every loan of the path, summed in a fixed order so the reported
		// amount is the same on every run and in every build.
		names = slices.Sorted(maps.Keys(path.Owed))
	}
	var loans [][]float64
	for _, name := range names {
		if v, ok := path.Owed[name]; ok {
			loans = append(loans, v)
		}
	}
	owed := func(m config.Month) float64 {
		total := 0.0
		for _, v := range loans {
			total += v[m-start]
		}
		return total
	}
	out.Result = GuardrailHolds
	for m := first; m <= last; m++ {
		if round2(owed(m)) != 0 {
			out.Result, out.FirstBreach, out.Owed = GuardrailBreaks, m, owed(m)
			break
		}
	}
	if round2(owed(last)) != 0 {
		return
	}
	cleared := last
	for cleared > start && round2(owed(cleared-1)) == 0 {
		cleared--
	}
	out.HasTightest, out.Tightest = true, cleared
	out.MarginMonths = int(first - cleared)
}
