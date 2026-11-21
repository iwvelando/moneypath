package config

import (
	"fmt"
	"math"
	"slices"
	"strings"
)

// Validate checks cfg against spec chapter 03, fills every Resolved* field
// (defaults applied, dates parsed), and returns validation warnings. now is
// the current month, used when simulation.startDate is absent. A plan that
// breaks a rule is refused with the first one it breaks; Check reports all.
func Validate(cfg *Config, now Month) ([]string, error) {
	problems := Check(cfg, now)
	if err := firstError(problems); err != nil {
		return nil, err
	}
	return warningsOf(problems), nil
}

// Check is Validate reporting every rule the plan breaks and every warning,
// each with the field it concerns (spec chapter 02, Problems JSON). The
// Resolved* fields are complete only when no problem is an error.
func Check(cfg *Config, now Month) []Problem {
	c := &checker{windowed: map[*Guardrail]bool{}}

	switch {
	case cfg.Version == nil:
		c.fail("version", "This file has no version, so it is not a moneypath plan. Plans in the older finance-forecast format are no longer converted.")
	case *cfg.Version != 2:
		c.fail("version", "This plan is version %d, and moneypath reads version 2.", *cfg.Version)
	}

	// Simulation.
	sim := &cfg.Simulation
	start, haveStart := now, true
	if sim.StartDate != "" {
		start, haveStart = c.month("simulation.startDate", "start month", sim.StartDate)
	}
	var end Month
	haveEnd := false
	if sim.EndDate == "" {
		c.fail("simulation.endDate", "The end month is required.")
	} else {
		end, haveEnd = c.month("simulation.endDate", "end month", sim.EndDate)
	}
	c.window = haveStart && haveEnd
	if c.window && end < start {
		c.fail("simulation.endDate", "The end month (%s) is before the start month (%s).", end, start)
		c.window = false
	}
	c.start, c.end = start, end
	sim.ResolvedStart, sim.ResolvedEnd = start, end
	if sim.StartingCash == nil {
		c.warn("simulation.startingCash", "No starting cash is given, so the plan starts with 0.00.")
		sim.ResolvedStartingCash = 0
	} else {
		sim.ResolvedStartingCash = *sim.StartingCash
	}
	if sim.CashInterestRate < 0 {
		c.fail("simulation.cashInterestRate", "The cash interest rate must be at least 0.")
	}
	c.inflation = sim.InflationRate
	if !(sim.InflationRate > -100) || math.IsInf(sim.InflationRate, 0) {
		c.fail("simulation.inflationRate", "The inflation rate must be more than -100.")
	}

	// Recommendations.
	cfg.ResolvedEmergencyFundMonths = 6
	if cfg.Recommendations != nil && cfg.Recommendations.EmergencyFundMonths != nil {
		n := *cfg.Recommendations.EmergencyFundMonths
		if n < 0 {
			c.fail("recommendations.emergencyFundMonths", "The emergency fund months must be at least 0.")
		}
		cfg.ResolvedEmergencyFundMonths = n
	}

	c.guardrails(cfg.Guardrails, entryNames(cfg))

	// Scenarios.
	if len(cfg.Scenarios) == 0 {
		c.fail("scenarios", "A plan needs at least one scenario.")
	}
	seen := map[string]bool{}
	for i, sc := range cfg.Scenarios {
		path := join("scenarios", i)
		if sc == nil {
			c.fail(path, "This scenario is empty.")
			continue
		}
		switch {
		case sc.Name == "":
			c.fail(join(path, "name"), "The scenario needs a name.")
		case seen[sc.Name]:
			c.fail(join(path, "name"), "Another scenario is already named “%s”. Give each scenario its own name.", sc.Name)
		}
		seen[sc.Name] = true
		sc.ResolvedActive = sc.Active == nil || *sc.Active
	}

	c.section(&cfg.Common, "common", "An optimizer cannot be used on a baseline event; put the event in a scenario.")
	c.choices(cfg)
	for i, sc := range cfg.Scenarios {
		if sc != nil {
			c.section(&sc.Section, join("scenarios", i), "")
		}
	}
	c.resolveScenarios(cfg)
	c.optimizerGuardrails(cfg)

	for i := range c.problems {
		c.problems[i].Where = locate(cfg.doc, c.problems[i].Path)
	}
	return c.problems
}

