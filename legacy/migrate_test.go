// Migration conformance per spec chapter 08: each testdata/migration case
// must convert to a document semantically equal to expected.yaml (key
// order/comments/formatting free), the output must validate as v2, and the
// migrated config must run through the forecast engine without hard errors.
package legacy_test

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/legacy"
)

func TestMigrationFixtures(t *testing.T) {
	root := filepath.Join("..", "testdata", "migration")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("reading %s: %v", root, err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		t.Run(e.Name(), func(t *testing.T) {
			dir := filepath.Join(root, e.Name())
			in, err := os.ReadFile(filepath.Join(dir, "legacy.yaml"))
			if err != nil {
				t.Fatalf("legacy.yaml: %v", err)
			}
			want, err := os.ReadFile(filepath.Join(dir, "expected.yaml"))
			if err != nil {
				t.Fatalf("expected.yaml: %v", err)
			}
			got, _, err := legacy.Migrate(in)
			if err != nil {
				t.Fatalf("migrate: %v", err)
			}

			var wantDoc, gotDoc any
			if err := yaml.Unmarshal(want, &wantDoc); err != nil {
				t.Fatalf("expected.yaml parse: %v", err)
			}
			if err := yaml.Unmarshal(got, &gotDoc); err != nil {
				t.Fatalf("migrated output parse: %v\n%s", err, got)
			}
			if diff := semanticDiff(normalize(wantDoc), normalize(gotDoc), "$"); diff != "" {
				t.Errorf("migrated output differs from expected.yaml:\n%s\n--- got document ---\n%s", diff, got)
			}

			// The migrated output must parse and validate as v2 …
			cfg, _, err := config.Parse(got)
			if err != nil {
				t.Fatalf("migrated output does not parse as v2: %v", err)
			}
			now, _ := config.ParseMonth("2000-01")
			if _, err := config.Validate(cfg, now); err != nil {
				t.Fatalf("migrated output does not validate as v2: %v", err)
			}
			// … and run without hard errors (round-trip check).
			if _, err := engine.Run(cfg, engine.Options{}); err != nil {
				t.Fatalf("migrated output does not run: %v", err)
			}
		})
	}
}

// TestMigrateRejects covers chapter 07's required failure modes.
func TestMigrateRejects(t *testing.T) {
	cases := map[string]string{
		"unparseable":       "{{not yaml",
		"missing deathDate": "common:\n  startingValue: 1\nscenarios: []\n",
		"already v2":        "version: 2\ncommon:\n  deathDate: 2030-01\n",
	}
	for name, in := range cases {
		if _, _, err := legacy.Migrate([]byte(in)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// normalize maps every number to float64 so 6 and 6.0 compare equal
// ("semantically equal structures", chapter 08).
func normalize(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := map[string]any{}
		for k, vv := range x {
			out[k] = normalize(vv)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, vv := range x {
			out[i] = normalize(vv)
		}
		return out
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case float32:
		return float64(x)
	default:
		return v
	}
}

func semanticDiff(want, got any, path string) string {
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			return fmt.Sprintf("%s: want mapping, got %T", path, got)
		}
		var diffs []string
		keys := map[string]bool{}
		for k := range w {
			keys[k] = true
		}
		for k := range g {
			keys[k] = true
		}
		sorted := make([]string, 0, len(keys))
		for k := range keys {
			sorted = append(sorted, k)
		}
		sort.Strings(sorted)
		for _, k := range sorted {
			wv, wok := w[k]
			gv, gok := g[k]
			sub := path + "." + k
			switch {
			case !wok:
				diffs = append(diffs, fmt.Sprintf("%s: unexpected key (value %v)", sub, gv))
			case !gok:
				diffs = append(diffs, fmt.Sprintf("%s: missing key (want %v)", sub, wv))
			default:
				if d := semanticDiff(wv, gv, sub); d != "" {
					diffs = append(diffs, d)
				}
			}
		}
		return strings.Join(diffs, "\n")
	case []any:
		g, ok := got.([]any)
		if !ok {
			return fmt.Sprintf("%s: want sequence, got %T", path, got)
		}
		if len(w) != len(g) {
			return fmt.Sprintf("%s: want %d items, got %d", path, len(w), len(g))
		}
		var diffs []string
		for i := range w {
			if d := semanticDiff(w[i], g[i], fmt.Sprintf("%s[%d]", path, i)); d != "" {
				diffs = append(diffs, d)
			}
		}
		return strings.Join(diffs, "\n")
	default:
		if !reflect.DeepEqual(want, got) {
			return fmt.Sprintf("%s: want %v (%T), got %v (%T)", path, want, want, got, got)
		}
		return ""
	}
}
