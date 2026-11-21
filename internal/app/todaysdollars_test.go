package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
)

// A plan with an inflation rate, guardrails of each kind, two scenarios that
// cross, an optimizer target and a choice to flip.
const todaysDollarsPlan = `
version: 2
simulation: {startDate: 2026-01, endDate: 2028-12, startingCash: 25000, inflationRate: 3.0}
recommendations: {emergencyFundMonths: 3}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 24000, growth: inflation}
  - {name: Car gone, kind: debtFree, loans: [Car], startDate: 2028-06}
common:
  events:
    - {name: Salary, amount: 4000}
    - {name: Living, amount: -4000}
choices:
  - name: Car
    options:
      - {name: None}
      - name: Buy
        events: [{name: Car budget, amount: 250}]
        loans:
          - {name: Car, principal: 12000, interestRate: 0, term: 48, startDate: 2026-01}
scenarios:
  - name: steady
    select: {Car: Buy}
  - name: bonus later
    select: {Car: None}
    events:
      - {name: Trip, amount: -3000, startDate: 2026-03, endDate: 2026-03}
      - {name: Bonus, amount: 5000, startDate: 2027-06, endDate: 2027-06}
      - name: Fun
        amount: -10
        optimize: {field: amount, min: -100, max: 0}
`

// amountKeys are the fields chapter 04 §12 converts; everything else in
// today's dollars repeats the nominal results.
var amountKeys = map[string]bool{
	"liquid": true, "total": true, "difference": true, "margin": true, "owed": true,
	"floor": true, "minimumCash": true, "headroom": true,
	"lowestCash": true, "lowestCashDate": true, "endingCash": true, "endingTotal": true,
}

// masked drops every converted field, so what is left must match exactly.
func masked(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, e := range x {
			if !amountKeys[k] {
				out[k] = masked(e)
			}
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = masked(e)
		}
		return out
	}
	return v
}

