// Package conformance wires testdata/conformance into go test, per spec
// chapter 08: every normative case must reproduce expected.csv under the
// manifest rules (numeric cells within tolerance; dates, headers, and note
// strings exact) and match expectedMetrics within 0.01.
package conformance_test

import (
	"encoding/csv"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/render"
)

type manifest struct {
	Description     string           `yaml:"description"`
	Normative       bool             `yaml:"normative"`
	Optimize        bool             `yaml:"optimize"`
	Tolerance       float64          `yaml:"tolerance"`
	ExpectedMetrics []scenarioMetric `yaml:"expectedMetrics"`
}

type scenarioMetric struct {
	Scenario      string             `yaml:"scenario"`
	EmergencyFund map[string]float64 `yaml:"emergencyFund"`
	Optimizations []optMetric        `yaml:"optimizations"`
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
	Iterations      int     `yaml:"iterations"`
	Converged       bool    `yaml:"converged"`
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
			// Numeric cells (liquid/total, i.e. data-row columns j%3 in
			// {1,2}) compare as parsed values within tolerance; everything
			// else — header, dates, notes — compares exactly.
			if i > 0 && j > 0 && j%3 != 0 {
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
			if go_.Iterations != wo.Iterations {
				t.Errorf("scenario %q opt %d: iterations want %d, got %d", wm.Scenario, i, wo.Iterations, go_.Iterations)
			}
			if go_.Converged != wo.Converged {
				t.Errorf("scenario %q opt %d: converged want %v, got %v", wm.Scenario, i, wo.Converged, go_.Converged)
			}
		}
	}
}
