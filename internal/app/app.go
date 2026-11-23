// Package app is the entry the WASM bridge calls: config bytes in, forecast
// plus rendered surfaces out. It runs natively too, which is how the tests
// and the conformance fixtures reach it (spec chapter 02).
package app

import (
	"encoding/json"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/render"
)

type ForecastInput struct {
	ConfigYAML []byte
	Now        config.Month // current month; used when startDate is absent
	Optimize   bool
	// Flip also compares one scenario with its flipped path; nil = no flip.
	Flip *Flip
	// Earliest also asks for the earliest month an entry can take (spec
	// chapter 04 §11); nil = no question.
	Earliest *Earliest
}

type Forecast struct {
	Config   *config.Config
	Result   *engine.Result
	Warnings []string
	CSV      string
	// ConfigYAML is the config as run, re-serialized (reflects optimizer
	// adjustments when they were enabled).
	ConfigYAML string
	// Flip is set when the input asked for one. Nothing else here reflects it.
	Flip *FlipResult
	// Earliest is set when the input asked for one. Nothing else here
	// reflects it.
	Earliest *EarliestResult
}

// RunForecast parses, validates, and simulates a v2 config.
func RunForecast(in ForecastInput) (*Forecast, error) {
	cfg, parseWarns, err := config.Parse(in.ConfigYAML)
	if err != nil {
		return nil, err
	}
	valWarns, err := config.Validate(cfg, in.Now)
	if err != nil {
		return nil, err
	}
	res, err := engine.Run(cfg, engine.Options{Optimize: in.Optimize})
	if err != nil {
		return nil, err
	}
	echoed, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	warnings := append(append([]string{}, parseWarns...), valWarns...)
	f := &Forecast{
		Config:     cfg,
		Result:     res,
		Warnings:   warnings,
		CSV:        render.CSV(res),
		ConfigYAML: string(echoed),
	}
	if in.Flip != nil {
		if f.Flip, err = runFlip(in, f); err != nil {
			return nil, err
		}
	}
	if in.Earliest != nil {
		if f.Earliest, err = runEarliest(in, f); err != nil {
			return nil, err
		}
	}
	return f, nil
}

// ProblemsJSON validates a config without running it and returns everything
// wrong with it (spec chapter 02, Problems JSON).
func ProblemsJSON(configYAML []byte, now config.Month) []byte {
	_, problems := config.Load(configYAML, now)
	if problems == nil {
		problems = []config.Problem{}
	}
	out, err := json.Marshal(struct {
		Problems []config.Problem `json:"problems"`
	}{problems})
	if err != nil {
		// Problems are four strings each; this cannot fail.
		return []byte(`{"problems":[]}`)
	}
	return out
}

// --- Results JSON (normative shape, spec chapter 02) ---

type resultsJSON struct {
	Version     string           `json:"version"`
	Scenarios   []string         `json:"scenarios"`
	Rows        []rowJSON        `json:"rows"`
	CSV         string           `json:"csv"`
	Metrics     []metricJSON     `json:"metrics"`
	Comparisons []comparisonJSON `json:"comparisons"`
	Flip        *flipJSON        `json:"flip,omitempty"`
	Earliest    *earliestJSON    `json:"earliest,omitempty"`
	// TodaysDollars is present when the plan has an inflation rate.
	TodaysDollars *todaysDollarsJSON `json:"todaysDollars,omitempty"`
	Warnings      []string           `json:"warnings"`
	ConfigYaml    string             `json:"configYaml"`
}

// todaysDollarsJSON is the run read in the start month's prices (spec chapter
// 02, Results JSON, todaysDollars; chapter 04 §12), in the shapes of the
// top-level fields of the same names.
type todaysDollarsJSON struct {
	Today       string           `json:"today"`
	Rows        []rowJSON        `json:"rows"`
	Metrics     []metricJSON     `json:"metrics"`
	Comparisons []comparisonJSON `json:"comparisons"`
	Flip        *flipJSON        `json:"flip,omitempty"`
	Earliest    *earliestJSON    `json:"earliest,omitempty"`
}

