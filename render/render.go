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

// CSV renders the normative CSV format (spec chapter 05).
func CSV(res *engine.Result) string {
	if res == nil || len(res.Scenarios) == 0 {
		return "Date,Scenario,Liquid,Total,Notes\n"
	}
	var b strings.Builder
	cells := []string{"date"}
	for _, sc := range res.Scenarios {
		cells = append(cells,
			fmt.Sprintf("liquid (%s)", sc.Name),
			fmt.Sprintf("total (%s)", sc.Name),
			fmt.Sprintf("notes (%s)", sc.Name))
	}
	writeCSVRow(&b, cells)
	for idx, m := range res.Dates() {
		cells = cells[:0]
		cells = append(cells, m.String())
		for _, sc := range res.Scenarios {
			cells = append(cells,
				money.Fixed(sc.Liquid[idx]),
				money.Fixed(sc.Total[idx]),
				strings.Join(sc.Notes[idx], ","))
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
