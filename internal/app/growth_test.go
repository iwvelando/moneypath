package app

import (
	"math"
	"strings"
	"testing"
)

// growthPlan saves 300 a month toward a purchase of 5,000 in the start
// month's prices, which grows as written. A choice adds the purchase, so a
// flip can take it.
const growthPlan = `
version: 2
simulation: {startDate: 2026-01, endDate: 2029-12, startingCash: 0, inflationRate: 20}
guardrails:
  - {name: Never overdrawn, kind: cashFloor, amount: 0}
common:
  events:
    - {name: Savings, amount: 300}
    - {name: Purchase, amount: -5000, startDate: 2026-01, endDate: 2026-01GROWTH}
choices:
  - name: Car
    options:
      - name: None
      - name: Buy
        events:
          - {name: Car, amount: -1000, startDate: 2028-03, endDate: 2028-03GROWTH}
scenarios:
  - {name: save, select: {Car: None}}
`

func growthDoc(growth string) string { return strings.ReplaceAll(growthPlan, "GROWTH", growth) }

// Spec chapter 04 §11 with §2.1: growth counts from the plan's start, so a
// purchase moved later costs more, and the earliest month it can take
// follows. At 300 a month, 5,000 fixed can be paid in 2027-05; growing 20 %
// a year it costs 6,000 in 2027 and is first affordable in 2027-08.
func TestEarliestFollowsGrowth(t *testing.T) {
	q := Earliest{Scenario: "save", Entry: "common.events.1", Field: "startDate", From: "2026-01", To: "2029-12", Guardrails: []string{"Never overdrawn"}}
	for _, c := range []struct{ growth, want string }{
		{"", "2027-05"},
		{", growth: inflation", "2027-08"},
	} {
		f, err := askEarliest(t, growthDoc(c.growth), false, q)
		if err != nil {
			t.Fatal(err)
		}
		if got := f.Earliest; got == nil || !got.Found || got.Month.String() != c.want {
			t.Errorf("growth %q: got %+v, want %s", c.growth, got, c.want)
		}
	}
}

// Spec chapter 04 §2.1: a flipped path grows its amounts as any path does.
func TestFlipFollowsGrowth(t *testing.T) {
	f, err := flipOf(t, growthDoc(", growth: inflation"), false, Flip{Scenario: "save", Choice: "Car", Option: "Buy"})
	if err != nil {
		t.Fatal(err)
	}
	// The car is bought in 2028-03, in the plan's third year.
	i := 2*12 + 2
	if got, want := f.Flip.Comparison.Cash.Difference[i], -1000*1.2*1.2; math.Abs(got-want) > 1e-9 {
		t.Errorf("the car costs %.4f on the flipped path, want %.4f", got, want)
	}
}
