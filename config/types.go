package config

import "gopkg.in/yaml.v3"

// Config is a moneypath v2 plan document (spec chapter 03).
//
// Optional scalars whose absence matters use pointer types; Resolved*
// fields are filled by Validate and are what the engine consumes.
type Config struct {
	Version         *int             `yaml:"version"`
	Simulation      Simulation       `yaml:"simulation"`
	Recommendations *Recommendations `yaml:"recommendations,omitempty"`
	Guardrails      []*Guardrail     `yaml:"guardrails,omitempty"`
	Common          Section          `yaml:"common,omitempty"`
	Choices         []*Choice        `yaml:"choices,omitempty"`
	Scenarios       []*Scenario      `yaml:"scenarios"`

	// ResolvedEmergencyFundMonths is recommendations.emergencyFundMonths
	// with the default (6) applied. 0 disables the recommendation.
	ResolvedEmergencyFundMonths float64 `yaml:"-"`

	// doc is the document the config was parsed from, kept so a problem can
	// name the entries on the way to its field. Nil for a config built in code.
	doc *yaml.Node
}

type Simulation struct {
	StartDate    string   `yaml:"startDate,omitempty"`
	EndDate      string   `yaml:"endDate"`
	StartingCash *float64 `yaml:"startingCash,omitempty"`
	// CashInterestRate is the annual percent earned on positive cash,
	// compounded monthly (spec chapter 03; 0 when unset).
	CashInterestRate float64 `yaml:"cashInterestRate,omitempty"`

	ResolvedStart        Month   `yaml:"-"`
	ResolvedEnd          Month   `yaml:"-"`
	ResolvedStartingCash float64 `yaml:"-"`
}

type Recommendations struct {
	EmergencyFundMonths *float64 `yaml:"emergencyFundMonths,omitempty"`
}

// The kinds of guardrail (spec chapter 03, Guardrails).
const (
	GuardrailCashFloor = "cashFloor"
	GuardrailDebtFree  = "debtFree"
	GuardrailLasts     = "lasts"
)

// Guardrail is a condition every path is checked against, month by month
// over its window (spec chapter 03, Guardrails; chapter 04 §10).
type Guardrail struct {
	Name        string   `yaml:"name"`
	Kind        string   `yaml:"kind"`
	Amount      *float64 `yaml:"amount,omitempty"`
	Investments []string `yaml:"investments,omitempty"`
	Loans       []string `yaml:"loans,omitempty"`
	StartDate   string   `yaml:"startDate,omitempty"`
	EndDate     string   `yaml:"endDate,omitempty"`

	// The window as written, with the simulation's months as its defaults.
	// It is not clipped to the simulation: the engine reads it against the
	// months a path records.
	ResolvedStart Month `yaml:"-"`
	ResolvedEnd   Month `yaml:"-"`
}

type Section struct {
	Events      []*Event      `yaml:"events,omitempty"`
	Loans       []*Loan       `yaml:"loans,omitempty"`
	Investments []*Investment `yaml:"investments,omitempty"`
}

type Scenario struct {
	Name    string `yaml:"name"`
	Active  *bool  `yaml:"active,omitempty"`
	Select  Select `yaml:"select,omitempty"`
	Section `yaml:",inline"`

	ResolvedActive bool `yaml:"-"`
	// Resolved and ResolvedShared are the two lists the engine simulates
	// (spec chapter 03, Choices): the scenario's own entries followed by
	// those its selected options add, and common as those options change it.
	// Without choices they are Section and Config.Common.
	Resolved       Section `yaml:"-"`
	ResolvedShared Section `yaml:"-"`
}

