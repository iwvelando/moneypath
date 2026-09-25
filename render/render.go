// Package render turns engine results into the CLI/CSV output surfaces
// (spec chapter 05). It is shared by the CLI and the WASM bridge so both
// produce byte-identical CSV.
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
				fmt.Sprintf("%.2f", sc.Liquid[idx]),
				fmt.Sprintf("%.2f", sc.Total[idx]),
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

// Currency formats x as $1,234.56 (negative: -$1,234.56).
func Currency(x float64) string { return money.Format(x) }

// Pretty renders the human-readable table format (spec chapter 05).
func Pretty(res *engine.Result) string {
	var b strings.Builder
	if res == nil {
		return ""
	}
	dates := res.Dates()
	for _, sc := range res.Scenarios {
		fmt.Fprintf(&b, "--- Results for scenario %s ---\n", sc.Name)
		if ef := sc.EmergencyFund; ef != nil {
			fmt.Fprintf(&b, "Emergency fund target (%.1f months): %s | Avg monthly expenses: %s",
				ef.TargetMonths, Currency(ef.TargetAmount), Currency(ef.AverageMonthlyExpenses))
			if ef.FundedMonths > 0 {
				fmt.Fprintf(&b, " | Starting coverage: %.1f months", ef.FundedMonths)
			}
			if ef.Shortfall > 0 {
				fmt.Fprintf(&b, " | Shortfall: %s", Currency(ef.Shortfall))
			} else if ef.Surplus > 0 {
				fmt.Fprintf(&b, " | Surplus: %s", Currency(ef.Surplus))
			}
			b.WriteByte('\n')
		}
		if len(sc.Optimizations) > 0 {
			b.WriteString("Optimization adjustments:\n")
			for _, o := range sc.Optimizations {
				status := "converged"
				if !o.Converged {
					status = "not converged"
				}
				fmt.Fprintf(&b, " - %s (%s): %s -> %s | floor %s | min cash %s | headroom %s | iterations %d (%s)\n",
					o.TargetName, o.Field, o.OriginalDisplay, o.ValueDisplay,
					Currency(o.Floor), Currency(o.MinimumCash), Currency(o.Headroom),
					o.Iterations, status)
				if len(o.Notes) > 0 {
					fmt.Fprintf(&b, "   Notes: %s\n", strings.Join(o.Notes, "; "))
				}
			}
		}
		b.WriteString("Date    | Liquid Net Worth | Total Net Worth | Notes\n")
		b.WriteString("____    | ________________ | _______________ | _____\n")
		for idx, m := range dates {
			fmt.Fprintf(&b, "%s | %s | %s | %s\n",
				m.String(), Currency(sc.Liquid[idx]), Currency(sc.Total[idx]),
				strings.Join(sc.Notes[idx], ", "))
		}
		b.WriteByte('\n')
	}
	return b.String()
}
