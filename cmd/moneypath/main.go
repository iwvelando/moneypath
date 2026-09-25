// moneypath — personal-finance scenario simulator (spec chapter 05).
//
// Exit codes: 0 success, 1 runtime/config error, 2 usage error.
package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/internal/app"
	"github.com/iwvelando/moneypath/internal/webembed"
	"github.com/iwvelando/moneypath/legacy"
)

// version is injected at build time via -ldflags "-X main.version=v".
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 {
		usage(os.Stderr)
		return 2
	}
	switch args[0] {
	case "forecast":
		return cmdForecast(args[1:])
	case "migrate":
		return cmdMigrate(args[1:])
	case "serve":
		return cmdServe(args[1:])
	case "version":
		fmt.Println(version)
		return 0
	case "-h", "--help", "help":
		usage(os.Stdout)
		return 0
	default:
		// Default command: forecast, when invoked with flags directly.
		if len(args[0]) > 0 && args[0][0] == '-' {
			return cmdForecast(args)
		}
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", args[0])
		usage(os.Stderr)
		return 2
	}
}

func usage(w *os.File) {
	fmt.Fprint(w, `usage: moneypath <command> [flags]

commands:
  forecast   run a forecast from a v2 config (default with bare flags)
             --config FILE [--output-format pretty|csv] [--optimize]
             [--write-config FILE] [--emergency-months N] [--now YYYY-MM]
             [--log-level L]
  migrate    convert a legacy (v1) config to v2
             moneypath migrate old-config.yaml [-o new-config.yaml]
  serve      serve the embedded static web app locally [--addr :8080]
  version    print the build version
`)
}

type logger struct{ level int }

var levelNames = map[string]int{"debug": 0, "info": 1, "warn": 2, "error": 3}

func (l logger) logf(level int, prefix, format string, args ...any) {
	if level >= l.level {
		fmt.Fprintf(os.Stderr, prefix+format+"\n", args...)
	}
}

func cmdForecast(args []string) int {
	fs := flag.NewFlagSet("forecast", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	configPath := fs.String("config", "", "path to a v2 YAML config (required)")
	outputFormat := fs.String("output-format", "pretty", "pretty or csv")
	optimize := fs.Bool("optimize", false, "run the optimizer before forecasting")
	writeConfig := fs.String("write-config", "", "write the config as run here (with --optimize, the adjusted values)")
	emergencyMonths := fs.Float64("emergency-months", -1, "override recommendations.emergencyFundMonths (0 disables)")
	nowFlag := fs.String("now", "", "override the current month (YYYY-MM)")
	logLevel := fs.String("log-level", "warn", "debug|info|warn|error")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	lvl, ok := levelNames[*logLevel]
	if !ok {
		fmt.Fprintf(os.Stderr, "invalid --log-level %q\n", *logLevel)
		return 2
	}
	log := logger{level: lvl}
	if *configPath == "" {
		fmt.Fprintln(os.Stderr, "--config is required")
		return 2
	}
	if *outputFormat != "pretty" && *outputFormat != "csv" {
		fmt.Fprintf(os.Stderr, "invalid --output-format %q (want pretty or csv)\n", *outputFormat)
		return 2
	}

	now := currentMonth()
	if *nowFlag != "" {
		var err error
		if now, err = config.ParseMonth(*nowFlag); err != nil {
			fmt.Fprintf(os.Stderr, "invalid --now: %v\n", err)
			return 2
		}
	}
	var emOverride *float64
	emSet := false
	fs.Visit(func(f *flag.Flag) {
		if f.Name == "emergency-months" {
			emSet = true
		}
	})
	if emSet {
		if *emergencyMonths < 0 {
			fmt.Fprintln(os.Stderr, "--emergency-months must be >= 0")
			return 2
		}
		emOverride = emergencyMonths
	}

	data, err := os.ReadFile(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}
	started := time.Now()
	f, err := app.RunForecast(app.ForecastInput{
		ConfigYAML:      data,
		Now:             now,
		Optimize:        *optimize,
		EmergencyMonths: emOverride,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}
	for _, w := range f.Warnings {
		log.logf(2, "warning: ", "%s", w)
	}
	log.logf(1, "info: ", "forecast completed in %s", time.Since(started).Round(time.Millisecond))

	if *outputFormat == "csv" {
		fmt.Print(f.CSV)
	} else {
		fmt.Print(f.Pretty)
	}

	// After the results, so a write failure never costs the user the forecast.
	if *writeConfig != "" {
		if err := os.WriteFile(*writeConfig, []byte(f.ConfigYAML), 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			return 1
		}
		log.logf(1, "info: ", "wrote the config as run to %s", *writeConfig)
	}
	return 0
}

func cmdMigrate(args []string) int {
	fs := flag.NewFlagSet("migrate", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	outPath := fs.String("o", "", "write the converted config here (default stdout)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	if fs.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: moneypath migrate old-config.yaml [-o new-config.yaml]")
		return 2
	}
	data, err := os.ReadFile(fs.Arg(0))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}
	converted, notices, err := legacy.Migrate(data)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}
	for _, n := range notices {
		fmt.Fprintf(os.Stderr, "notice: %s\n", n)
	}
	if *outPath != "" {
		if err := os.WriteFile(*outPath, converted, 0o644); err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			return 1
		}
		return 0
	}
	os.Stdout.Write(converted)
	return 0
}

func cmdServe(args []string) int {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	addr := fs.String("addr", ":8080", "listen address")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	dist, err := webembed.FS()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "serving the moneypath web app on %s\n", *addr)
	// Static files only — no computation or upload endpoints (spec
	// chapters 01/02).
	if err := http.ListenAndServe(*addr, http.FileServer(http.FS(dist))); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		return 1
	}
	return 0
}

func currentMonth() config.Month {
	t := time.Now()
	return config.Month(t.Year()*12 + int(t.Month()) - 1)
}
