package engine

import (
	"fmt"
	"math"
	"strconv"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/internal/money"
)

// runOptimized implements spec chapter 04 §7: adjust each event carrying an
// optimize block while holding its scenario to the target's floor. That is
// the guardrail the block names, or else the emergency-fund floor, which is
// each candidate plan's own emergency-fund target.
// Negative amount targets maximize affordable spending within their bounds;
// other targets require the smallest adjustment from the configured original.
// Chosen values are written back into cfg before the final forecast.
func runOptimized(cfg *config.Config, opts Options) (*Result, error) {
	type targetRef struct{ scIdx, evIdx int }
	var targets []targetRef
	needsFund := false
	for si, sc := range cfg.Scenarios {
		if !sc.ResolvedActive {
			continue
		}
		for ei, ev := range sc.Events {
			if ev.Optimize != nil {
				targets = append(targets, targetRef{si, ei})
				needsFund = needsFund || ev.Optimize.ResolvedGuardrail == nil
			}
		}
	}
	// Only a target held to the emergency fund needs the recommendation.
	if needsFund && cfg.ResolvedEmergencyFundMonths <= 0 {
		return nil, fmt.Errorf("optimization requires the emergency-fund recommendation, which is disabled")
	}

	floors := map[string]float64{}
	if needsFund {
		for _, sr := range forecast(cfg, opts).Scenarios {
			if sr.EmergencyFund != nil {
				floors[sr.Name] = sr.EmergencyFund.TargetAmount
			}
		}
	}

	summaries := map[string][]*Optimization{}
	for _, tr := range targets {
		sc := cfg.Scenarios[tr.scIdx]
		ev := sc.Events[tr.evIdx]
		if ev.Optimize.ResolvedGuardrail == nil {
			if floor, ok := floors[sc.Name]; !ok || floor <= 0 {
				return nil, fmt.Errorf("optimization failed: scenario %q has no positive emergency-fund floor", sc.Name)
			}
		}
		summary, err := optimizeTarget(cfg, opts, tr.scIdx, tr.evIdx)
		if err != nil {
			return nil, err
		}
		// Apply the chosen value so later targets see it and the
		// re-serialized config reflects it.
		setEventField(ev, ev.Optimize.ResolvedField, summary.Value)
		summaries[sc.Name] = append(summaries[sc.Name], summary)
	}

	final := forecast(cfg, opts)
	for _, sr := range final.Scenarios {
		sr.Optimizations = summaries[sr.Name]
	}
	return final, nil
}

// evalResult is one candidate's outcome. Held to the emergency fund, floor
// is the candidate plan's own emergency-fund target, the level its cash was
// held to. Held to a guardrail, guardrail is its result on the candidate's
// forecast, and floor and minCash are the guardrail's floor and its balance
// at the tightest month (zero for a debtFree, which has no dollar floor).
type evalResult struct {
	feasible  bool
	minCash   float64
	floor     float64
	headroom  float64
	guardrail *GuardrailResult
}

// better reports whether e is the better of two infeasible bounds (spec
// chapter 04 §7 step 3): the greater headroom or margin, and for a debtFree
// a cleared month over none, then more months to spare.
func (e evalResult) better(than evalResult) bool {
	if g, h := e.guardrail, than.guardrail; g != nil && h != nil && g.Kind == config.GuardrailDebtFree {
		if g.HasTightest != h.HasTightest {
			return g.HasTightest
		}
		return g.HasTightest && g.MarginMonths > h.MarginMonths
	}
	return e.headroom > than.headroom
}

