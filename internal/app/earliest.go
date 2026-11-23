package app

import (
	"fmt"
	"strings"

	"github.com/iwvelando/moneypath/config"
	"github.com/iwvelando/moneypath/engine"
)

// Earliest asks for the earliest month in a range at which one entry of an
// active scenario's path can be placed with every chosen guardrail holding
// (spec chapter 04 §11; chapter 02, WASM bridge).
type Earliest struct {
	Scenario string
	// Entry is the entry's place in the plan as written, in the form of a
	// problem's path, such as "common.loans.0".
	Entry string
	// Field is "startDate" or "endDate" for an event, "startDate" for a loan.
	Field      string
	From, To   string
	Guardrails []string
}

// MonthSpan is a stretch of consecutive months, inclusive at both ends.
type MonthSpan struct{ From, To config.Month }

// GuardrailMonths is the stretches of months in which one guardrail holds.
type GuardrailMonths struct {
	Name   string
	Months []MonthSpan
}

// EarliestResult answers an Earliest. Guardrails, Holds, DecidedBy and
// AtEarliest follow the plan's order of guardrails.
type EarliestResult struct {
	Earliest
	// ScenarioIndex indexes the run's active scenarios.
	ScenarioIndex int
	// Name is the entry's name as written.
	Name       string
	Configured config.Month
	// Found says whether some month works; Month is then the first.
	Found bool
	Month config.Month
	Works []MonthSpan
	Holds []GuardrailMonths
	// DecidedBy is the chosen guardrails that break a month before Month;
	// nil when Month is From or nothing works.
	DecidedBy []engine.GuardrailResult
	// AtEarliest is the chosen guardrails' results at Month; nil when
	// nothing works.
	AtEarliest []engine.GuardrailResult
}

// refuse is a question that cannot be asked, in the reader's words.
func refuse(format string, args ...any) error { return fmt.Errorf(format, args...) }

