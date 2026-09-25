//go:build js && wasm

// moneypath-wasm exposes the engine to JavaScript (spec chapter 02):
//
//	moneypathForecast(configYAML, optionsJSON) -> results JSON | {"error": …}
//	moneypathMigrate(legacyYAML)               -> {"configYaml", "notices"} | {"error": …}
//	moneypathVersion()                         -> version string
package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"
	"time"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/internal/app"
)

// version is injected at build time via -ldflags "-X main.version=v".
var version = "dev"

func errorJSON(err error) string {
	b, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(b)
}

type forecastOptions struct {
	Optimize bool   `json:"optimize"`
	Now      string `json:"now"`
}

func forecastFn(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return errorJSON(fmt.Errorf("moneypathForecast requires a config argument"))
	}
	var opts forecastOptions
	if len(args) >= 2 && args[1].Type() == js.TypeString && args[1].String() != "" {
		if err := json.Unmarshal([]byte(args[1].String()), &opts); err != nil {
			return errorJSON(fmt.Errorf("invalid options JSON: %w", err))
		}
	}
	now := currentMonth()
	if opts.Now != "" {
		var err error
		if now, err = config.ParseMonth(opts.Now); err != nil {
			return errorJSON(fmt.Errorf("invalid options.now: %w", err))
		}
	}
	f, err := app.RunForecast(app.ForecastInput{
		ConfigYAML: []byte(args[0].String()),
		Now:        now,
		Optimize:   opts.Optimize,
	})
	if err != nil {
		return errorJSON(err)
	}
	out, err := app.ResultsJSON(f, version)
	if err != nil {
		return errorJSON(err)
	}
	return string(out)
}

func migrateFn(_ js.Value, args []js.Value) any {
	if len(args) < 1 {
		return errorJSON(fmt.Errorf("moneypathMigrate requires a config argument"))
	}
	out, err := app.MigrationJSON([]byte(args[0].String()))
	if err != nil {
		return errorJSON(err)
	}
	return string(out)
}

func currentMonth() config.Month {
	t := time.Now()
	return config.Month(t.Year()*12 + int(t.Month()) - 1)
}

func main() {
	js.Global().Set("moneypathForecast", js.FuncOf(forecastFn))
	js.Global().Set("moneypathMigrate", js.FuncOf(migrateFn))
	js.Global().Set("moneypathVersion", js.FuncOf(func(js.Value, []js.Value) any {
		return version
	}))
	// Keep the Go runtime alive; the bridge functions are the API.
	select {}
}
