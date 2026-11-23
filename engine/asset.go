package engine

import (
	"fmt"

	"github.com/iwvelando/moneypath/config"
)

// assetSim is one asset of a path: its value month by month and its sale
// (spec chapter 04 §1.2, §3.5).
type assetSim struct {
	a *config.Asset
	// drift is A(m), counted from the asset's first month; nil when the asset
	// does not appreciate, so its value is exactly as written.
	drift *Deflator
	// sale is the month the asset is sold inside the plan, or -1.
	sale config.Month
}

func newAssetSim(a *config.Asset, end config.Month) *assetSim {
	as := &assetSim{a: a, drift: NewDeflator(a.ResolvedFirst, a.Appreciation.Rate()), sale: -1}
	if a.ResolvedSell >= 0 && a.ResolvedSell <= end {
		as.sale = a.ResolvedSell
	}
	return as
}

// grownAt is value · A(m), what the asset is worth in m while it is held.
func (as *assetSim) grownAt(m config.Month) float64 {
	if as.drift == nil {
		return *as.a.Value
	}
	return *as.a.Value * as.drift.At(m)
}

// valueAt is value[m]: 0 before the asset's first month and from its sale on.
func (as *assetSim) valueAt(m config.Month) float64 {
	if m < as.a.ResolvedFirst || (as.a.ResolvedSell >= 0 && m >= as.a.ResolvedSell) {
		return 0
	}
	return as.grownAt(m)
}

// settle is the asset's sale at m when it is sold then: the one payment that
// settles it, Σ (payoff − refund) over the loans the sale pays off less the
// price plus the costs, and its note (§3.5, §6). ok is false in any other
// month.
func (as *assetSim) settle(m config.Month, loans []*loanSim) (payment float64, note string, ok bool) {
	if as.sale != m {
		return 0, "", false
	}
	price := as.grownAt(m)
	costs := price * as.a.SellCosts / 100
	payment = -price + costs
	for _, ls := range loans {
		if ls.l.Asset == as.a.Name && ls.soldAt(m) {
			payment += ls.payments[m]
		}
	}
	return payment, fmt.Sprintf("selling asset %s for %.2f with %.2f selling costs", as.a.Name, price, costs), true
}
