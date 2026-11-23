package conformance_test

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/render"
)

// withGrowth rewrites a plan so that every amount that can grow carries
// growth, every escrow escrowGrowth, every asset that appreciation, and the
// simulation the given inflation rate (none when empty).
func withGrowth(t *testing.T, data []byte, inflationRate, growth string) []byte {
	t.Helper()
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		t.Fatal(err)
	}
	scalar := func(v string) *yaml.Node { return &yaml.Node{Kind: yaml.ScalarNode, Value: v} }
	var walk func(n *yaml.Node, key string)
	walk = func(n *yaml.Node, key string) {
		switch n.Kind {
		case yaml.DocumentNode, yaml.SequenceNode:
			for _, c := range n.Content {
				walk(c, key)
			}
		case yaml.MappingNode:
			has := map[string]bool{}
			for i := 0; i+1 < len(n.Content); i += 2 {
				has[n.Content[i].Value] = true
				walk(n.Content[i+1], n.Content[i].Value)
			}
			if key == "simulation" && inflationRate != "" {
				n.Content = append(n.Content, scalar("inflationRate"), scalar(inflationRate))
			}
			// An optimizer block's bounds are not an amount.
			if has["amount"] && !has["growth"] && key != "optimize" {
				n.Content = append(n.Content, scalar("growth"), scalar(growth))
			}
			if has["escrow"] && !has["escrowGrowth"] {
				n.Content = append(n.Content, scalar("escrowGrowth"), scalar(growth))
			}
			// An asset's appreciation takes the values growth takes.
			if has["value"] && !has["appreciation"] {
				n.Content = append(n.Content, scalar("appreciation"), scalar(growth))
			}
		}
	}
	walk(&doc, "")
	out, err := yaml.Marshal(&doc)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func runPlan(t *testing.T, data []byte, optimize bool) (*engine.Result, string) {
	t.Helper()
	now, _ := config.ParseMonth(arbitraryNow)
	cfg, problems := config.Load(data, now)
	for _, p := range problems {
		if p.Level == config.LevelError {
			t.Fatalf("%s\n%s", p, data)
		}
	}
	res, err := engine.Run(cfg, engine.Options{Optimize: optimize})
	if err != nil {
		t.Fatal(err)
	}
	return res, render.CSV(res)
}

// Spec chapter 03, Growth, and the compatibility promise of the assignment:
// growth that changes nothing — 0, or inflation at a rate of 0 — leaves every
// conformance case exactly as it is, and so does an inflation rate on its own.
func TestGrowthThatChangesNothingLeavesEveryCaseAlone(t *testing.T) {
	root := filepath.Join("..", "testdata", "conformance")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		t.Run(e.Name(), func(t *testing.T) {
			dir := filepath.Join(root, e.Name())
			var mf manifest
			mdata, err := os.ReadFile(filepath.Join(dir, "manifest.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			if err := yaml.Unmarshal(mdata, &mf); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(filepath.Join(dir, "config.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(data, []byte("rowth")) || bytes.Contains(data, []byte("inflationRate")) {
				t.Skip("the case sets growth itself")
			}
			want, wantCSV := runPlan(t, data, mf.Optimize)
			for _, variant := range []struct{ rate, growth string }{
				{"3.0", "0"},
				{"", "inflation"},
				{"0", "inflation"},
			} {
				got, gotCSV := runPlan(t, withGrowth(t, data, variant.rate, variant.growth), mf.Optimize)
				if variant.rate == "3.0" {
					// The rate alone changes no nominal figure; it adds the
					// today's-dollars columns (spec chapter 05) and nothing else.
					if gotCSV == wantCSV {
						t.Errorf("inflation rate %q: the CSV has no today's-dollars columns", variant.rate)
					}
					gotCSV = withoutTodaysDollars(t, gotCSV)
					got.InflationRate = 0
				}
				if gotCSV != wantCSV {
					t.Errorf("inflation rate %q, growth %s: the CSV differs", variant.rate, variant.growth)
				}
				if !reflect.DeepEqual(got, want) {
					t.Errorf("inflation rate %q, growth %s: the results differ", variant.rate, variant.growth)
				}
			}
		})
	}
}

// withoutTodaysDollars drops a CSV's today's-dollars columns and renders the
// rest as the engine renders a CSV (spec chapter 05).
func withoutTodaysDollars(t *testing.T, s string) string {
	t.Helper()
	rows := parseCSV(t, s)
	var b strings.Builder
	for _, row := range rows {
		first := true
		for j, cell := range row {
			if strings.Contains(rows[0][j], " dollars (") {
				continue
			}
			if !first {
				b.WriteByte(',')
			}
			first = false
			b.WriteString(`"` + strings.ReplaceAll(cell, `"`, `""`) + `"`)
		}
		b.WriteByte('\n')
	}
	return b.String()
}