// comparisonJSON is one ordered pair: Scenario minus Against, both indexes
// into the scenarios array.
type comparisonJSON struct {
	Scenario int                  `json:"scenario"`
	Against  int                  `json:"against"`
	Cash     seriesComparisonJSON `json:"cash"`
	Total    seriesComparisonJSON `json:"total"`
	NetWorth seriesComparisonJSON `json:"netWorth"`
}

type seriesComparisonJSON struct {
	Difference []float64       `json:"difference"`
	BreakEven  []breakEvenJSON `json:"breakEven"`
}

type flipJSON struct {
	Scenario int            `json:"scenario"`
	Choice   string         `json:"choice"`
	Option   string         `json:"option"`
	Name     string         `json:"name"`
	Cash     flipSeriesJSON `json:"cash"`
	Total    flipSeriesJSON `json:"total"`
	NetWorth flipSeriesJSON `json:"netWorth"`
	// Guardrails are the flipped path's own; absent when the plan has none.
	Guardrails []guardrailJSON `json:"guardrails,omitempty"`
}

// earliestJSON answers an earliest-month question (spec chapter 02, Results
// JSON, earliest).
type earliestJSON struct {
	Scenario   int                   `json:"scenario"`
	Entry      string                `json:"entry"`
	Name       string                `json:"name"`
	Field      string                `json:"field"`
	From       string                `json:"from"`
	To         string                `json:"to"`
	Guardrails []string              `json:"guardrails"`
	Configured string                `json:"configured"`
	Month      string                `json:"month,omitempty"`
	Works      []monthSpanJSON       `json:"works"`
	Holds      []guardrailMonthsJSON `json:"holds"`
	DecidedBy  []guardrailJSON       `json:"decidedBy,omitempty"`
	AtEarliest []guardrailJSON       `json:"atEarliest,omitempty"`
}

type monthSpanJSON struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type guardrailMonthsJSON struct {
	Name   string          `json:"name"`
	Months []monthSpanJSON `json:"months"`
}

func spansJSON(spans []MonthSpan) []monthSpanJSON {
	out := make([]monthSpanJSON, len(spans))
	for i, s := range spans {
		out[i] = monthSpanJSON{From: s.From.String(), To: s.To.String()}
	}
	return out
}

func earliestOf(e *EarliestResult) *earliestJSON {
	out := &earliestJSON{
		Scenario:   e.ScenarioIndex,
		Entry:      e.Entry,
		Name:       e.Name,
		Field:      e.Field,
		From:       e.From,
		To:         e.To,
		Guardrails: e.Guardrails,
		Configured: e.Configured.String(),
		Works:      spansJSON(e.Works),
		Holds:      make([]guardrailMonthsJSON, len(e.Holds)),
		DecidedBy:  guardrailsJSON(e.DecidedBy),
		AtEarliest: guardrailsJSON(e.AtEarliest),
	}
	if e.Found {
		out.Month = e.Month.String()
	}
	for i, h := range e.Holds {
		out.Holds[i] = guardrailMonthsJSON{Name: h.Name, Months: spansJSON(h.Months)}
	}
	return out
}

type flipSeriesJSON struct {
	Difference []float64           `json:"difference"`
	BreakEven  []flipBreakEvenJSON `json:"breakEven"`
}

type flipBreakEvenJSON struct {
	Date    string `json:"date"`
	Flipped bool   `json:"flipped"`
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
	Liquid      float64 `json:"liquid"`
	Total       float64 `json:"total"`
	Liabilities float64 `json:"liabilities"`
	NetWorth    float64 `json:"netWorth"`
	// Assets and Equity are present when the plan lists an asset anywhere
	// (spec chapter 02, Results JSON).
	Assets *float64 `json:"assets,omitempty"`
	Equity *float64 `json:"equity,omitempty"`
	Notes  []string `json:"notes"`
}

type metricJSON struct {
	KeyFigures    keyFiguresJSON  `json:"keyFigures"`
	Guardrails    []guardrailJSON `json:"guardrails,omitempty"`
	EmergencyFund *efJSON         `json:"emergencyFund,omitempty"`
	Optimizations []optJSON       `json:"optimizations,omitempty"`
}

