package config

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func load(t *testing.T, doc string) (*Config, []string, error) {
	t.Helper()
	cfg, parseWarns, err := Parse([]byte(doc))
	if err != nil {
		return nil, nil, err
	}
	warns, err := Validate(cfg, mustMonth(t, "2026-01"))
	return cfg, append(parseWarns, warns...), err
}

func mustLoad(t *testing.T, doc string) (*Config, []string) {
	t.Helper()
	cfg, warns, err := load(t, doc)
	if err != nil {
		t.Fatalf("plan should be valid: %v", err)
	}
	return cfg, warns
}

func eventNames(evs []*Event) []string {
	out := []string{}
	for _, e := range evs {
		out = append(out, e.Name)
	}
	return out
}

func loanNames(ls []*Loan) []string {
	out := []string{}
	for _, l := range ls {
		out = append(out, l.Name)
	}
	return out
}

func investmentNames(is []*Investment) []string {
	out := []string{}
	for _, i := range is {
		out = append(out, i.Name)
	}
	return out
}

func assertNames(t *testing.T, what string, got, want []string) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s = %q, want %q", what, got, want)
	}
}

func scenario(t *testing.T, cfg *Config, name string) *Scenario {
	t.Helper()
	for _, sc := range cfg.Scenarios {
		if sc.Name == name {
			return sc
		}
	}
	t.Fatalf("no scenario %q", name)
	return nil
}

