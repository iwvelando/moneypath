package config

import (
	"fmt"
	"math"
	"strings"

	"gopkg.in/yaml.v3"
)

// LooksLegacy reports whether raw YAML appears to be a v1 (finance-forecast
// era) config: no version field, or a common.deathDate key (spec chapter 05).
func LooksLegacy(data []byte) bool {
	var doc struct {
		Version *int `yaml:"version"`
		Common  struct {
			DeathDate *string `yaml:"deathDate"`
		} `yaml:"common"`
	}
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return false
	}
	return doc.Version == nil || doc.Common.DeathDate != nil
}

// Validate checks cfg against spec chapter 03, fills every Resolved* field
// (defaults applied, dates parsed), and returns validation warnings. now is
// the current month, used when simulation.startDate is absent.
func Validate(cfg *Config, now Month) ([]string, error) {
	var warns []string

	if cfg.Version == nil {
		return nil, fmt.Errorf("missing 'version' field — legacy configs can be converted with 'moneypath migrate'")
	}
	if *cfg.Version != 2 {
		return nil, fmt.Errorf("unsupported config version %d (expected 2)", *cfg.Version)
	}

	// Simulation.
	sim := &cfg.Simulation
	if sim.EndDate == "" {
		return nil, fmt.Errorf("simulation.endDate is required")
	}
	end, err := ParseMonth(sim.EndDate)
	if err != nil {
		return nil, fmt.Errorf("simulation.endDate: %w", err)
	}
	start := now
	if sim.StartDate != "" {
		if start, err = ParseMonth(sim.StartDate); err != nil {
			return nil, fmt.Errorf("simulation.startDate: %w", err)
		}
	}
	if end < start {
		return nil, fmt.Errorf("simulation.endDate %s is before startDate %s", end, start)
	}
	sim.ResolvedStart, sim.ResolvedEnd = start, end
	if sim.StartingCash == nil {
		warns = append(warns, "simulation.startingCash is absent; treating it as 0.00")
		sim.ResolvedStartingCash = 0
	} else {
		sim.ResolvedStartingCash = *sim.StartingCash
	}

	if sim.CashInterestRate < 0 {
		return nil, fmt.Errorf("simulation.cashInterestRate must be at least 0 (got %v)", sim.CashInterestRate)
	}

	// Recommendations.
	cfg.ResolvedEmergencyFundMonths = 6
	if cfg.Recommendations != nil && cfg.Recommendations.EmergencyFundMonths != nil {
		n := *cfg.Recommendations.EmergencyFundMonths
		if n < 0 {
			return nil, fmt.Errorf("recommendations.emergencyFundMonths must be >= 0")
		}
		cfg.ResolvedEmergencyFundMonths = n
	}

	// Scenarios.
	if len(cfg.Scenarios) == 0 {
		return nil, fmt.Errorf("at least one scenario is required")
	}
	seen := map[string]bool{}
	for i, sc := range cfg.Scenarios {
		if sc == nil || sc.Name == "" {
			return nil, fmt.Errorf("scenarios[%d] has no name", i)
		}
		if seen[sc.Name] {
			return nil, fmt.Errorf("duplicate scenario name %q", sc.Name)
		}
		seen[sc.Name] = true
		sc.ResolvedActive = sc.Active == nil || *sc.Active
	}

	if err := validateSection(&cfg.Common, "common", true, start, end, &warns); err != nil {
		return nil, err
	}
	for _, sc := range cfg.Scenarios {
		where := fmt.Sprintf("scenario %q", sc.Name)
		if err := validateSection(&sc.Section, where, false, start, end, &warns); err != nil {
			return nil, err
		}
	}
	return warns, nil
}

func validateSection(s *Section, where string, isCommon bool, start, end Month, warns *[]string) error {
	for i, ev := range s.Events {
		name := eventLabel(ev, i)
		if ev.Amount == nil {
			return fmt.Errorf("%s: event %s: amount is required", where, name)
		}
		if ev.Percentage != nil {
			return fmt.Errorf("%s: event %s: percentage is only valid on investment withdrawals", where, name)
		}
		if err := resolveEvent(ev, fmt.Sprintf("%s: event %s", where, name), start, end, warns); err != nil {
			return err
		}
		if ev.Optimize != nil {
			if isCommon {
				return fmt.Errorf("%s: event %s: optimize is not allowed on common events", where, name)
			}
			if err := validateOptimize(ev, fmt.Sprintf("%s: event %s", where, name)); err != nil {
				return err
			}
		}
	}
	for i, l := range s.Loans {
		if err := validateLoan(l, where, i, start, end, warns); err != nil {
			return err
		}
	}
	names := map[string]bool{}
	for i, inv := range s.Investments {
		if err := validateInvestment(inv, where, i, start, end, warns); err != nil {
			return err
		}
		if names[inv.Name] {
			return fmt.Errorf("%s: duplicate investment name %q", where, inv.Name)
		}
		names[inv.Name] = true
	}
	return nil
}

