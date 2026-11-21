package config

import (
	"regexp"
	"strings"
	"testing"
)

func problemsOf(t *testing.T, doc string) []Problem {
	t.Helper()
	_, problems := Load([]byte(doc), mustMonth(t, "2025-01"))
	return problems
}

func findProblem(problems []Problem, path string) *Problem {
	for i := range problems {
		if problems[i].Path == path {
			return &problems[i]
		}
	}
	return nil
}

const sim = "version: 2\nsimulation: {startDate: 2025-01, endDate: 2030-01, startingCash: 0}\n"

// Spec chapter 02, Problems JSON: each problem carries the field it is about,
// that place in words, and a sentence that does not repeat the place.
func TestProblemsNameTheirField(t *testing.T) {
	cases := []struct {
		name, doc         string
		path, where, want string
		level             Level
	}{
		{"withdrawal tax rate",
			sim + "common: {investments: [{name: Brokerage, withdrawalTaxRate: -1}]}\nscenarios: [{name: a}]\n",
			"common.investments.0.withdrawalTaxRate", "Baseline, investment “Brokerage”",
			"The withdrawal tax rate must be at least 0 and less than 100.", LevelError},
		{"growth tax rate",
			sim + "scenarios: [{name: a, investments: [{name: i, taxRate: 100}]}]\n",
			"scenarios.0.investments.0.taxRate", "Scenario “a”, investment “i”",
			"The growth tax rate must be at least 0 and less than 100.", LevelError},
		{"missing end month",
			"version: 2\nsimulation: {startingCash: 0}\nscenarios: [{name: a}]\n",
			"simulation.endDate", "Simulation", "The end month is required.", LevelError},
		{"a month that is not one",
			"version: 2\nsimulation: {endDate: 2030-13, startingCash: 0}\nscenarios: [{name: a}]\n",
			"simulation.endDate", "Simulation", "“2030-13”", LevelError},
		{"end before start",
			"version: 2\nsimulation: {startDate: 2031-01, endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a}]\n",
			"simulation.endDate", "Simulation", "is before the start month", LevelError},
		{"absent starting cash",
			"version: 2\nsimulation: {endDate: 2030-01}\nscenarios: [{name: a}]\n",
			"simulation.startingCash", "Simulation", "starts with 0.00", LevelWarning},
		{"inflation rate",
			"version: 2\nsimulation: {endDate: 2030-01, startingCash: 0, inflationRate: -100}\nscenarios: [{name: a}]\n",
			"simulation.inflationRate", "Simulation", "The inflation rate must be more than -100.", LevelError},
		{"growth that is not one",
			sim + "scenarios: [{name: a, events: [{name: Rent, amount: -1, growth: inflaton}]}]\n",
			"scenarios.0.events.0.growth", "Scenario “a”, event “Rent”",
			"Growth must be fixed, inflation or a yearly rate in percent, such as 3.", LevelError},
		{"growth too far below 0",
			sim + "common: {investments: [{name: i, contributions: [{amount: 1, growth: -100}]}]}\nscenarios: [{name: a}]\n",
			"common.investments.0.contributions.0.growth", "Baseline, investment “i”, contribution 1",
			"The yearly growth must be more than -100.", LevelError},
		{"escrow growth that is not one",
			sim + "scenarios: [{name: a, loans: [{name: Home, principal: 10, interestRate: 1, term: 12, startDate: 2025-01, escrow: 1, escrowGrowth: [1]}]}]\n",
			"scenarios.0.loans.0.escrowGrowth", "Scenario “a”, loan “Home”",
			"Escrow growth must be fixed, inflation or a yearly rate in percent, such as 3.", LevelError},
		{"inflation with no inflation rate",
			sim + "guardrails: [{name: Cushion, kind: cashFloor, amount: 1, growth: inflation}]\nscenarios: [{name: a}]\n",
			"guardrails.0.growth", "Guardrail “Cushion”",
			"This follows the plan’s inflation rate, which is 0, so it stays the same.", LevelWarning},
		{"inflation at a rate of 0",
			"version: 2\nsimulation: {endDate: 2030-01, startingCash: 0, inflationRate: 0}\nscenarios: [{name: a, events: [{name: Rent, amount: -1, growth: inflation}]}]\n",
			"scenarios.0.events.0.growth", "Scenario “a”, event “Rent”",
			"which is 0", LevelWarning},
		{"escrow growth without escrow",
			sim + "scenarios: [{name: a, loans: [{name: Home, principal: 10, interestRate: 1, term: 12, startDate: 2025-01, escrowGrowth: 3}]}]\n",
			"scenarios.0.loans.0.escrowGrowth", "Scenario “a”, loan “Home”",
			"There is no escrow to grow, so this has no effect.", LevelWarning},
		{"growth on a percentage withdrawal",
			sim + "scenarios: [{name: a, investments: [{name: i, withdrawals: [{percentage: 4, growth: inflation}]}]}]\n",
			"scenarios.0.investments.0.withdrawals.0.growth", "Scenario “a”, investment “i”, withdrawal 1",
			"A percentage withdrawal already follows the balance, so growth has no effect.", LevelWarning},
		{"growth on a debt-free guardrail",
			sim + "guardrails: [{name: Clear, kind: debtFree, startDate: 2029-01, growth: 2}]\nscenarios: [{name: a}]\n",
			"guardrails.0.growth", "Guardrail “Clear”",
			"A debt-free guardrail does not use growth, so this has no effect.", LevelWarning},
		{"emergency fund months",
			sim + "recommendations: {emergencyFundMonths: -1}\nscenarios: [{name: a}]\n",
			"recommendations.emergencyFundMonths", "Simulation", "at least 0", LevelError},
		{"unnamed scenario",
			sim + "scenarios: [{name: a}, {active: true}]\n",
			"scenarios.1.name", "Scenario 2", "needs a name", LevelError},
		{"duplicate scenario",
			sim + "scenarios: [{name: a}, {name: a}]\n",
			"scenarios.1.name", "Scenario “a”", "already named “a”", LevelError},
		{"unnamed event is numbered from one",
			sim + "common: {events: [{name: Pay, amount: 1}, {frequency: 2}]}\nscenarios: [{name: a}]\n",
			"common.events.1.amount", "Baseline, event 2", "The amount is required.", LevelError},
		{"frequency",
			sim + "scenarios: [{name: a, events: [{name: Pay, amount: 1, frequency: 0}]}]\n",
			"scenarios.0.events.0.frequency", "Scenario “a”, event “Pay”", "1 or more", LevelError},
		{"a frequency that is not whole",
			sim + "scenarios: [{name: a, events: [{name: Pay, amount: 1, frequency: 1.5}]}]\n",
			"scenarios.0.events.0.frequency", "Scenario “a”, event “Pay”", "whole number", LevelError},
		{"start after end",
			sim + "scenarios: [{name: a, events: [{amount: 1, startDate: 2029-01, endDate: 2028-01}]}]\n",
			"scenarios.0.events.0.startDate", "Scenario “a”, event 1", "is after the end month", LevelError},
		{"end before the simulation starts",
			sim + "scenarios: [{name: a, events: [{amount: 1, endDate: 2024-01}]}]\n",
			"scenarios.0.events.0.endDate", "Scenario “a”, event 1", "before the simulation starts", LevelError},
		{"event ends after the simulation",
			sim + "scenarios: [{name: a, events: [{name: Bonus, amount: 1, endDate: 2040-01}]}]\n",
			"scenarios.0.events.0.endDate", "Scenario “a”, event “Bonus”", "ends after the simulation", LevelWarning},
		{"optimizer on a baseline event",
			sim + "common: {events: [{amount: 1, optimize: {field: amount, min: 0, max: 1}}]}\nscenarios: [{name: a}]\n",
			"common.events.0.optimize", "Baseline, event 1", "optimizer", LevelError},
		{"optimizer bounds",
			sim + "scenarios: [{name: a, events: [{amount: 1, optimize: {field: amount, min: 5, max: 1}}]}]\n",
			"scenarios.0.events.0.optimize.min", "Scenario “a”, event 1", "less than the upper bound", LevelError},
		{"optimizer missing upper bound",
			sim + "scenarios: [{name: a, events: [{amount: 1, optimize: {field: amount, min: 5}}]}]\n",
			"scenarios.0.events.0.optimize.max", "Scenario “a”, event 1", "The upper bound is required.", LevelError},
		{"loan principal",
			sim + "common: {loans: [{name: Car, principal: 0, interestRate: 1, term: 12, startDate: 2025-01}]}\nscenarios: [{name: a}]\n",
			"common.loans.0.principal", "Baseline, loan “Car”", "The principal must be more than 0.", LevelError},
		{"loan down payment",
			sim + "common: {loans: [{name: Car, principal: 100, downPayment: 100, interestRate: 1, term: 12, startDate: 2025-01}]}\nscenarios: [{name: a}]\n",
			"common.loans.0.downPayment", "Baseline, loan “Car”", "less than the principal", LevelError},
		{"extra principal payment",
			sim + "common: {loans: [{name: Car, principal: 100, interestRate: 1, term: 12, startDate: 2025-01, extraPrincipalPayments: [{amount: -5}]}]}\nscenarios: [{name: a}]\n",
			"common.loans.0.extraPrincipalPayments.0.amount", "Baseline, loan “Car”, extra payment 1", "more than 0", LevelError},
		{"selling without a payoff",
			sim + "common: {loans: [{name: Car, principal: 100, interestRate: 1, term: 12, startDate: 2025-01, sellProperty: true}]}\nscenarios: [{name: a}]\n",
			"common.loans.0.sellProperty", "Baseline, loan “Car”", "no effect", LevelWarning},
		{"withdrawal with neither amount nor percentage",
			sim + "scenarios: [{name: a, investments: [{name: i, withdrawals: [{name: w}]}]}]\n",
			"scenarios.0.investments.0.withdrawals.0.amount", "Scenario “a”, investment “i”, withdrawal “w”", "either an amount or a percentage", LevelError},
		{"duplicate investment",
			sim + "scenarios: [{name: a, investments: [{name: i}, {name: i}]}]\n",
			"scenarios.0.investments.1.name", "Scenario “a”, investment “i”", "already named “i”", LevelError},
		{"unknown key",
			sim + "common: {loans: [{name: Car, principal: 100, intrestRate: 1, interestRate: 1, term: 12, startDate: 2025-01}]}\nscenarios: [{name: a}]\n",
			"common.loans.0.intrestRate", "Baseline, loan “Car”", "“intrestRate”", LevelWarning},
		{"missing version",
			"simulation: {endDate: 2030-01, startingCash: 0}\nscenarios: [{name: a}]\n",
			"version", "", "not a moneypath plan", LevelError},
		{"no scenarios",
			sim, "scenarios", "", "at least one scenario", LevelError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems := problemsOf(t, tc.doc)
			p := findProblem(problems, tc.path)
			if p == nil {
				t.Fatalf("no problem at %q; got %+v", tc.path, problems)
			}
			if p.Level != tc.level {
				t.Errorf("level = %q, want %q", p.Level, tc.level)
			}
			if p.Where != tc.where {
				t.Errorf("where = %q, want %q", p.Where, tc.where)
			}
			if !strings.Contains(p.Message, tc.want) {
				t.Errorf("message = %q, want it to contain %q", p.Message, tc.want)
			}
		})
	}
}

