// Package app is the shared entry used by both the CLI and the WASM
// bridge: config bytes in, forecast plus rendered surfaces out. Keeping
// this in one place is what guarantees CLI/WASM parity (spec chapter 02).
package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/legacy"
	"github.com/iwvelando/moneypath/render"
)

type ForecastInput struct {
	ConfigYAML      []byte
	Now             config.Month // current month; used when startDate is absent
	Optimize        bool
	EmergencyMonths *float64 // CLI/UI override; nil = use config
}

type Forecast struct {
	Config   *config.Config
	Result   *engine.Result
	Warnings []string
	CSV      string
	Pretty   string
	// ConfigYAML is the config as run, re-serialized (reflects optimizer
	// adjustments when they were enabled).
	ConfigYAML string
}

// RunForecast parses, validates, and simulates a v2 config.
func RunForecast(in ForecastInput) (*Forecast, error) {
	if config.LooksLegacy(in.ConfigYAML) {
		return nil, fmt.Errorf("this looks like a legacy (v1) config; convert it with 'moneypath migrate'")
	}
	cfg, parseWarns, err := config.Parse(in.ConfigYAML)
	if err != nil {
		return nil, err
	}
	valWarns, err := config.Validate(cfg, in.Now)
	if err != nil {
		return nil, err
	}
	res, err := engine.Run(cfg, engine.Options{
		Optimize:            in.Optimize,
		EmergencyFundMonths: in.EmergencyMonths,
	})
	if err != nil {
		return nil, err
	}
	echoed, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	warnings := append(append([]string{}, parseWarns...), valWarns...)
	return &Forecast{
		Config:     cfg,
		Result:     res,
		Warnings:   warnings,
		CSV:        render.CSV(res),
		Pretty:     render.Pretty(res),
		ConfigYAML: string(echoed),
	}, nil
}

// CompareScenarios renders one named scenario minus another in both output
// forms (spec chapter 05). Its errors are for the user: both names must be
// active scenarios of the plan, and different ones.
func CompareScenarios(f *Forecast, scenario, against string) (pretty, csv string, err error) {
	find := func(name string) (*engine.ScenarioResult, error) {
		names := make([]string, 0, len(f.Result.Scenarios))
		for _, sc := range f.Result.Scenarios {
			if sc.Name == name {
				return sc, nil
			}
			names = append(names, sc.Name)
		}
		return nil, fmt.Errorf("%q is not an active scenario in this plan; the active scenarios are: %s",
			name, strings.Join(names, ", "))
	}
	a, err := find(scenario)
	if err != nil {
		return "", "", err
	}
	b, err := find(against)
	if err != nil {
		return "", "", err
	}
	if a == b {
		return "", "", fmt.Errorf("a scenario cannot be compared with itself; name two different scenarios")
	}
	return render.ComparisonPretty(f.Result, a, b), render.ComparisonCSV(f.Result, a, b), nil
}

// --- Results JSON (normative shape, spec chapter 02) ---

type resultsJSON struct {
	Version     string           `json:"version"`
	Scenarios   []string         `json:"scenarios"`
	Rows        []rowJSON        `json:"rows"`
	CSV         string           `json:"csv"`
	Metrics     []metricJSON     `json:"metrics"`
	Comparisons []comparisonJSON `json:"comparisons"`
	Warnings    []string         `json:"warnings"`
	ConfigYaml  string           `json:"configYaml"`
}

// comparisonJSON is one ordered pair: Scenario minus Against, both indexes
// into the scenarios array.
type comparisonJSON struct {
	Scenario int                  `json:"scenario"`
	Against  int                  `json:"against"`
	Cash     seriesComparisonJSON `json:"cash"`
	Total    seriesComparisonJSON `json:"total"`
}

type seriesComparisonJSON struct {
	Difference []float64       `json:"difference"`
	BreakEven  []breakEvenJSON `json:"breakEven"`
}

type breakEvenJSON struct {
	Date   string `json:"date"`
	Leader int    `json:"leader"`
}

type rowJSON struct {
	Date   string      `json:"date"`
	Values []valueJSON `json:"values"`
}

type valueJSON struct {
	Liquid float64  `json:"liquid"`
	Total  float64  `json:"total"`
	Notes  []string `json:"notes"`
}

type metricJSON struct {
	KeyFigures    keyFiguresJSON `json:"keyFigures"`
	EmergencyFund *efJSON        `json:"emergencyFund,omitempty"`
	Optimizations []optJSON      `json:"optimizations,omitempty"`
}

type keyFiguresJSON struct {
	LowestCash     float64 `json:"lowestCash"`
	LowestCashDate string  `json:"lowestCashDate"`
	EndingCash     float64 `json:"endingCash"`
	EndingTotal    float64 `json:"endingTotal"`
}

