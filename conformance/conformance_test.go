// Package conformance wires testdata/conformance into go test, per spec
// chapter 08: every normative case must reproduce expected.csv under the
// manifest rules (numeric cells within tolerance; dates, headers, and note
// strings exact) and match expectedMetrics within 0.01.
package conformance_test

import (
	"encoding/csv"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/internal/app"
	"github.com/iwvelando/moneypath/render"
)

type manifest struct {
	Description     string           `yaml:"description"`
	Normative       bool             `yaml:"normative"`
	Optimize        bool             `yaml:"optimize"`
	Tolerance       float64          `yaml:"tolerance"`
	ExpectedMetrics []scenarioMetric `yaml:"expectedMetrics"`
	// ExpectedComparisons pins ordered pairs of scenarios (spec chapter 04 §9).
	ExpectedComparisons []pairComparison `yaml:"expectedComparisons"`
	// Earliest asks earliest-month questions of the plan (spec chapter 04 §11).
	Earliest []earliestCase `yaml:"earliest"`
}

// earliestCase is one earliest-month question and its whole answer.
type earliestCase struct {
	Ask struct {
		Scenario   string   `yaml:"scenario"`
		Entry      string   `yaml:"entry"`
		Field      string   `yaml:"field"`
		From       string   `yaml:"from"`
		To         string   `yaml:"to"`
		Guardrails []string `yaml:"guardrails"`
	} `yaml:"ask"`
	Configured string            `yaml:"configured"`
	Month      string            `yaml:"month"`
	Works      []monthSpan       `yaml:"works"`
	Holds      []guardrailMonths `yaml:"holds"`
	DecidedBy  []guardrailMetric `yaml:"decidedBy"`
	AtEarliest []guardrailMetric `yaml:"atEarliest"`
}

type monthSpan struct {
	From string `yaml:"from"`
	To   string `yaml:"to"`
}

type guardrailMonths struct {
	Name   string      `yaml:"name"`
	Months []monthSpan `yaml:"months"`
}

type pairComparison struct {
	Scenario string            `yaml:"scenario"`
	Against  string            `yaml:"against"`
	Cash     *seriesComparison `yaml:"cash"`
	Total    *seriesComparison `yaml:"total"`
}

type seriesComparison struct {
	BreakEven        []breakEvenMonth `yaml:"breakEven"`
	EndingDifference float64          `yaml:"endingDifference"`
}

type breakEvenMonth struct {
	Date   string `yaml:"date"`
	Leader string `yaml:"leader"`
}

type scenarioMetric struct {
	Scenario      string             `yaml:"scenario"`
	KeyFigures    *keyFigureMetric   `yaml:"keyFigures"`
	EmergencyFund map[string]float64 `yaml:"emergencyFund"`
	Optimizations []optMetric        `yaml:"optimizations"`
	// Guardrails, when given, is the scenario's complete list of guardrail
	// results (spec chapter 04 §10).
	Guardrails []guardrailMetric `yaml:"guardrails"`
	// TodaysDollars pins the scenario read in today's dollars (spec chapter 04
	// §12), by the same rules.
	TodaysDollars *scenarioMetric `yaml:"todaysDollars"`
}

type guardrailMetric struct {
	Name            string  `yaml:"name"`
	Kind            string  `yaml:"kind"`
	Result          string  `yaml:"result"`
	FirstBreachDate string  `yaml:"firstBreachDate"`
	TightestDate    string  `yaml:"tightestDate"`
	Margin          float64 `yaml:"margin"`
	// MarginMonths and Owed are a debtFree's: the months to spare at its
	// cleared month, and what is owed at its first breach.
	MarginMonths int     `yaml:"marginMonths"`
	Owed         float64 `yaml:"owed"`
}

type keyFigureMetric struct {
	LowestCash     float64 `yaml:"lowestCash"`
	LowestCashDate string  `yaml:"lowestCashDate"`
	EndingCash     float64 `yaml:"endingCash"`
	EndingTotal    float64 `yaml:"endingTotal"`
}

type optMetric struct {
	TargetName      string  `yaml:"targetName"`
	Field           string  `yaml:"field"`
	Original        float64 `yaml:"original"`
	Value           float64 `yaml:"value"`
	OriginalDisplay string  `yaml:"originalDisplay"`
	ValueDisplay    string  `yaml:"valueDisplay"`
	Floor           float64 `yaml:"floor"`
	MinimumCash     float64 `yaml:"minimumCash"`
	Headroom        float64 `yaml:"headroom"`
	// Guardrail is the result of the guardrail a target is held to, on the
	// reported value's forecast; absent for a target held to the emergency
	// fund.
	Guardrail  *guardrailMetric `yaml:"guardrail"`
	Iterations int              `yaml:"iterations"`
	Converged  bool             `yaml:"converged"`
}