// optimizerGuardrails resolves the guardrail each optimizer target names and
// checks that it applies to the target's scenario (spec chapter 03,
// Optimizer block). It runs once guardrail windows and scenarios are
// resolved; a scenario whose selection could not be resolved is not judged
// on its investments.
func (c *checker) optimizerGuardrails(cfg *Config) {
	byName := map[string]*Guardrail{}
	for _, g := range cfg.Guardrails {
		if g != nil && g.Name != "" && byName[g.Name] == nil {
			byName[g.Name] = g
		}
	}
	for si, sc := range cfg.Scenarios {
		if sc == nil {
			continue
		}
		selectPath := join("scenarios", si, "select")
		resolved := true
		for _, p := range c.problems {
			if p.Level == LevelError && (p.Path == selectPath || strings.HasPrefix(p.Path, selectPath+".")) {
				resolved = false
			}
		}
		for ei, ev := range sc.Events {
			if ev == nil || ev.Optimize == nil || ev.Optimize.Guardrail == "" {
				continue
			}
			at := join("scenarios", si, "events", ei, "optimize", "guardrail")
			g := byName[ev.Optimize.Guardrail]
			switch {
			case g == nil:
				c.fail(at, "No guardrail in the plan is named “%s”.", ev.Optimize.Guardrail)
				continue
			case c.windowed[g] && (g.ResolvedStart > c.end || g.ResolvedEnd < c.start):
				c.fail(at, "Guardrail “%s” checks no month inside the plan, so it cannot hold this value.", g.Name)
			case g.Kind == GuardrailLasts && resolved && !hasInvestment(sc, g.Investments):
				c.fail(at, "Guardrail “%s” checks investments this scenario does not have, so it cannot hold this value.", g.Name)
			}
			ev.Optimize.ResolvedGuardrail = g
		}
	}
}

// hasInvestment reports whether a resolved scenario has an investment by any
// of the names.
func hasInvestment(sc *Scenario, names []string) bool {
	for _, list := range [][]*Investment{sc.Resolved.Investments, sc.ResolvedShared.Investments} {
		for _, inv := range list {
			if inv != nil && slices.Contains(names, inv.Name) {
				return true
			}
		}
	}
	return false
}

// checker gathers the problems of one plan.
type checker struct {
	problems []Problem
	// The simulation's months, and whether both are known. An entry is held
	// against them only when they are.
	start, end Month
	window     bool
	// windowed holds the guardrails whose window is known and in order,
	// so that it can be held against the simulation's months.
	windowed map[*Guardrail]bool
	// inflation is the plan's inflation rate, which a growth of inflation
	// follows.
	inflation float64
}

// growth checks a growth or an escrow growth at path, whose label in the app
// is label, and resolves it against the plan's inflation rate (spec chapter
// 03, Growth). unused, when set, is why a growth written there has no effect.
func (c *checker) growth(g *Growth, path, label, unused string) {
	g.resolve(c.inflation)
	if g.Fixed() {
		return
	}
	switch {
	case g.invalid != nil || math.IsNaN(*g.rateOr0()) || math.IsInf(*g.rateOr0(), 0):
		c.fail(path, "%s must be fixed, inflation or a yearly rate in percent, such as 3.", label)
	case g.rate != nil && *g.rate <= -100:
		c.fail(path, "The yearly growth must be more than -100.")
	case unused != "":
		c.warn(path, "%s", unused)
	case g.inflation && c.inflation == 0:
		c.warn(path, "This follows the plan’s inflation rate, which is 0, so it stays the same.")
	}
}

func (c *checker) fail(path, format string, args ...any) {
	c.problems = append(c.problems, Problem{Level: LevelError, Path: path, Message: fmt.Sprintf(format, args...)})
}

func (c *checker) warn(path, format string, args ...any) {
	c.problems = append(c.problems, Problem{Level: LevelWarning, Path: path, Message: fmt.Sprintf(format, args...)})
}

// month parses a month the reader knows by label, such as "end month".
func (c *checker) month(path, label, s string) (Month, bool) {
	m, err := ParseMonth(s)
	if err != nil {
		c.fail(path, "The %s, “%s”, is not a month. Write the year and the month, like 2030-01.", label, s)
		return 0, false
	}
	return m, true
}

// planNames is every loan and investment name written anywhere in the plan:
// in common, an option's added entries, or a scenario's own, active or not.
type planNames struct{ loans, investments map[string]bool }