// Event is the shared schedule shape (spec chapter 03 §Event). It is used
// for cash-flow events, loan extraPrincipalPayments, and investment
// contributions/withdrawals; per-context validation differs.
type Event struct {
	Name       string    `yaml:"name,omitempty"`
	Amount     *float64  `yaml:"amount,omitempty"`
	Percentage *float64  `yaml:"percentage,omitempty"`
	Frequency  *int      `yaml:"frequency,omitempty"`
	StartDate  string    `yaml:"startDate,omitempty"`
	EndDate    string    `yaml:"endDate,omitempty"`
	Optimize   *Optimize `yaml:"optimize,omitempty"`

	ResolvedStart     Month `yaml:"-"`
	ResolvedEnd       Month `yaml:"-"`
	ResolvedFrequency int   `yaml:"-"`
}

// OccursAt reports whether the (validated) event has an occurrence at m
// (spec chapter 04 §2).
func (e *Event) OccursAt(m Month) bool {
	if m < e.ResolvedStart || m > e.ResolvedEnd {
		return false
	}
	if e.ResolvedStart == e.ResolvedEnd {
		return m == e.ResolvedStart
	}
	return int(m-e.ResolvedStart)%e.ResolvedFrequency == 0
}

type Loan struct {
	Name                    string   `yaml:"name"`
	Principal               float64  `yaml:"principal"`
	DownPayment             float64  `yaml:"downPayment,omitempty"`
	InterestRate            float64  `yaml:"interestRate"`
	Term                    int      `yaml:"term"`
	StartDate               string   `yaml:"startDate"`
	Escrow                  float64  `yaml:"escrow,omitempty"`
	MortgageInsurance       float64  `yaml:"mortgageInsurance,omitempty"`
	MortgageInsuranceCutoff float64  `yaml:"mortgageInsuranceCutoff,omitempty"`
	EarlyPayoffThreshold    float64  `yaml:"earlyPayoffThreshold,omitempty"`
	EarlyPayoffDate         string   `yaml:"earlyPayoffDate,omitempty"`
	SellProperty            bool     `yaml:"sellProperty,omitempty"`
	SellPrice               *float64 `yaml:"sellPrice,omitempty"`
	SellCostsNet            float64  `yaml:"sellCostsNet,omitempty"`
	ExtraPrincipalPayments  []*Event `yaml:"extraPrincipalPayments,omitempty"`

	ResolvedStart           Month   `yaml:"-"`
	ResolvedEarlyPayoffDate Month   `yaml:"-"` // -1 when unset
	ResolvedSellPrice       float64 `yaml:"-"` // defaults to Principal
}

type Investment struct {
	Name                  string   `yaml:"name"`
	StartingValue         float64  `yaml:"startingValue,omitempty"`
	AnnualReturnRate      float64  `yaml:"annualReturnRate,omitempty"`
	TaxRate               float64  `yaml:"taxRate,omitempty"`
	WithdrawalTaxRate     float64  `yaml:"withdrawalTaxRate,omitempty"`
	ContributionsFromCash bool     `yaml:"contributionsFromCash,omitempty"`
	FundLoanPayoffs       bool     `yaml:"fundLoanPayoffs,omitempty"`
	Contributions         []*Event `yaml:"contributions,omitempty"`
	Withdrawals           []*Event `yaml:"withdrawals,omitempty"`
}

// Optimize marks one event field for the optimizer (spec chapter 03).
type Optimize struct {
	Field         string   `yaml:"field"`
	Min           *float64 `yaml:"min,omitempty"`
	Max           *float64 `yaml:"max,omitempty"`
	MinDate       string   `yaml:"minDate,omitempty"`
	MaxDate       string   `yaml:"maxDate,omitempty"`
	Tolerance     *float64 `yaml:"tolerance,omitempty"`
	MaxIterations *int     `yaml:"maxIterations,omitempty"`

	ResolvedField   string  `yaml:"-"` // canonical: amount|frequency|startDate|endDate
	ResolvedMinDate Month   `yaml:"-"`
	ResolvedMaxDate Month   `yaml:"-"`
	ResolvedTol     float64 `yaml:"-"`
	ResolvedMaxIter int     `yaml:"-"`
}
