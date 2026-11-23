package app

import (
	"encoding/json"
	"reflect"
	"strings"
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
	if value != -225.64 {
		t.Errorf("value = %v, want -225.64", value)
	}
	// The display strings stay, and describe the same numbers.
	if opt["originalDisplay"] != "-$500.00" || opt["valueDisplay"] != "-$225.64" {
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

// Spec chapter 03/04: the cash interest rate reaches results and the echoed
// config the web app sends (a 12% rate is 1% a month).
func TestResultsCarryCashInterest(t *testing.T) {
	out := runPlan(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-02, startingCash: 1200, cashInterestRate: 12}
recommendations: {emergencyFundMonths: 0}
scenarios: [{name: plan}]
`, false)
	rows, ok := out["rows"].([]any)
	if !ok || len(rows) != 2 { // both months are simulated
		t.Fatalf("rows = %v", out["rows"])
	}
	row := rows[0].(map[string]any)
	liquid := row["values"].([]any)[0].(map[string]any)["liquid"].(float64)
	if liquid != 1212 {
		t.Errorf("liquid after the start month = %v, want 1212", liquid)
	}
	yaml, _ := out["configYaml"].(string)
	if !strings.Contains(yaml, "cashInterestRate: 12") {
		t.Errorf("configYaml lost the rate:\n%s", yaml)
	}
}

// Spec chapter 02, results JSON, and chapter 04 §8: every scenario's metrics
// carry its key figures, with the month of lowest cash as a YYYY-MM string.
func TestResultsJSONCarriesKeyFigures(t *testing.T) {
	out := runPlan(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-04, startingCash: 5000}
common:
  investments:
    - {name: Fund, startingValue: 1000, annualReturnRate: 0}
scenarios:
  - name: dips
    events:
      - {name: Repair, amount: -2000, startDate: 2025-02, endDate: 2025-02}
      - {name: Bonus, amount: 2500, startDate: 2025-03, endDate: 2025-03}
  - name: grows
    events:
      - {name: Income, amount: 500}
`, false)
	metrics, _ := out["metrics"].([]any)
	if len(metrics) != 2 {
		t.Fatalf("want 2 scenarios' metrics, got %d", len(metrics))
	}
	want := []map[string]any{
		{"lowestCash": 3000.0, "lowestCashDate": "2025-02", "endingCash": 5500.0, "endingTotal": 6500.0, "endingNetWorth": 6500.0},
		{"lowestCash": 5500.0, "lowestCashDate": "2025-01", "endingCash": 7000.0, "endingTotal": 8000.0, "endingNetWorth": 8000.0},
	}
	for i, m := range metrics {
		got, ok := m.(map[string]any)["keyFigures"].(map[string]any)
		if !ok {
			t.Fatalf("scenario %d has no keyFigures: %v", i, m)
		}
		if len(got) != len(want[i]) {
			t.Errorf("scenario %d keyFigures = %v, want %v", i, got, want[i])
		}
		for k, wv := range want[i] {
			if got[k] != wv {
				t.Errorf("scenario %d keyFigures.%s = %v, want %v", i, k, got[k], wv)
			}
		}
	}
}

// Key figures do not depend on the emergency-fund recommendation: with it
// disabled they are still reported, and no emergency fund is.
func TestResultsJSONKeepsKeyFiguresWithoutAnEmergencyFund(t *testing.T) {
	out := runPlan(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-03, startingCash: 1000}
recommendations: {emergencyFundMonths: 0}
scenarios: [{name: plan}]
`, false)
	m := out["metrics"].([]any)[0].(map[string]any)
	if _, ok := m["keyFigures"].(map[string]any); !ok {
		t.Errorf("keyFigures missing: %v", m)
	}
	if _, ok := m["emergencyFund"]; ok {
		t.Errorf("emergencyFund reported while disabled: %v", m)
	}
}

const crossingPlan = `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-04, startingCash: 1000}
scenarios:
  - name: rent
    events:
      - {name: Savings, amount: 500}
  - name: buy
    events:
      - {name: Savings, amount: 500}
      - {name: Deposit, amount: -1100, startDate: 2025-02, endDate: 2025-02}
      - {name: Rebate, amount: 1100, startDate: 2025-03, endDate: 2025-03}
      - {name: Lodger, amount: 700, startDate: 2025-04, endDate: 2025-04}
  - name: skipped
    active: false
`

// Spec chapter 02, results JSON: comparisons holds every ordered pair of
// scenarios, by index, with the differences aligned to rows and the
// break-even months naming the scenario that moves ahead.
func TestResultsJSONComparesEveryOrderedPair(t *testing.T) {
	out := runPlan(t, crossingPlan, false)
	got, err := json.Marshal(out["comparisons"])
	if err != nil {
		t.Fatal(err)
	}
	want := `[` +
		`{"against":1,"cash":{"breakEven":[{"date":"2025-04","leader":1}],"difference":[0,1100,0,-700]},` +
		`"netWorth":{"breakEven":[{"date":"2025-04","leader":1}],"difference":[0,1100,0,-700]},"scenario":0,` +
		`"total":{"breakEven":[{"date":"2025-04","leader":1}],"difference":[0,1100,0,-700]}},` +
		`{"against":0,"cash":{"breakEven":[{"date":"2025-04","leader":1}],"difference":[0,-1100,0,700]},` +
		`"netWorth":{"breakEven":[{"date":"2025-04","leader":1}],"difference":[0,-1100,0,700]},"scenario":1,` +
		`"total":{"breakEven":[{"date":"2025-04","leader":1}],"difference":[0,-1100,0,700]}}]`
	if string(got) != want {
		t.Errorf("comparisons =\n%s\nwant\n%s", got, want)
	}
}

// Spec chapter 02: with fewer than two scenarios comparisons is an empty
// array, and a lead that never changes hands is an empty breakEven array.
func TestResultsJSONComparisonsAreEmptyArraysNotNull(t *testing.T) {
	one := runPlan(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-03, startingCash: 1000}
scenarios: [{name: plan}]
`, false)
	if got, ok := one["comparisons"].([]any); !ok || len(got) != 0 {
		t.Errorf("comparisons = %v, want an empty array", one["comparisons"])
	}
	two := runPlan(t, `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-03, startingCash: 1000}
scenarios: [{name: a}, {name: b, events: [{name: Pay, amount: 10}]}]
`, false)
	first := two["comparisons"].([]any)[0].(map[string]any)["cash"].(map[string]any)
	if got, ok := first["breakEven"].([]any); !ok || len(got) != 0 {
		t.Errorf("breakEven = %v, want an empty array", first["breakEven"])
	}
}