func entryNames(cfg *Config) planNames {
	names := planNames{loans: map[string]bool{}, investments: map[string]bool{}}
	add := func(s *Section) {
		for _, l := range s.Loans {
			if l != nil {
				names.loans[l.Name] = true
			}
		}
		for _, inv := range s.Investments {
			if inv != nil {
				names.investments[inv.Name] = true
			}
		}
	}
	add(&cfg.Common)
	for _, ch := range cfg.Choices {
		if ch == nil {
			continue
		}
		for _, opt := range ch.Options {
			if opt != nil {
				add(&opt.Section)
			}
		}
	}
	for _, sc := range cfg.Scenarios {
		if sc != nil {
			add(&sc.Section)
		}
	}
	return names
}

// guardrailNames checks the names a guardrail lists: each once, and each the
// name of an entry of that kind in the plan (spec chapter 03, Guardrails).
func (c *checker) guardrailNames(path string, names []string, known map[string]bool, noun string) {
	listed := map[string]bool{}
	for j, name := range names {
		switch {
		case listed[name]:
			c.fail(join(path, j), "“%s” is already listed.", name)
		case !known[name]:
			c.fail(join(path, j), "No %s in the plan is named “%s”.", noun, name)
		}
		listed[name] = true
	}
}

// guardrails checks the plan's guardrails and resolves each one's window
// (spec chapter 03, Guardrails).
func (c *checker) guardrails(guardrails []*Guardrail, plan planNames) {
	names := map[string]bool{}
	for i, g := range guardrails {
		path := join("guardrails", i)
		if g == nil {
			c.fail(path, "This guardrail is empty.")
			continue
		}
		at := func(field string) string { return join(path, field) }
		switch {
		case g.Name == "":
			c.fail(at("name"), "The guardrail needs a name.")
		case names[g.Name]:
			c.fail(at("name"), "Another guardrail is already named “%s”. Give each guardrail its own name.", g.Name)
		}
		names[g.Name] = true

		switch g.Kind {
		case "":
			c.fail(at("kind"), "The guardrail needs a kind.")
		case GuardrailCashFloor:
			if g.Amount == nil {
				c.fail(at("amount"), "The floor amount is required.")
			}
			if g.Investments != nil {
				c.warn(at("investments"), "A cash floor does not use investments, so this has no effect.")
			}
			if g.Loans != nil {
				c.warn(at("loans"), "A cash floor does not use loans, so this has no effect.")
			}
		case GuardrailDebtFree:
			if g.StartDate == "" {
				c.fail(at("startDate"), "A debt-free guardrail needs a start month, the month from which nothing may be owed.")
			}
			if g.Amount != nil {
				c.warn(at("amount"), "A debt-free guardrail does not use an amount, so this has no effect.")
			}
			if g.Investments != nil {
				c.warn(at("investments"), "A debt-free guardrail does not use investments, so this has no effect.")
			}
			if g.Loans != nil && len(g.Loans) == 0 {
				c.fail(at("loans"), "List at least one loan, or leave the list out to check every loan.")
			}
			c.guardrailNames(at("loans"), g.Loans, plan.loans, "loan")
		case GuardrailLasts:
			if len(g.Investments) == 0 {
				c.fail(at("investments"), "List at least one investment whose balance must last.")
			}
			c.guardrailNames(at("investments"), g.Investments, plan.investments, "investment")
			if g.Amount != nil && *g.Amount <= 0 {
				c.fail(at("amount"), "The amount must be more than 0. Leave it out to mean the investments must never be emptied.")
			}
			if g.Loans != nil {
				c.warn(at("loans"), "A guardrail on investments that last does not use loans, so this has no effect.")
			}
		default:
			c.fail(at("kind"), "“%s” is not a kind of guardrail. Use cashFloor, debtFree or lasts.", g.Kind)
		}
		unused := ""
		switch {
		case g.Kind == GuardrailDebtFree:
			unused = "A debt-free guardrail does not use growth, so this has no effect."
		case g.Kind == GuardrailLasts && g.Amount == nil:
			unused = "Growth applies to the amount, and this guardrail has none, so this has no effect."
		}
		c.growth(&g.Growth, at("growth"), "Growth", unused)

		start, haveStart := c.start, c.window
		if g.StartDate != "" {
			start, haveStart = c.month(at("startDate"), "start month", g.StartDate)
		}
		end, haveEnd := c.end, c.window
		if g.EndDate != "" {
			end, haveEnd = c.month(at("endDate"), "end month", g.EndDate)
		}
		g.ResolvedStart, g.ResolvedEnd = start, end
		switch {
		case !haveStart || !haveEnd:
		case g.StartDate != "" && g.EndDate != "" && end < start:
			c.fail(at("endDate"), "The end month (%s) is before the start month (%s).", end, start)
		case !c.window:
		default:
			c.windowed[g] = true
		}
		switch {
		case !c.windowed[g]:
		case start > c.end:
			c.warn(at("startDate"), "This starts after the simulation ends (%s), so the guardrail has no month to check and does not apply.", c.end)
		case end < c.start:
			c.warn(at("endDate"), "This ends before the simulation starts (%s), so the guardrail has no month to check and does not apply.", c.start)
		}
	}
}

