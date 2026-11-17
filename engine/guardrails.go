package engine

import "github.com/iwvelando/moneypath/config"

// GuardrailOutcome is what a path's months say about one guardrail (spec
// chapter 04 §10).
type GuardrailOutcome string

const (
	GuardrailHolds        GuardrailOutcome = "holds"
	GuardrailBreaks       GuardrailOutcome = "breaks"
	GuardrailDoesNotApply GuardrailOutcome = "doesNotApply"
)

// GuardrailResult is one guardrail read from one path. FirstBreach is set
// only when the guardrail breaks; Tightest and Margin unless it does not
// apply.
type GuardrailResult struct {
	Name        string
	Kind        string
	Result      GuardrailOutcome
	FirstBreach config.Month
	Tightest    config.Month
	// Margin is the balance less the floor in the tightest month, unrounded.
	Margin float64
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
	switch g.Kind {
	case config.GuardrailCashFloor:
		floor := func(config.Month) float64 { return *g.Amount }
		tightest := first
		breached := false
		for m := first; m <= last; m++ {
			cash := path.Liquid[m-start]
			if !breached && round2(cash) < round2(floor(m)) {
				out.FirstBreach, breached = m, true
			}
			if round2(cash) < round2(path.Liquid[tightest-start]) {
				tightest = m
			}
		}
		out.Result = GuardrailHolds
		if breached {
			out.Result = GuardrailBreaks
		}
		out.Tightest = tightest
		out.Margin = path.Liquid[tightest-start] - floor(tightest)
	}
	return out
}