// guardrailJSON is one guardrail read from one path (spec chapter 02, Results
// JSON): a first breach only on a breach, and the tightest month with its
// margin when the path has one. A debtFree's margin is in months, and it
// reports what is owed at a breach.
type guardrailJSON struct {
	Name            string   `json:"name"`
	Kind            string   `json:"kind"`
	Result          string   `json:"result"`
	FirstBreachDate string   `json:"firstBreachDate,omitempty"`
	Owed            *float64 `json:"owed,omitempty"`
	TightestDate    string   `json:"tightestDate,omitempty"`
	Margin          *float64 `json:"margin,omitempty"`
	MarginMonths    *int     `json:"marginMonths,omitempty"`
}

func guardrailsJSON(results []engine.GuardrailResult) []guardrailJSON {
	if len(results) == 0 {
		return nil
	}
	out := make([]guardrailJSON, len(results))
	for i, g := range results {
		out[i] = guardrailJSON{Name: g.Name, Kind: g.Kind, Result: string(g.Result)}
		debtFree := g.Kind == config.GuardrailDebtFree
		if g.Result == engine.GuardrailBreaks {
			out[i].FirstBreachDate = g.FirstBreach.String()
			if debtFree {
				owed := g.Owed
				out[i].Owed = &owed
			}
		}
		if g.HasTightest {
			out[i].TightestDate = g.Tightest.String()
			if debtFree {
				months := g.MarginMonths
				out[i].MarginMonths = &months
			} else {
				margin := g.Margin
				out[i].Margin = &margin
			}
		}
	}
	return out
}

type keyFiguresJSON struct {
	LowestCash     float64 `json:"lowestCash"`
	LowestCashDate string  `json:"lowestCashDate"`
	EndingCash     float64 `json:"endingCash"`
	EndingTotal    float64 `json:"endingTotal"`
	EndingNetWorth float64 `json:"endingNetWorth"`
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
	Original        float64 `json:"original"`
	Value           float64 `json:"value"`
	OriginalDisplay string  `json:"originalDisplay"`
	ValueDisplay    string  `json:"valueDisplay"`
	// Floor, MinimumCash and Headroom are absent for a target held to a
	// debtFree guardrail, which has no dollar floor; Guardrail is present for
	// a target held to any guardrail (spec chapter 02, Results JSON).
	Floor       *float64       `json:"floor,omitempty"`
	MinimumCash *float64       `json:"minimumCash,omitempty"`
	Headroom    *float64       `json:"headroom,omitempty"`
	Guardrail   *guardrailJSON `json:"guardrail,omitempty"`
	Iterations  int            `json:"iterations"`
	Converged   bool           `json:"converged"`
	Notes       []string       `json:"notes"`
}

// ResultsJSON renders the normative WASM results shape (spec chapter 02).
func ResultsJSON(f *Forecast, version string) ([]byte, error) {
	res := f.Result
	out := resultsJSON{
		Version:     version,
		Scenarios:   []string{},
		CSV:         f.CSV,
		Rows:        rowsJSON(res),
		Metrics:     metricsJSON(res),
		Comparisons: comparisonsJSON(res, nil),
		Flip:        flipJSONOf(res, f.Flip, nil),
		Warnings:    f.Warnings,
		ConfigYaml:  f.ConfigYAML,
	}
	if out.Warnings == nil {
		out.Warnings = []string{}
	}
	for _, sc := range res.Scenarios {
		out.Scenarios = append(out.Scenarios, sc.Name)
	}
	if f.Earliest != nil {
		out.Earliest = earliestOf(f.Earliest)
	}
	if d := res.Deflator(); d != nil {
		today := d.Result(res)
		td := &todaysDollarsJSON{
			Today:       res.Start.String(),
			Rows:        rowsJSON(today),
			Metrics:     metricsJSON(today),
			Comparisons: comparisonsJSON(res, d),
			Flip:        flipJSONOf(res, f.Flip, d),
		}
		if e := f.Earliest; e != nil {
			converted := *e
			converted.DecidedBy, converted.AtEarliest = d.Guardrails(e.DecidedBy), d.Guardrails(e.AtEarliest)
			td.Earliest = earliestOf(&converted)
		}
		out.TodaysDollars = td
	}
	return json.Marshal(out)
}

