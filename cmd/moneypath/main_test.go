package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const planWithOptimizer = `version: 2
simulation:
  startDate: 2025-01
  endDate: 2026-12
  startingCash: 5000.00
recommendations:
  emergencyFundMonths: 3
scenarios:
  - name: plan
    events:
      - name: Income
        amount: 2000.00
      - name: Rent
        amount: -1800.00
      - name: New expense
        amount: -500.00
        startDate: 2025-07
        optimize:
          field: amount
          min: -500
          max: 0
`

func writePlan(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "plan.yaml")
	if err := os.WriteFile(path, []byte(planWithOptimizer), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// Spec chapter 05: --write-config saves the config as run, so an optimizing
// run can hand back a plan carrying the values it chose.
func TestForecastWriteConfigCapturesOptimizedValues(t *testing.T) {
	in := writePlan(t)
	out := filepath.Join(t.TempDir(), "adjusted.yaml")

	if code := run([]string{"forecast", "--config", in, "--optimize", "--write-config", out}); code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}

	written, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("--write-config produced no file: %v", err)
	}
	if !strings.Contains(string(written), "-184.72") {
		t.Errorf("written config does not carry the optimized amount:\n%s", written)
	}
	// The source config must be left exactly as the user wrote it.
	source, err := os.ReadFile(in)
	if err != nil {
		t.Fatal(err)
	}
	if string(source) != planWithOptimizer {
		t.Errorf("--config was modified:\n%s", source)
	}
}

// Without --optimize the flag still writes, giving back the canonical config.
func TestForecastWriteConfigWithoutOptimize(t *testing.T) {
	in := writePlan(t)
	out := filepath.Join(t.TempDir(), "canonical.yaml")

	if code := run([]string{"forecast", "--config", in, "--write-config", out}); code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	written, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("--write-config produced no file: %v", err)
	}
	if !strings.Contains(string(written), "-500") {
		t.Errorf("canonical config lost the configured amount:\n%s", written)
	}
	if strings.Contains(string(written), "-184.72") {
		t.Errorf("no optimizer was asked for, but the config was adjusted:\n%s", written)
	}
}

// An unwritable destination is a runtime error, not a silent success.
func TestForecastWriteConfigUnwritable(t *testing.T) {
	in := writePlan(t)
	out := filepath.Join(t.TempDir(), "no-such-dir", "adjusted.yaml")

	if code := run([]string{"forecast", "--config", in, "--write-config", out}); code != 1 {
		t.Errorf("exit code = %d, want 1", code)
	}
}
