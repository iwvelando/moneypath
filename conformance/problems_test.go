package conformance_test

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/internal/app"
)

type problemsFixture struct {
	Description string           `yaml:"description"`
	Problems    []config.Problem `yaml:"problems"`
}

// TestProblems wires testdata/problems into go test, per spec chapter 08:
// each case's config must raise exactly the problems its expected.yaml
// lists, in that order (spec chapter 02, Problems JSON). Where node is
// available, the WASM build must answer byte for byte as the native one does.
func TestProblems(t *testing.T) {
	root := filepath.Join("..", "testdata", "problems")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("reading %s: %v", root, err)
	}
	now, _ := config.ParseMonth(arbitraryNow)
	wasm := wasmRunner(t)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		t.Run(e.Name(), func(t *testing.T) {
			dir := filepath.Join(root, e.Name())
			var want problemsFixture
			data, err := os.ReadFile(filepath.Join(dir, "expected.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			if err := yaml.Unmarshal(data, &want); err != nil {
				t.Fatalf("expected.yaml: %v", err)
			}
			configPath := filepath.Join(dir, "config.yaml")
			cdata, err := os.ReadFile(configPath)
			if err != nil {
				t.Fatal(err)
			}

			native := app.ProblemsJSON(cdata, now)
			var got struct {
				Problems []config.Problem `json:"problems"`
			}
			if err := json.Unmarshal(native, &got); err != nil {
				t.Fatalf("problems JSON: %v\n%s", err, native)
			}
			if !reflect.DeepEqual(got.Problems, want.Problems) {
				t.Errorf("problems differ\n--- got ---\n%s\n--- want ---\n%s", list(got.Problems), list(want.Problems))
			}

			if wasm == nil {
				return
			}
			out := wasm(configPath, fmt.Sprintf(`{"now":%q}`, arbitraryNow), "validate")
			if out != string(native) {
				t.Errorf("problems differ between native and WASM builds\n--- native ---\n%s\n--- wasm ---\n%s", native, out)
			}
		})
	}
}

func list(problems []config.Problem) string {
	var b strings.Builder
	for _, p := range problems {
		fmt.Fprintf(&b, "%s  %s  [%s]  %s\n", p.Level, p.Path, p.Where, p.Message)
	}
	return b.String()
}

// wasmRunner builds the WASM module and returns a function that calls one of
// its bridge functions under Node, or nil when that cannot be done here.
func wasmRunner(t *testing.T) func(configPath, options, function string) string {
	t.Helper()
	if testing.Short() {
		return nil
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return nil
	}
	goroot := strings.TrimSpace(runCmd(t, "go", "env", "GOROOT"))
	wasmExec := filepath.Join(goroot, "lib", "wasm", "wasm_exec.js")
	if _, err := os.Stat(wasmExec); err != nil {
		t.Fatalf("wasm_exec.js not found at %s", wasmExec)
	}
	wasmPath := filepath.Join(t.TempDir(), "moneypath.wasm")
	build := exec.Command("go", "build", "-o", wasmPath, "github.com/iwvelando/moneypath/cmd/moneypath-wasm")
	build.Env = append(os.Environ(), "GOOS=js", "GOARCH=wasm")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("building wasm: %v\n%s", err, out)
	}
	harness := filepath.Join("..", "scripts", "parity_harness.cjs")
	return func(configPath, options, function string) string {
		return runCmd(t, node, harness, wasmExec, wasmPath, configPath, options, function)
	}
}