func rowsJSON(res *engine.Result) []rowJSON {
	rows := []rowJSON{}
	for idx, m := range res.Dates() {
		row := rowJSON{Date: m.String()}
		for _, sc := range res.Scenarios {
			notes := sc.Notes[idx]
			if notes == nil {
				notes = []string{}
			}
			v := valueJSON{
				Liquid:      sc.Liquid[idx],
				Total:       sc.Total[idx],
				Liabilities: sc.Liabilities[idx],
				NetWorth:    sc.NetWorth[idx],
				Notes:       notes,
			}
			if res.HasAssets {
				assets, equity := sc.Assets[idx], sc.Equity[idx]
				v.Assets, v.Equity = &assets, &equity
			}
			row.Values = append(row.Values, v)
		}
		rows = append(rows, row)
	}
	return rows
}

func metricsJSON(res *engine.Result) []metricJSON {
	metrics := []metricJSON{}
	for _, sc := range res.Scenarios {
		m := metricJSON{KeyFigures: keyFiguresJSON{
			LowestCash:     sc.KeyFigures.LowestCash,
			LowestCashDate: sc.KeyFigures.LowestCashDate.String(),
			EndingCash:     sc.KeyFigures.EndingCash,
			EndingTotal:    sc.KeyFigures.EndingTotal,
			EndingNetWorth: sc.KeyFigures.EndingNetWorth,
		}, Guardrails: guardrailsJSON(sc.Guardrails)}
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
			oj := optJSON{
				TargetName:      o.TargetName,
				Field:           o.Field,
				Original:        o.Original,
				Value:           o.Value,
				OriginalDisplay: o.OriginalDisplay,
				ValueDisplay:    o.ValueDisplay,
				Iterations:      o.Iterations,
				Converged:       o.Converged,
				Notes:           notes,
			}
			if o.Guardrail != nil {
				oj.Guardrail = &guardrailsJSON([]engine.GuardrailResult{*o.Guardrail})[0]
			}
			if o.Guardrail == nil || o.Guardrail.Kind != config.GuardrailDebtFree {
				floor, minimum, headroom := o.Floor, o.MinimumCash, o.Headroom
				oj.Floor, oj.MinimumCash, oj.Headroom = &floor, &minimum, &headroom
			}
			m.Optimizations = append(m.Optimizations, oj)
		}
		metrics = append(metrics, m)
	}
	return metrics
}

// comparisonsJSON compares every ordered pair of the nominal result, read in
// today's dollars when d is not nil: the break-even months are decided in
// nominal dollars either way (spec chapter 04 §12).
func comparisonsJSON(res *engine.Result, d *engine.Deflator) []comparisonJSON {
	out := []comparisonJSON{}
	for i, a := range res.Scenarios {
		for j, b := range res.Scenarios {
			if i == j {
				continue
			}
			cmp := res.Compare(a, b)
			if d != nil {
				cmp = d.Comparison(cmp)
			}
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
			out = append(out, comparisonJSON{
				Scenario: i,
				Against:  j,
				Cash:     series(cmp.Cash),
				Total:    series(cmp.Total),
				NetWorth: series(cmp.NetWorth),
			})
		}
	}
	return out
}

// flipJSONOf renders a flip, read in today's dollars when d is not nil; nil
// without one.
func flipJSONOf(res *engine.Result, fl *FlipResult, d *engine.Deflator) *flipJSON {
	if fl == nil {
		return nil
	}
	cmp, guardrails := fl.Comparison, fl.Flipped.Guardrails
	if d != nil {
		cmp, guardrails = d.Comparison(cmp), d.Guardrails(guardrails)
	}
	series := func(sc engine.SeriesComparison) flipSeriesJSON {
		s := flipSeriesJSON{Difference: sc.Difference, BreakEven: []flipBreakEvenJSON{}}
		for _, be := range sc.BreakEven {
			s.BreakEven = append(s.BreakEven, flipBreakEvenJSON{Date: be.Month.String(), Flipped: be.FirstAhead})
		}
		return s
	}
	entry := &flipJSON{
		Choice:   fl.Choice,
		Option:   fl.Option,
		Name:     fl.Name,
		Cash:     series(cmp.Cash),
		Total:    series(cmp.Total),
		NetWorth: series(cmp.NetWorth),

		Guardrails: guardrailsJSON(guardrails),
	}
	for i, sc := range res.Scenarios {
		if sc == fl.Original {
			entry.Scenario = i
		}
	}
	return entry
}
