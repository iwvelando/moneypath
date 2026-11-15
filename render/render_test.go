package render

import (
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
)

// Spec chapter 05: currency display is $ + thousands separators + 2
// decimals; negative as -$1,234.56.
func TestCurrency(t *testing.T) {
	cases := map[float64]string{
		0:          "$0.00",
		1234.56:    "$1,234.56",
		-1234.56:   "-$1,234.56",
		999.999:    "$1,000.00",
		1000000:    "$1,000,000.00",
		12345678.9: "$12,345,678.90",
		-0.004:     "$0.00", // rounds to zero: no sign
		-0.005001:  "-$0.01",
		17654.331:  "$17,654.33",
	}
	for in, want := range cases {
		if got := Currency(in); got != want {
			t.Errorf("Currency(%v) = %q, want %q", in, got, want)
		}
	}
}

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

// Spec chapter 05 pretty format: structure checks (loosely conformance-
// tested per chapter 08 — CSV is the byte-exact surface).
func TestPrettyStructure(t *testing.T) {
	start, _ := config.ParseMonth("2025-06")
	res := &engine.Result{
		Start: start, End: start + 1,
		Scenarios: []*engine.ScenarioResult{
			{
				Name:   "plan",
				Liquid: []float64{30000, 31200.5},
				Total:  []float64{55000, 56430.75},
				Notes:  [][]string{nil, {"n1", "n2"}},
				EmergencyFund: &engine.EmergencyFund{
					TargetMonths: 6, AverageMonthlyExpenses: 2057.61,
					TargetAmount: 12345.67, InitialLiquid: 30000,
					FundedMonths: 14.6, Surplus: 17654.33,
				},
			},
		},
	}
	got := Pretty(res)
	for _, want := range []string{
		"--- Results for scenario plan ---\n",
		"Emergency fund target (6.0 months): $12,345.67 | Avg monthly expenses: $2,057.61 | Starting coverage: 14.6 months | Surplus: $17,654.33\n",
		"Date    | Liquid Net Worth | Total Net Worth | Notes\n",
		"____    | ________________ | _______________ | _____\n",
		"2025-06 | $30,000.00 | $55,000.00 | \n",
		"2025-07 | $31,200.50 | $56,430.75 | n1, n2\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("pretty output missing %q\n--- got ---\n%s", want, got)
		}
	}
	if !strings.HasSuffix(got, "\n\n") {
		t.Error("blank line after scenario block missing")
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

// Spec chapter 05 pretty format: each scenario's key figures (chapter 04 §8)
// sit on one line under its heading, whether or not the emergency-fund
// recommendation is enabled.
func TestPrettyListsKeyFigures(t *testing.T) {
	start, _ := config.ParseMonth("2025-06")
	res := &engine.Result{
		Start: start, End: start + 2,
		Scenarios: []*engine.ScenarioResult{
			{
				Name:   "plan",
				Liquid: []float64{30000, -1250.5, 4000},
				Total:  []float64{55000, 26000, 31234.56},
				Notes:  [][]string{nil, nil, nil},
				KeyFigures: engine.KeyFigures{
					LowestCash: -1250.5, LowestCashDate: start + 1,
					EndingCash: 4000, EndingTotal: 31234.56,
				},
			},
		},
	}
	got := Pretty(res)
	want := "--- Results for scenario plan ---\n" +
		"Lowest cash: -$1,250.50 in 2025-07 | Ending cash: $4,000.00 | Ending total: $31,234.56\n" +
		"Date    | Liquid Net Worth"
	if !strings.Contains(got, want) {
		t.Errorf("pretty output missing %q\n--- got ---\n%s", want, got)
	}
}

func crossingResult() *engine.Result {
	start, _ := config.ParseMonth("2025-01")
	return &engine.Result{
		Start: start,
		End:   start + 3,
		Scenarios: []*engine.ScenarioResult{
			{Name: "rent", Liquid: []float64{1000, 1500, 2000, 2500}, Total: []float64{1000, 1500, 2000, 2500}},
			{Name: "buy", Liquid: []float64{1000, 400, 2000, 3734.5}, Total: []float64{1000, 1400, 1900, 2400}},
		},
	}
}

// Spec chapter 05: the comparison's pretty form is a heading, one break-even
// line per series naming the scenario that moves ahead, and the differences
// month by month.
func TestComparisonPretty(t *testing.T) {
	res := crossingResult()
	got := ComparisonPretty(res, res.Scenarios[1], res.Scenarios[0])
	want := `--- buy minus rent ---
Cash break-even: 2025-04 (buy moves ahead)
Total break-even: none
Date    | Cash difference | Total difference
____    | _______________ | ________________
2025-01 | $0.00 | $0.00
2025-02 | -$1,100.00 | -$100.00
2025-03 | $0.00 | -$100.00
2025-04 | $1,234.50 | -$100.00
`
	if got != want {
		t.Errorf("ComparisonPretty =\n%s\nwant\n%s", got, want)
	}
}

// Spec chapter 05: several break-even months are listed in order on one line.
func TestComparisonPrettyListsEveryBreakEvenMonth(t *testing.T) {
	start, _ := config.ParseMonth("2025-01")
	res := &engine.Result{Start: start, End: start + 2, Scenarios: []*engine.ScenarioResult{
		{Name: "a", Liquid: []float64{1, 3, 1}, Total: []float64{1, 3, 1}},
		{Name: "b", Liquid: []float64{2, 2, 2}, Total: []float64{2, 2, 2}},
	}}
	got := ComparisonPretty(res, res.Scenarios[0], res.Scenarios[1])
	if want := "Cash break-even: 2025-02 (a moves ahead), 2025-03 (b moves ahead)\n"; !strings.Contains(got, want) {
		t.Errorf("ComparisonPretty =\n%s\nwant a line %q", got, want)
	}
}

// Spec chapter 05: the comparison's CSV keeps the forecast CSV's conventions.
func TestComparisonCSV(t *testing.T) {
	res := crossingResult()
	got := ComparisonCSV(res, res.Scenarios[1], res.Scenarios[0])
	want := `"date","liquid (buy minus rent)","total (buy minus rent)"
"2025-01","0.00","0.00"
"2025-02","-1100.00","-100.00"
"2025-03","0.00","-100.00"
"2025-04","1234.50","-100.00"
`
	if got != want {
		t.Errorf("ComparisonCSV =\n%s\nwant\n%s", got, want)
	}
}