// workedExample is examples/choices.yaml, the plan chapter 03's Choices
// section is written around.
func workedExample(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "examples", "choices.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// Spec chapter 03, Choices, Resolution: the scenario list is the scenario's
// own entries then the selected options' in choice order; the shared list is
// common as the selected options change it, each changed entry in its place.
func TestWorkedExampleResolves(t *testing.T) {
	cfg, warns := mustLoad(t, workedExample(t))
	if len(warns) != 0 {
		t.Errorf("unexpected warnings: %q", warns)
	}

	sc := scenario(t, cfg, "sell and freelance")
	assertNames(t, "scenario events", eventNames(sc.Resolved.Events),
		[]string{"Health insurance", "Rent", "Salary until I leave", "Freelance income"})
	assertNames(t, "scenario loans", loanNames(sc.Resolved.Loans), []string{})
	assertNames(t, "scenario investments", investmentNames(sc.Resolved.Investments), []string{})
	assertNames(t, "shared events", eventNames(sc.ResolvedShared.Events), []string{"Living costs"})
	assertNames(t, "shared loans", loanNames(sc.ResolvedShared.Loans), []string{"Mortgage"})
	assertNames(t, "shared investments", investmentNames(sc.ResolvedShared.Investments), []string{"Brokerage"})

	m := sc.ResolvedShared.Loans[0]
	if m.EarlyPayoffDate != "2027-06" || !m.SellProperty || m.SellPrice == nil || *m.SellPrice != 310000 || m.SellCostsNet != 21000 {
		t.Errorf("the four sale fields were not set on the Mortgage: %+v", m)
	}
	if m.Principal != 240000 || m.Escrow != 450 || m.Term != 360 || m.StartDate != "2021-01" {
		t.Errorf("fields outside set were not kept: %+v", m)
	}
	if m.ResolvedEarlyPayoffDate != mustMonth(t, "2027-06") || m.ResolvedSellPrice != 310000 {
		t.Errorf("the changed Mortgage was not validated as changed: %+v", m)
	}
	b := sc.ResolvedShared.Investments[0]
	if len(b.Contributions) != 1 || b.Contributions[0].EndDate != "2026-12" || b.StartingValue != 40000 {
		t.Errorf("Brokerage contributions were not replaced whole: %+v", b)
	}

	// The baseline itself is untouched, and a scenario selecting neither
	// changing option simulates it as written.
	if cfg.Common.Loans[0].EarlyPayoffDate != "" || len(cfg.Common.Events) != 3 {
		t.Errorf("common was modified by resolution")
	}
	as := scenario(t, cfg, "as we are")
	assertNames(t, "as we are: scenario events", eventNames(as.Resolved.Events), []string{})
	assertNames(t, "as we are: shared events", eventNames(as.ResolvedShared.Events), []string{"Salary", "Living costs", "Gym"})
	if as.ResolvedShared.Loans[0].EarlyPayoffDate != "" {
		t.Errorf("as we are: Mortgage should be the baseline's")
	}

	sell := scenario(t, cfg, "sell")
	assertNames(t, "sell: scenario events", eventNames(sell.Resolved.Events), []string{"Rent"})
	assertNames(t, "sell: shared events", eventNames(sell.ResolvedShared.Events), []string{"Salary", "Living costs", "Gym"})
}

// A plan without choices resolves to itself: the scenario's own entries and
// common, the very same entries.
func TestPlanWithoutChoicesResolvesToItself(t *testing.T) {
	cfg, _ := mustLoad(t, `
version: 2
simulation: {endDate: 2027-01, startingCash: 0}
common:
  events: [{name: Shared, amount: 1}]
scenarios:
  - name: a
    events: [{name: Own, amount: 2}]
`)
	sc := cfg.Scenarios[0]
	if len(sc.Resolved.Events) != 1 || sc.Resolved.Events[0] != sc.Events[0] {
		t.Errorf("resolved scenario list is not the scenario's own entries")
	}
	if len(sc.ResolvedShared.Events) != 1 || sc.ResolvedShared.Events[0] != cfg.Common.Events[0] {
		t.Errorf("resolved shared list is not common")
	}
}

const twoChoices = `
version: 2
simulation: {endDate: 2030-01, startingCash: 1000}
common:
  events:
    - {name: Salary, amount: 5000}
    - {name: Gym, amount: -60}
  loans:
    - {name: Mortgage, principal: 100000, interestRate: 4, term: 360, startDate: 2021-01, earlyPayoffThreshold: 5000}
  investments:
    - {name: Brokerage, startingValue: 100}
choices:
  - name: Housing
    options:
      - name: Keep
      - name: Sell
        events: [{name: Rent, amount: -1900}]
  - name: Job
    options:
      - name: Stay
      - name: Leave
        events: [{name: Freelance, amount: 6000}]
scenarios:
  - name: one
    select: {Housing: Sell, Job: Leave}
    events: [{name: Own, amount: 1}]
`

// with returns twoChoices with one exact fragment replaced.
func with(t *testing.T, old, new string) string {
	t.Helper()
	if strings.Count(twoChoices, old) != 1 {
		t.Fatalf("fragment %q must occur exactly once in the base plan", old)
	}
	return strings.Replace(twoChoices, old, new, 1)
}

// The order of keys in select has no effect: options are taken in the order
// the choices are listed.
func TestSelectKeyOrderHasNoEffect(t *testing.T) {
	a, _ := mustLoad(t, twoChoices)
	b, _ := mustLoad(t, with(t, "{Housing: Sell, Job: Leave}", "{Job: Leave, Housing: Sell}"))
	want := []string{"Own", "Rent", "Freelance"}
	assertNames(t, "as listed", eventNames(a.Scenarios[0].Resolved.Events), want)
	assertNames(t, "select reversed", eventNames(b.Scenarios[0].Resolved.Events), want)
}

// A field set to null is taken away and falls back to its default.
func TestChangeNullTakesTheFieldAway(t *testing.T) {
	cfg, _ := mustLoad(t, with(t, "- name: Sell\n", `- name: Sell
        change:
          loans:
            - name: Mortgage
              set: {earlyPayoffThreshold: ~, escrow: 200}
`))
	m := cfg.Scenarios[0].ResolvedShared.Loans[0]
	if m.EarlyPayoffThreshold != 0 || m.Escrow != 200 || m.Principal != 100000 {
		t.Errorf("changed Mortgage = %+v", m)
	}
	if cfg.Common.Loans[0].EarlyPayoffThreshold != 5000 {
		t.Errorf("the baseline Mortgage was modified")
	}
}

func TestRemoveDropsTheBaselineEntry(t *testing.T) {
	cfg, _ := mustLoad(t, with(t, "- name: Leave\n", `- name: Leave
        remove: {events: [Gym], loans: [Mortgage], investments: [Brokerage]}
`))
	sh := cfg.Scenarios[0].ResolvedShared
	assertNames(t, "shared events", eventNames(sh.Events), []string{"Salary"})
	assertNames(t, "shared loans", loanNames(sh.Loans), []string{})
	assertNames(t, "shared investments", investmentNames(sh.Investments), []string{})
}

// Chapter 03, Choices, Validation: each refusal names what it concerns.
func TestChoiceErrors(t *testing.T) {
	cases := []struct {
		name string
		doc  string
		want []string
	}{
		{"choice without a name",
			with(t, "- name: Job\n", "- options:\n      - name: X\n  - name: Job\n"),
			[]string{"choices[1]", "no name"}},
		{"repeated choice name",
			with(t, "- name: Job\n", "- name: Housing\n"),
			[]string{"duplicate choice name", `"Housing"`}},
		{"choice with no options",
			with(t, "- name: Job\n", "- name: Empty\n  - name: Job\n"),
			[]string{`choice "Empty"`, "no options"}},
		{"option without a name",
			with(t, "- name: Stay\n", "- events: []\n"),
			[]string{`choice "Job"`, "options[0]", "no name"}},
		{"repeated option name",
			with(t, "- name: Stay\n", "- name: Leave\n"),
			[]string{`choice "Job"`, "duplicate option name", `"Leave"`}},
		{"scenario picks nothing for a choice",
			with(t, "{Housing: Sell, Job: Leave}", "{Housing: Sell}"),
			[]string{`scenario "one"`, "picks no option", `"Job"`}},
		{"scenario has no select at all",
			with(t, "    select: {Housing: Sell, Job: Leave}\n", ""),
			[]string{`scenario "one"`, "picks no option", `"Housing"`}},
		{"scenario names an unknown choice",
			with(t, "{Housing: Sell, Job: Leave}", "{Housing: Sell, Job: Leave, Car: Buy}"),
			[]string{`scenario "one"`, `"Car"`, "does not have"}},
		{"scenario names an unknown option",
			with(t, "{Housing: Sell, Job: Leave}", "{Housing: Sell, Job: Freelance}"),
			[]string{`scenario "one"`, `choice "Job"`, `"Freelance"`, "Stay", "Leave"}},
		{"scenario names a choice twice",
			with(t, "{Housing: Sell, Job: Leave}", "{Housing: Sell, Job: Leave, Housing: Keep}"),
			[]string{`"Housing"`, "more than once"}},
		{"remove target the baseline lacks",
			with(t, "- name: Leave\n", "- name: Leave\n        remove: {events: [Salery]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, "common has no event", `"Salery"`}},
		{"change target the baseline lacks",
			with(t, "- name: Leave\n", "- name: Leave\n        change: {loans: [{name: Morgage, set: {term: 12}}]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, "common has no loan", `"Morgage"`}},
		{"unnamed target",
			with(t, "- name: Leave\n", "- name: Leave\n        remove: {events: [\"\"]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, "name"}},
		{"entry changed and removed in one option",
			with(t, "- name: Leave\n", "- name: Leave\n        remove: {events: [Gym]}\n        change: {events: [{name: Gym, set: {amount: -10}}]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, `event "Gym"`, "more than once"}},
		{"entry removed twice in one option",
			with(t, "- name: Leave\n", "- name: Leave\n        remove: {events: [Gym, Gym]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, `event "Gym"`, "more than once"}},
		{"optimize on an option's event",
			with(t, "[{name: Rent, amount: -1900}]", "[{name: Rent, amount: -1900, optimize: {field: amount, min: -2000, max: 0}}]"),
			[]string{`choice "Housing"`, `option "Sell"`, `"Rent"`, "optimize is not allowed"}},
		{"set names the entry",
			with(t, "- name: Leave\n", "- name: Leave\n        change: {events: [{name: Gym, set: {name: Club}}]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, `event "Gym"`, "name cannot be set"}},
		{"set carries optimize",
			with(t, "- name: Leave\n", "- name: Leave\n        change: {events: [{name: Gym, set: {optimize: {field: amount, min: -1, max: 0}}}]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, `event "Gym"`, "optimize cannot be set"}},
		{"change without set",
			with(t, "- name: Leave\n", "- name: Leave\n        change: {events: [{name: Gym}]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, `event "Gym"`, "set"}},
		{"an added entry breaks an entry rule",
			with(t, "[{name: Freelance, amount: 6000}]", "[{name: Freelance}]"),
			[]string{`choice "Job"`, `option "Leave"`, `"Freelance"`, "amount is required"}},
		{"a set of the wrong type",
			with(t, "- name: Leave\n", "- name: Leave\n        change: {loans: [{name: Mortgage, set: {term: soon}}]}\n"),
			[]string{`choice "Job"`, `option "Leave"`, `loan "Mortgage"`}},
		{"select is not a mapping",
			with(t, "{Housing: Sell, Job: Leave}", "[Sell, Leave]"),
			[]string{"select"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := load(t, tc.doc)
			if err == nil {
				t.Fatal("expected an error")
			}
			for _, w := range tc.want {
				if !strings.Contains(err.Error(), w) {
					t.Errorf("error %q should mention %q", err, w)
				}
			}
		})
	}
}

func TestTargetTheBaselineHasTwiceIsRefused(t *testing.T) {
	doc := with(t, "    - {name: Gym, amount: -60}\n", "    - {name: Gym, amount: -60}\n    - {name: Gym, amount: -10}\n")
	// Two entries of one name are fine until an option points at one.
	if _, _, err := load(t, doc); err != nil {
		t.Fatalf("duplicate event names in common are valid on their own: %v", err)
	}
	doc = strings.Replace(doc, "- name: Leave\n", "- name: Leave\n        remove: {events: [Gym]}\n", 1)
	_, _, err := load(t, doc)
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, w := range []string{`choice "Job"`, `option "Leave"`, "2 events", `"Gym"`} {
		if !strings.Contains(err.Error(), w) {
			t.Errorf("error %q should mention %q", err, w)
		}
	}
}

// One baseline entry belongs to one decision. The check is made once for the
// plan and does not depend on what any scenario selects.
func TestEntryChangedByTwoChoicesIsRefused(t *testing.T) {
	doc := with(t, "- name: Leave\n", "- name: Leave\n        remove: {loans: [Mortgage]}\n")
	doc = strings.Replace(doc, "- name: Sell\n", "- name: Sell\n        change: {loans: [{name: Mortgage, set: {escrow: 10}}]}\n", 1)
	// The scenario selects neither changing option; the plan is refused anyway.
	doc = strings.Replace(doc, "{Housing: Sell, Job: Leave}", "{Housing: Keep, Job: Stay}", 1)
	_, _, err := load(t, doc)
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, w := range []string{`loan "Mortgage"`, "two choices", `"Housing"`, `"Job"`} {
		if !strings.Contains(err.Error(), w) {
			t.Errorf("error %q should mention %q", err, w)
		}
	}

	// Two options of the same choice may both change it.
	ok := with(t, "- name: Stay\n", "- name: Stay\n        change: {loans: [{name: Mortgage, set: {escrow: 5}}]}\n")
	ok = strings.Replace(ok, "- name: Leave\n", "- name: Leave\n        remove: {loans: [Mortgage]}\n", 1)
	if _, _, err := load(t, ok); err != nil {
		t.Errorf("two options of one choice may change the same entry: %v", err)
	}
}

// A changed entry is validated as changed, whether or not any scenario
// selects the option.
func TestChangedEntryIsValidatedEvenWhenUnselected(t *testing.T) {
	doc := with(t, "- name: Stay\n", "- name: Stay\n        change: {loans: [{name: Mortgage, set: {term: 0}}]}\n")
	_, _, err := load(t, doc)
	if err == nil {
		t.Fatal("expected an error: the scenario selects Leave, but Stay is broken")
	}
	for _, w := range []string{`choice "Job"`, `option "Stay"`, `loan "Mortgage"`, "term"} {
		if !strings.Contains(err.Error(), w) {
			t.Errorf("error %q should mention %q", err, w)
		}
	}
}

// A value under set is reported as written. YAML reads a full date as a
// timestamp, and re-spelling it as one would quote a value the user never wrote.
func TestSetValueIsQuotedAsWritten(t *testing.T) {
	doc := with(t, "- name: Stay\n", "- name: Stay\n        change: {loans: [{name: Mortgage, set: {earlyPayoffDate: 2027-06-15}}]}\n")
	_, _, err := load(t, doc)
	if err == nil {
		t.Fatal("expected an error: a payoff date names a month, not a day")
	}
	if !strings.Contains(err.Error(), `"2027-06-15"`) {
		t.Errorf("error %q should quote the date as written, \"2027-06-15\"", err)
	}
}

// A scenario's own investments and those its selected options add share one
// list, where names are unique. Two options of one choice never meet.
func TestInvestmentNamesAreUniqueInAResolvedScenario(t *testing.T) {
	inv := "        investments: [{name: Fund}]\n"
	doc := with(t, "- name: Sell\n", "- name: Sell\n"+inv)
	doc = strings.Replace(doc, "- name: Leave\n", "- name: Leave\n"+inv, 1)
	_, _, err := load(t, doc)
	if err == nil {
		t.Fatal("expected an error")
	}
	for _, w := range []string{`scenario "one"`, "duplicate investment name", `"Fund"`} {
		if !strings.Contains(err.Error(), w) {
			t.Errorf("error %q should mention %q", err, w)
		}
	}

	// An inactive scenario is resolved and checked like any other.
	inactive := strings.Replace(doc, "  - name: one\n", "  - name: one\n    active: false\n", 1) +
		"  - name: two\n    select: {Housing: Keep, Job: Stay}\n"
	if _, _, err := load(t, inactive); err == nil || !strings.Contains(err.Error(), `scenario "one"`) {
		t.Errorf("an inactive scenario is still validated; got %v", err)
	}

	same := with(t, "- name: Keep\n", "- name: Keep\n"+inv)
	same = strings.Replace(same, "- name: Sell\n", "- name: Sell\n"+inv, 1)
	if _, _, err := load(t, same); err != nil {
		t.Errorf("two options of one choice may add investments of one name: %v", err)
	}
}

// Warnings name the choice and option, an unknown key inside set is warned
// about, and a warning the baseline entry already raises is not repeated for
// its changed form.
func TestChoiceWarnings(t *testing.T) {
	doc := with(t, "[{name: Rent, amount: -1900}]", "[{name: Rent, amount: -1900, endDate: 2040-01}]")
	doc = strings.Replace(doc, "earlyPayoffThreshold: 5000}", "mortgageInsurance: 50}", 1)
	doc = strings.Replace(doc, "- name: Leave\n", `- name: Leave
        colour: blue
        change:
          loans:
            - name: Mortgage
              set: {sellProperty: true, intrestRate: 3}
`, 1)
	_, warns := mustLoad(t, doc)
	joined := strings.Join(warns, "\n")
	for _, w := range []string{
		`choice "Housing", option "Sell": event "Rent": ends after the simulation end`,
		`choice "Job", option "Leave": change: loan "Mortgage": sellProperty has no effect`,
		`unknown key "choices[1].options[1].colour"`,
		`unknown key "choices[1].options[1].change.loans[0].set.intrestRate"`,
	} {
		if !strings.Contains(joined, w) {
			t.Errorf("warnings should include %q; got:\n%s", w, joined)
		}
	}
	if n := strings.Count(joined, "mortgageInsurance without mortgageInsuranceCutoff"); n != 1 {
		t.Errorf("the baseline's own warning should appear once, not %d times:\n%s", n, joined)
	}
	if strings.Contains(joined, "select") {
		t.Errorf("select must not raise unknown-key warnings:\n%s", joined)
	}
}

// Boundary plans: no choices listed, a choice of one option, one scenario.
func TestChoiceBoundaries(t *testing.T) {
	mustLoad(t, `
version: 2
simulation: {endDate: 2027-01, startingCash: 0}
choices: []
scenarios:
  - name: a
`)
	cfg, _ := mustLoad(t, `
version: 2
simulation: {endDate: 2027-01, startingCash: 0}
choices:
  - name: Only
    options:
      - name: This
        events: [{name: E, amount: 1}]
scenarios:
  - name: a
    select: {Only: This}
`)
	assertNames(t, "events", eventNames(cfg.Scenarios[0].Resolved.Events), []string{"E"})
}

// Chapter 03, Choices, Canonical form: the echoed plan keeps the written
// form, in a fixed key order, with select in choice order.
func TestCanonicalFormKeepsChoices(t *testing.T) {
	cfg, _ := mustLoad(t, `
version: 2
simulation: {startDate: 2026-01, endDate: 2030-01, startingCash: 1000}
scenarios:
  - events: [{name: Own, amount: 1}]
    select: {Job: Leave, Housing: Sell}
    active: false
    name: one
  - name: two
    select: {Housing: Keep, Job: Stay}
choices:
  - name: Housing
    options:
      - name: Keep
      - remove: {events: [Gym]}
        change:
          loans:
            - set: {earlyPayoffThreshold: ~, escrow: 200.5, extraPrincipalPayments: [{amount: 50}]}
              name: Mortgage
        events: [{name: Rent, amount: -1900}]
        name: Sell
  - name: Job
    options: [{name: Stay}, {name: Leave}]
common:
  events: [{name: Gym, amount: -60}]
  loans:
    - {name: Mortgage, principal: 100000, interestRate: 4, term: 360, startDate: 2021-01, earlyPayoffThreshold: 5000}
`)
	out, err := yaml.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	got := string(out)
	want := `choices:
    - name: Housing
      options:
        - name: Keep
        - name: Sell
          events:
            - name: Rent
              amount: -1900
          change:
            loans:
                - name: Mortgage
                  set:
                    earlyPayoffThreshold: null
                    escrow: 200.5
                    extraPrincipalPayments:
                        - amount: 50
          remove:
            events:
                - Gym
    - name: Job
      options:
        - name: Stay
        - name: Leave
scenarios:
    - name: one
      active: false
      select:
        Housing: Sell
        Job: Leave
      events:
        - name: Own
          amount: 1
    - name: two
      select:
        Housing: Keep
        Job: Stay
`
	if !strings.HasSuffix(got, want) {
		t.Errorf("canonical form:\n%s\nshould end with:\n%s", got, want)
	}
	if !strings.Contains(got, "common:") || strings.Index(got, "common:") > strings.Index(got, "choices:") {
		t.Errorf("common is written before choices:\n%s", got)
	}

	// The echoed plan reads back to the same plan.
	again, _ := mustLoad(t, got)
	out2, err := yaml.Marshal(again)
	if err != nil {
		t.Fatal(err)
	}
	if string(out2) != got {
		t.Errorf("the canonical form is not stable:\n%s\n---\n%s", got, out2)
	}
}