// A plan in the older finance-forecast format is refused in words that offer
// no conversion: there is none.
func TestRunForecastRefusesAFinanceForecastPlan(t *testing.T) {
	old := "startDate: 2025-06\ncommon:\n  startingValue: 30000\n  deathDate: 2090-01\nscenarios:\n  - name: current path\n    active: true\n"
	_, err := RunForecast(ForecastInput{ConfigYAML: []byte(old)})
	if err == nil {
		t.Fatal("a finance-forecast plan was forecast")
	}
	want := "This file has no version, so it is not a moneypath plan. Plans in the older finance-forecast format are no longer converted."
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err, want)
	}
}

// Spec chapter 02, Problems JSON: every problem of the plan, each with its
// level, path, place in words and sentence; an empty list for a sound plan.
func TestProblemsJSON(t *testing.T) {
	now, err := config.ParseMonth("2025-01")
	if err != nil {
		t.Fatal(err)
	}
	doc := "version: 2\nsimulation: {endDate: 2030-01}\n" +
		"common: {investments: [{name: Brokerage, withdrawalTaxRate: -1, taxRate: 100}]}\nscenarios: [{name: a}]\n"
	var got struct {
		Problems []map[string]string `json:"problems"`
	}
	if err := json.Unmarshal(ProblemsJSON([]byte(doc), now), &got); err != nil {
		t.Fatal(err)
	}
	want := []map[string]string{
		{"level": "warning", "path": "simulation.startingCash", "where": "Simulation",
			"message": "No starting cash is given, so the plan starts with 0.00."},
		{"level": "error", "path": "common.investments.0.taxRate", "where": "Baseline, investment “Brokerage”",
			"message": "The growth tax rate must be at least 0 and less than 100."},
		{"level": "error", "path": "common.investments.0.withdrawalTaxRate", "where": "Baseline, investment “Brokerage”",
			"message": "The withdrawal tax rate must be at least 0 and less than 100."},
	}
	if !reflect.DeepEqual(got.Problems, want) {
		t.Errorf("problems = %v\nwant %v", got.Problems, want)
	}

	sound := "version: 2\nsimulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a}]\n"
	if out := string(ProblemsJSON([]byte(sound), now)); out != `{"problems":[]}` {
		t.Errorf("a sound plan gives %s, want an empty list", out)
	}
	if out := string(ProblemsJSON([]byte("version: [2\n"), now)); !strings.Contains(out, `"level":"error"`) {
		t.Errorf("an unreadable file gives %s, want one error", out)
	}
}
