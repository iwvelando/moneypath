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
// optimize block to the value requiring the smallest adjustment from the
// configured original that keeps cash at or above the emergency-fund floor.
// Chosen values are written back into cfg before the final forecast.
func runOptimized(cfg *config.Config, opts Options) (*Result, error) {
	if emergencyMonths(cfg, opts) <= 0 {
		return nil, fmt.Errorf("optimization requires the emergency-fund recommendation, which is disabled")
	}

	baseline := forecast(cfg, opts)
	floors := map[string]float64{}
	for _, sr := range baseline.Scenarios {
		if sr.EmergencyFund != nil {
			floors[sr.Name] = sr.EmergencyFund.TargetAmount
		}
	}

	type targetRef struct{ scIdx, evIdx int }
	var targets []targetRef
	for si, sc := range cfg.Scenarios {
		if !sc.ResolvedActive {
			continue
		}
		for ei, ev := range sc.Events {
			if ev.Optimize != nil {
				targets = append(targets, targetRef{si, ei})
			}
		}
	}

	summaries := map[string][]*Optimization{}
	for _, tr := range targets {
		sc := cfg.Scenarios[tr.scIdx]
		ev := sc.Events[tr.evIdx]
		floor, ok := floors[sc.Name]
		if !ok || floor <= 0 {
			return nil, fmt.Errorf("optimization failed: scenario %q has no positive emergency-fund floor", sc.Name)
		}
		summary, err := optimizeTarget(cfg, opts, tr.scIdx, tr.evIdx, floor)
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

type evalResult struct {
	feasible bool
	minCash  float64
}

func optimizeTarget(cfg *config.Config, opts Options, scIdx, evIdx int, floor float64) (*Optimization, error) {
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
			if sr.Name == sc.Name {
				return feasibility(sr.Liquid, floor), nil
			}
		}
		return evalResult{}, fmt.Errorf("scenario %q missing from optimizer evaluation", sc.Name)
	}

	sum := &Optimization{
		TargetName:      ev.Name,
		Field:           field,
		Original:        original,
		OriginalDisplay: displayValue(field, original),
		Floor:           floor,
	}

	orig := snapClamp(original)
	origEval, err := evaluate(orig)
	if err != nil {
		return nil, err
	}
	if origEval.feasible {
		sum.Value = orig
		sum.ValueDisplay = displayValue(field, orig)
		sum.MinimumCash = origEval.minCash
		sum.Headroom = origEval.minCash - floor
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
		// Keep the original value; report the higher-headroom bound.
		best := loEval
		if hiEval.minCash > loEval.minCash {
			best = hiEval
		}
		sum.Value = original
		sum.ValueDisplay = displayValue(field, original)
		sum.MinimumCash = best.minCash
		sum.Headroom = best.minCash - floor
		sum.Converged = false
		sum.Notes = append(sum.Notes, fmt.Sprintf(
			"unable to satisfy minimum cash %s within bounds %s to %s",
			money.Format(floor), displayValue(field, lo), displayValue(field, hi)))
		return sum, nil
	}

	// Bisect between the (infeasible) original and each feasible bound.
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
		inf, feas, feasEval := orig, dir.value, dir.eval
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
		dBest := math.Abs(best.value - orig)
		dC := math.Abs(c.value - orig)
		if dC < dBest || (dC == dBest && c.value < best.value) {
			best = c
		}
	}
	sum.Value = best.value
	sum.ValueDisplay = displayValue(field, best.value)
	sum.MinimumCash = best.eval.minCash
	sum.Headroom = best.eval.minCash - floor
	sum.Iterations = iterations
	sum.Converged = true
	return sum, nil
}

// feasibility: find the first month where liquid >= floor; feasible iff it
// exists and liquid stays >= floor from there through the end. minCash is
// the minimum over that suffix (over the whole series when the floor is
// never reached, for failure reporting).
func feasibility(liquid []float64, floor float64) evalResult {
	first := -1
	for i, v := range liquid {
		if v >= floor {
			first = i
			break
		}
	}
	if first < 0 {
		min := math.Inf(1)
		for _, v := range liquid {
			min = math.Min(min, v)
		}
		return evalResult{feasible: false, minCash: min}
	}
	min := math.Inf(1)
	for _, v := range liquid[first:] {
		min = math.Min(min, v)
	}
	return evalResult{feasible: min >= floor, minCash: min}
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
