package render

import (
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
)

// Spec chapter 05: all CSV fields double-quoted, money as plain %.2f,
// notes joined with "," inside the quoted field, rows end with \n.
func TestCSVFormat(t *testing.T) {
	start, _ := config.ParseMonth("2025-06")
	res := &engine.Result{
		Start: start,
		End:   start + 1,
		Scenarios: []*engine.ScenarioResult{
			{
				Name:   "steady",
				Liquid: []float64{10000, 11175.5},
				Total:  []float64{10000, 11175.5},
				Notes:  [][]string{nil, {"note one", "note two"}},
			},
		},
	}
	got := CSV(res)
	want := `"date","liquid (steady)","total (steady)","notes (steady)"` + "\n" +
		`"2025-06","10000.00","10000.00",""` + "\n" +
		`"2025-07","11175.50","11175.50","note one,note two"` + "\n"
	if got != want {
		t.Errorf("CSV:\n%s\nwant:\n%s", got, want)
	}
}

// Spec chapter 05: with no results, print just the literal header.
func TestCSVEmpty(t *testing.T) {
	if got := CSV(&engine.Result{}); got != "Date,Scenario,Liquid,Total,Notes\n" {
		t.Errorf("empty CSV = %q", got)
	}
}

// A double quote inside a note must be escaped by doubling (standard CSV).
func TestCSVQuoteEscaping(t *testing.T) {
	start, _ := config.ParseMonth("2025-01")
	res := &engine.Result{
		Start: start, End: start,
		Scenarios: []*engine.ScenarioResult{
			{Name: `a "b"`, Liquid: []float64{0}, Total: []float64{0}, Notes: [][]string{nil}},
		},
	}
	got := CSV(res)
	if !strings.Contains(got, `"liquid (a ""b"")"`) {
		t.Errorf("quotes not escaped: %s", got)
	}
}

// Spec chapter 05: an amount that rounds to zero prints as 0.00, never -0.00.
func TestCSVNeverPrintsNegativeZero(t *testing.T) {
	start, _ := config.ParseMonth("2025-06")
	res := &engine.Result{
		Start: start, End: start,
		Scenarios: []*engine.ScenarioResult{{
			Name: "a", Liquid: []float64{-0.0000001}, Total: []float64{-0.004}, Notes: [][]string{nil},
		}},
	}
	want := "\"date\",\"liquid (a)\",\"total (a)\",\"notes (a)\"\n\"2025-06\",\"0.00\",\"0.00\",\"\"\n"
	if got := CSV(res); got != want {
		t.Errorf("CSV = %q, want %q", got, want)
	}
}

// Spec chapter 05, today's dollars: with an inflation rate, each scenario's
// liquid and total in the start month's prices follow its total, under
// headers that name that month.
func TestCSVTodaysDollarsColumns(t *testing.T) {
	start, _ := config.ParseMonth("2026-06")
	res := &engine.Result{
		Start:         start,
		End:           start + 12,
		InflationRate: 3,
		Scenarios: []*engine.ScenarioResult{{
			Name:   "Base",
			Liquid: make([]float64, 13),
			Total:  make([]float64, 13),
			Notes:  make([][]string, 13),
		}},
	}
	res.Scenarios[0].Liquid[0], res.Scenarios[0].Total[0] = 1000, 2000
	res.Scenarios[0].Liquid[12], res.Scenarios[0].Total[12] = 1030, 2060
	res.Scenarios[0].Notes[12] = []string{"a note"}
	lines := strings.Split(CSV(res), "\n")
	for i, want := range map[int]string{
		0:  `"date","liquid (Base)","total (Base)","liquid in 2026-06 dollars (Base)","total in 2026-06 dollars (Base)","notes (Base)"`,
		1:  `"2026-06","1000.00","2000.00","1000.00","2000.00",""`,
		13: `"2027-06","1030.00","2060.00","1000.00","2000.00","a note"`,
	} {
		if lines[i] != want {
			t.Errorf("line %d = %s, want %s", i, lines[i], want)
		}
	}
	res.InflationRate = 0
	if got := CSV(res); strings.Contains(got, "dollars") {
		t.Errorf("a rate of 0 has today's-dollars columns:\n%s", got)
	}
}
