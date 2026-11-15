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
	if !strings.Contains(string(written), "-212.65") {
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
	if strings.Contains(string(written), "-212.65") {
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

const twoPaths = `version: 2
simulation:
  startDate: 2025-01
  endDate: 2025-04
  startingCash: 1000.00
scenarios:
  - name: rent
    events:
      - name: Savings
        amount: 500.00
  - name: buy a flat
    events:
      - name: Savings
        amount: 500.00
      - name: Deposit
        amount: -1100.00
        startDate: 2025-02
        endDate: 2025-02
      - name: Rebate
        amount: 1800.00
        startDate: 2025-04
        endDate: 2025-04
`

// runCaptured runs the CLI and returns its exit code, stdout and stderr.
func runCaptured(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	dir := t.TempDir()
	outFile, err := os.Create(filepath.Join(dir, "stdout"))
	if err != nil {
		t.Fatal(err)
	}
	errFile, err := os.Create(filepath.Join(dir, "stderr"))
	if err != nil {
		t.Fatal(err)
	}
	realOut, realErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = outFile, errFile
	code := run(args)
	os.Stdout, os.Stderr = realOut, realErr
	outFile.Close()
	errFile.Close()
	stdout, _ := os.ReadFile(outFile.Name())
	stderr, _ := os.ReadFile(errFile.Name())
	return code, string(stdout), string(stderr)
}

func writeTwoPaths(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "plan.yaml")
	if err := os.WriteFile(path, []byte(twoPaths), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// Spec chapter 05: --compare with --against prints one scenario minus the
// other in place of the per-scenario output, in either output format.
func TestForecastCompareTwoScenarios(t *testing.T) {
	in := writeTwoPaths(t)

	code, stdout, _ := runCaptured(t, "forecast", "--config", in, "--compare", "buy a flat", "--against", "rent")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	want := `--- buy a flat minus rent ---
Cash break-even: 2025-04 (buy a flat moves ahead)
Total break-even: 2025-04 (buy a flat moves ahead)
Date    | Cash difference | Total difference
____    | _______________ | ________________
2025-01 | $0.00 | $0.00
2025-02 | -$1,100.00 | -$1,100.00
2025-03 | -$1,100.00 | -$1,100.00
2025-04 | $700.00 | $700.00
`
	if stdout != want {
		t.Errorf("pretty comparison =\n%s\nwant\n%s", stdout, want)
	}

	code, stdout, _ = runCaptured(t, "forecast", "--config", in, "--output-format", "csv", "--compare", "rent", "--against", "buy a flat")
	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	want = `"date","liquid (rent minus buy a flat)","total (rent minus buy a flat)"
"2025-01","0.00","0.00"
"2025-02","1100.00","1100.00"
"2025-03","1100.00","1100.00"
"2025-04","-700.00","-700.00"
`
	if stdout != want {
		t.Errorf("csv comparison =\n%s\nwant\n%s", stdout, want)
	}
}

// Spec chapter 05: a comparison that cannot be made is a usage error that
// says what to do, and prints no results.
func TestForecastCompareUsageErrors(t *testing.T) {
	in := writeTwoPaths(t)
	for _, c := range []struct {
		args []string
		want string
	}{
		{[]string{"--compare", "rent"}, "--compare and --against go together: name the scenario to subtract with --against"},
		{[]string{"--against", "rent"}, "--compare and --against go together: name the scenario to subtract from with --compare"},
		{[]string{"--compare", ""}, "--compare and --against go together: name the scenario to subtract with --against"},
		{[]string{"--against", ""}, "--compare and --against go together: name the scenario to subtract from with --compare"},
		{[]string{"--compare", "", "--against", ""}, `"" is not an active scenario in this plan`},
		{[]string{"--compare", "rent", "--against", "lease"}, `"lease" is not an active scenario in this plan; the active scenarios are: rent, buy a flat`},
		{[]string{"--compare", "rent", "--against", "rent"}, "a scenario cannot be compared with itself; name two different scenarios"},
	} {
		code, stdout, stderr := runCaptured(t, append([]string{"forecast", "--config", in}, c.args...)...)
		if code != 2 {
			t.Errorf("%v: exit code = %d, want 2", c.args, code)
		}
		if stdout != "" {
			t.Errorf("%v: printed results:\n%s", c.args, stdout)
		}
		if !strings.Contains(stderr, c.want) {
			t.Errorf("%v: stderr = %q, want it to contain %q", c.args, stderr, c.want)
		}
	}
}
