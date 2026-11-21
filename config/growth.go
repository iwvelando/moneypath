package config

import (
	"strconv"

	"gopkg.in/yaml.v3"
)

// The words a growth may be written as (spec chapter 03, Growth).
const (
	GrowthFixed     = "fixed"
	GrowthInflation = "inflation"
)

// Growth says how an amount changes over the plan's years: fixed (the zero
// value, and what an absent key reads as), with the plan's inflation rate, or
// at its own yearly rate (spec chapter 03, Growth). Anything else it is
// written as is kept, for Check to refuse at its field.
type Growth struct {
	inflation bool
	// rate is the own yearly rate, in percent; nil for fixed and inflation.
	rate *float64
	// invalid holds the value as written when it is none of the three.
	invalid *yaml.Node
	// applied is the yearly percent the factor uses: the own rate, the
	// plan's inflation rate, or 0. Check sets it.
	applied float64
}

// GrowthRate is a growth at its own yearly rate, in percent.
func GrowthRate(rate float64) Growth { return Growth{rate: &rate} }

// GrowthWithInflation is a growth that follows the plan's inflation rate.
func GrowthWithInflation() Growth { return Growth{inflation: true} }

// Fixed reports whether the amount stays as written: no growth, or the word
// fixed. A rate of 0 is not Fixed, though it grows by nothing.
func (g Growth) Fixed() bool { return !g.inflation && g.rate == nil && g.invalid == nil }

// Inflation reports whether the amount follows the plan's inflation rate.
func (g Growth) Inflation() bool { return g.inflation }

// Rate is the yearly percent the amount grows by, once the plan is checked:
// its own rate, the plan's inflation rate, or 0 when fixed.
func (g Growth) Rate() float64 { return g.applied }

// IsZero lets an absent or fixed growth be left out when the plan is
// written, which is its canonical form.
func (g Growth) IsZero() bool { return g.Fixed() }

// Factor is G(m), what an amount in month m is multiplied by: 1 + the rate,
// raised to the plan year m falls in, counted from start and rounding down
// (spec chapter 04 §2.1). The power is taken by repeated multiplication, so
// every build computes the same bits, and it is exactly 1 for no growth.
func (g Growth) Factor(start, m Month) float64 {
	if g.applied == 0 {
		return 1
	}
	months := int(m - start)
	k := months / 12
	if months%12 < 0 {
		k--
	}
	base := 1 + g.applied/100
	f := 1.0
	for range max(k, -k) {
		f *= base
	}
	if k < 0 {
		return 1 / f
	}
	return f
}

// rateOr0 points at the own rate, or at 0 when there is none.
func (g *Growth) rateOr0() *float64 {
	if g.rate == nil {
		return new(float64)
	}
	return g.rate
}

// resolve sets the yearly percent the factor applies, given the plan's
// inflation rate.
func (g *Growth) resolve(inflationRate float64) {
	switch {
	case g.inflation:
		g.applied = inflationRate
	case g.rate != nil:
		g.applied = *g.rate
	default:
		g.applied = 0
	}
}

func (g *Growth) UnmarshalYAML(n *yaml.Node) error {
	*g = Growth{}
	if n.Kind == yaml.AliasNode && n.Alias != nil {
		n = n.Alias
	}
	if n.Kind == yaml.ScalarNode {
		switch tag := n.ShortTag(); {
		case tag == "!!str" && n.Value == GrowthFixed:
			return nil
		case tag == "!!str" && n.Value == GrowthInflation:
			g.inflation = true
			return nil
		case tag == "!!int" || tag == "!!float":
			if v, err := strconv.ParseFloat(n.Value, 64); err == nil {
				g.rate = &v
				return nil
			}
			var v float64
			if n.Decode(&v) == nil {
				g.rate = &v
				return nil
			}
		}
	}
	keep := *n
	g.invalid = &keep
	return nil
}

func (g Growth) MarshalYAML() (any, error) {
	switch {
	case g.invalid != nil:
		return g.invalid, nil
	case g.inflation:
		return GrowthInflation, nil
	case g.rate != nil:
		return *g.rate, nil
	}
	return nil, nil
}