func optimizeTarget(cfg *config.Config, opts Options, scIdx, evIdx int) (*Optimization, error) {
	sc := cfg.Scenarios[scIdx]
	ev := sc.Events[evIdx]
	o := ev.Optimize
	field := o.ResolvedField

	lo, hi := fieldBounds(o, field)
	original := getEventField(ev, field)
	// Snap each candidate to its field's value space, then clamp (spec 04 §7).
	// Amounts snap up: cash rises with an event's amount, so the extra fraction
	// of a cent can only add headroom, never eat into it.
	snapClamp := func(v float64) float64 {
		if field == "amount" {
			v = ceilCents(v)
		} else {
			v = math.Round(v)
		}
		return math.Min(math.Max(v, lo), hi)
	}

	evaluate := func(v float64) (evalResult, error) {
		cp, err := copyConfig(cfg)
		if err != nil {
			return evalResult{}, err
		}
		setEventField(cp.Scenarios[scIdx].Events[evIdx], field, v)
		res := forecast(cp, opts)
		for _, sr := range res.Scenarios {
			if sr.Name != sc.Name {
				continue
			}
			if g := o.ResolvedGuardrail; g != nil {
				return guardrailFeasibility(g, res.Start, sr), nil
			}
			return feasibility(sr.Liquid, sr.EmergencyFund.TargetAmount), nil
		}
		return evalResult{}, fmt.Errorf("scenario %q missing from optimizer evaluation", sc.Name)
	}

	sum := &Optimization{
		TargetName:      ev.Name,
		Field:           field,
		Original:        original,
		OriginalDisplay: displayValue(field, original),
	}
	report := func(e evalResult) {
		sum.Floor = e.floor
		sum.MinimumCash = e.minCash
		sum.Headroom = e.headroom
		sum.Guardrail = e.guardrail
	}

	anchor := snapClamp(original)
	if field == "amount" && original < 0 {
		// Search for the largest affordable expense, even when the configured
		// expense already works. The most negative bound is the ideal value.
		anchor = lo
	}
	anchorEval, err := evaluate(anchor)
	if err != nil {
		return nil, err
	}
	if anchorEval.feasible {
		sum.Value = anchor
		sum.ValueDisplay = displayValue(field, anchor)
		report(anchorEval)
		sum.Converged = true
		return sum, nil
	}

	loEval, err := evaluate(lo)
	if err != nil {
		return nil, err
	}
	hiEval, err := evaluate(hi)
	if err != nil {
		return nil, err
	}

	if !loEval.feasible && !hiEval.feasible {
		// Keep the original value; report the better bound, the lower one
		// when neither is better.
		best := loEval
		if hiEval.better(loEval) {
			best = hiEval
		}
		sum.Value = original
		sum.ValueDisplay = displayValue(field, original)
		report(best)
		sum.Converged = false
		bounds := fmt.Sprintf("within bounds %s to %s", displayValue(field, lo), displayValue(field, hi))
		if g := o.ResolvedGuardrail; g != nil {
			sum.Notes = append(sum.Notes, fmt.Sprintf("unable to hold guardrail “%s” %s", g.Name, bounds))
		} else {
			sum.Notes = append(sum.Notes, fmt.Sprintf("unable to satisfy minimum cash %s %s", money.Format(best.floor), bounds))
		}
		return sum, nil
	}

	// Bisect between the (infeasible) anchor and each feasible bound.
	type candidate struct {
		value float64
		eval  evalResult
	}
	var candidates []candidate
	iterations := 0
	budget := o.ResolvedMaxIter
	for _, dir := range []candidate{{lo, loEval}, {hi, hiEval}} {
		if !dir.eval.feasible {
			continue
		}
		inf, feas, feasEval := anchor, dir.value, dir.eval
		for math.Abs(feas-inf) > o.ResolvedTol && iterations < budget {
			mid := snapClamp((inf + feas) / 2)
			if mid == inf || mid == feas {
				break
			}
			iterations++
			e, err := evaluate(mid)
			if err != nil {
				return nil, err
			}
			if e.feasible {
				feas, feasEval = mid, e
			} else {
				inf = mid
			}
		}
		candidates = append(candidates, candidate{feas, feasEval})
	}

	best := candidates[0]
	for _, c := range candidates[1:] {
		dBest := math.Abs(best.value - anchor)
		dC := math.Abs(c.value - anchor)
		if dC < dBest || (dC == dBest && c.value < best.value) {
			best = c
		}
	}
	sum.Value = best.value
	sum.ValueDisplay = displayValue(field, best.value)
	report(best.eval)
	sum.Iterations = iterations
	sum.Converged = true
	return sum, nil
}

