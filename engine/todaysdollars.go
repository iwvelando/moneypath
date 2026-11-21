package engine

import (
	"math"

	"github.com/iwvelando/moneypath/config"
)

// Deflator reads nominal figures in today's dollars: the plan's start month's
// prices (spec chapter 04 §12). Its methods return converted copies and leave
// what they are given alone.
type Deflator struct {
	start config.Month
	// year is a year's inflation, 1 + i/100, and month its twelfth root.
	year, month float64
}

// NewDeflator is the deflator of a plan starting in start at a yearly
// inflation rate in percent; nil when the rate is 0, which has no today's
// dollars.
func NewDeflator(start config.Month, inflationRate float64) *Deflator {
	if inflationRate == 0 {
		return nil
	}
	year := 1 + inflationRate/100
	// The twelfth root without a fractional power, which builds compute
	// differently in the last bit.
	return &Deflator{start: start, year: year, month: math.Sqrt(math.Sqrt(math.Cbrt(year)))}
}

// Deflator is the result's deflator, nil when the plan has no inflation rate.
func (r *Result) Deflator() *Deflator {
	return NewDeflator(r.Start, r.InflationRate)
}

// At is D(m) = year^k · month^j, where m − start = 12k + j and 0 ≤ j < 12,
// each power taken by repeated multiplication.
func (d *Deflator) At(m config.Month) float64 {
	n := int(m - d.start)
	k, j := n/12, n%12
	if j < 0 {
		k, j = k-1, j+12
	}
	years := 1.0
	for range max(k, -k) {
		years *= d.year
	}
	if k < 0 {
		years = 1 / years
	}
	months := 1.0
	for range j {
		months *= d.month
	}
	return years * months
}

// series divides each month of a series whose index i is month start+i.
func (d *Deflator) series(s []float64) []float64 {
	if s == nil {
		return nil
	}
	out := make([]float64, len(s))
	for i, v := range s {
		out[i] = v / d.At(d.start+config.Month(i))
	}
	return out
}

// Result reads a whole result in today's dollars; nil for a nil deflator.
func (d *Deflator) Result(r *Result) *Result {
	if d == nil {
		return nil
	}
	out := &Result{Start: r.Start, End: r.End, InflationRate: r.InflationRate}
	for _, sr := range r.Scenarios {
		out.Scenarios = append(out.Scenarios, d.Path(sr))
	}
	return out
}

// Path reads one path in today's dollars: its series month by month, its key
// figures from those, and the amounts of its guardrails and optimizations at
// their months. Notes, the emergency fund and the per-loan and per-account
// balances guardrails read are carried as they are.
func (d *Deflator) Path(sr *ScenarioResult) *ScenarioResult {
	out := *sr
	out.Liquid, out.Total = d.series(sr.Liquid), d.series(sr.Total)
	out.KeyFigures = keyFigures(d.start, out.Liquid, out.Total)
	out.Guardrails = d.Guardrails(sr.Guardrails)
	out.Optimizations = nil
	for _, o := range sr.Optimizations {
		out.Optimizations = append(out.Optimizations, d.Optimization(o))
	}
	return &out
}

// Guardrails converts each result's margin at its tightest month and its
// owed at its first breach; the outcome and months are as decided.
func (d *Deflator) Guardrails(results []GuardrailResult) []GuardrailResult {
	if results == nil {
		return nil
	}
	out := make([]GuardrailResult, len(results))
	for i, g := range results {
		out[i] = g
		if g.HasTightest {
			out[i].Margin = g.Margin / d.At(g.Tightest)
		}
		if g.Result == GuardrailBreaks {
			out[i].Owed = g.Owed / d.At(g.FirstBreach)
		}
	}
	return out
}

// Optimization converts a summary's floor, minimum cash and headroom at the
// month they describe. The values searched are plan values and stay.
func (d *Deflator) Optimization(o *Optimization) *Optimization {
	out := *o
	if o.Guardrail == nil || o.Guardrail.Kind != config.GuardrailDebtFree {
		at := d.At(o.MinimumCashMonth)
		out.Floor, out.MinimumCash, out.Headroom = o.Floor/at, o.MinimumCash/at, o.Headroom/at
	}
	if o.Guardrail != nil {
		g := d.Guardrails([]GuardrailResult{*o.Guardrail})[0]
		out.Guardrail = &g
	}
	return &out
}

// Comparison divides each month's difference and keeps the break-even
// months, decided in nominal dollars.
func (d *Deflator) Comparison(c Comparison) Comparison {
	series := func(s SeriesComparison) SeriesComparison {
		return SeriesComparison{Difference: d.series(s.Difference), BreakEven: s.BreakEven}
	}
	return Comparison{Cash: series(c.Cash), Total: series(c.Total)}
}