// section checks one list of entries at path. noOptimize, when set, is why
// an event of this list cannot carry an optimizer.
func (c *checker) section(s *Section, path, noOptimize string) {
	for i, ev := range s.Events {
		c.event(ev, join(path, "events", i), noOptimize)
	}
	for i, l := range s.Loans {
		c.loan(l, join(path, "loans", i))
	}
	names := map[string]bool{}
	for i, inv := range s.Investments {
		p := join(path, "investments", i)
		c.investment(inv, p)
		if inv == nil || inv.Name == "" {
			continue
		}
		if names[inv.Name] {
			c.fail(join(p, "name"), "Another investment here is already named “%s”. Give each its own name.", inv.Name)
		}
		names[inv.Name] = true
	}
}

// event checks a cash-flow event.
func (c *checker) event(ev *Event, path, noOptimize string) {
	if ev == nil {
		c.fail(path, "This event is empty.")
		return
	}
	if ev.Amount == nil {
		c.fail(join(path, "amount"), "The amount is required.")
	}
	if ev.Percentage != nil {
		c.fail(join(path, "percentage"), "A percentage can only be used on an investment’s withdrawal.")
	}
	c.growth(&ev.Growth, join(path, "growth"), "Growth", "")
	c.schedule(ev, path)
	if ev.Optimize != nil {
		if noOptimize != "" {
			c.fail(join(path, "optimize"), "%s", noOptimize)
			return
		}
		c.optimize(ev.Optimize, join(path, "optimize"))
	}
}

// schedule applies schedule defaults and shared checks (chapter 03 §Event,
// chapter 04 §2).
func (c *checker) schedule(ev *Event, path string) {
	ev.ResolvedFrequency = 1
	if ev.Frequency != nil {
		if *ev.Frequency < 1 {
			c.fail(join(path, "frequency"), "The frequency must be a whole number of months, 1 or more.")
		} else {
			ev.ResolvedFrequency = *ev.Frequency
		}
	}
	haveStart, haveEnd := c.window, c.window
	ev.ResolvedStart = c.start
	if ev.StartDate != "" {
		ev.ResolvedStart, haveStart = c.month(join(path, "startDate"), "start month", ev.StartDate)
	}
	ev.ResolvedEnd = c.end
	if ev.EndDate != "" {
		ev.ResolvedEnd, haveEnd = c.month(join(path, "endDate"), "end month", ev.EndDate)
	}
	if haveStart && haveEnd && ev.ResolvedStart > ev.ResolvedEnd {
		switch {
		case ev.StartDate == "":
			c.fail(join(path, "endDate"), "The end month (%s) is before the simulation starts (%s).", ev.ResolvedEnd, ev.ResolvedStart)
		case ev.EndDate == "":
			c.fail(join(path, "startDate"), "The start month (%s) is after the simulation ends (%s).", ev.ResolvedStart, ev.ResolvedEnd)
		default:
			c.fail(join(path, "startDate"), "The start month (%s) is after the end month (%s).", ev.ResolvedStart, ev.ResolvedEnd)
		}
		return
	}
	if !c.window {
		return
	}
	if haveStart && ev.ResolvedStart >= c.end && ev.ResolvedStart != c.start {
		c.warn(join(path, "startDate"), "This starts at or after the end of the simulation (%s).", c.end)
	}
	if haveEnd && ev.ResolvedEnd > c.end {
		c.warn(join(path, "endDate"), "This ends after the simulation does (%s), so the later months are not counted.", c.end)
	}
}

