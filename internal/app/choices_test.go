package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
)

func forecastOf(t *testing.T, doc string, optimize bool) *Forecast {
	t.Helper()
	now, err := config.ParseMonth("2025-01")
	if err != nil {
		t.Fatal(err)
	}
	f, err := RunForecast(ForecastInput{ConfigYAML: []byte(doc), Now: now, Optimize: optimize})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func example(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "examples", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// Spec chapter 03, Choices: a plain plan rewritten with choices forecasts to
// the same CSV. Every scenario of examples/example.yaml has its body moved
// into an option of one choice and is reduced to a select. An event carrying
// an optimize block stays among the scenario's own events, the only place a
// target can be.
func TestExampleRewrittenWithChoicesGivesTheSameCSV(t *testing.T) {
	plain := example(t, "example.yaml")
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(plain), &doc); err != nil {
		t.Fatal(err)
	}
	var options []any
	scenarios := doc["scenarios"].([]any)
	for i, raw := range scenarios {
		sc := raw.(map[string]any)
		name := sc["name"].(string)
		option := map[string]any{"name": name}
		rewritten := map[string]any{"name": name, "select": map[string]any{"Path": name}}
		if active, ok := sc["active"]; ok {
			rewritten["active"] = active
		}
		var targets, moved []any
		for _, ev := range sc["events"].([]any) {
			if _, ok := ev.(map[string]any)["optimize"]; ok {
				targets = append(targets, ev)
			} else {
				moved = append(moved, ev)
			}
		}
		if len(targets) > 0 {
			rewritten["events"] = targets
		}
		option["events"] = moved
		for _, kind := range []string{"loans", "investments"} {
			if list, ok := sc[kind]; ok {
				option[kind] = list
			}
		}
		options = append(options, option)
		scenarios[i] = rewritten
	}
	if len(options) < 2 {
		t.Fatal("the example should have more than one scenario")
	}
	doc["choices"] = []any{map[string]any{"name": "Path", "options": options}}
	rewrittenYAML, err := yaml.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}

	want := forecastOf(t, plain, false)
	got := forecastOf(t, string(rewrittenYAML), false)
	if len(got.Warnings) != 0 {
		t.Errorf("the rewritten plan warns: %q", got.Warnings)
	}
	if got.CSV != want.CSV {
		t.Errorf("the rewritten plan's CSV differs from the plain plan's")
	}
	if got.Config.Scenarios[0].Select == nil || len(got.Config.Choices) != 1 {
		t.Fatalf("the rewrite did not produce a plan with choices")
	}
}

// The choices example forecasts every path it names.
func TestChoicesExampleForecasts(t *testing.T) {
	f := forecastOf(t, example(t, "choices.yaml"), false)
	if len(f.Warnings) != 0 {
		t.Errorf("unexpected warnings: %q", f.Warnings)
	}
	var names []string
	for _, sc := range f.Result.Scenarios {
		names = append(names, sc.Name)
	}
	if strings.Join(names, "|") != "as we are|sell|sell and freelance" {
		t.Errorf("scenarios = %q", names)
	}
}

const sharedOptionPlan = `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-06, startingCash: 1000}
common:
  events: [{name: Income, amount: 3000}]
choices:
  - name: Home
    options:
      - name: Rent
        events: [{name: Rent, amount: -1500}]
      - name: Buy
        events: [{name: Upkeep, amount: -400}]
  - name: Car
    options:
      - {name: Keep}
      - name: Replace
        events: [{name: Car payment, amount: -300}]
scenarios:
  - {name: rent, select: {Home: Rent, Car: Keep}}
  - {name: rent and replace, select: {Home: Rent, Car: Replace}}
  - {name: buy, select: {Home: Buy, Car: Keep}}
`

// An option is edited once: the edit reaches every scenario that selects it
// and no other.
func TestEditingAnOptionChangesEveryScenarioSelectingIt(t *testing.T) {
	before := forecastOf(t, sharedOptionPlan, false).Result
	after := forecastOf(t, strings.Replace(sharedOptionPlan, "amount: -1500", "amount: -1600", 1), false).Result
	last := len(before.Scenarios[0].Liquid) - 1
	diff := func(i int) float64 {
		return after.Scenarios[i].Liquid[last] - before.Scenarios[i].Liquid[last]
	}
	// Six simulated months at 100 more rent each.
	if diff(0) != -600 || diff(1) != -600 {
		t.Errorf("both renting scenarios should end 600 lower; got %v and %v", diff(0), diff(1))
	}
	if diff(2) != 0 {
		t.Errorf("the buying scenario should not move; got %v", diff(2))
	}
}

const optimizerChoicesPlan = `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 5000}
recommendations: {emergencyFundMonths: 3}
common:
  events:
    - {name: Income, amount: 2000}
    - {name: Rent, amount: -1800}
choices:
  - name: Home
    options:
      - {name: Stay}
      - name: Move
        change:
          events:
            - name: Rent
              set: {amount: -1500}
scenarios:
  - name: stay
    select: {Home: Stay}
    events:
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0}
  - name: move
    select: {Home: Move}
    events:
      - name: New expense
        amount: -100
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0}
`

// Spec chapter 04 §7 with choices: a target in a scenario's own events is
// searched against that scenario's resolved lists and written back to that
// one place; the echoed plan keeps choices and select.
func TestOptimizerWritesBackInAPlanWithChoices(t *testing.T) {
	f := forecastOf(t, optimizerChoicesPlan, true)
	var stay, move float64
	for _, sc := range f.Result.Scenarios {
		if len(sc.Optimizations) != 1 {
			t.Fatalf("scenario %q: %d optimizations, want 1", sc.Name, len(sc.Optimizations))
		}
		if !sc.Optimizations[0].Converged {
			t.Errorf("scenario %q did not converge", sc.Name)
		}
		if sc.Name == "stay" {
			stay = sc.Optimizations[0].Value
		} else {
			move = sc.Optimizations[0].Value
		}
	}
	// Cheaper rent leaves room for a larger expense.
	if !(move < stay) {
		t.Errorf("the moving scenario should afford more: stay %v, move %v", stay, move)
	}

	echoed, _, err := config.Parse([]byte(f.ConfigYAML))
	if err != nil {
		t.Fatal(err)
	}
	if len(echoed.Choices) != 1 || echoed.Choices[0].Options[1].Change == nil {
		t.Errorf("the echoed plan lost its choices:\n%s", f.ConfigYAML)
	}
	for i, want := range []float64{stay, move} {
		sc := echoed.Scenarios[i]
		if len(sc.Select) != 1 || sc.Select[0].Choice != "Home" {
			t.Errorf("scenario %q lost its select:\n%s", sc.Name, f.ConfigYAML)
		}
		if len(sc.Events) != 1 || *sc.Events[0].Amount != want {
			t.Errorf("scenario %q: the chosen value %v was not written to its own event:\n%s", sc.Name, want, f.ConfigYAML)
		}
	}
	// The resolved entries are not written into the scenarios.
	if strings.Count(f.ConfigYAML, "name: Rent") != 2 { // common, and the change naming it
		t.Errorf("the echoed plan should keep the written form:\n%s", f.ConfigYAML)
	}
}
