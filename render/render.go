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
// inflation rate adds each scenario's liquid and total in today's dollars,
// the start month's prices (spec chapter 04 §12).
func CSV(res *engine.Result) string {
	if res == nil || len(res.Scenarios) == 0 {
		return "Date,Scenario,Liquid,Total,Notes\n"
	}
	today := res.Deflator().Result(res)
	var b strings.Builder
	cells := []string{"date"}
	for _, sc := range res.Scenarios {
		cells = append(cells,
			fmt.Sprintf("liquid (%s)", sc.Name),
			fmt.Sprintf("total (%s)", sc.Name))
		if today != nil {
			cells = append(cells,
				fmt.Sprintf("liquid in %s dollars (%s)", res.Start, sc.Name),
				fmt.Sprintf("total in %s dollars (%s)", res.Start, sc.Name))
		}
		cells = append(cells, fmt.Sprintf("notes (%s)", sc.Name))
	}
	writeCSVRow(&b, cells)
	for idx, m := range res.Dates() {
		cells = cells[:0]
		cells = append(cells, m.String())
		for i, sc := range res.Scenarios {
			cells = append(cells, money.Fixed(sc.Liquid[idx]), money.Fixed(sc.Total[idx]))
			if today != nil {
				tc := today.Scenarios[i]
				cells = append(cells, money.Fixed(tc.Liquid[idx]), money.Fixed(tc.Total[idx]))
			}
			cells = append(cells, strings.Join(sc.Notes[idx], ","))
		}
		writeCSVRow(&b, cells)
	}
	return b.String()
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