// arbitraryNow: every conformance config pins simulation.startDate, so the
// caller-supplied current month must never influence results.
const arbitraryNow = "2000-01"

func TestConformance(t *testing.T) {
	root := filepath.Join("..", "testdata", "conformance")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("reading %s: %v", root, err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		t.Run(e.Name(), func(t *testing.T) {
			runCase(t, filepath.Join(root, e.Name()))
		})
	}
}

func runCase(t *testing.T, dir string) {
	var mf manifest
	mdata, err := os.ReadFile(filepath.Join(dir, "manifest.yaml"))
	if err != nil {
		t.Fatalf("manifest: %v", err)
	}
	if err := yaml.Unmarshal(mdata, &mf); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	if !mf.Normative {
		t.Skip("informative case")
	}

	cdata, err := os.ReadFile(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	cfg, _, err := config.Parse(cdata)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	now, _ := config.ParseMonth(arbitraryNow)
	if _, err := config.Validate(cfg, now); err != nil {
		t.Fatalf("validate: %v", err)
	}
	res, err := engine.Run(cfg, engine.Options{Optimize: mf.Optimize})
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	got := render.CSV(res)
	wantBytes, err := os.ReadFile(filepath.Join(dir, "expected.csv"))
	if err != nil {
		t.Fatalf("expected.csv: %v", err)
	}
	compareCSV(t, string(wantBytes), got, mf.Tolerance)
	compareMetrics(t, mf.ExpectedMetrics, res)
	today := res.Deflator().Result(res)
	for _, wm := range mf.ExpectedMetrics {
		if wm.TodaysDollars == nil {
			continue
		}
		if today == nil {
			t.Errorf("scenario %q: today's dollars pinned, but the plan has no inflation rate", wm.Scenario)
			continue
		}
		in := *wm.TodaysDollars
		in.Scenario = wm.Scenario
		t.Run("todaysDollars", func(t *testing.T) { compareMetrics(t, []scenarioMetric{in}, today) })
	}
	compareComparisons(t, mf.ExpectedComparisons, res, string(wantBytes), mf.Tolerance)
	for i, want := range mf.Earliest {
		compareEarliest(t, fmt.Sprintf("earliest %d", i), cdata, now, mf.Optimize, want)
	}
}

// compareEarliest asks one earliest-month question of the case's plan and
// checks the whole answer (spec chapter 08).
func compareEarliest(t *testing.T, label string, cdata []byte, now config.Month, optimize bool, want earliestCase) {
	t.Helper()
	a := want.Ask
	f, err := app.RunForecast(app.ForecastInput{
		ConfigYAML: cdata,
		Now:        now,
		Optimize:   optimize,
		Earliest: &app.Earliest{
			Scenario: a.Scenario, Entry: a.Entry, Field: a.Field,
			From: a.From, To: a.To, Guardrails: a.Guardrails,
		},
	})
	if err != nil {
		t.Errorf("%s: %v", label, err)
		return
	}
	got := f.Earliest
	if got == nil {
		t.Errorf("%s: no answer", label)
		return
	}
	spans := func(in []app.MonthSpan) []monthSpan {
		out := []monthSpan{}
		for _, s := range in {
			out = append(out, monthSpan{From: s.From.String(), To: s.To.String()})
		}
		return out
	}
	if c := got.Configured.String(); c != want.Configured {
		t.Errorf("%s: configured want %s, got %s", label, want.Configured, c)
	}
	month := ""
	if got.Found {
		month = got.Month.String()
	}
	if month != want.Month {
		t.Errorf("%s: month want %q, got %q", label, want.Month, month)
	}
	if w, g := append([]monthSpan{}, want.Works...), spans(got.Works); !reflect.DeepEqual(w, g) {
		t.Errorf("%s: works want %v, got %v", label, w, g)
	}
	wantHolds := []guardrailMonths{}
	for _, h := range want.Holds {
		wantHolds = append(wantHolds, guardrailMonths{Name: h.Name, Months: append([]monthSpan{}, h.Months...)})
	}
	gotHolds := []guardrailMonths{}
	for _, h := range got.Holds {
		gotHolds = append(gotHolds, guardrailMonths{Name: h.Name, Months: spans(h.Months)})
	}
	if !reflect.DeepEqual(wantHolds, gotHolds) {
		t.Errorf("%s: holds want %v, got %v", label, wantHolds, gotHolds)
	}
	for _, list := range []struct {
		name string
		want []guardrailMetric
		got  []engine.GuardrailResult
	}{
		{"decidedBy", want.DecidedBy, got.DecidedBy},
		{"atEarliest", want.AtEarliest, got.AtEarliest},
	} {
		if len(list.want) != len(list.got) {
			t.Errorf("%s: %s want %d results, got %d", label, list.name, len(list.want), len(list.got))
			continue
		}
		for i, w := range list.want {
			compareGuardrail(t, fmt.Sprintf("%s %s %d", label, list.name, i), w, list.got[i])
		}
	}
}

// compareComparisons checks each pinned pair: its break-even months exactly,
// its ending differences within 0.01, and every month's difference against
// the expected.csv columns it derives from (spec chapter 08).
func compareComparisons(t *testing.T, want []pairComparison, res *engine.Result, wantCSV string, tol float64) {
	index := map[string]int{}
	for i, sc := range res.Scenarios {
		index[sc.Name] = i
	}
	rows := parseCSV(t, wantCSV)
	// Three columns a scenario, or five with today's dollars (spec chapter 05).
	stride := 3
	if len(res.Scenarios) > 0 {
		stride = (len(rows[0]) - 1) / len(res.Scenarios)
	}
	for _, wp := range want {
		pair := wp.Scenario + " minus " + wp.Against
		a, aok := index[wp.Scenario]
		b, bok := index[wp.Against]
		if !aok || !bok {
			t.Errorf("expectedComparisons %s: scenario missing from results", pair)
			continue
		}
		got := res.Compare(res.Scenarios[a], res.Scenarios[b])
		if d := res.Deflator(); d != nil {
			// Read in today's dollars: the same break-even months, and the
			// differences of the today's-dollars columns (spec chapter 08).
			today := d.Comparison(got)
			for _, s := range []struct {
				name           string
				nominal, today engine.SeriesComparison
				column         int
			}{
				{"cash", got.Cash, today.Cash, 3},
				{"total", got.Total, today.Total, 4},
			} {
				if !reflect.DeepEqual(s.nominal.BreakEven, s.today.BreakEven) {
					t.Errorf("%s: %s break-even in today's dollars %v, nominal %v", pair, s.name, s.today.BreakEven, s.nominal.BreakEven)
				}
				compareDifferences(t, pair+" in today's dollars", s.name, s.today.Difference, rows, a, b, stride, s.column, tol)
			}
		}
		for _, series := range []struct {
			name   string
			want   *seriesComparison
			got    engine.SeriesComparison
			column int // offset of the series within a scenario's CSV columns
		}{
			{"cash", wp.Cash, got.Cash, 1},
			{"total", wp.Total, got.Total, 2},
		} {
			if series.want == nil {
				t.Errorf("expectedComparisons %s: %s is not pinned", pair, series.name)
				continue
			}
			gotMonths := []breakEvenMonth{}
			for _, be := range series.got.BreakEven {
				leader := wp.Against
				if be.FirstAhead {
					leader = wp.Scenario
				}
				gotMonths = append(gotMonths, breakEvenMonth{Date: be.Month.String(), Leader: leader})
			}
			wantMonths := append([]breakEvenMonth{}, series.want.BreakEven...)
			if !reflect.DeepEqual(gotMonths, wantMonths) {
				t.Errorf("%s: %s break-even want %v, got %v", pair, series.name, wantMonths, gotMonths)
			}
			diff := series.got.Difference
			if len(diff) != len(rows)-1 {
				t.Errorf("%s: %s difference has %d months, expected.csv has %d", pair, series.name, len(diff), len(rows)-1)
				continue
			}
			if last := diff[len(diff)-1]; math.Abs(last-series.want.EndingDifference) > 0.01 {
				t.Errorf("%s: %s endingDifference want %.4f, got %.4f", pair, series.name, series.want.EndingDifference, last)
			}
			compareDifferences(t, pair, series.name, diff, rows, a, b, stride, series.column, tol)
		}
	}
}

// compareDifferences checks every month's difference against the difference
// of the two scenarios' expected.csv cells at the given column offset.
func compareDifferences(t *testing.T, pair, name string, diff []float64, rows [][]string, a, b, stride, column int, tol float64) {
	t.Helper()
	if len(diff) != len(rows)-1 {
		t.Errorf("%s: %s difference has %d months, expected.csv has %d", pair, name, len(diff), len(rows)-1)
		return
	}
	for i, d := range diff {
		row := rows[i+1]
		av, aerr := strconv.ParseFloat(row[a*stride+column], 64)
		bv, berr := strconv.ParseFloat(row[b*stride+column], 64)
		if aerr != nil || berr != nil {
			t.Errorf("%s: %s in %s: non-numeric expected.csv cell", pair, name, row[0])
			continue
		}
		// Each of the two cells may be off by the tolerance.
		if math.Abs(d-(av-bv)) > 2*tol {
			t.Errorf("%s: %s in %s: want %.2f, got %.4f", pair, name, row[0], av-bv, d)
		}
	}
}

func parseCSV(t *testing.T, s string) [][]string {
	r := csv.NewReader(strings.NewReader(s))
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		t.Fatalf("parsing CSV: %v", err)
	}
	return rows
}

