package engine

import (
	"fmt"
	"math"
	"strings"

	"github.com/iwvelando/moneypath/config"
)

// invSim is one investment's running state (spec chapter 04 §4).
type invSim struct {
	inv   *config.Investment
	scope string // "scenario" or "common"

	value, basis, growthBalance float64
}

func newInvSim(inv *config.Investment, scope string) *invSim {
	return &invSim{inv: inv, scope: scope, value: inv.StartingValue, basis: inv.StartingValue}
}

type invMonthResult struct {
	cashContribution float64
	netWithdrawal    float64
	note             string
}

// processMonth applies §4 steps 1–5 for month m.
func (s *invSim) processMonth(m config.Month) invMonthResult {
	inv := s.inv

	// 1. Growth on the pre-contribution balance.
	r := inv.AnnualReturnRate / 100 / 12
	g := s.value * r
	tax := 0.0
	if g > 0 && inv.TaxRate > 0 {
		tax = g * inv.TaxRate / 100
	}
	afterTax := g - tax
	s.value += afterTax
	s.growthBalance += afterTax
	if s.growthBalance < 0 {
		deficit := -s.growthBalance
		s.basis = math.Max(0, s.basis-deficit)
		s.growthBalance = 0
	}

	// 2. Contributions.
	c := 0.0
	for _, ev := range inv.Contributions {
		if ev.OccursAt(m) {
			c += *ev.Amount
		}
	}
	s.value += c
	s.basis = math.Max(0, s.basis+c)

	// 3. Withdrawals (percentage of the post-growth, post-contribution balance).
	w := 0.0
	pctTotal := 0.0
	isPct := false
	for _, ev := range inv.Withdrawals {
		if !ev.OccursAt(m) {
			continue
		}
		if ev.Percentage != nil {
			isPct = true
			pctTotal += *ev.Percentage
			w += s.value * *ev.Percentage / 100
		} else {
			w += *ev.Amount
		}
	}
	w = math.Min(math.Max(w, 0), s.value)
	fromGrowth := math.Min(w, s.growthBalance)
	fromBasis := w - fromGrowth
	s.growthBalance -= fromGrowth
	s.basis = math.Max(0, s.basis-fromBasis)
	s.value -= w

	// 4. Withdrawal tax on the growth portion.
	wTax := fromGrowth * inv.WithdrawalTaxRate / 100

	// 5. Note (§6) and ledger effects.
	var parts []string
	if c != 0 {
		label := "contribution"
		if inv.ContributionsFromCash {
			label = "contribution (reduces cash balance)"
		}
		parts = append(parts, fmt.Sprintf("%s %+.2f", label, c))
	}
	if w != 0 {
		var p string
		if isPct {
			p = fmt.Sprintf("withdrawal (%.2f%%) %+.2f", pctTotal, w)
		} else {
			p = fmt.Sprintf("withdrawal %+.2f", w)
		}
		parts = append(parts, p+withdrawalSplitSuffix(fromBasis, fromGrowth))
	}
	if g != 0 {
		parts = append(parts, fmt.Sprintf("growth %+.2f", g))
	}
	if tax != 0 {
		parts = append(parts, fmt.Sprintf("tax %.2f", tax))
	}
	if wTax != 0 {
		parts = append(parts, fmt.Sprintf("withdrawal tax %.2f", wTax))
	}

	res := invMonthResult{netWithdrawal: w - wTax}
	if inv.ContributionsFromCash {
		res.cashContribution = c
	}
	if len(parts) > 0 {
		res.note = fmt.Sprintf("%s %s: %s", s.scope, inv.Name, strings.Join(parts, ", "))
	}
	return res
}

// withdrawalSplitSuffix renders the " (basis %+.2f, growth %+.2f)" suffix,
// listing only the nonzero components (§6).
func withdrawalSplitSuffix(fromBasis, fromGrowth float64) string {
	var comps []string
	if fromBasis != 0 {
		comps = append(comps, fmt.Sprintf("basis %+.2f", fromBasis))
	}
	if fromGrowth != 0 {
		comps = append(comps, fmt.Sprintf("growth %+.2f", fromGrowth))
	}
	if len(comps) == 0 {
		return ""
	}
	return " (" + strings.Join(comps, ", ") + ")"
}

// netLiquidationValue is the after-tax value of a full liquidation
// (spec chapter 04 §3.5).
func (s *invSim) netLiquidationValue() float64 {
	t := s.inv.WithdrawalTaxRate / 100
	return s.value - t*math.Min(s.value, s.growthBalance)
}

// withdrawNet performs a loan-payoff-funding withdrawal netting up to n
// after withdrawal tax (capped at full liquidation), per §3.5. It returns
// the net proceeds and the payoff-withdrawal note.
func (s *invSim) withdrawNet(n float64) (float64, string) {
	t := s.inv.WithdrawalTaxRate / 100
	gAvail := math.Min(s.value, s.growthBalance)
	var gross float64
	if n <= gAvail*(1-t) {
		gross = n / (1 - t)
	} else {
		gross = n + t*gAvail
	}
	gross = math.Min(gross, s.value)
	if gross <= 0 {
		return 0, ""
	}

	fromGrowth := math.Min(gross, s.growthBalance)
	fromBasis := gross - fromGrowth
	s.growthBalance -= fromGrowth
	s.basis = math.Max(0, s.basis-fromBasis)
	s.value -= gross
	wTax := fromGrowth * s.inv.WithdrawalTaxRate / 100
	net := gross - wTax

	note := fmt.Sprintf("%s %s: loan payoff withdrawal %+.2f%s",
		s.scope, s.inv.Name, gross, withdrawalSplitSuffix(fromBasis, fromGrowth))
	if wTax != 0 {
		note += fmt.Sprintf(", withdrawal tax %.2f", wTax)
	}
	return net, note
}
