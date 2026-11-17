package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
)

// earliestPlan has an entry of every origin a question can name: the
// scenario's own one-off, a loan an option adds, a baseline event an option
// changes, and baseline events left alone. Each month a question can move is
// a marker, so a test can write any month there by hand.
const earliestPlan = `
version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 1000}
recommendations: {emergencyFundMonths: 0}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 500}
  - {name: Car gone, kind: debtFree, startDate: 2026-12, loans: [Car]}
  - {name: After the plan, kind: cashFloor, amount: 0, startDate: 2027-06}
  - {name: Brokerage lasts, kind: lasts, investments: [Brokerage]}
common:
  events:
    - {name: Salary, amount: 1000, endDate: SALARY_END}
    - {name: Rent, amount: -800, startDate: RENT_START}
    - {name: Gift, amount: -600, startDate: 2026-03, endDate: 2026-03}
    - {amount: -10}
choices:
  - name: Car
    options:
      - name: No car
        remove:
          events: [Gift]
      - name: Buy
        loans:
          - {name: Car, principal: 3000, downPayment: 500, interestRate: 0, term: 8, startDate: CAR_START}
        change:
          events:
            - name: Rent
              set: {amount: -700, endDate: RENT_END}
scenarios:
  - name: walk
    select: {Car: No car}
    events:
      - {name: Trip, amount: -900, startDate: TRIP, endDate: TRIP}
  - name: drive
    select: {Car: Buy}
  - name: invest
    select: {Car: No car}
    investments:
      - {name: Brokerage, startingValue: 1000}
  - name: parked
    active: false
    select: {Car: No car}
    events:
      - {name: Parked expense, amount: -5, endDate: 2026-02}
`

// The month each marker holds in the plan as written.
var earliestDefaults = map[string]string{
	"SALARY_END": "2026-12",
	"RENT_START": "2026-01",
	"CAR_START":  "2026-04",
	"RENT_END":   "2026-10",
	"TRIP":       "2026-05",
}

// earliestDoc is the plan with marker at month and every other marker at its
// default.
func earliestDoc(marker, month string) string {
	doc := earliestPlan
	if marker != "" {
		doc = strings.ReplaceAll(doc, marker, month)
	}
	for m, v := range earliestDefaults {
		doc = strings.ReplaceAll(doc, m, v)
	}
	return doc
}

func earliestNow(t *testing.T) config.Month {
	t.Helper()
	now, err := config.ParseMonth("2026-01")
	if err != nil {
		t.Fatal(err)
	}
	return now
}

func askEarliest(t *testing.T, doc string, optimize bool, q Earliest) (*Forecast, error) {
	t.Helper()
	return RunForecast(ForecastInput{ConfigYAML: []byte(doc), Now: earliestNow(t), Optimize: optimize, Earliest: &q})
}

// handPlaced runs the plan with marker written as month by hand and returns
// the named scenario's results for the named guardrails, in the plan's order.
func handPlaced(t *testing.T, marker, month, scenario string, chosen []string) []engine.GuardrailResult {
	t.Helper()
	f, err := RunForecast(ForecastInput{ConfigYAML: []byte(earliestDoc(marker, month)), Now: earliestNow(t)})
	if err != nil {
		t.Fatalf("%s at %s: %v", marker, month, err)
	}
	var out []engine.GuardrailResult
	for _, sc := range f.Result.Scenarios {
		if sc.Name != scenario {
			continue
		}
		for _, r := range sc.Guardrails {
			for _, c := range chosen {
				if r.Name == c {
					out = append(out, r)
				}
			}
		}
	}
	return out
}

func spansOf(months []config.Month, works []bool) []MonthSpan {
	var out []MonthSpan
	for i, ok := range works {
		if !ok {
			continue
		}
		if n := len(out); n > 0 && out[n-1].To == months[i]-1 {
			out[n-1].To = months[i]
		} else {
			out = append(out, MonthSpan{From: months[i], To: months[i]})
		}
	}
	return out
}

