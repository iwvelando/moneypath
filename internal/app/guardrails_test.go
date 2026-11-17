package app

import (
	"encoding/json"
	"math"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

const guardrailPlan = `
version: 2
simulation: {startDate: 2025-01, endDate: 2025-04, startingCash: 1000}
recommendations: {emergencyFundMonths: 0}
guardrails:
  - {name: Cushion, kind: cashFloor, amount: 700}
  - {endDate: 2025-03, amount: 0, kind: cashFloor, name: Overdraft}
  - {name: Later, kind: cashFloor, amount: 0, startDate: 2026-01}
common:
  events: [{name: Spending, amount: -200}]
scenarios:
  - name: spends
`

// Spec chapter 02, Results JSON: each scenario's metrics carry its guardrail
// results in the plan's order, with a first breach only on a breach and the
// tightest month and margin unless the guardrail does not apply.
func TestResultsJSONCarriesGuardrails(t *testing.T) {
	// Cash is 1000, 800, 600 and 400.
	got := runPlan(t, guardrailPlan, false)["metrics"].([]any)[0].(map[string]any)["guardrails"]
	var want any
	if err := json.Unmarshal([]byte(`[
		{"name":"Cushion","kind":"cashFloor","result":"breaks","firstBreachDate":"2025-03","tightestDate":"2025-04","margin":-300},
		{"name":"Overdraft","kind":"cashFloor","result":"holds","tightestDate":"2025-03","margin":600},
		{"name":"Later","kind":"cashFloor","result":"doesNotApply"}]`), &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("guardrails =\n %v\nwant\n %v", got, want)
	}
}

// Spec chapter 02, Results JSON: a plan with no guardrails, written or as an
// empty list, has no guardrails field, and its output is otherwise what it
// would be with them.
func TestPlanWithoutGuardrailsIsUnchanged(t *testing.T) {
	without := strings.Replace(guardrailPlan, guardrailPlan[strings.Index(guardrailPlan, "guardrails:"):strings.Index(guardrailPlan, "common:")], "", 1)
	empty := strings.Replace(without, "common:", "guardrails: []\ncommon:", 1)
	for name, doc := range map[string]string{"absent": without, "empty": empty} {
		out := runPlan(t, doc, false)
		if _, ok := out["metrics"].([]any)[0].(map[string]any)["guardrails"]; ok {
			t.Errorf("%s: metrics carry guardrails", name)
		}
		if strings.Contains(out["configYaml"].(string), "guardrails") {
			t.Errorf("%s: the echoed plan carries guardrails", name)
		}
		if out["csv"] != runPlan(t, guardrailPlan, false)["csv"] {
			t.Errorf("%s: the CSV depends on the guardrails", name)
		}
	}
}

// Spec chapter 03, Guardrails, canonical form: guardrails are echoed after
// recommendations and before common, each with its keys in a fixed order.
func TestGuardrailsAreEchoedInCanonicalForm(t *testing.T) {
	echoed := runPlan(t, guardrailPlan, false)["configYaml"].(string)
	keys := regexp.MustCompile(`(?m)^[a-z]+:`).FindAllString(echoed, -1)
	if strings.Join(keys, " ") != "version: simulation: recommendations: guardrails: common: scenarios:" {
		t.Errorf("top-level keys = %v", keys)
	}
	if !strings.Contains(echoed, "    - name: Overdraft\n      kind: cashFloor\n      amount: 0\n      endDate: 2025-03\n") {
		t.Errorf("a guardrail's keys are out of order:\n%s", echoed)
	}
}

// The R04.1 worked example: a $15,000 cash floor on examples/choices.yaml
// holds on "as we are" and "sell", and breaks for "sell and freelance" in the
// months before the sale.
func TestChoicesExampleCashFloor(t *testing.T) {
	f := forecastOf(t, example(t, "choices.yaml"), false)
	type want struct {
		result, breach, tightest string
		margin                   float64
	}
	wants := map[string]want{
		"as we are":          {"holds", "", "2026-01", 5000},
		"sell":               {"holds", "", "2026-01", 5000},
		"sell and freelance": {"breaks", "2027-02", "2027-02", -4545.36},
	}
	for _, sc := range f.Result.Scenarios {
		if len(sc.Guardrails) != 1 {
			t.Fatalf("%s: want one guardrail, got %+v", sc.Name, sc.Guardrails)
		}
		g, w := sc.Guardrails[0], wants[sc.Name]
		breach := ""
		if string(g.Result) == "breaks" {
			breach = g.FirstBreach.String()
		}
		if string(g.Result) != w.result || breach != w.breach || g.Tightest.String() != w.tightest || math.Abs(g.Margin-w.margin) > 0.005 {
			t.Errorf("%s: got %+v, want %+v", sc.Name, g, w)
		}
	}
}

// Spec chapter 02, Results JSON, flip: the flipped path carries its own
// guardrail results, those of the same scenario written by hand.
func TestFlipCarriesTheFlippedPathsGuardrails(t *testing.T) {
	floor := "guardrails:\n  - {name: Cushion, kind: cashFloor, amount: 5100, startDate: 2025-02}\ncommon:"
	f, err := flipOf(t, strings.Replace(flipPlan, "common:", floor, 1), false, Flip{Scenario: "stay", Choice: "Home", Option: "Move"})
	if err != nil {
		t.Fatal(err)
	}
	hand := forecastOf(t, strings.Replace(flipPlanHandBuilt, "common:", floor, 1), false)
	want := hand.Result.Scenarios[1].Guardrails
	if !reflect.DeepEqual(f.Flip.Flipped.Guardrails, want) {
		t.Errorf("flipped guardrails = %+v, want %+v", f.Flip.Flipped.Guardrails, want)
	}
	if reflect.DeepEqual(f.Flip.Flipped.Guardrails, f.Flip.Original.Guardrails) {
		t.Fatalf("the plan does not tell the two paths apart: %+v", want)
	}

	raw, err := ResultsJSON(f, "test")
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Flip struct {
			Guardrails []map[string]any `json:"guardrails"`
		} `json:"flip"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Flip.Guardrails) != 1 || out.Flip.Guardrails[0]["result"] != string(want[0].Result) {
		t.Errorf("flip guardrails in JSON = %v", out.Flip.Guardrails)
	}
}