func resultsOf(t *testing.T, f *Forecast) map[string]any {
	t.Helper()
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

func forecastWith(t *testing.T, doc string, in ForecastInput) *Forecast {
	t.Helper()
	now, err := config.ParseMonth("2026-01")
	if err != nil {
		t.Fatal(err)
	}
	in.ConfigYAML, in.Now = []byte(doc), now
	f, err := RunForecast(in)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// Spec chapter 02: no inflation rate, no today's dollars, and the results are
// exactly what they were.
func TestResultsJSONHasNoTodaysDollarsWithoutARate(t *testing.T) {
	for _, rate := range []string{"", ", inflationRate: 0"} {
		doc := strings.Replace(todaysDollarsPlan, ", inflationRate: 3.0", rate, 1)
		raw, err := ResultsJSON(forecastWith(t, doc, ForecastInput{Optimize: true}), "test")
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "todaysDollars") {
			t.Errorf("rate %q: results mention today's dollars", rate)
		}
	}
}

// Spec chapter 02, todaysDollars, and chapter 04 §12: the same shapes, every
// month, result and note repeated, and the amounts converted at their months.
func TestResultsJSONCarriesTodaysDollars(t *testing.T) {
	f := forecastWith(t, todaysDollarsPlan, ForecastInput{Optimize: true})
	out := resultsOf(t, f)
	today, ok := out["todaysDollars"].(map[string]any)
	if !ok {
		t.Fatalf("no todaysDollars in %v", out)
	}
	if today["today"] != "2026-01" {
		t.Errorf("today = %v, want 2026-01", today["today"])
	}
	for _, k := range []string{"rows", "metrics", "comparisons"} {
		if !reflect.DeepEqual(masked(today[k]), masked(out[k])) {
			t.Errorf("%s: beyond the amounts, today's dollars differ from the nominal", k)
		}
	}
	for _, k := range []string{"flip", "earliest", "version", "csv", "warnings", "configYaml", "scenarios"} {
		if _, ok := today[k]; ok {
			t.Errorf("today's dollars carry %s", k)
		}
	}

	d := f.Result.Deflator()
	at := func(date any) float64 {
		t.Helper()
		m, err := config.ParseMonth(date.(string))
		if err != nil {
			t.Fatal(err)
		}
		return d.At(m)
	}
	rows, todayRows := out["rows"].([]any), today["rows"].([]any)
	for i, r := range rows {
		row, trow := r.(map[string]any), todayRows[i].(map[string]any)
		for s, v := range row["values"].([]any) {
			nv, tv := v.(map[string]any), trow["values"].([]any)[s].(map[string]any)
			for _, k := range []string{"liquid", "total"} {
				if want := nv[k].(float64) / at(row["date"]); tv[k] != want {
					t.Errorf("%s %s scenario %d = %v, want %v", row["date"], k, s, tv[k], want)
				}
			}
		}
	}
	cmps, todayCmps := out["comparisons"].([]any), today["comparisons"].([]any)
	if len(cmps) != 2 {
		t.Fatalf("%d comparisons", len(cmps))
	}
	for i, c := range cmps {
		for _, series := range []string{"cash", "total"} {
			nd := c.(map[string]any)[series].(map[string]any)["difference"].([]any)
			td := todayCmps[i].(map[string]any)[series].(map[string]any)["difference"].([]any)
			for j := range nd {
				if want := nd[j].(float64) / at(rows[j].(map[string]any)["date"]); td[j] != want {
					t.Errorf("comparison %d %s month %d = %v, want %v", i, series, j, td[j], want)
				}
			}
		}
	}
	metrics, todayMetrics := out["metrics"].([]any), today["metrics"].([]any)
	converted := d.Result(f.Result)
	for s, m := range metrics {
		nm, tm := m.(map[string]any), todayMetrics[s].(map[string]any)
		kf := converted.Scenarios[s].KeyFigures
		want := map[string]any{
			"lowestCash": kf.LowestCash, "lowestCashDate": kf.LowestCashDate.String(),
			"endingCash": kf.EndingCash, "endingTotal": kf.EndingTotal,
		}
		if !reflect.DeepEqual(tm["keyFigures"], want) {
			t.Errorf("scenario %d key figures %v, want %v", s, tm["keyFigures"], want)
		}
		for g, ng := range nm["guardrails"].([]any) {
			n, tg := ng.(map[string]any), tm["guardrails"].([]any)[g].(map[string]any)
			if margin, ok := n["margin"].(float64); ok {
				if want := margin / at(n["tightestDate"]); tg["margin"] != want {
					t.Errorf("scenario %d %s margin %v, want %v", s, n["name"], tg["margin"], want)
				}
			}
			if owed, ok := n["owed"].(float64); ok {
				if want := owed / at(n["firstBreachDate"]); tg["owed"] != want {
					t.Errorf("scenario %d %s owed %v, want %v", s, n["name"], tg["owed"], want)
				}
			}
		}
		if !reflect.DeepEqual(tm["emergencyFund"], nm["emergencyFund"]) {
			t.Errorf("scenario %d emergency fund %v, want the nominal %v", s, tm["emergencyFund"], nm["emergencyFund"])
		}
	}
	// The car's debt-free breaks with something owed, so the owed check ran.
	if g := metrics[0].(map[string]any)["guardrails"].([]any)[1].(map[string]any); g["owed"] == nil {
		t.Fatalf("the car's guardrail owes nothing: %v", g)
	}
	opt := todayMetrics[1].(map[string]any)["optimizations"].([]any)[0].(map[string]any)
	o := converted.Scenarios[1].Optimizations[0]
	for k, want := range map[string]float64{"floor": o.Floor, "minimumCash": o.MinimumCash, "headroom": o.Headroom} {
		if opt[k] != want {
			t.Errorf("optimization %s = %v, want %v", k, opt[k], want)
		}
	}
	nominalOpt := metrics[1].(map[string]any)["optimizations"].([]any)[0].(map[string]any)
	if opt["floor"] == nominalOpt["floor"] {
		t.Errorf("the optimizer's floor was not converted: %v", opt["floor"])
	}
}

// Spec chapter 02: a flip and an earliest-month answer are read in today's
// dollars too, with their months as they are.
func TestTodaysDollarsCarryTheFlipAndTheEarliestMonth(t *testing.T) {
	f := forecastWith(t, todaysDollarsPlan, ForecastInput{
		Flip: &Flip{Scenario: "steady", Choice: "Car", Option: "None"},
		Earliest: &Earliest{
			Scenario: "bonus later", Entry: "scenarios.1.events.0", Field: "startDate",
			From: "2026-01", To: "2028-12", Guardrails: []string{"Cushion"},
		},
	})
	out := resultsOf(t, f)
	today := out["todaysDollars"].(map[string]any)
	for _, k := range []string{"flip", "earliest"} {
		if today[k] == nil {
			t.Fatalf("no %s in today's dollars", k)
		}
		if !reflect.DeepEqual(masked(today[k]), masked(out[k])) {
			t.Errorf("%s: beyond the amounts, today's dollars differ from the nominal:\n%v\n%v", k, masked(today[k]), masked(out[k]))
		}
	}
	d := f.Result.Deflator()
	start := f.Result.Start
	flip := today["flip"].(map[string]any)
	cash := flip["cash"].(map[string]any)["difference"].([]any)
	for i, v := range f.Flip.Comparison.Cash.Difference {
		if want := v / d.At(start+config.Month(i)); cash[i] != want {
			t.Errorf("flip cash difference %d = %v, want %v", i, cash[i], want)
		}
	}
	wantGuardrails := d.Guardrails(f.Flip.Flipped.Guardrails)
	gotGuardrails := flip["guardrails"].([]any)
	for i, g := range wantGuardrails {
		if g.Kind == config.GuardrailCashFloor && gotGuardrails[i].(map[string]any)["margin"] != g.Margin {
			t.Errorf("flip guardrail %s margin %v, want %v", g.Name, gotGuardrails[i].(map[string]any)["margin"], g.Margin)
		}
	}
	earliest := today["earliest"].(map[string]any)
	for _, list := range []struct {
		key  string
		want []engine.GuardrailResult
	}{
		{"decidedBy", d.Guardrails(f.Earliest.DecidedBy)},
		{"atEarliest", d.Guardrails(f.Earliest.AtEarliest)},
	} {
		got, _ := earliest[list.key].([]any)
		if len(got) != len(list.want) {
			t.Errorf("%s: %d results, want %d", list.key, len(got), len(list.want))
			continue
		}
		for i, g := range list.want {
			if got[i].(map[string]any)["margin"] != g.Margin {
				t.Errorf("%s %s margin %v, want %v", list.key, g.Name, got[i].(map[string]any)["margin"], g.Margin)
			}
		}
	}
	if len(f.Earliest.AtEarliest) == 0 && len(f.Earliest.DecidedBy) == 0 {
		t.Errorf("the earliest-month answer has no guardrail results to convert")
	}
}