func compareCSV(t *testing.T, want, got string, tol float64) {
	if !strings.HasSuffix(got, "\n") {
		t.Errorf("CSV output must end with a newline")
	}
	wrows, grows := parseCSV(t, want), parseCSV(t, got)
	if len(wrows) != len(grows) {
		t.Fatalf("row count: want %d, got %d", len(wrows), len(grows))
	}
	for i := range wrows {
		if len(wrows[i]) != len(grows[i]) {
			t.Fatalf("row %d: column count want %d, got %d", i, len(wrows[i]), len(grows[i]))
		}
		for j := range wrows[i] {
			w, g := wrows[i][j], grows[i][j]
			// Numeric cells (every data-row cell but the date and the notes)
			// compare as parsed values within tolerance; everything else —
			// header, dates, notes — compares exactly.
			if i > 0 && j > 0 && !strings.HasPrefix(wrows[0][j], "notes (") {
				wf, werr := strconv.ParseFloat(w, 64)
				gf, gerr := strconv.ParseFloat(g, 64)
				if werr != nil || gerr != nil {
					t.Errorf("row %d col %d: non-numeric cell want %q got %q", i, j, w, g)
					continue
				}
				if math.Abs(wf-gf) > tol {
					t.Errorf("row %d (%s) col %d: want %s, got %s (tolerance %g)", i, wrows[i][0], j, w, g, tol)
				}
				continue
			}
			if w != g {
				t.Errorf("row %d col %d: want %q, got %q", i, j, w, g)
			}
		}
	}
}