// runEarliest answers in.Earliest of the finished forecast f, on the plan as
// it was run: f.ConfigYAML carries the optimizer's chosen values when there
// were any. f is left untouched.
func runEarliest(in ForecastInput, f *Forecast) (*EarliestResult, error) {
	q := *in.Earliest

	active := make([]string, 0, len(f.Result.Scenarios))
	scIndex := -1
	for i, sr := range f.Result.Scenarios {
		if sr.Name == q.Scenario {
			scIndex = i
		}
		active = append(active, sr.Name)
	}
	if scIndex < 0 {
		return nil, refuse("“%s” is not an active scenario in this plan. The active scenarios are: %s.",
			q.Scenario, strings.Join(active, ", "))
	}

	// The plan as run, parsed afresh so the scan can move its entry, with
	// every scenario but the one asked about set aside.
	cfg, _, err := config.Parse([]byte(f.ConfigYAML))
	if err != nil {
		return nil, err
	}
	if _, err := config.Validate(cfg, in.Now); err != nil {
		return nil, err
	}
	var sc *config.Scenario
	for _, s := range cfg.Scenarios {
		if s.ResolvedActive && s.Name == q.Scenario {
			sc = s
		} else {
			s.ResolvedActive = false
		}
	}

	entry, ok := config.LocateEntry(cfg, sc, q.Entry)
	if !ok {
		return nil, refuse("This plan has no event or loan there to move.")
	}
	where := config.Describe(cfg, q.Entry)
	if !entry.OnPath() {
		return nil, refuse("%s: The scenario “%s” does not have this, so moving it changes nothing there.", where, q.Scenario)
	}
	switch {
	case entry.IsLoan && q.Field != "startDate":
		return nil, refuse("Only a loan’s first payment month can be moved.")
	case !entry.IsLoan && q.Field != "startDate" && q.Field != "endDate":
		return nil, refuse("Only an event’s start or end month can be moved.")
	}

	start, end := cfg.Simulation.ResolvedStart, cfg.Simulation.ResolvedEnd
	from, err := config.ParseMonth(q.From)
	if err != nil {
		return nil, refuse("The first month of the range, “%s”, is not a month. Write the year and the month, like 2030-01.", q.From)
	}
	to, err := config.ParseMonth(q.To)
	if err != nil {
		return nil, refuse("The last month of the range, “%s”, is not a month. Write the year and the month, like 2030-01.", q.To)
	}
	if from > to {
		return nil, refuse("The range starts in %s, after it ends in %s.", from, to)
	}
	if from < start || to > end {
		return nil, refuse("The range must lie inside the plan, from %s to %s.", start, end)
	}

	chosen, names, err := chooseGuardrails(cfg, sc, q.Guardrails)
	if err != nil {
		return nil, err
	}

	res := &EarliestResult{Earliest: q, ScenarioIndex: scIndex, Name: entry.Name}
	res.Earliest.Guardrails = names
	sale, asset := assetSale(sc, entry.Loan)
	place := placer(entry, q.Field, where, sale, asset)
	res.Configured = place.configured
	defer place.restore()

	works := make([]bool, 0, int(to-from)+1)
	holds := make([][]bool, len(chosen))
	results := make([][]engine.GuardrailResult, 0, cap(works))
	for m := from; m <= to; m++ {
		if err := place.at(m); err != nil {
			return nil, err
		}
		run, err := engine.Run(cfg, engine.Options{})
		if err != nil {
			return nil, err
		}
		path := run.Scenarios[0]
		rs := make([]engine.GuardrailResult, len(chosen))
		all := true
		for i, g := range chosen {
			rs[i] = engine.EvaluateGuardrail(g, run.Start, path)
			ok := rs[i].Result == engine.GuardrailHolds
			holds[i] = append(holds[i], ok)
			all = all && ok
		}
		works = append(works, all)
		results = append(results, rs)
	}

	res.Works = stretches(from, works)
	res.Holds = make([]GuardrailMonths, len(chosen))
	for i, g := range chosen {
		res.Holds[i] = GuardrailMonths{Name: g.Name, Months: stretches(from, holds[i])}
	}
	if len(res.Works) > 0 {
		res.Found = true
		res.Month = res.Works[0].From
		at := int(res.Month - from)
		res.AtEarliest = results[at]
		if at > 0 {
			for _, r := range results[at-1] {
				if r.Result == engine.GuardrailBreaks {
					res.DecidedBy = append(res.DecidedBy, r)
				}
			}
		}
	}
	return res, nil
}

// chooseGuardrails resolves the chosen names, in the plan's order, refusing a
// name the plan lacks, a name given twice, and a guardrail that cannot apply
// to the scenario's path whatever month the entry takes.
func chooseGuardrails(cfg *config.Config, sc *config.Scenario, asked []string) ([]*config.Guardrail, []string, error) {
	if len(cfg.Guardrails) == 0 {
		return nil, nil, refuse("This plan has no guardrails to hold.")
	}
	if len(asked) == 0 {
		return nil, nil, refuse("Choose at least one guardrail that must hold.")
	}
	want := map[string]bool{}
	for _, name := range asked {
		if want[name] {
			return nil, nil, refuse("The guardrail “%s” is chosen more than once.", name)
		}
		want[name] = true
		found := false
		for _, g := range cfg.Guardrails {
			found = found || g.Name == name
		}
		if !found {
			return nil, nil, refuse("No guardrail in the plan is named “%s”.", name)
		}
	}
	start, end := cfg.Simulation.ResolvedStart, cfg.Simulation.ResolvedEnd
	var chosen []*config.Guardrail
	var names []string
	for _, g := range cfg.Guardrails {
		if !want[g.Name] {
			continue
		}
		if g.ResolvedEnd < start || g.ResolvedStart > end {
			return nil, nil, refuse("Guardrail “%s” checks no month inside the plan, so it cannot hold in any month.", g.Name)
		}
		if g.Kind == config.GuardrailLasts && !pathHasInvestment(sc, g.Investments) {
			return nil, nil, refuse("Guardrail “%s” checks investments the scenario “%s” does not have, so it cannot hold in any month.", g.Name, sc.Name)
		}
		chosen = append(chosen, g)
		names = append(names, g.Name)
	}
	return chosen, names, nil
}

