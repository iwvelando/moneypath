package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
)

// Two decisions and one scenario with a target of its own, so a flip has to
// leave the other selection, the scenario's own entries and the optimizer's
// treatment of them alone.
const flipPlan = `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 5000}
recommendations: {emergencyFundMonths: 3}
common:
  events:
    - {name: Income, amount: 2000}
    - {name: Rent, amount: -1800}
    - {name: Gym, amount: -50}
choices:
  - name: Home
    options:
      - {name: Stay}
      - name: Move
        events:
          - {name: Movers, amount: -1200, startDate: 2025-03, endDate: 2025-03}
        change:
          events:
            - name: Rent
              set: {amount: -1500}
  - name: Gym
    options:
      - {name: Keep}
      - name: Quit
        remove:
          events: [Gym]
scenarios:
  - name: stay
    select: {Home: Stay, Gym: Quit}
    events:
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0}
`

// The scenario a user would write by hand to see the same flip.
const flipPlanHandBuilt = flipPlan + `
  - name: by hand
    select: {Home: Move, Gym: Quit}
    events:
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0}
`

func flipOf(t *testing.T, doc string, optimize bool, flip Flip) (*Forecast, error) {
	t.Helper()
	now, err := config.ParseMonth("2025-01")
	if err != nil {
		t.Fatal(err)
	}
	return RunForecast(ForecastInput{ConfigYAML: []byte(doc), Now: now, Optimize: optimize, Flip: &flip})
}

// Spec chapter 02, Results JSON, flip: the flipped path is simulated like a
// scenario written that way by hand, with and without the optimizer, and the
// rest of the run is what it is without the flip.
func TestFlipMatchesAHandBuiltScenario(t *testing.T) {
	for _, optimize := range []bool{false, true} {
		f, err := flipOf(t, flipPlan, optimize, Flip{Scenario: "stay", Choice: "Home", Option: "Move"})
		if err != nil {
			t.Fatal(err)
		}
		if f.Flip == nil {
			t.Fatalf("optimize=%v: no flip in the forecast", optimize)
		}
		if f.Flip.Name != "stay (Home: Move)" {
			t.Errorf("flipped path name = %q", f.Flip.Name)
		}

		hand := forecastOf(t, flipPlanHandBuilt, optimize)
		want := hand.Result.Compare(hand.Result.Scenarios[1], hand.Result.Scenarios[0])
		if !reflect.DeepEqual(f.Flip.Comparison, want) {
			t.Errorf("optimize=%v: flip differs from the hand-built comparison\n got %+v\nwant %+v", optimize, f.Flip.Comparison, want)
		}
		if len(want.Cash.Difference) == 0 || want.Cash.Difference[len(want.Cash.Difference)-1] == 0 {
			t.Fatalf("optimize=%v: the plan does not exercise the flip", optimize)
		}

		plain := forecastOf(t, flipPlan, optimize)
		if f.CSV != plain.CSV || f.ConfigYAML != plain.ConfigYAML {
			t.Errorf("optimize=%v: the flip changed the forecast output", optimize)
		}
		if len(f.Result.Scenarios) != 1 {
			t.Errorf("optimize=%v: the flipped path was added to the results", optimize)
		}
	}
}

// With the optimizer the flipped path is optimized on its own terms: cheaper
// rent leaves room for more of the target expense.
func TestFlipIsOptimizedAsItsOwnScenario(t *testing.T) {
	f, err := flipOf(t, flipPlan, true, Flip{Scenario: "stay", Choice: "Home", Option: "Move"})
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Flip.Flipped.Optimizations) != 1 || len(f.Flip.Original.Optimizations) != 1 {
		t.Fatalf("each path should report one optimization")
	}
	if !(f.Flip.Flipped.Optimizations[0].Value < f.Flip.Original.Optimizations[0].Value) {
		t.Errorf("the flipped path should afford more: original %v, flipped %v",
			f.Flip.Original.Optimizations[0].Value, f.Flip.Flipped.Optimizations[0].Value)
	}
}