func compareMetrics(t *testing.T, want []scenarioMetric, res *engine.Result) {
	const tol = 0.01
	byName := map[string]*engine.ScenarioResult{}
	for _, sc := range res.Scenarios {
		byName[sc.Name] = sc
	}
	for _, wm := range want {
		sc, ok := byName[wm.Scenario]
		if !ok {
			t.Errorf("expectedMetrics: scenario %q missing from results", wm.Scenario)
			continue
		}
		if wk := wm.KeyFigures; wk != nil {
			gk := sc.KeyFigures
			if got := gk.LowestCashDate.String(); got != wk.LowestCashDate {
				t.Errorf("scenario %q: keyFigures.lowestCashDate want %s, got %s", wm.Scenario, wk.LowestCashDate, got)
			}
			for _, c := range []struct {
				name      string
				want, got float64
			}{
				{"lowestCash", wk.LowestCash, gk.LowestCash},
				{"endingCash", wk.EndingCash, gk.EndingCash},
				{"endingTotal", wk.EndingTotal, gk.EndingTotal},
			} {
				if math.Abs(c.want-c.got) > tol {
					t.Errorf("scenario %q: keyFigures.%s want %.4f, got %.4f", wm.Scenario, c.name, c.want, c.got)
				}
			}
		}
		if len(wm.EmergencyFund) > 0 {
			if sc.EmergencyFund == nil {
				t.Errorf("scenario %q: emergency fund metrics missing", wm.Scenario)
			} else {
				ef := sc.EmergencyFund
				gotEF := map[string]float64{
					"targetMonths":           ef.TargetMonths,
					"averageMonthlyExpenses": ef.AverageMonthlyExpenses,
					"targetAmount":           ef.TargetAmount,
					"initialLiquid":          ef.InitialLiquid,
					"fundedMonths":           ef.FundedMonths,
					"shortfall":              ef.Shortfall,
					"surplus":                ef.Surplus,
				}
				for k, wv := range wm.EmergencyFund {
					gv, ok := gotEF[k]
					if !ok {
						t.Errorf("scenario %q: unknown emergencyFund metric %q in manifest", wm.Scenario, k)
						continue
					}
					if math.Abs(gv-wv) > tol {
						t.Errorf("scenario %q: emergencyFund.%s want %.4f, got %.4f", wm.Scenario, k, wv, gv)
					}
				}
			}
		}
		if wm.Guardrails != nil {
			compareGuardrails(t, wm.Scenario, wm.Guardrails, sc.Guardrails)
		}
		if len(wm.Optimizations) != len(sc.Optimizations) {
			t.Errorf("scenario %q: want %d optimizations, got %d", wm.Scenario, len(wm.Optimizations), len(sc.Optimizations))
			continue
		}
		for i, wo := range wm.Optimizations {
			go_ := sc.Optimizations[i]
			if go_.TargetName != wo.TargetName || go_.Field != wo.Field {
				t.Errorf("scenario %q opt %d: want target %s/%s, got %s/%s",
					wm.Scenario, i, wo.TargetName, wo.Field, go_.TargetName, go_.Field)
			}
			if go_.OriginalDisplay != wo.OriginalDisplay {
				t.Errorf("scenario %q opt %d: originalDisplay want %q, got %q", wm.Scenario, i, wo.OriginalDisplay, go_.OriginalDisplay)
			}
			if go_.ValueDisplay != wo.ValueDisplay {
				t.Errorf("scenario %q opt %d: valueDisplay want %q, got %q", wm.Scenario, i, wo.ValueDisplay, go_.ValueDisplay)
			}
			for _, c := range []struct {
				name      string
				want, got float64
			}{
				{"original", wo.Original, go_.Original},
				{"value", wo.Value, go_.Value},
				{"floor", wo.Floor, go_.Floor},
				{"minimumCash", wo.MinimumCash, go_.MinimumCash},
				{"headroom", wo.Headroom, go_.Headroom},
			} {
				if math.Abs(c.want-c.got) > tol {
					t.Errorf("scenario %q opt %d: %s want %.4f, got %.4f", wm.Scenario, i, c.name, c.want, c.got)
				}
			}
			switch {
			case wo.Guardrail == nil && go_.Guardrail != nil:
				t.Errorf("scenario %q opt %d: want no guardrail, got %+v", wm.Scenario, i, *go_.Guardrail)
			case wo.Guardrail != nil && go_.Guardrail == nil:
				t.Errorf("scenario %q opt %d: want guardrail %+v, got none", wm.Scenario, i, *wo.Guardrail)
			case wo.Guardrail != nil:
				compareGuardrail(t, fmt.Sprintf("scenario %q opt %d guardrail", wm.Scenario, i), *wo.Guardrail, *go_.Guardrail)
			}
			if go_.Iterations != wo.Iterations {
				t.Errorf("scenario %q opt %d: iterations want %d, got %d", wm.Scenario, i, wo.Iterations, go_.Iterations)
			}
			if go_.Converged != wo.Converged {
				t.Errorf("scenario %q opt %d: converged want %v, got %v", wm.Scenario, i, wo.Converged, go_.Converged)
			}
		}
	}
}

