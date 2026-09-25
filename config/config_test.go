package config

import (
	"strings"
	"testing"
)

// Spec chapter 02: dates are YYYY-MM strings stepped with calendar-month
// arithmetic (2025-11 + 3 = 2026-02).
func TestMonthArithmetic(t *testing.T) {
	m, err := ParseMonth("2025-11")
	if err != nil {
		t.Fatal(err)
	}
	if got := (m + 3).String(); got != "2026-02" {
		t.Errorf("2025-11 + 3 = %s, want 2026-02", got)
	}
	if got := m.YearStart().String(); got != "2025-01" {
		t.Errorf("YearStart(2025-11) = %s, want 2025-01", got)
	}
	if !(m + 1).IsDecember() || !(m + 2).IsJanuary() {
		t.Error("December/January detection broken")
	}
	for _, bad := range []string{"2025-13", "2025-00", "2025-1", "202506", "2025-06-01", "junk"} {
		if _, err := ParseMonth(bad); err == nil {
			t.Errorf("ParseMonth(%q) should fail", bad)
		}
	}
}

func mustMonth(t *testing.T, s string) Month {
	t.Helper()
	m, err := ParseMonth(s)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// Spec chapter 04 §2: occurrences at S, S+f, S+2f, … while ≤ E;
// S == E is a one-time event regardless of frequency.
func TestEventOccurrences(t *testing.T) {
	ev := &Event{
		ResolvedStart:     mustMonth(t, "2025-01"),
		ResolvedEnd:       mustMonth(t, "2025-12"),
		ResolvedFrequency: 5,
	}
	want := map[string]bool{"2025-01": true, "2025-06": true, "2025-11": true}
	for m := ev.ResolvedStart - 2; m <= ev.ResolvedEnd+2; m++ {
		if got := ev.OccursAt(m); got != want[m.String()] {
			t.Errorf("OccursAt(%s) = %v, want %v", m, got, want[m.String()])
		}
	}

	// One-time event: S == E, frequency irrelevant.
	one := &Event{
		ResolvedStart:     mustMonth(t, "2025-03"),
		ResolvedEnd:       mustMonth(t, "2025-03"),
		ResolvedFrequency: 7,
	}
	for m := one.ResolvedStart - 1; m <= one.ResolvedStart+1; m++ {
		if got := one.OccursAt(m); got != (m == one.ResolvedStart) {
			t.Errorf("one-time OccursAt(%s) = %v", m, got)
		}
	}
}

// Spec chapter 03 validation: the hard-error list.
func TestValidateHardErrors(t *testing.T) {
	now := mustMonth(t, "2025-01")
	cases := map[string]string{
		"missing version":          "simulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a}]\n",
		"wrong version":            "version: 1\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a}]\n",
		"missing endDate":          "version: 2\nsimulation: {startingCash: 0}\nscenarios: [{name: a}]\n",
		"end before start":         "version: 2\nsimulation: {startDate: 2031-01, endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a}]\n",
		"no scenarios":             "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\n",
		"unnamed scenario":         "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{active: true}]\n",
		"duplicate scenarios":      "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a}, {name: a}]\n",
		"event S after E":          "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a, events: [{amount: 1, startDate: 2029-01, endDate: 2028-01}]}]\n",
		"frequency zero":           "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a, events: [{amount: 1, frequency: 0}]}]\n",
		"optimize on common":       "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\ncommon: {events: [{amount: 1, optimize: {field: amount, min: 0, max: 1}}]}\nscenarios: [{name: a}]\n",
		"mixed withdrawals":        "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a, investments: [{name: i, withdrawals: [{amount: 1}, {percentage: 2}]}]}]\n",
		"amount and pct":           "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a, investments: [{name: i, withdrawals: [{amount: 1, percentage: 2}]}]}]\n",
		"taxRate 100":              "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a, investments: [{name: i, withdrawalTaxRate: 100}]}]\n",
		"downPayment >= principal": "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a, loans: [{name: l, principal: 100, downPayment: 100, interestRate: 1, term: 12, startDate: 2025-01}]}]\n",
	}
	for name, doc := range cases {
		cfg, _, err := Parse([]byte(doc))
		if err == nil {
			_, err = Validate(cfg, now)
		}
		if err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}

// Spec chapter 03: unknown keys and absent startingCash warn but do not fail.
func TestValidateWarnings(t *testing.T) {
	doc := "version: 2\nsimulation: {endDate: 2030-01}\nbogusKey: 1\nscenarios: [{name: a}]\n"
	cfg, parseWarns, err := Parse([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	if len(parseWarns) != 1 || !contains(parseWarns[0], "bogusKey") {
		t.Errorf("want unknown-key warning naming bogusKey, got %v", parseWarns)
	}
	warns, err := Validate(cfg, mustMonth(t, "2025-01"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(warns) != 1 || !contains(warns[0], "startingCash") {
		t.Errorf("want startingCash warning, got %v", warns)
	}
	if cfg.Simulation.ResolvedStartingCash != 0 {
		t.Errorf("absent startingCash must resolve to 0")
	}
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