func eventLabel(ev *Event, i int) string {
	if ev.Name != "" {
		return fmt.Sprintf("%q", ev.Name)
	}
	return fmt.Sprintf("#%d", i+1)
}

// resolveEvent applies schedule defaults and shared checks (chapter 03
// §Event, chapter 04 §2).
func resolveEvent(ev *Event, where string, start, end Month, warns *[]string) error {
	ev.ResolvedFrequency = 1
	if ev.Frequency != nil {
		if *ev.Frequency < 1 {
			return fmt.Errorf("%s: frequency must be >= 1", where)
		}
		ev.ResolvedFrequency = *ev.Frequency
	}
	ev.ResolvedStart = start
	if ev.StartDate != "" {
		s, err := ParseMonth(ev.StartDate)
		if err != nil {
			return fmt.Errorf("%s: startDate: %w", where, err)
		}
		ev.ResolvedStart = s
	}
	ev.ResolvedEnd = end
	if ev.EndDate != "" {
		e, err := ParseMonth(ev.EndDate)
		if err != nil {
			return fmt.Errorf("%s: endDate: %w", where, err)
		}
		ev.ResolvedEnd = e
	}
	if ev.ResolvedStart > ev.ResolvedEnd {
		return fmt.Errorf("%s: startDate %s is after endDate %s", where, ev.ResolvedStart, ev.ResolvedEnd)
	}
	if ev.ResolvedStart >= end && ev.ResolvedStart != start {
		*warns = append(*warns, fmt.Sprintf("%s: starts at or after the simulation end (%s)", where, end))
	}
	if ev.ResolvedEnd > end {
		*warns = append(*warns, fmt.Sprintf("%s: ends after the simulation end (%s)", where, end))
	}
	return nil
}

func validateLoan(l *Loan, where string, i int, start, end Month, warns *[]string) error {
	if l.Name == "" {
		return fmt.Errorf("%s: loans[%d]: name is required", where, i)
	}
	w := fmt.Sprintf("%s: loan %q", where, l.Name)
	if l.Principal <= 0 {
		return fmt.Errorf("%s: principal must be > 0", w)
	}
	if l.Term < 1 {
		return fmt.Errorf("%s: term must be >= 1", w)
	}
	if l.InterestRate < 0 {
		return fmt.Errorf("%s: interestRate must be >= 0", w)
	}
	if l.DownPayment < 0 || l.DownPayment >= l.Principal {
		return fmt.Errorf("%s: downPayment must be >= 0 and < principal", w)
	}
	if l.Escrow < 0 {
		return fmt.Errorf("%s: escrow must be >= 0", w)
	}
	if l.MortgageInsurance < 0 {
		return fmt.Errorf("%s: mortgageInsurance must be >= 0", w)
	}
	if l.MortgageInsuranceCutoff < 0 || l.MortgageInsuranceCutoff > 100 {
		return fmt.Errorf("%s: mortgageInsuranceCutoff must be between 0 and 100", w)
	}
	if l.EarlyPayoffThreshold < 0 {
		return fmt.Errorf("%s: earlyPayoffThreshold must be >= 0", w)
	}
	if l.StartDate == "" {
		return fmt.Errorf("%s: startDate is required", w)
	}
	s, err := ParseMonth(l.StartDate)
	if err != nil {
		return fmt.Errorf("%s: startDate: %w", w, err)
	}
	l.ResolvedStart = s
	l.ResolvedEarlyPayoffDate = -1
	if l.EarlyPayoffDate != "" {
		d, err := ParseMonth(l.EarlyPayoffDate)
		if err != nil {
			return fmt.Errorf("%s: earlyPayoffDate: %w", w, err)
		}
		l.ResolvedEarlyPayoffDate = d
		if d <= s {
			*warns = append(*warns, fmt.Sprintf("%s: earlyPayoffDate %s is not after the loan start %s", w, d, s))
		}
	}
	l.ResolvedSellPrice = l.Principal
	if l.SellPrice != nil {
		l.ResolvedSellPrice = *l.SellPrice
	}
	if l.SellProperty && l.EarlyPayoffDate == "" && l.EarlyPayoffThreshold == 0 {
		*warns = append(*warns, fmt.Sprintf("%s: sellProperty has no effect without earlyPayoffDate or earlyPayoffThreshold", w))
	}
	if l.MortgageInsurance > 0 && l.MortgageInsuranceCutoff == 0 {
		*warns = append(*warns, fmt.Sprintf("%s: mortgageInsurance without mortgageInsuranceCutoff applies for the whole life of the loan", w))
	}
	for j, ev := range l.ExtraPrincipalPayments {
		ew := fmt.Sprintf("%s: extraPrincipalPayments %s", w, eventLabel(ev, j))
		if ev.Amount == nil || *ev.Amount <= 0 {
			return fmt.Errorf("%s: amount must be > 0", ew)
		}
		if ev.Percentage != nil {
			return fmt.Errorf("%s: percentage is not allowed", ew)
		}
		if ev.Optimize != nil {
			return fmt.Errorf("%s: optimize is not allowed", ew)
		}
		if err := resolveEvent(ev, ew, start, end, warns); err != nil {
			return err
		}
	}
	return nil
}