// compareGuardrails checks a scenario's guardrail results against the
// manifest: names, kinds, results, months and months to spare exactly,
// margins and amounts owed within 0.01.
func compareGuardrails(t *testing.T, scenario string, want []guardrailMetric, got []engine.GuardrailResult) {
	t.Helper()
	if len(want) != len(got) {
		t.Errorf("scenario %q: want %d guardrail results, got %d", scenario, len(want), len(got))
		return
	}
	for i, w := range want {
		compareGuardrail(t, fmt.Sprintf("scenario %q guardrail %d", scenario, i), w, got[i])
	}
}

// compareGuardrail checks one guardrail result against the manifest, by the
// rule of compareGuardrails.
func compareGuardrail(t *testing.T, label string, w guardrailMetric, g engine.GuardrailResult) {
	t.Helper()
	have := guardrailMetric{Name: g.Name, Kind: g.Kind, Result: string(g.Result)}
	if g.Result == engine.GuardrailBreaks {
		have.FirstBreachDate = g.FirstBreach.String()
	}
	if g.HasTightest {
		have.TightestDate = g.Tightest.String()
		have.Margin = g.Margin
		have.MarginMonths = g.MarginMonths
	}
	if g.Kind == config.GuardrailDebtFree && g.Result == engine.GuardrailBreaks {
		have.Owed = g.Owed
	}
	if math.Abs(have.Margin-w.Margin) <= 0.01 {
		have.Margin = w.Margin
	}
	if math.Abs(have.Owed-w.Owed) <= 0.01 {
		have.Owed = w.Owed
	}
	if have != w {
		t.Errorf("%s:\n want %+v\n  got %+v", label, w, have)
	}
}
