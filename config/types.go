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
	// InflationRate is the yearly percent prices rise by, year over year,
	// which a growth of inflation follows (spec chapter 03, Growth; 0 when
	// unset).
	InflationRate float64 `yaml:"inflationRate,omitempty"`

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
	Growth      Growth   `yaml:"growth,omitempty"`
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
	Assets      []*Asset      `yaml:"assets,omitempty"`
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
	Growth     Growth    `yaml:"growth,omitempty"`
	Percentage *float64  `yaml:"percentage,omitempty"`
	Frequency  *int      `yaml:"frequency,omitempty"`
	StartDate  string    `yaml:"startDate,omitempty"`
	EndDate    string    `yaml:"endDate,omitempty"`
	Optimize   *Optimize `yaml:"optimize,omitempty"`

	ResolvedStart     Month `yaml:"-"`
	ResolvedEnd       Month `yaml:"-"`
	ResolvedFrequency int   `yaml:"-"`
}

// AmountAt is what an occurrence of the (validated) event moves in month m
// of a plan that starts at start: its amount, grown by its growth (spec
// chapter 04 §2.1).
func (e *Event) AmountAt(start, m Month) float64 {
	return *e.Amount * e.Growth.Factor(start, m)
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
	Name string `yaml:"name"`
	// Asset names the asset the loan is secured on, on the same path; empty
	// for none (spec chapter 03, Loan and Asset).
	Asset                   string   `yaml:"asset,omitempty"`
	Principal               float64  `yaml:"principal"`
	DownPayment             float64  `yaml:"downPayment,omitempty"`
	InterestRate            float64  `yaml:"interestRate"`
	Term                    int      `yaml:"term"`
	StartDate               string   `yaml:"startDate"`
	Escrow                  float64  `yaml:"escrow,omitempty"`
	EscrowGrowth            Growth   `yaml:"escrowGrowth,omitempty"`
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

	// started says ResolvedStart was read from a month that parses.
	started bool
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

// Asset is something owned that has a value and no cash flow until it is
// sold (spec chapter 03, Asset; chapter 04 §1.2).
type Asset struct {
	Name         string   `yaml:"name"`
	Value        *float64 `yaml:"value,omitempty"`
	Appreciation Growth   `yaml:"appreciation,omitempty"`
	StartDate    string   `yaml:"startDate,omitempty"`
	SellDate     string   `yaml:"sellDate,omitempty"`
	SellCosts    float64  `yaml:"sellCosts,omitempty"`

	// ResolvedFirst is the asset's first month in the plan: its startDate, or
	// the plan's start when it has none or one before the start.
	ResolvedFirst Month `yaml:"-"`
	// ResolvedSell is the sale month; -1 when the asset is kept.
	ResolvedSell Month `yaml:"-"`

	// dated says both months were read from months that parse, in a plan
	// whose own months are known.
	dated bool
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
	// Guardrail names the guardrail the value is held to; empty holds it to
	// the emergency fund (spec chapter 03, Optimizer block).
	Guardrail string `yaml:"guardrail,omitempty"`

	ResolvedField string `yaml:"-"` // canonical: amount|frequency|startDate|endDate
	// ResolvedGuardrail is the guardrail Guardrail names, nil for none.
	ResolvedGuardrail *Guardrail `yaml:"-"`
	ResolvedMinDate   Month      `yaml:"-"`
	ResolvedMaxDate   Month      `yaml:"-"`
	ResolvedTol       float64    `yaml:"-"`
	ResolvedMaxIter   int        `yaml:"-"`
}