// Problems inside choices: an option's own entries, a baseline entry as an
// option changes it, a target and a scenario's pick.
func TestChoiceProblemsNameTheirField(t *testing.T) {
	cases := []struct {
		name            string
		doc             string
		path, where, in string
	}{
		{"an option's added entry",
			with(t, "[{name: Freelance, amount: 6000}]", "[{name: Freelance}]"),
			"choices.1.options.1.events.0.amount", "Choice “Job”, option “Leave”, event “Freelance”", "amount is required"},
		{"a baseline entry as changed",
			with(t, "- name: Stay\n", "- name: Stay\n        change: {loans: [{name: Mortgage, set: {term: 0}}]}\n"),
			"choices.1.options.0.change.loans.0.set.term", "Choice “Job”, option “Stay”, changed loan “Mortgage”", "term"},
		{"a changed value of the wrong kind",
			with(t, "- name: Leave\n", "- name: Leave\n        change: {loans: [{name: Mortgage, set: {term: soon}}]}\n"),
			"choices.1.options.1.change.loans.0.set.term", "Choice “Job”, option “Leave”, changed loan “Mortgage”", "whole number"},
		{"a target the baseline lacks",
			with(t, "- name: Leave\n", "- name: Leave\n        remove: {events: [Salery]}\n"),
			"choices.1.options.1.remove.events.0", "Choice “Job”, option “Leave”, removed event “Salery”", "The baseline has no event named “Salery”."},
		{"a scenario with no pick",
			with(t, "{Housing: Sell, Job: Leave}", "{Housing: Sell}"),
			"scenarios.0.select.1", "Scenario “one”", "Pick an option for the choice “Job”."},
		{"a pick the choice lacks",
			with(t, "{Housing: Sell, Job: Leave}", "{Housing: Sell, Job: Freelance}"),
			"scenarios.0.select.1", "Scenario “one”", "no option named “Freelance”"},
		{"option without a name",
			with(t, "- name: Stay\n", "- events: []\n"),
			"choices.1.options.0.name", "Choice “Job”, option 1", "needs a name"},
		{"choice with no options",
			with(t, "- name: Job\n", "- name: Empty\n  - name: Job\n"),
			"choices.1.options", "Choice “Empty”", "at least one option"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems := problemsOf(t, tc.doc)
			p := findProblem(problems, tc.path)
			if p == nil {
				t.Fatalf("no problem at %q; got %+v", tc.path, problems)
			}
			if p.Level != LevelError {
				t.Errorf("level = %q, want an error", p.Level)
			}
			if p.Where != tc.where {
				t.Errorf("where = %q, want %q", p.Where, tc.where)
			}
			if !strings.Contains(p.Message, tc.in) {
				t.Errorf("message = %q, want it to contain %q", p.Message, tc.in)
			}
		})
	}
}

