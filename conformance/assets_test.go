package conformance_test

import (
	"os"
	"path/filepath"
	"testing"
)

// Spec chapter 03, Asset, and the R08.1 decision: a sale by date written with
// an asset settles exactly as the legacy sellProperty sale it replaces. The two
// cases' cash and total columns are the same, month for month.
func TestAssetSaleMatchesTheLegacySale(t *testing.T) {
	read := func(name string) [][]string {
		data, err := os.ReadFile(filepath.Join("..", "testdata", "conformance", name, "expected.csv"))
		if err != nil {
			t.Fatal(err)
		}
		return parseCSV(t, string(data))
	}
	legacy, asset := read("loan-payoff-date-sell"), read("asset-sale-by-date")
	if len(legacy) != len(asset) {
		t.Fatalf("legacy has %d rows, asset %d", len(legacy), len(asset))
	}
	for i := 1; i < len(legacy); i++ {
		for col := 0; col <= 2; col++ { // date, liquid, total
			if legacy[i][col] != asset[i][col] {
				t.Errorf("row %d column %d: legacy %s, asset %s", i, col, legacy[i][col], asset[i][col])
			}
		}
	}
}