func validateInvestment(inv *Investment, where string, i int, start, end Month, warns *[]string) error {
	if inv.Name == "" {
		return fmt.Errorf("%s: investments[%d]: name is required", where, i)
	}
	w := fmt.Sprintf("%s: investment %q", where, inv.Name)
	if inv.StartingValue < 0 {
		return fmt.Errorf("%s: startingValue must be >= 0", w)
	}
	if inv.TaxRate < 0 || inv.TaxRate >= 100 {
		return fmt.Errorf("%s: taxRate must be at least 0 and less than 100", w)
	}
	if inv.WithdrawalTaxRate < 0 || inv.WithdrawalTaxRate >= 100 {
		return fmt.Errorf("%s: withdrawalTaxRate must be at least 0 and less than 100", w)
	}
	for j, ev := range inv.Contributions {
		ew := fmt.Sprintf("%s: contributions %s", w, eventLabel(ev, j))
		if ev.Amount == nil || *ev.Amount <= 0 {
			return fmt.Errorf("%s: amount must be > 0", ew)
		}
		if ev.Percentage != nil {
			return fmt.Errorf("%s: percentage is not allowed on contributions", ew)
		}
		if ev.Optimize != nil {
			return fmt.Errorf("%s: optimize is not allowed", ew)
		}
		if err := resolveEvent(ev, ew, start, end, warns); err != nil {
			return err
		}
	}
	style := 0 // 1 = amount, 2 = percentage
	for j, ev := range inv.Withdrawals {
		ew := fmt.Sprintf("%s: withdrawals %s", w, eventLabel(ev, j))
		hasAmount := ev.Amount != nil
		hasPct := ev.Percentage != nil
		if hasAmount == hasPct {
			return fmt.Errorf("%s: exactly one of amount or percentage is required", ew)
		}
		if hasAmount && *ev.Amount <= 0 {
			return fmt.Errorf("%s: amount must be > 0", ew)
		}
		if hasPct && *ev.Percentage <= 0 {
			return fmt.Errorf("%s: percentage must be > 0", ew)
		}
		this := 1
		if hasPct {
			this = 2
		}
		if style != 0 && style != this {
			return fmt.Errorf("%s: an investment must not mix amount-style and percentage-style withdrawals", w)
		}
		style = this
		if ev.Optimize != nil {
			return fmt.Errorf("%s: optimize is not allowed", ew)
		}
		if err := resolveEvent(ev, ew, start, end, warns); err != nil {
			return err
		}
	}
	return nil
}

func validateOptimize(ev *Event, where string) error {
	o := ev.Optimize
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
		return fmt.Errorf("%s: optimize.field must be amount, frequency, startDate, or endDate", where)
	}
	o.ResolvedTol = 0.01
	if o.ResolvedField != "amount" {
		o.ResolvedTol = 1
	}
	if o.Tolerance != nil {
		if *o.Tolerance <= 0 {
			return fmt.Errorf("%s: optimize.tolerance must be > 0", where)
		}
		o.ResolvedTol = *o.Tolerance
	}
	o.ResolvedMaxIter = 50
	if o.MaxIterations != nil {
		if *o.MaxIterations < 1 {
			return fmt.Errorf("%s: optimize.maxIterations must be >= 1", where)
		}
		o.ResolvedMaxIter = *o.MaxIterations
	}
	switch o.ResolvedField {
	case "amount", "frequency":
		if o.Min == nil || o.Max == nil {
			return fmt.Errorf("%s: optimize.min and optimize.max are required for field %s", where, o.ResolvedField)
		}
		if !(*o.Min < *o.Max) {
			return fmt.Errorf("%s: optimize.min must be < optimize.max", where)
		}
		if o.ResolvedField == "frequency" {
			if *o.Min < 1 || *o.Min != math.Trunc(*o.Min) || *o.Max != math.Trunc(*o.Max) {
				return fmt.Errorf("%s: optimize frequency bounds must be integers with min >= 1", where)
			}
		}
	default: // startDate, endDate
		if o.MinDate == "" || o.MaxDate == "" {
			return fmt.Errorf("%s: optimize.minDate and optimize.maxDate are required for field %s", where, o.ResolvedField)
		}
		mn, err := ParseMonth(o.MinDate)
		if err != nil {
			return fmt.Errorf("%s: optimize.minDate: %w", where, err)
		}
		mx, err := ParseMonth(o.MaxDate)
		if err != nil {
			return fmt.Errorf("%s: optimize.maxDate: %w", where, err)
		}
		if mn > mx {
			return fmt.Errorf("%s: optimize.minDate must be <= optimize.maxDate", where)
		}
		o.ResolvedMinDate, o.ResolvedMaxDate = mn, mx
	}
	return nil
}