// feasibility: find the first month where liquid >= floor; feasible iff it
// exists and liquid stays >= floor from there through the end. Both sides
// compare in whole cents, so float noise cannot decide the outcome. minCash
// is the minimum over that suffix (over the whole series when the floor is
// never reached, for failure reporting).
func feasibility(liquid []float64, floor float64) evalResult {
	centFloor := round2(floor)
	first := -1
	for i, v := range liquid {
		if round2(v) >= centFloor {
			first = i
			break
		}
	}
	if first < 0 {
		min := math.Inf(1)
		for _, v := range liquid {
			min = math.Min(min, v)
		}
		return evalResult{feasible: false, minCash: min, floor: floor, headroom: min - floor}
	}
	min := math.Inf(1)
	for _, v := range liquid[first:] {
		min = math.Min(min, v)
	}
	return evalResult{feasible: round2(min) >= centFloor, minCash: min, floor: floor, headroom: min - floor}
}

// guardrailFeasibility holds a candidate's path to a guardrail: feasible iff
// the guardrail holds (spec chapter 04 §7, §10). A cashFloor or a lasts
// reports its floor, its balance at the tightest month and its margin there;
// a debtFree reports only its result.
func guardrailFeasibility(g *config.Guardrail, start config.Month, path *ScenarioResult) evalResult {
	r := EvaluateGuardrail(g, start, path)
	e := evalResult{feasible: r.Result == GuardrailHolds, guardrail: &r}
	if balance, ok := guardrailBalance(g, start, path); ok && r.HasTightest {
		e.floor, e.minCash, e.headroom = guardrailFloor(g, start, r.Tightest), balance(r.Tightest), r.Margin
	}
	return e
}

// fieldBounds returns the numeric search bounds (dates as month indexes).
func fieldBounds(o *config.Optimize, field string) (float64, float64) {
	switch field {
	case "amount", "frequency":
		return *o.Min, *o.Max
	default:
		return float64(o.ResolvedMinDate), float64(o.ResolvedMaxDate)
	}
}

func getEventField(ev *config.Event, field string) float64 {
	switch field {
	case "amount":
		return *ev.Amount
	case "frequency":
		return float64(ev.ResolvedFrequency)
	case "startDate":
		return float64(ev.ResolvedStart)
	default: // endDate
		return float64(ev.ResolvedEnd)
	}
}

// setEventField writes v into both the raw (serialized) and resolved forms.
func setEventField(ev *config.Event, field string, v float64) {
	switch field {
	case "amount":
		a := v
		ev.Amount = &a
	case "frequency":
		f := int(math.Round(v))
		ev.Frequency = &f
		ev.ResolvedFrequency = f
	case "startDate":
		m := config.Month(int(math.Round(v)))
		ev.StartDate = m.String()
		ev.ResolvedStart = m
	default: // endDate
		m := config.Month(int(math.Round(v)))
		ev.EndDate = m.String()
		ev.ResolvedEnd = m
	}
}

func displayValue(field string, v float64) string {
	switch field {
	case "amount":
		return money.Format(v)
	case "frequency":
		return strconv.Itoa(int(math.Round(v)))
	default:
		return config.Month(int(math.Round(v))).String()
	}
}

// copyConfig deep-copies a validated config via YAML round-trip and
// re-validation (candidate evaluations must not mutate the original).
func copyConfig(cfg *config.Config) (*config.Config, error) {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	cp, _, err := config.Parse(data)
	if err != nil {
		return nil, err
	}
	if _, err := config.Validate(cp, cfg.Simulation.ResolvedStart); err != nil {
		return nil, err
	}
	return cp, nil
}