// A flip that names something the plan does not have is the caller's mistake,
// reported with the names that would work.
func TestFlipRefusals(t *testing.T) {
	inactive := flipPlan + `
  - name: parked
    active: false
    select: {Home: Stay, Gym: Keep}
`
	noChoices := `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-06, startingCash: 100}
scenarios:
  - name: only
`
	for _, c := range []struct {
		doc  string
		flip Flip
		want string
	}{
		{flipPlan, Flip{"go", "Home", "Move"}, "“go” is not an active scenario in this plan. The active scenarios are: stay."},
		{inactive, Flip{"parked", "Home", "Move"}, "“parked” is not an active scenario in this plan. The active scenarios are: stay."},
		{noChoices, Flip{"only", "Home", "Move"}, "This plan has no choices, so there is nothing to flip."},
		{flipPlan, Flip{"stay", "House", "Move"}, "This plan has no choice named “House”. Its choices are: Home, Gym."},
		{flipPlan, Flip{"stay", "Home", "Sell"}, "The choice “Home” has no option named “Sell”. Its options are: Stay, Move."},
		{flipPlan, Flip{"stay", "Home", "Stay"}, "The scenario “stay” already takes “Stay” for the choice “Home”. Pick another of its options."},
	} {
		f, err := flipOf(t, c.doc, false, c.flip)
		if err == nil {
			t.Errorf("%+v: no error; flip = %+v", c.flip, f.Flip)
			continue
		}
		if err.Error() != c.want {
			t.Errorf("%+v: error = %q, want %q", c.flip, err, c.want)
		}
	}
}

// A flipped path the plan's rules refuse is reported with the flip that led to
// it.
func TestFlipIntoAnInvalidPathIsRefused(t *testing.T) {
	doc := `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-06, startingCash: 100}
choices:
  - name: Savings
    options:
      - {name: None}
      - name: Fund
        investments:
          - {name: Index fund, startingValue: 100}
scenarios:
  - name: mine
    select: {Savings: None}
    investments:
      - {name: Index fund, startingValue: 50}
`
	_, err := flipOf(t, doc, false, Flip{"mine", "Savings", "Fund"})
	if err == nil {
		t.Fatal("no error")
	}
	for _, want := range []string{"With “Fund” for the choice “Savings”, this path cannot be run.", "“Index fund” names more than one investment"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want it to contain %q", err, want)
		}
	}
}

// The flipped path is validated as the plan is: a guardrail may name an entry
// from any scenario's own entries, so another scenario's investments and loans
// still count, and its guardrail is judged only on the paths that have them.
func TestFlipKeepsNamesFromOtherScenarios(t *testing.T) {
	doc := `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-06, startingCash: 1000}
guardrails:
  - {name: Brokerage lasts, kind: lasts, investments: [Brokerage]}
  - {name: Car paid off, kind: debtFree, startDate: 2025-06, loans: [Car loan]}
choices:
  - name: Car
    options:
      - {name: Keep}
      - name: Buy
        events:
          - {name: Down payment, amount: -500, startDate: 2025-02, endDate: 2025-02}
scenarios:
  - name: keep
    select: {Car: Keep}
  - name: invest
    select: {Car: Keep}
    investments:
      - {name: Brokerage, startingValue: 100}
  - name: borrow
    active: false
    select: {Car: Keep}
    loans:
      - {name: Car loan, principal: 1000, interestRate: 5, term: 12, startDate: 2025-01}
`
	f, err := flipOf(t, doc, false, Flip{Scenario: "keep", Choice: "Car", Option: "Buy"})
	if err != nil {
		t.Fatal(err)
	}
	if f.Flip.Name != "keep (Car: Buy)" || f.Flip.Flipped.Name != "keep (Car: Buy)" {
		t.Errorf("flipped path name = %q, result name = %q", f.Flip.Name, f.Flip.Flipped.Name)
	}
	if len(f.Result.Scenarios) != 2 {
		t.Errorf("the run has %d scenarios, want the plan's 2 active ones", len(f.Result.Scenarios))
	}
	// The flipped path has neither entry, so a lasts does not judge it and a
	// debtFree finds nothing owed.
	want := []engine.GuardrailOutcome{engine.GuardrailDoesNotApply, engine.GuardrailHolds}
	got := make([]engine.GuardrailOutcome, len(f.Flip.Flipped.Guardrails))
	for i, g := range f.Flip.Flipped.Guardrails {
		got[i] = g.Result
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("flipped path guardrails = %v, want %v", got, want)
	}
}