type efJSON struct {
	TargetMonths           float64 `json:"targetMonths"`
	AverageMonthlyExpenses float64 `json:"averageMonthlyExpenses"`
	TargetAmount           float64 `json:"targetAmount"`
	InitialLiquid          float64 `json:"initialLiquid"`
	FundedMonths           float64 `json:"fundedMonths"`
	Shortfall              float64 `json:"shortfall"`
	Surplus                float64 `json:"surplus"`
}

type optJSON struct {
	TargetName string `json:"targetName"`
	Field      string `json:"field"`
	// The raw numbers searched over: currency for amount, a count for
	// frequency, a month index for the date fields (spec chapter 02).
	Original        float64  `json:"original"`
	Value           float64  `json:"value"`
	OriginalDisplay string   `json:"originalDisplay"`
	ValueDisplay    string   `json:"valueDisplay"`
	Floor           float64  `json:"floor"`
	MinimumCash     float64  `json:"minimumCash"`
	Headroom        float64  `json:"headroom"`
	Iterations      int      `json:"iterations"`
	Converged       bool     `json:"converged"`
	Notes           []string `json:"notes"`
}

// ResultsJSON renders the normative WASM results shape (spec chapter 02).
func ResultsJSON(f *Forecast, version string) ([]byte, error) {
	out := resultsJSON{
		Version:     version,
		Scenarios:   []string{},
		Rows:        []rowJSON{},
		CSV:         f.CSV,
		Metrics:     []metricJSON{},
		Comparisons: []comparisonJSON{},
		Warnings:    f.Warnings,
		ConfigYaml:  f.ConfigYAML,
	}
	if out.Warnings == nil {
		out.Warnings = []string{}
	}
	res := f.Result
	for _, sc := range res.Scenarios {
		out.Scenarios = append(out.Scenarios, sc.Name)
	}
	for idx, m := range res.Dates() {
		row := rowJSON{Date: m.String()}
		for _, sc := range res.Scenarios {
			notes := sc.Notes[idx]
			if notes == nil {
				notes = []string{}
			}
			row.Values = append(row.Values, valueJSON{
				Liquid: sc.Liquid[idx],
				Total:  sc.Total[idx],
				Notes:  notes,
			})
		}
		out.Rows = append(out.Rows, row)
	}
	for _, sc := range res.Scenarios {
		m := metricJSON{KeyFigures: keyFiguresJSON{
			LowestCash:     sc.KeyFigures.LowestCash,
			LowestCashDate: sc.KeyFigures.LowestCashDate.String(),
			EndingCash:     sc.KeyFigures.EndingCash,
			EndingTotal:    sc.KeyFigures.EndingTotal,
		}}
		if sc.EmergencyFund != nil {
			ef := sc.EmergencyFund
			m.EmergencyFund = &efJSON{
				TargetMonths:           ef.TargetMonths,
				AverageMonthlyExpenses: ef.AverageMonthlyExpenses,
				TargetAmount:           ef.TargetAmount,
				InitialLiquid:          ef.InitialLiquid,
				FundedMonths:           ef.FundedMonths,
				Shortfall:              ef.Shortfall,
				Surplus:                ef.Surplus,
			}
		}
		for _, o := range sc.Optimizations {
			notes := o.Notes
			if notes == nil {
				notes = []string{}
			}
			m.Optimizations = append(m.Optimizations, optJSON{
				TargetName:      o.TargetName,
				Field:           o.Field,
				Original:        o.Original,
				Value:           o.Value,
				OriginalDisplay: o.OriginalDisplay,
				ValueDisplay:    o.ValueDisplay,
				Floor:           o.Floor,
				MinimumCash:     o.MinimumCash,
				Headroom:        o.Headroom,
				Iterations:      o.Iterations,
				Converged:       o.Converged,
				Notes:           notes,
			})
		}
		out.Metrics = append(out.Metrics, m)
	}
	for i, a := range res.Scenarios {
		for j, b := range res.Scenarios {
			if i == j {
				continue
			}
			cmp := res.Compare(a, b)
			series := func(sc engine.SeriesComparison) seriesComparisonJSON {
				s := seriesComparisonJSON{Difference: sc.Difference, BreakEven: []breakEvenJSON{}}
				for _, be := range sc.BreakEven {
					leader := j
					if be.FirstAhead {
						leader = i
					}
					s.BreakEven = append(s.BreakEven, breakEvenJSON{Date: be.Month.String(), Leader: leader})
				}
				return s
			}
			out.Comparisons = append(out.Comparisons, comparisonJSON{
				Scenario: i,
				Against:  j,
				Cash:     series(cmp.Cash),
				Total:    series(cmp.Total),
			})
		}
	}
	return json.Marshal(out)
}

// MigrationJSON renders the moneypathMigrate result shape (spec chapter 02).
func MigrationJSON(input []byte) ([]byte, error) {
	converted, notices, err := legacy.Migrate(input)
	if err != nil {
		return nil, err
	}
	if notices == nil {
		notices = []string{}
	}
	return json.Marshal(map[string]any{
		"configYaml": string(converted),
		"notices":    notices,
	})
}
