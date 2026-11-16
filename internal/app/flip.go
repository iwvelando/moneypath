package app

import (
	"fmt"
	"strings"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
)

// Flip asks for one active scenario to be compared with itself under another
// option of one choice (spec chapter 02, Results JSON, flip).
type Flip struct {
	Scenario string
	Choice   string
	Option   string
}

// FlipResult is the flipped path beside the scenario it was flipped from.
// Comparison is the flipped path minus the original.
type FlipResult struct {
	Flip
	// Name is the flipped path's display name.
	Name       string
	Original   *engine.ScenarioResult
	Flipped    *engine.ScenarioResult
	Comparison engine.Comparison
}

// FlipName is the display name of a scenario's flipped path.
func FlipName(fl Flip) string {
	return fmt.Sprintf("%s (%s: %s)", fl.Scenario, fl.Choice, fl.Option)
}

// runFlip simulates the flipped path of in.Flip beside the finished forecast
// f. The plan is parsed afresh and reduced to that one scenario with its
// selection replaced, so the path is validated, resolved and optimized exactly
// as a scenario written that way would be, and f is left untouched.
func runFlip(in ForecastInput, f *Forecast) (*FlipResult, error) {
	fl := *in.Flip

	var original *engine.ScenarioResult
	active := make([]string, 0, len(f.Result.Scenarios))
	for _, sc := range f.Result.Scenarios {
		if sc.Name == fl.Scenario {
			original = sc
		}
		active = append(active, sc.Name)
	}
	if original == nil {
		return nil, fmt.Errorf("“%s” is not an active scenario in this plan. The active scenarios are: %s.",
			fl.Scenario, strings.Join(active, ", "))
	}

	if len(f.Config.Choices) == 0 {
		return nil, fmt.Errorf("This plan has no choices, so there is nothing to flip.")
	}
	var choice *config.Choice
	choices := make([]string, len(f.Config.Choices))
	for i, ch := range f.Config.Choices {
		choices[i] = ch.Name
		if ch.Name == fl.Choice {
			choice = ch
		}
	}
	if choice == nil {
		return nil, fmt.Errorf("This plan has no choice named “%s”. Its choices are: %s.",
			fl.Choice, strings.Join(choices, ", "))
	}
	found := false
	options := make([]string, len(choice.Options))
	for i, opt := range choice.Options {
		options[i] = opt.Name
		found = found || opt.Name == fl.Option
	}
	if !found {
		return nil, fmt.Errorf("The choice “%s” has no option named “%s”. Its options are: %s.",
			fl.Choice, fl.Option, strings.Join(options, ", "))
	}

	cfg, _, err := config.Parse(in.ConfigYAML)
	if err != nil {
		return nil, err
	}
	name := FlipName(fl)
	var flipped *config.Scenario
	for _, sc := range cfg.Scenarios {
		if sc.Name == fl.Scenario {
			flipped = sc
		}
	}
	// The forecast validated this plan, so the scenario is there and selects
	// one option for the choice.
	for i, sel := range flipped.Select {
		if sel.Choice != fl.Choice {
			continue
		}
		if sel.Option == fl.Option {
			return nil, fmt.Errorf("The scenario “%s” already takes “%s” for the choice “%s”. Pick another of its options.",
				fl.Scenario, fl.Option, fl.Choice)
		}
		flipped.Select[i].Option = fl.Option
	}
	flipped.Name = name
	cfg.Scenarios = []*config.Scenario{flipped}

	invalid := func(err error) error {
		return fmt.Errorf("With “%s” for the choice “%s”, this path cannot be run. %w", fl.Option, fl.Choice, err)
	}
	if _, err := config.Validate(cfg, in.Now); err != nil {
		return nil, invalid(err)
	}
	res, err := engine.Run(cfg, engine.Options{Optimize: in.Optimize})
	if err != nil {
		return nil, invalid(err)
	}
	path := res.Scenarios[0]
	return &FlipResult{
		Flip:       fl,
		Name:       name,
		Original:   original,
		Flipped:    path,
		Comparison: engine.Compare(f.Result.Start, path, original),
	}, nil
}