// The flipped path's display name may already belong to a scenario of the
// plan; the flip is still the same path, not a clash of names.
func TestFlipNameMayMatchAnotherScenario(t *testing.T) {
	doc := flipPlan + `
  - name: "stay (Home: Move)"
    active: false
    select: {Home: Stay, Gym: Keep}
`
	f, err := flipOf(t, doc, false, Flip{Scenario: "stay", Choice: "Home", Option: "Move"})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := flipOf(t, flipPlan, false, Flip{Scenario: "stay", Choice: "Home", Option: "Move"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.Flip.Comparison, plain.Flip.Comparison) {
		t.Errorf("the other scenario changed the flip")
	}
}

// Spec chapter 02, Results JSON: flip is absent unless asked for, and
// otherwise carries the flipped path minus the scenario.
func TestResultsJSONCarriesTheFlip(t *testing.T) {
	plain, err := ResultsJSON(forecastOf(t, flipPlan, false), "test")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(plain), `"flip"`) {
		t.Errorf("results without a flip mention one:\n%s", plain)
	}

	f, err := flipOf(t, flipPlan, false, Flip{Scenario: "stay", Choice: "Home", Option: "Move"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := ResultsJSON(f, "test")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Rows []struct{} `json:"rows"`
		Flip *struct {
			Scenario int    `json:"scenario"`
			Choice   string `json:"choice"`
			Option   string `json:"option"`
			Name     string `json:"name"`
			Cash     struct {
				Difference []float64 `json:"difference"`
				BreakEven  []struct {
					Date    string `json:"date"`
					Flipped *bool  `json:"flipped"`
				} `json:"breakEven"`
			} `json:"cash"`
			Total struct {
				Difference []float64       `json:"difference"`
				BreakEven  json.RawMessage `json:"breakEven"`
			} `json:"total"`
		} `json:"flip"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Flip == nil {
		t.Fatalf("no flip in:\n%s", raw)
	}
	if got.Flip.Scenario != 0 || got.Flip.Choice != "Home" || got.Flip.Option != "Move" || got.Flip.Name != "stay (Home: Move)" {
		t.Errorf("flip identifies itself as %+v", got.Flip)
	}
	if len(got.Flip.Cash.Difference) != len(got.Rows) || len(got.Flip.Total.Difference) != len(got.Rows) {
		t.Errorf("differences are not aligned with the %d rows", len(got.Rows))
	}
	if !reflect.DeepEqual(got.Flip.Cash.Difference, f.Flip.Comparison.Cash.Difference) {
		t.Errorf("cash difference = %v", got.Flip.Cash.Difference)
	}
	// Cheaper rent puts the flipped path ahead from January, which overtakes
	// nobody; the movers put it behind in March (300 + 300 + 300 - 1200);
	// cheaper rent draws level in April and overtakes in May.
	be := got.Flip.Cash.BreakEven
	if len(be) != 2 || be[0].Flipped == nil || be[1].Flipped == nil ||
		be[0].Date != "2025-03" || *be[0].Flipped || be[1].Date != "2025-05" || !*be[1].Flipped {
		t.Errorf("cash break-even = %+v, want the scenario ahead in 2025-03 and the flipped path in 2025-05", be)
	}
	if strings.TrimSpace(string(got.Flip.Total.BreakEven)) == "null" {
		t.Errorf("total break-even is null, want an array")
	}
}