// payment checks an event that moves a positive amount and nothing else: a
// loan's extra principal payment or an investment's contribution.
func (c *checker) payment(ev *Event, path string) {
	if ev == nil {
		c.fail(path, "This entry is empty.")
		return
	}
	if ev.Amount == nil || *ev.Amount <= 0 {
		c.fail(join(path, "amount"), "The amount must be more than 0.")
	}
	if ev.Percentage != nil {
		c.fail(join(path, "percentage"), "A percentage cannot be used here.")
	}
	c.growth(&ev.Growth, join(path, "growth"), "Growth", "")
	if ev.Optimize != nil {
		c.fail(join(path, "optimize"), "An optimizer cannot be used here.")
	}
	c.schedule(ev, path)
}

func (c *checker) loan(l *Loan, path string) {
	if l == nil {
		c.fail(path, "This loan is empty.")
		return
	}
	at := func(field string) string { return join(path, field) }
	if l.Name == "" {
		c.fail(at("name"), "The loan needs a name.")
	}
	if l.Principal <= 0 {
		c.fail(at("principal"), "The principal must be more than 0.")
	}
	if l.Term < 1 {
		c.fail(at("term"), "The term must be 1 month or more.")
	}
	if l.InterestRate < 0 {
		c.fail(at("interestRate"), "The interest rate must be at least 0.")
	}
	if l.DownPayment < 0 || (l.Principal > 0 && l.DownPayment >= l.Principal) {
		c.fail(at("downPayment"), "The down payment must be at least 0 and less than the principal.")
	}
	if l.Escrow < 0 {
		c.fail(at("escrow"), "The escrow must be at least 0.")
	}
	noEscrow := ""
	if l.Escrow == 0 {
		noEscrow = "There is no escrow to grow, so this has no effect."
	}
	c.growth(&l.EscrowGrowth, at("escrowGrowth"), "Escrow growth", noEscrow)
	if l.MortgageInsurance < 0 {
		c.fail(at("mortgageInsurance"), "The mortgage insurance must be at least 0.")
	}
	if l.MortgageInsuranceCutoff < 0 || l.MortgageInsuranceCutoff > 100 {
		c.fail(at("mortgageInsuranceCutoff"), "The mortgage insurance cutoff must be at least 0 and at most 100.")
	}
	if l.EarlyPayoffThreshold < 0 {
		c.fail(at("earlyPayoffThreshold"), "The early payoff threshold must be at least 0.")
	}
	haveStart := false
	if l.StartDate == "" {
		c.fail(at("startDate"), "The first payment month is required.")
	} else {
		l.ResolvedStart, haveStart = c.month(at("startDate"), "first payment month", l.StartDate)
	}
	l.ResolvedEarlyPayoffDate = -1
	if l.EarlyPayoffDate != "" {
		if d, ok := c.month(at("earlyPayoffDate"), "early payoff month", l.EarlyPayoffDate); ok {
			l.ResolvedEarlyPayoffDate = d
			if haveStart && d <= l.ResolvedStart {
				c.warn(at("earlyPayoffDate"), "The early payoff month (%s) is not after the first payment (%s).", d, l.ResolvedStart)
			}
		}
	}
	l.ResolvedSellPrice = l.Principal
	if l.SellPrice != nil {
		l.ResolvedSellPrice = *l.SellPrice
	}
	if l.SellProperty && l.EarlyPayoffDate == "" && l.EarlyPayoffThreshold == 0 {
		c.warn(at("sellProperty"), "Selling the property has no effect without an early payoff month or an early payoff threshold.")
	}
	if l.MortgageInsurance > 0 && l.MortgageInsuranceCutoff == 0 {
		c.warn(at("mortgageInsuranceCutoff"), "With no cutoff, the mortgage insurance is charged for the whole life of the loan.")
	}
	for j, ev := range l.ExtraPrincipalPayments {
		c.payment(ev, join(path, "extraPrincipalPayments", j))
	}
}

