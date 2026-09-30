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

// Spec chapter 05: the config as run keeps simulation.cashInterestRate, and
// the rate reaches the forecast (a saver's cash grows; the default's does not).
func TestForecastHonoursAndWritesCashInterestRate(t *testing.T) {
	plan := func(rate string) string {
		return "version: 2\nsimulation:\n  startDate: 2025-01\n  endDate: 2025-03\n  startingCash: 1200\n" + rate +
			"recommendations: {emergencyFundMonths: 0}\nscenarios:\n  - name: plan\n"
	}
	dir := t.TempDir()
	in := filepath.Join(dir, "saver.yaml")
	if err := os.WriteFile(in, []byte(plan("  cashInterestRate: 12\n")), 0o644); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(dir, "written.yaml")
	csvOut := filepath.Join(dir, "stdout.csv")
	f, err := os.Create(csvOut)
	if err != nil {
		t.Fatal(err)
	}
	realStdout := os.Stdout
	os.Stdout = f
	code := run([]string{"forecast", "--config", in, "--output-format", "csv", "--write-config", out})
	os.Stdout = realStdout
	f.Close()
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	csvBytes, err := os.ReadFile(csvOut)
	if err != nil {
		t.Fatal(err)
	}
	// 1200 at 1% a month: 1212.00 after one month, 1224.12 after two.
	if !strings.Contains(string(csvBytes), `"2025-02","1212.00"`) || !strings.Contains(string(csvBytes), `"2025-03","1224.12"`) {
		t.Errorf("CSV does not show cash growing at the configured rate:\n%s", csvBytes)
	}
	written, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(written), "cashInterestRate: 12") {
		t.Errorf("written config lost cashInterestRate:\n%s", written)
	}

	// A config without the key stays without it: the default is not echoed.
	plain := filepath.Join(dir, "plain.yaml")
	if err := os.WriteFile(plain, []byte(plan("")), 0o644); err != nil {
		t.Fatal(err)
	}
	out2 := filepath.Join(dir, "plain-written.yaml")
	if code := run([]string{"forecast", "--config", plain, "--write-config", out2}); code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	written2, _ := os.ReadFile(out2)
	if strings.Contains(string(written2), "cashInterestRate") {
		t.Errorf("default rate should not be written:\n%s", written2)
	}
}