func pathHasInvestment(sc *config.Scenario, names []string) bool {
	for _, list := range [][]*config.Investment{sc.Resolved.Investments, sc.ResolvedShared.Investments} {
		for _, inv := range list {
			for _, n := range names {
				if inv != nil && inv.Name == n {
					return true
				}
			}
		}
	}
	return false
}

// stretches gathers the months marked true, the first being from, into runs
// of consecutive months. It is empty, not nil, when none is marked.
func stretches(from config.Month, marked []bool) []MonthSpan {
	out := []MonthSpan{}
	for i, ok := range marked {
		if !ok {
			continue
		}
		m := from + config.Month(i)
		if n := len(out); n > 0 && out[n-1].To == m-1 {
			out[n-1].To = m
		} else {
			out = append(out, MonthSpan{From: m, To: m})
		}
	}
	return out
}

// entryPlacer writes a candidate month into one entry of a validated plan
// and puts the entry back as it was afterwards.
type entryPlacer struct {
	configured config.Month
	at         func(m config.Month) error
	restore    func()
}

// assetSale is the sale month of the asset a loan is secured on, on the
// scenario's path, and the asset's name; -1 when it has none or is kept.
func assetSale(sc *config.Scenario, l *config.Loan) (config.Month, string) {
	if l == nil || l.Asset == "" {
		return -1, ""
	}
	for _, list := range [][]*config.Asset{sc.Resolved.Assets, sc.ResolvedShared.Assets} {
		for _, a := range list {
			if a != nil && a.Name == l.Asset {
				return a.ResolvedSell, a.Name
			}
		}
	}
	return -1, ""
}

// placer moves the entry's field on its path (spec chapter 04 §11): an
// event's start or end alone, a one-off event as a whole, a loan's start.
// sale is the sale month of the asset a loan is secured on, or -1.
func placer(entry config.PathEntry, field, where string, sale config.Month, asset string) entryPlacer {
	if l := entry.Loan; l != nil {
		was, wasRaw := l.ResolvedStart, l.StartDate
		return entryPlacer{
			configured: was,
			at: func(m config.Month) error {
				// A secured loan starts before its asset's sale (chapter 03).
				if sale >= 0 && m >= sale {
					return refuse("%s: With its first payment in %s, it would not start before “%s” is sold (%s), which pays it off. Choose a range that ends by %s.", where, m, asset, sale, sale-1)
				}
				l.ResolvedStart, l.StartDate = m, m.String()
				return nil
			},
			restore: func() { l.ResolvedStart, l.StartDate = was, wasRaw },
		}
	}
	ev := entry.Event
	s0, e0, sRaw, eRaw := ev.ResolvedStart, ev.ResolvedEnd, ev.StartDate, ev.EndDate
	oneOff := s0 == e0
	configured := s0
	if field == "endDate" {
		configured = e0
	}
	return entryPlacer{
		configured: configured,
		at: func(m config.Month) error {
			start, end := s0, e0
			switch {
			case oneOff:
				start, end = m, m
			case field == "startDate":
				start = m
			default:
				end = m
			}
			// The one rule of chapter 03 that a moved month can break.
			if start > end {
				if field == "startDate" {
					return refuse("%s: With its start in %s, it would start after it ends (%s). Choose a range that ends by %s.", where, m, end, end)
				}
				return refuse("%s: With its end in %s, it would end before it starts (%s). Choose a range that starts in %s or later.", where, m, start, start)
			}
			ev.ResolvedStart, ev.ResolvedEnd = start, end
			ev.StartDate, ev.EndDate = start.String(), end.String()
			return nil
		},
		restore: func() {
			ev.ResolvedStart, ev.ResolvedEnd, ev.StartDate, ev.EndDate = s0, e0, sRaw, eRaw
		},
	}
}