// Spec chapter 04 §11: the answer for each month is what the plan gives with
// that month written into the entry by hand, for an entry of every origin,
// and the deciding guardrails are those that break a month before the answer.
func TestEarliestMatchesHandPlacedMonths(t *testing.T) {
	both := []string{"Cushion", "Car gone"}
	for _, c := range []struct {
		name, scenario, entry, field, marker string
		guardrails                           []string
		// to is the range's last month, 2026-12 when empty.
		to string
	}{
		{"own one-off, by its start", "walk", "scenarios.0.events.0", "startDate", "TRIP", []string{"Cushion"}, ""},
		{"own one-off, by its end", "walk", "scenarios.0.events.0", "endDate", "TRIP", []string{"Cushion"}, ""},
		{"loan an option adds", "drive", "choices.0.options.1.loans.0", "startDate", "CAR_START", both, ""},
		{"baseline event an option changes", "drive", "common.events.1", "endDate", "RENT_END", both, ""},
		{"baseline event left alone, by its end", "drive", "common.events.0", "endDate", "SALARY_END", both, ""},
		// Past 2026-10 the drive path's change would end Rent before it
		// starts, so the plan as a whole cannot be written that way by hand.
		{"baseline event left alone, by its start", "walk", "common.events.1", "startDate", "RENT_START", []string{"Cushion"}, "2026-10"},
	} {
		t.Run(c.name, func(t *testing.T) {
			to := c.to
			if to == "" {
				to = "2026-12"
			}
			last, _ := config.ParseMonth(to)
			f, err := askEarliest(t, earliestDoc("", ""), false, Earliest{
				Scenario: c.scenario, Entry: c.entry, Field: c.field,
				From: "2026-01", To: to, Guardrails: c.guardrails,
			})
			if err != nil {
				t.Fatal(err)
			}
			got := f.Earliest
			if got == nil {
				t.Fatal("no answer")
			}
			if want, _ := config.ParseMonth(earliestDefaults[c.marker]); got.Configured != want {
				t.Errorf("configured %s, want %s", got.Configured, want)
			}

			var months []config.Month
			var works []bool
			holds := make([][]bool, len(c.guardrails))
			per := map[config.Month][]engine.GuardrailResult{}
			for m := config.Month(2026 * 12); m <= last; m++ {
				rs := handPlaced(t, c.marker, m.String(), c.scenario, c.guardrails)
				per[m] = rs
				all := true
				for i, r := range rs {
					ok := r.Result == engine.GuardrailHolds
					holds[i] = append(holds[i], ok)
					all = all && ok
				}
				months = append(months, m)
				works = append(works, all)
			}
			wantWorks := spansOf(months, works)
			if !reflect.DeepEqual(got.Works, wantWorks) {
				t.Errorf("works %v, want %v", got.Works, wantWorks)
			}
			for i, name := range c.guardrails {
				if got.Holds[i].Name != name || !reflect.DeepEqual(got.Holds[i].Months, spansOf(months, holds[i])) {
					t.Errorf("holds[%d] %+v, want %s in %v", i, got.Holds[i], name, spansOf(months, holds[i]))
				}
			}
			if len(wantWorks) == 0 {
				t.Fatalf("the case has no working month, so it checks nothing about the answer")
			}
			first := wantWorks[0].From
			if !got.Found || got.Month != first {
				t.Fatalf("month %s (found %v), want %s", got.Month, got.Found, first)
			}
			if !reflect.DeepEqual(got.AtEarliest, per[first]) {
				t.Errorf("atEarliest %+v, want %+v", got.AtEarliest, per[first])
			}
			var decided []engine.GuardrailResult
			if first > months[0] {
				for _, r := range per[first-1] {
					if r.Result == engine.GuardrailBreaks {
						decided = append(decided, r)
					}
				}
			}
			if !reflect.DeepEqual(got.DecidedBy, decided) {
				t.Errorf("decidedBy %+v, want %+v", got.DecidedBy, decided)
			}
		})
	}
}

