// Package render turns engine results into the CSV download (spec chapter
// 05). The format is rendered here, in Go, so the fixtures pin the bytes the
// web app serves.
package render

import (
	"fmt"
	"strings"

	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/internal/money"
)

// CSV renders the normative CSV format (spec chapter 05). A plan with an
// inflation rate adds each scenario's series in today's dollars, the start
// month's prices (spec chapter 04 §12), and a plan that lists an asset reports
// six series rather than two.
func CSV(res *engine.Result) string {
	if res == nil || len(res.Scenarios) == 0 {
		return "Date,Scenario,Liquid,Total,Notes\n"
	}
	today := res.Deflator().Result(res)
	series := seriesOf(res.HasAssets)
	var b strings.Builder
	cells := []string{"date"}
	for _, sc := range res.Scenarios {
		for _, s := range series {
			cells = append(cells, fmt.Sprintf("%s (%s)", s.name, sc.Name))
		}
		if today != nil {
			for _, s := range series {
				cells = append(cells, fmt.Sprintf("%s in %s dollars (%s)", s.name, res.Start, sc.Name))
			}
		}
		cells = append(cells, fmt.Sprintf("notes (%s)", sc.Name))
	}
	writeCSVRow(&b, cells)
	for idx, m := range res.Dates() {
		cells = cells[:0]
		cells = append(cells, m.String())
		for i, sc := range res.Scenarios {
			for _, s := range series {
				cells = append(cells, money.Fixed(s.of(sc)[idx]))
			}
			if today != nil {
				for _, s := range series {
					cells = append(cells, money.Fixed(s.of(today.Scenarios[i])[idx]))
				}
			}
			cells = append(cells, strings.Join(sc.Notes[idx], ","))
		}
		writeCSVRow(&b, cells)
	}
	return b.String()
}

// column is one series a scenario reports in the CSV.
type column struct {
	name string
	of   func(*engine.ScenarioResult) []float64
}

// seriesOf is a scenario's series, in order: liquid and total, and with
// assets the balance sheet, which reads total + assets − liabilities = net
// worth from left to right, then equity (spec chapter 05).
func seriesOf(hasAssets bool) []column {
	out := []column{
		{"liquid", func(sc *engine.ScenarioResult) []float64 { return sc.Liquid }},
		{"total", func(sc *engine.ScenarioResult) []float64 { return sc.Total }},
	}
	if hasAssets {
		out = append(out,
			column{"assets", func(sc *engine.ScenarioResult) []float64 { return sc.Assets }},
			column{"liabilities", func(sc *engine.ScenarioResult) []float64 { return sc.Liabilities }},
			column{"net worth", func(sc *engine.ScenarioResult) []float64 { return sc.NetWorth }},
			column{"equity", func(sc *engine.ScenarioResult) []float64 { return sc.Equity }},
		)
	}
	return out
}

func writeCSVRow(b *strings.Builder, cells []string) {
	for i, c := range cells {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		b.WriteString(strings.ReplaceAll(c, `"`, `""`))
		b.WriteByte('"')
	}
	b.WriteByte('\n')
}