func (c *checker) investment(inv *Investment, path string) {
	if inv == nil {
		c.fail(path, "This investment is empty.")
		return
	}
	at := func(field string) string { return join(path, field) }
	if inv.Name == "" {
		c.fail(at("name"), "The investment needs a name.")
	}
	if inv.StartingValue < 0 {
		c.fail(at("startingValue"), "The starting value must be at least 0.")
	}
	if inv.TaxRate < 0 || inv.TaxRate >= 100 {
		c.fail(at("taxRate"), "The growth tax rate must be at least 0 and less than 100.")
	}
	if inv.WithdrawalTaxRate < 0 || inv.WithdrawalTaxRate >= 100 {
		c.fail(at("withdrawalTaxRate"), "The withdrawal tax rate must be at least 0 and less than 100.")
	}
	for j, ev := range inv.Contributions {
		c.payment(ev, join(path, "contributions", j))
	}
	amounts, percentages := false, false
	for j, ev := range inv.Withdrawals {
		p := join(path, "withdrawals", j)
		if ev == nil {
			c.fail(p, "This withdrawal is empty.")
			continue
		}
		hasAmount, hasPct := ev.Amount != nil, ev.Percentage != nil
		switch {
		case hasAmount == hasPct:
			c.fail(join(p, "amount"), "A withdrawal needs either an amount or a percentage, and not both.")
		case hasAmount:
			amounts = true
			if *ev.Amount <= 0 {
				c.fail(join(p, "amount"), "The amount must be more than 0.")
			}
		default:
			percentages = true
			if *ev.Percentage <= 0 {
				c.fail(join(p, "percentage"), "The percentage must be more than 0.")
			}
		}
		byPercentage := ""
		if !hasAmount && hasPct {
			byPercentage = "A percentage withdrawal already follows the balance, so growth has no effect."
		}
		c.growth(&ev.Growth, join(p, "growth"), "Growth", byPercentage)
		if ev.Optimize != nil {
			c.fail(join(p, "optimize"), "An optimizer cannot be used here.")
		}
		c.schedule(ev, p)
	}
	if amounts && percentages {
		c.fail(at("withdrawals"), "An investment’s withdrawals must all be amounts or all be percentages, never a mix.")
	}
}

func (c *checker) optimize(o *Optimize, path string) {
	at := func(field string) string { return join(path, field) }
	field := strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(o.Field))
	switch field {
	case "amount":
		o.ResolvedField = "amount"
	case "frequency":
		o.ResolvedField = "frequency"
	case "startdate":
		o.ResolvedField = "startDate"
	case "enddate":
		o.ResolvedField = "endDate"
	default:
		c.fail(at("field"), "The field to adjust must be the amount, the frequency, the start month or the end month.")
		return
	}
	o.ResolvedTol = 0.01
	if o.ResolvedField != "amount" {
		o.ResolvedTol = 1
	}
	if o.Tolerance != nil {
		if *o.Tolerance <= 0 {
			c.fail(at("tolerance"), "The tolerance must be more than 0.")
		} else {
			o.ResolvedTol = *o.Tolerance
		}
	}
	o.ResolvedMaxIter = 50
	if o.MaxIterations != nil {
		if *o.MaxIterations < 1 {
			c.fail(at("maxIterations"), "The max iterations must be 1 or more.")
		} else {
			o.ResolvedMaxIter = *o.MaxIterations
		}
	}
	switch o.ResolvedField {
	case "amount", "frequency":
		if o.Min == nil {
			c.fail(at("min"), "The lower bound is required.")
		}
		if o.Max == nil {
			c.fail(at("max"), "The upper bound is required.")
		}
		if o.Min == nil || o.Max == nil {
			return
		}
		if !(*o.Min < *o.Max) {
			c.fail(at("min"), "The lower bound must be less than the upper bound.")
		}
		if o.ResolvedField == "frequency" {
			if *o.Min < 1 || *o.Min != math.Trunc(*o.Min) {
				c.fail(at("min"), "The lower bound must be a whole number of months, 1 or more.")
			}
			if *o.Max != math.Trunc(*o.Max) {
				c.fail(at("max"), "The upper bound must be a whole number of months.")
			}
		}
	default: // startDate, endDate
		var mn, mx Month
		haveMin, haveMax := false, false
		if o.MinDate == "" {
			c.fail(at("minDate"), "The earliest month is required.")
		} else {
			mn, haveMin = c.month(at("minDate"), "earliest month", o.MinDate)
		}
		if o.MaxDate == "" {
			c.fail(at("maxDate"), "The latest month is required.")
		} else {
			mx, haveMax = c.month(at("maxDate"), "latest month", o.MaxDate)
		}
		if haveMin && haveMax && mn > mx {
			c.fail(at("minDate"), "The earliest month must not be after the latest month.")
		}
		o.ResolvedMinDate, o.ResolvedMaxDate = mn, mx
	}
}
