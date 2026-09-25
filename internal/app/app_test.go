package app

import (
	"encoding/json"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

const optimizerPlan = `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 5000}
recommendations: {emergencyFundMonths: 3}
scenarios:
  - name: plan
    events:
      - {name: Income, amount: 2000}
      - {name: Rent, amount: -1800}
      - name: New expense
        amount: -500
        startDate: 2025-07
        optimize: {field: amount, min: -500, max: 0}
`

func runPlan(t *testing.T, yaml string, optimize bool) map[string]any {
	t.Helper()
	now, err := config.ParseMonth("2025-01")
	if err != nil {
		t.Fatal(err)
	}
	f, err := RunForecast(ForecastInput{ConfigYAML: []byte(yaml), Now: now, Optimize: optimize})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := ResultsJSON(f, "test")
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// Spec chapter 02, results JSON: an optimization carries the raw numbers the
// optimizer searched, not only their display forms — a consumer has to be able
// to write the chosen value back into a config without parsing "$1,234.56".
func TestResultsJSONCarriesRawOptimizerValues(t *testing.T) {
	out := runPlan(t, optimizerPlan, true)
	metrics, _ := out["metrics"].([]any)
	if len(metrics) != 1 {
		t.Fatalf("want 1 scenario's metrics, got %d", len(metrics))
	}
	m, _ := metrics[0].(map[string]any)
	opts, _ := m["optimizations"].([]any)
	if len(opts) != 1 {
		t.Fatalf("want 1 optimization, got %d", len(opts))
	}
	opt, _ := opts[0].(map[string]any)

	original, ok := opt["original"].(float64)
	if !ok {
		t.Fatalf("optimization has no numeric \"original\": %v", opt["original"])
	}
	if original != -500 {
		t.Errorf("original = %v, want -500", original)
	}
	value, ok := opt["value"].(float64)
	if !ok {
		t.Fatalf("optimization has no numeric \"value\": %v", opt["value"])
	}
	if value != -184.72 {
		t.Errorf("value = %v, want -184.72", value)
	}
	// The display strings stay, and describe the same numbers.
	if opt["originalDisplay"] != "-$500.00" || opt["valueDisplay"] != "-$184.72" {
		t.Errorf("displays = %v / %v", opt["originalDisplay"], opt["valueDisplay"])
	}
}

// Date fields report a month index; the display string carries the YYYY-MM form.
func TestResultsJSONDateOptimizerValueIsAMonthIndex(t *testing.T) {
	out := runPlan(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2026-12, startingCash: 4000}
recommendations: {emergencyFundMonths: 3}
scenarios:
  - name: plan
    events:
      - {name: Rent, amount: -1000}
      - name: Income
        amount: 1500
        endDate: 2025-06
        optimize: {field: endDate, minDate: 2025-06, maxDate: 2026-12}
`, true)
	metrics, _ := out["metrics"].([]any)
	m, _ := metrics[0].(map[string]any)
	opts, _ := m["optimizations"].([]any)
	opt, _ := opts[0].(map[string]any)

	value, ok := opt["value"].(float64)
	if !ok {
		t.Fatalf("optimization has no numeric \"value\": %v", opt["value"])
	}
	display, _ := opt["valueDisplay"].(string)
	want, err := config.ParseMonth(display)
	if err != nil {
		t.Fatalf("valueDisplay %q is not a month: %v", display, err)
	}
	if config.Month(int(value)) != want {
		t.Errorf("value %v does not match display %q", value, display)
	}
}