// Spec chapter 03, Conventions: every broken rule is reported, not the first.
func TestEveryProblemIsReported(t *testing.T) {
	doc := "version: 2\nsimulation: {startDate: 2025-01, endDate: 2030-01, cashInterestRate: -1}\n" +
		"common:\n" +
		"  events: [{name: Pay}]\n" +
		"  loans: [{name: Car, principal: 0, interestRate: -1, term: 0, startDate: 2025-01}]\n" +
		"  investments: [{name: Fund, taxRate: 100, withdrawalTaxRate: -1}]\n" +
		"scenarios: [{name: a, events: [{amount: 1, frequency: 0}]}]\n"
	problems := problemsOf(t, doc)
	for _, path := range []string{
		"simulation.cashInterestRate",
		"simulation.startingCash",
		"common.events.0.amount",
		"common.loans.0.principal",
		"common.loans.0.interestRate",
		"common.loans.0.term",
		"common.investments.0.taxRate",
		"common.investments.0.withdrawalTaxRate",
		"scenarios.0.events.0.frequency",
	} {
		if findProblem(problems, path) == nil {
			t.Errorf("no problem at %q; got %+v", path, problems)
		}
	}
}

// Validate still refuses with the first error, written as place then sentence.
func TestValidateReportsTheFirstErrorInWords(t *testing.T) {
	doc := sim + "common: {investments: [{name: Brokerage, withdrawalTaxRate: -1}]}\nscenarios: [{name: a}]\n"
	cfg, _, err := Parse([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	_, err = Validate(cfg, mustMonth(t, "2025-01"))
	want := "Baseline, investment “Brokerage”: The withdrawal tax rate must be at least 0 and less than 100."
	if err == nil || err.Error() != want {
		t.Errorf("error = %v, want %q", err, want)
	}
}

// Spec chapter 03, Choices: what a baseline entry already raises as written is
// not raised again for its changed form, error or warning.
func TestChangedEntryDoesNotRepeatTheBaseline(t *testing.T) {
	doc := with(t, "- name: Stay\n", "- name: Stay\n        change: {loans: [{name: Mortgage, set: {escrow: 5}}]}\n")
	doc = strings.Replace(doc, "term: 360", "term: 0", 1)
	problems := problemsOf(t, doc)
	n := 0
	for _, p := range problems {
		if strings.HasSuffix(p.Path, ".term") {
			n++
		}
	}
	if n != 1 {
		t.Errorf("the baseline's term problem should be reported once, not %d times: %+v", n, problems)
	}
}

// A file that is not YAML is one problem about the whole document.
func TestUnreadableFileIsOneProblem(t *testing.T) {
	problems := problemsOf(t, "version: [2\n")
	if len(problems) != 1 || problems[0].Level != LevelError || problems[0].Path != "" {
		t.Fatalf("problems = %+v, want one error with no path", problems)
	}
}

var (
	configKey = regexp.MustCompile(`\b[a-z]+[A-Z][A-Za-z]*\b`)
	notation  = regexp.MustCompile(`[<>=\[\]]`)
)

// AGENTS.md, User-facing text: no config keys, indexes or comparison symbols
// in what a reader sees. A key the user typed themselves is quoted back.
func TestProblemTextIsPlain(t *testing.T) {
	docs := []string{
		"version: 2\nsimulation: {startDate: 2031-01, endDate: 2030-01, cashInterestRate: -1, inflationRate: -101}\n" +
			"guardrails: [{name: G, kind: debtFree, startDate: 2030-01, growth: 1}, {name: H, kind: cashFloor, amount: 1, growth: inflation}, {name: I, kind: lasts, investments: [Fund], growth: 1}]\n" +
			"recommendations: {emergencyFundMonths: -1}\n" +
			"common:\n" +
			"  events: [{name: Pay, percentage: 3, startDate: 2029-01, endDate: 2028-01, optimize: {field: amount}}, {amount: 1, startDate: 2041-01, endDate: 2042-01}, {amount: 1, growth: -100}, {amount: 1, growth: {a: 1}}]\n" +
			"  loans: [{principal: 0}, {name: Car, principal: 10, downPayment: 20, interestRate: -1, term: 0, escrow: -1, mortgageInsurance: -1, mortgageInsuranceCutoff: 101, earlyPayoffThreshold: -1, startDate: 2025-13, earlyPayoffDate: nope, sellProperty: true, extraPrincipalPayments: [{amount: 0, percentage: 1, optimize: {field: amount}}]}," +
			" {name: Home, principal: 10, interestRate: 1, term: 12, startDate: 2026-01, earlyPayoffDate: 2025-06, mortgageInsurance: 5, escrowGrowth: fast}, {name: Boat, principal: 10, interestRate: 1, term: 12, startDate: 2026-01, escrowGrowth: 1}]\n" +
			"  investments: [{startingValue: 1}, {name: Fund, startingValue: -1, taxRate: 100, withdrawalTaxRate: -1, contributions: [{amount: 0, percentage: 1, optimize: {field: amount}}], withdrawals: [{amount: 1, percentage: 1}, {amount: -1}, {percentage: -1, optimize: {field: amount}}, {percentage: 1, growth: 2}]}, {name: Fund}]\n" +
			"scenarios:\n" +
			"  - {name: a, events: [" +
			"{amount: 1, optimize: {field: colour}}, " +
			"{amount: 1, optimize: {field: amount, tolerance: 0, maxIterations: 0}}, " +
			"{amount: 1, optimize: {field: amount, min: 2, max: 1}}, " +
			"{amount: 1, optimize: {field: frequency, min: 0.5, max: 2.5}}, " +
			"{amount: 1, optimize: {field: startDate}}, " +
			"{amount: 1, optimize: {field: endDate, minDate: 2027-01, maxDate: 2026-01}}, " +
			"{amount: 1, optimize: {field: endDate, minDate: x, maxDate: y}}]}\n" +
			"  - {name: a}\n  - {active: false}\n",
		with(t, "- name: Job\n", "- options:\n      - name: X\n  - name: Housing\n    options: []\n  - name: Job\n"),
		with(t, "- name: Stay\n", "- name: Leave\n      - events: []\n"),
		with(t, "{Housing: Sell, Job: Leave}", "{Housing: Sell, Job: Freelance, Car: Buy}"),
		with(t, "- name: Leave\n", "- name: Leave\n        remove: {events: [Salery, \"\", Gym, Gym]}\n        change: {loans: [{name: Morgage, set: {term: 12}}, {name: Mortgage}], events: [{name: Gym, set: {name: Club, optimize: {field: amount}}}]}\n"),
		with(t, "- name: Sell\n", "- name: Sell\n        investments: [{name: Fund}]\n        change: {loans: [{name: Mortgage, set: {escrow: 10}}]}\n") +
			"", // paired with the next: two choices on one entry
	}
	docs = append(docs, strings.Replace(
		strings.Replace(docs[len(docs)-1], "- name: Leave\n", "- name: Leave\n        investments: [{name: Fund}]\n        remove: {loans: [Mortgage]}\n", 1),
		"[{name: Rent, amount: -1900}]", "[{name: Rent, amount: -1900, optimize: {field: amount, min: -2000, max: 0}}]", 1))

	seen := 0
	for _, doc := range docs {
		for _, p := range problemsOf(t, doc) {
			seen++
			text := p.Where + " " + p.Message
			if m := configKey.FindString(text); m != "" && !strings.Contains(text, "“"+m+"”") {
				t.Errorf("%q names a config key, %q", p.String(), m)
			}
			if notation.MatchString(text) {
				t.Errorf("%q uses notation the reader must decode", p.String())
			}
			if strings.Contains(strings.ToLower(text), "common") {
				t.Errorf("%q says \"common\"; the reader knows it as the baseline", p.String())
			}
			if !strings.HasSuffix(p.Message, ".") {
				t.Errorf("%q is not a complete sentence", p.Message)
			}
		}
	}
	if seen < 60 {
		t.Errorf("only %d problems were raised; the plans above are meant to break most rules", seen)
	}
}

// A fraction where a whole number belongs is one mistake and is reported
// once: the rule about the number's size is not held against it as well.
func TestFractionInAWholeNumberIsOneProblem(t *testing.T) {
	for _, doc := range []string{
		sim + "scenarios: [{name: a, events: [{name: Gym, amount: 1, frequency: 0.3}]}]\n",
		sim + "common: {loans: [{name: Car, principal: 100, interestRate: 1, term: 0.5, startDate: 2025-01}]}\nscenarios: [{name: a}]\n",
	} {
		problems := problemsOf(t, doc)
		if len(problems) != 1 || !strings.Contains(problems[0].Message, "whole number") {
			t.Errorf("problems = %+v, want the one about a whole number", problems)
		}
	}
}

// A value reached through a YAML alias is checked like one written in place.
func TestAliasedValuesAreChecked(t *testing.T) {
	doc := sim + "scenarios:\n  - name: a\n    events:\n      - {name: Gym, amount: &fraction 1.5, frequency: *fraction}\n" +
		"      - &pay {name: Pay, amount: 1, colour: blue}\n      - *pay\n"
	problems := problemsOf(t, doc)
	if p := findProblem(problems, "scenarios.0.events.0.frequency"); p == nil || !strings.Contains(p.Message, "whole number") {
		t.Errorf("an aliased fraction in a whole-number field is not reported: %+v", problems)
	}
	if findProblem(problems, "scenarios.0.events.2.colour") == nil {
		t.Errorf("an unknown key in an aliased entry is not reported: %+v", problems)
	}
}
