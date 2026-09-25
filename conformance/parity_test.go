package conformance_test

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
	"github.com/iwvelando/moneypath/render"
)

// TestCLIWASMParity is the parity check of spec chapter 08: for every conformance
// config, the CSV from the native engine and from the WASM build must be
// byte-identical. The WASM module runs under Node via the Go glue script.
func TestCLIWASMParity(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not available; parity check skipped")
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
			var mf struct {
				Optimize bool `yaml:"optimize"`
			}
			mdata, err := os.ReadFile(filepath.Join(dir, "manifest.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			if err := yaml.Unmarshal(mdata, &mf); err != nil {
				t.Fatal(err)
			}

			// Native CSV.
			cdata, err := os.ReadFile(filepath.Join(dir, "config.yaml"))
			if err != nil {
				t.Fatal(err)
			}
			cfg, _, err := config.Parse(cdata)
			if err != nil {
				t.Fatal(err)
			}
			now, _ := config.ParseMonth(arbitraryNow)
			if _, err := config.Validate(cfg, now); err != nil {
				t.Fatal(err)
			}
			res, err := engine.Run(cfg, engine.Options{Optimize: mf.Optimize})
			if err != nil {
				t.Fatal(err)
			}
			nativeCSV := render.CSV(res)

			// WASM CSV via Node.
			options := fmt.Sprintf(`{"optimize":%v,"now":%q}`, mf.Optimize, arbitraryNow)
			out := runCmd(t, node, harness, wasmExec, wasmPath, filepath.Join(dir, "config.yaml"), options)
			var payload struct {
				CSV   string `json:"csv"`
				Error string `json:"error"`
			}
			if err := json.Unmarshal([]byte(out), &payload); err != nil {
				t.Fatalf("wasm output is not JSON: %v\n%s", err, out)
			}
			if payload.Error != "" {
				t.Fatalf("wasm returned error: %s", payload.Error)
			}
			if payload.CSV != nativeCSV {
				t.Errorf("CSV differs between native and WASM builds\n--- native ---\n%s\n--- wasm ---\n%s", nativeCSV, payload.CSV)
			}
		})
	}
}

func runCmd(t *testing.T, name string, args ...string) string {
	t.Helper()
	cmd := exec.Command(name, args...)
	out, err := cmd.Output()
	if err != nil {
		stderr := ""
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = string(ee.Stderr)
		}
		t.Fatalf("%s %s: %v\n%s", name, strings.Join(args, " "), err, stderr)
	}
	return string(out)
}
