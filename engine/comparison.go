package engine

import "github.com/iwvelando/moneypath/config"

// Comparison is one scenario minus another, for cash and for total (spec
// chapter 04 §9).
type Comparison struct {
	Cash  SeriesComparison
	Total SeriesComparison
}

// SeriesComparison holds one series of a Comparison. Difference has one entry
// per recorded month; BreakEven is in month order and never nil.
type SeriesComparison struct {
	Difference []float64
	BreakEven  []BreakEven
}

// BreakEven is a month in which the lead changes hands. FirstAhead says which
// scenario of the pair moves ahead in it: the first, or else the second.
type BreakEven struct {
	Month      config.Month
	FirstAhead bool
}

// Compare reads a minus b from the two scenarios' recorded series.
func (r *Result) Compare(a, b *ScenarioResult) Comparison {
	return Compare(r.Start, a, b)
}

// Compare reads a minus b from two scenarios' recorded series, whose index i
// is month start+i (spec chapter 04 §9).
func Compare(start config.Month, a, b *ScenarioResult) Comparison {
	return Comparison{
		Cash:  compareSeries(start, a.Liquid, b.Liquid),
		Total: compareSeries(start, a.Total, b.Total),
	}
}

func compareSeries(start config.Month, a, b []float64) SeriesComparison {
	n := min(len(a), len(b))
	out := SeriesComparison{Difference: make([]float64, n), BreakEven: []BreakEven{}}
	// The scenario that most recently led: +1 the first, -1 the second, 0
	// while nobody has. A level month leaves it as it is.
	leader := 0
	for i := range n {
		out.Difference[i] = a[i] - b[i]
		lead := 0
		switch ra, rb := round2(a[i]), round2(b[i]); {
		case ra > rb:
			lead = 1
		case ra < rb:
			lead = -1
		}
		if lead == 0 {
			continue
		}
		if leader == -lead {
			out.BreakEven = append(out.BreakEven, BreakEven{Month: start + config.Month(i), FirstAhead: lead > 0})
		}
		leader = lead
	}
	return out
}