// The cases above must each answer something other than the range's first
// month for at least one of them, or decidedBy goes untested.
func TestEarliestCasesExerciseADecidingGuardrail(t *testing.T) {
	f, err := askEarliest(t, earliestDoc("", ""), false, Earliest{
		Scenario: "walk", Entry: "scenarios.0.events.0", Field: "startDate",
		From: "2026-01", To: "2026-12", Guardrails: []string{"Cushion"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Earliest.DecidedBy) == 0 {
		t.Fatalf("the trip works in the range's first month; tune the plan so it does not")
	}
}

// Spec chapter 04 §11: the question is asked of one path only. The reported
// forecast, and every other scenario, is what the run gives without it.
func TestEarliestLeavesTheRunAlone(t *testing.T) {
	doc := earliestDoc("", "")
	plain := forecastOf(t, doc, false)
	f, err := askEarliest(t, doc, false, Earliest{
		Scenario: "drive", Entry: "common.events.0", Field: "endDate",
		From: "2026-01", To: "2026-12", Guardrails: []string{"Cushion"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if f.CSV != plain.CSV || f.ConfigYAML != plain.ConfigYAML {
		t.Errorf("asking the question changed the run")
	}
	a, _ := ResultsJSON(plain, "test")
	var withQ map[string]json.RawMessage
	b, _ := ResultsJSON(f, "test")
	if err := json.Unmarshal(b, &withQ); err != nil {
		t.Fatal(err)
	}
	if _, ok := withQ["earliest"]; !ok {
		t.Fatalf("no earliest in:\n%s", b)
	}
	delete(withQ, "earliest")
	var without map[string]json.RawMessage
	if err := json.Unmarshal(a, &without); err != nil {
		t.Fatal(err)
	}
	if _, ok := without["earliest"]; ok {
		t.Errorf("a run that did not ask has an earliest")
	}
	if !reflect.DeepEqual(without, withQ) {
		t.Errorf("results beside the answer differ from the run without it")
	}
}

// Spec chapter 04 §11: candidates use the plan as run. With the optimizer, its
// chosen values stay in place and no candidate is optimized again.
func TestEarliestUsesThePlanAsRun(t *testing.T) {
	const doc = `
version: 2
simulation: {startDate: 2026-01, endDate: 2026-12, startingCash: 1000}
recommendations: {emergencyFundMonths: 0}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 500}
scenarios:
  - name: only
    events:
      - {name: Salary, amount: 1000}
      - name: Spending
        amount: -1000
        optimize: {field: amount, min: -1000, max: 0, guardrail: Cushion}
      - {name: Roof, amount: -2000, startDate: 2026-04, endDate: 2026-04}
`
	q := Earliest{Scenario: "only", Entry: "scenarios.0.events.2", Field: "startDate",
		From: "2026-01", To: "2026-12", Guardrails: []string{"Cushion"}}
	optimized, err := askEarliest(t, doc, true, q)
	if err != nil {
		t.Fatal(err)
	}
	// The same question of the adjusted plan, without the optimizer.
	asRun, err := askEarliest(t, optimized.ConfigYAML, false, q)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(optimized.Earliest, asRun.Earliest) {
		t.Errorf("with the optimizer %+v\nwithout, on the plan as run %+v", optimized.Earliest, asRun.Earliest)
	}
	// Held to the cushion, spending is $625 a month, so the roof fits from
	// the month cash reaches $2,500 after it: 1000 + 375k − 2000 ≥ 500 from
	// k = 4. Re-optimizing each candidate would fit it from 2026-02.
	if e := optimized.Earliest; !e.Found || e.Month != config.Month(2026*12+3) {
		t.Errorf("earliest %s (found %v), want 2026-04", e.Month, e.Found)
	}
	// And the plan as written answers differently from the plan as run.
	written, err := askEarliest(t, doc, false, q)
	if err != nil {
		t.Fatal(err)
	}
	if reflect.DeepEqual(written.Earliest.Holds, optimized.Earliest.Holds) {
		t.Errorf("the optimizer's chosen value made no difference, so this checks nothing")
	}
}

// Spec chapter 02, WASM bridge: a question that cannot be asked is refused
// with no results, in words that name no path.
func TestEarliestRefusals(t *testing.T) {
	doc := earliestDoc("", "")
	ok := Earliest{Scenario: "walk", Entry: "scenarios.0.events.0", Field: "startDate",
		From: "2026-01", To: "2026-12", Guardrails: []string{"Cushion"}}
	for _, c := range []struct {
		name string
		edit func(q *Earliest)
		want string
	}{
		{"inactive scenario", func(q *Earliest) { q.Scenario = "parked" }, "“parked” is not an active scenario in this plan."},
		{"unknown scenario", func(q *Earliest) { q.Scenario = "nobody" }, "“nobody” is not an active scenario in this plan."},
		{"no such entry", func(q *Earliest) { q.Entry = "common.events.9" }, "This plan has no event or loan there to move."},
		{"not an entry path", func(q *Earliest) { q.Entry = "simulation.endDate" }, "This plan has no event or loan there to move."},
		{"an investment", func(q *Earliest) { q.Entry = "scenarios.2.investments.0" }, "This plan has no event or loan there to move."},
		{"another scenario's entry", func(q *Earliest) { q.Scenario = "drive" }, "Scenario “walk”, event “Trip”: The scenario “drive” does not have this, so moving it changes nothing there."},
		{"an option not selected", func(q *Earliest) { q.Entry, q.Field = "choices.0.options.1.loans.0", "startDate" }, "Choice “Car”, option “Buy”, loan “Car”: The scenario “walk” does not have this, so moving it changes nothing there."},
		{"a removed baseline entry", func(q *Earliest) { q.Entry = "common.events.2" }, "Baseline, event “Gift”: The scenario “walk” does not have this, so moving it changes nothing there."},
		{"an event's frequency", func(q *Earliest) { q.Field = "frequency" }, "Only an event’s start or end month can be moved."},
		{"a loan's end", func(q *Earliest) { q.Scenario, q.Entry, q.Field = "drive", "choices.0.options.1.loans.0", "endDate" }, "Only a loan’s first payment month can be moved."},
		{"a month that does not parse", func(q *Earliest) { q.From = "2026-13" }, "The first month of the range, “2026-13”, is not a month. Write the year and the month, like 2030-01."},
		{"a last month that does not parse", func(q *Earliest) { q.To = "" }, "The last month of the range, “”, is not a month. Write the year and the month, like 2030-01."},
		{"from after to", func(q *Earliest) { q.From, q.To = "2026-06", "2026-05" }, "The range starts in 2026-06, after it ends in 2026-05."},
		{"before the plan", func(q *Earliest) { q.From = "2025-12" }, "The range must lie inside the plan, from 2026-01 to 2026-12."},
		{"after the plan", func(q *Earliest) { q.To = "2027-01" }, "The range must lie inside the plan, from 2026-01 to 2026-12."},
		{"no guardrails", func(q *Earliest) { q.Guardrails = nil }, "Choose at least one guardrail that must hold."},
		{"unknown guardrail", func(q *Earliest) { q.Guardrails = []string{"Cushion", "Nope"} }, "No guardrail in the plan is named “Nope”."},
		{"a guardrail twice", func(q *Earliest) { q.Guardrails = []string{"Cushion", "Cushion"} }, "The guardrail “Cushion” is chosen more than once."},
		{"a guardrail with no month in the plan", func(q *Earliest) { q.Guardrails = []string{"After the plan"} }, "Guardrail “After the plan” checks no month inside the plan, so it cannot hold in any month."},
		{"a lasts on investments the path lacks", func(q *Earliest) { q.Guardrails = []string{"Brokerage lasts"} }, "Guardrail “Brokerage lasts” checks investments the scenario “walk” does not have, so it cannot hold in any month."},
		{"a start after the end", func(q *Earliest) {
			q.Scenario, q.Entry, q.Field, q.From = "drive", "common.events.1", "startDate", "2026-03"
		}, "Baseline, event “Rent”: With its start in 2026-11, it would start after it ends (2026-10). Choose a range that ends by 2026-10."},
		{"an end before the start", func(q *Earliest) {
			q.Scenario, q.Entry, q.Field, q.From, q.To = "walk", "common.events.1", "endDate", "2026-01", "2026-06"
		}, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			q := ok
			q.Guardrails = append([]string(nil), ok.Guardrails...)
			c.edit(&q)
			f, err := askEarliest(t, doc, false, q)
			if c.want == "" {
				// Rent starts in the plan's first month, so no end in the range
				// is before it.
				if err != nil {
					t.Fatalf("refused: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("answered %+v, want refusal %q", f.Earliest, c.want)
			}
			if !strings.HasPrefix(err.Error(), c.want) {
				t.Errorf("refusal\n %q\nwant it to start\n %q", err.Error(), c.want)
			}
			for _, internal := range []string{"common.", "scenarios.", "choices.", "startDate", "endDate"} {
				if strings.Contains(err.Error(), internal) {
					t.Errorf("refusal names %q: %s", internal, err)
				}
			}
		})
	}
}

// Spec chapter 04 §11: only the path asked about is moved. A baseline entry
// moved where another scenario's option would make that scenario invalid is
// still answered, since that scenario is not simulated.
func TestEarliestIgnoresOtherPaths(t *testing.T) {
	f, err := askEarliest(t, earliestDoc("", ""), false, Earliest{
		Scenario: "walk", Entry: "common.events.1", Field: "startDate",
		From: "2026-01", To: "2026-12", Guardrails: []string{"Cushion"},
	})
	if err != nil {
		t.Fatalf("refused: %v", err)
	}
	if w := f.Earliest.Works; len(w) == 0 || w[len(w)-1].To != config.Month(2026*12+11) {
		t.Errorf("works %v, want it to reach 2026-12", w)
	}
}

// An end moved before a start the plan gives later is refused too.
func TestEarliestRefusesAnEndBeforeTheStart(t *testing.T) {
	_, err := askEarliest(t, earliestDoc("RENT_START", "2026-04"), false, Earliest{
		Scenario: "walk", Entry: "common.events.1", Field: "endDate",
		From: "2026-02", To: "2026-12", Guardrails: []string{"Cushion"},
	})
	want := "Baseline, event “Rent”: With its end in 2026-02, it would end before it starts (2026-04). Choose a range that starts in 2026-04 or later."
	if err == nil || err.Error() != want {
		t.Errorf("got %v, want %q", err, want)
	}
}

// An unnamed entry can be asked about, and its answer carries no name.
func TestEarliestTimesAnUnnamedEntry(t *testing.T) {
	f, err := askEarliest(t, earliestDoc("", ""), false, Earliest{
		Scenario: "walk", Entry: "common.events.3", Field: "startDate",
		From: "2026-01", To: "2026-02", Guardrails: []string{"Cushion"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if f.Earliest.Name != "" {
		t.Errorf("name %q, want none", f.Earliest.Name)
	}
}

// Spec chapter 02, Results JSON: earliest is absent unless asked; when no
// month works, month, decidedBy and atEarliest are absent and works is empty.
func TestResultsJSONCarriesTheEarliestMonth(t *testing.T) {
	type span struct{ From, To string }
	type answer struct {
		Scenario   int               `json:"scenario"`
		Entry      string            `json:"entry"`
		Name       string            `json:"name"`
		Field      string            `json:"field"`
		From       string            `json:"from"`
		To         string            `json:"to"`
		Guardrails []string          `json:"guardrails"`
		Configured string            `json:"configured"`
		Month      *string           `json:"month"`
		Works      []span            `json:"works"`
		Holds      []json.RawMessage `json:"holds"`
		DecidedBy  []json.RawMessage `json:"decidedBy"`
		AtEarliest []json.RawMessage `json:"atEarliest"`
	}
	read := func(q Earliest) (answer, map[string]json.RawMessage) {
		f, err := askEarliest(t, earliestDoc("", ""), false, q)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := ResultsJSON(f, "test")
		if err != nil {
			t.Fatal(err)
		}
		var top map[string]json.RawMessage
		if err := json.Unmarshal(raw, &top); err != nil {
			t.Fatal(err)
		}
		var a answer
		if err := json.Unmarshal(top["earliest"], &a); err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(top["earliest"], &fields)
		return a, fields
	}

	a, _ := read(Earliest{Scenario: "drive", Entry: "choices.0.options.1.loans.0", Field: "startDate",
		From: "2026-01", To: "2026-12", Guardrails: []string{"Car gone", "Cushion"}})
	if a.Scenario != 1 || a.Entry != "choices.0.options.1.loans.0" || a.Name != "Car" || a.Field != "startDate" ||
		a.From != "2026-01" || a.To != "2026-12" || a.Configured != "2026-04" {
		t.Errorf("answer identifies itself as %+v", a)
	}
	if !reflect.DeepEqual(a.Guardrails, []string{"Cushion", "Car gone"}) {
		t.Errorf("guardrails %v, want the plan's order", a.Guardrails)
	}
	if a.Month == nil || len(a.Works) == 0 || len(a.Holds) != 2 || len(a.AtEarliest) != 2 {
		t.Errorf("answer %+v", a)
	}
	var h struct {
		Name   string `json:"name"`
		Months []span `json:"months"`
	}
	if err := json.Unmarshal(a.Holds[0], &h); err != nil || h.Name != "Cushion" || h.Months == nil {
		t.Errorf("holds[0] %s", a.Holds[0])
	}

	// A month no placement of the trip can rescue: the roof month itself breaks.
	none, fields := read(Earliest{Scenario: "walk", Entry: "scenarios.0.events.0", Field: "startDate",
		From: "2026-01", To: "2026-01", Guardrails: []string{"Cushion"}})
	if none.Month != nil {
		t.Fatalf("expected no month to work, got %s", *none.Month)
	}
	for _, k := range []string{"month", "decidedBy", "atEarliest"} {
		if _, ok := fields[k]; ok {
			t.Errorf("%s present when no month works", k)
		}
	}
	if string(fields["works"]) != "[]" {
		t.Errorf("works is %s, want []", fields["works"])
	}
	if err := json.Unmarshal(none.Holds[0], &h); err != nil || string(mustRaw(t, none.Holds[0], "months")) != "[]" {
		t.Errorf("holds[0] %s, want empty months", none.Holds[0])
	}
}

func mustRaw(t *testing.T, raw json.RawMessage, key string) json.RawMessage {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m[key]
}

// A flip and an earliest asked together are each answered as if asked alone.
func TestEarliestBesideAFlip(t *testing.T) {
	// Without the lasts on another scenario's brokerage, which a flip
	// cannot yet validate (#87).
	doc := strings.Replace(earliestDoc("", ""), "  - {name: Brokerage lasts, kind: lasts, investments: [Brokerage]}\n", "", 1)
	q := Earliest{Scenario: "drive", Entry: "common.events.0", Field: "endDate",
		From: "2026-01", To: "2026-12", Guardrails: []string{"Cushion"}}
	alone, err := askEarliest(t, doc, false, q)
	if err != nil {
		t.Fatal(err)
	}
	flip := Flip{Scenario: "walk", Choice: "Car", Option: "Buy"}
	flipped, err := flipOf(t, doc, false, flip)
	if err != nil {
		t.Fatal(err)
	}
	both, err := RunForecast(ForecastInput{ConfigYAML: []byte(doc), Now: earliestNow(t), Flip: &flip, Earliest: &q})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(both.Earliest, alone.Earliest) {
		t.Errorf("earliest beside a flip %+v, alone %+v", both.Earliest, alone.Earliest)
	}
	if !reflect.DeepEqual(both.Flip.Comparison, flipped.Flip.Comparison) {
		t.Errorf("the flip changed beside an earliest")
	}
}
