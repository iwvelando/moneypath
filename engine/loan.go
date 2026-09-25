package engine

import (
	"fmt"
	"math"

	"github.com/iwvelando/moneypath/config"
)

// loanSim holds one loan's precomputed sparse schedule and running state
// for threshold payoffs (spec chapter 04 §3).
type loanSim struct {
	l *config.Loan

	payments    map[config.Month]float64 // month -> billed payment
	escrowComp  map[config.Month]float64 // escrow included in regular payments
	remainAfter map[config.Month]float64 // principal outstanding after the month

	firstGen, lastGen config.Month // generated payment-month range (inclusive)
	generated         bool
	ended             bool
	endMonth          config.Month
	fired             bool // threshold payoff already fired
}

// buildLoanSchedule expands a loan into its schedule, stopping at simEnd at
// the latest (spec chapter 04 §3.2).
func buildLoanSchedule(l *config.Loan, simEnd config.Month) *loanSim {
	ls := &loanSim{
		l:           l,
		payments:    map[config.Month]float64{},
		escrowComp:  map[config.Month]float64{},
		remainAfter: map[config.Month]float64{},
	}
	F := l.Principal - l.DownPayment
	r := l.InterestRate / 100 / 12
	var M float64
	if l.InterestRate == 0 {
		M = F / float64(l.Term)
	} else {
		M = F * r / (1 - math.Pow(1+r, -float64(l.Term)))
	}

	remaining := F
	escrowYear := 0.0
	cur := l.ResolvedStart
	for idx := 1; idx <= l.Term && cur <= simEnd; idx++ {
		if cur.IsJanuary() {
			escrowYear = 0
		}

		// Early payoff by date replaces the regular payment (§3.5).
		if idx >= 2 && cur == l.ResolvedEarlyPayoffDate {
			refund := escrowYear // payoff payments contain no escrow of their own
			var pay float64
			if l.SellProperty {
				pay = remaining - l.ResolvedSellPrice + l.SellCostsNet - refund
			} else {
				pay = remaining - refund
			}
			ls.record(cur, pay, 0, 0)
			ls.endLoan(cur, !l.SellProperty, simEnd)
			return ls
		}

		interest := remaining * r
		extra := ls.extraPrincipalAt(cur, remaining)
		principalPaid := math.Min(M-interest+extra, remaining)
		mi := 0.0
		if l.MortgageInsurance > 0 &&
			remaining/l.Principal > l.MortgageInsuranceCutoff/100 {
			mi = l.MortgageInsurance
		}
		pay := interest + principalPaid + l.Escrow + mi
		if idx == 1 {
			pay += l.DownPayment
		}
		escrowYear += l.Escrow
		remaining -= principalPaid

		if round2(remaining) <= 0 || idx == l.Term {
			// Final regular payment: charge exactly what is owed, refund
			// the year's escrow accrual (§3.2 end check, §3.6).
			remaining = 0
			pay -= escrowYear
			ls.record(cur, pay, l.Escrow, remaining)
			ls.endLoan(cur, true, simEnd)
			return ls
		}
		ls.record(cur, pay, l.Escrow, remaining)
		cur++
	}
	return ls
}

func (ls *loanSim) record(m config.Month, pay, escrow, remaining float64) {
	ls.payments[m] = pay
	if escrow != 0 {
		ls.escrowComp[m] = escrow
	}
	ls.remainAfter[m] = remaining
	if !ls.generated {
		ls.firstGen = m
		ls.generated = true
	}
	ls.lastGen = m
}

// endLoan marks the loan finished at m; when the asset is kept, escrow
// costs continue as 12*escrow every December from m through simEnd (§3.6).
func (ls *loanSim) endLoan(m config.Month, kept bool, simEnd config.Month) {
	ls.ended = true
	ls.endMonth = m
	if kept && ls.l.Escrow > 0 {
		for d := m; d <= simEnd; d++ {
			if d.IsDecember() {
				ls.payments[d] += 12 * ls.l.Escrow
			}
		}
	}
}

// extraPrincipalAt sums extra-principal occurrences at m, capped at the
// current remaining balance (§3.3).
func (ls *loanSim) extraPrincipalAt(m config.Month, remaining float64) float64 {
	total := 0.0
	for _, ev := range ls.l.ExtraPrincipalPayments {
		if ev.OccursAt(m) {
			total += *ev.Amount
		}
	}
	return math.Min(total, remaining)
}

// remainingAsOf returns the principal outstanding at the end of month m.
func (ls *loanSim) remainingAsOf(m config.Month) float64 {
	if !ls.generated {
		return ls.l.Principal - ls.l.DownPayment
	}
	if ls.ended && m >= ls.endMonth {
		return 0
	}
	if m < ls.firstGen {
		return ls.l.Principal - ls.l.DownPayment
	}
	if m > ls.lastGen {
		m = ls.lastGen
	}
	return ls.remainAfter[m]
}

// escrowAccruedBefore sums escrow included in this loan's payments during
// m's calendar year, before m (§3.6 refund for payoff payments).
func (ls *loanSim) escrowAccruedBefore(m config.Month) float64 {
	total := 0.0
	for k := m.YearStart(); k < m; k++ {
		total += ls.escrowComp[k]
	}
	return total
}

// checkThresholdPayoff applies §3.5 at month m. It returns whether the
// payoff fired, the notes to emit, the net cash effect (liquidation
// proceeds minus the payoff payment) for updating projectedLiquid, and the
// net liquidation proceeds to add to the month's withdrawalCash.
func (ls *loanSim) checkThresholdPayoff(m config.Month, projectedLiquid float64, invs []*invSim, simEnd config.Month) (bool, []string, float64, float64) {
	l := ls.l
	T := l.EarlyPayoffThreshold
	if T <= 0 || ls.fired {
		return false, nil, 0, 0
	}
	if l.ResolvedStart >= m {
		return false, nil, 0, 0
	}
	if ls.ended && m > ls.endMonth {
		return false, nil, 0, 0
	}
	remaining := ls.remainingAsOf(m - 1)
	if round2(remaining) <= 0 {
		return false, nil, 0, 0
	}
	eligible := projectedLiquid
	for _, iv := range invs {
		if iv.inv.FundLoanPayoffs {
			eligible += iv.netLiquidationValue()
		}
	}
	if round2(eligible-remaining) < T {
		return false, nil, 0, 0
	}

	// Fire: replace this month's payment with the payoff payment.
	ls.fired = true
	refund := ls.escrowAccruedBefore(m)
	var pay float64
	var notes []string
	if l.SellProperty {
		pay = remaining - l.ResolvedSellPrice + l.SellCostsNet - refund
		notes = append(notes, fmt.Sprintf("paying off asset %s for %.2f and selling for %.2f with %.2f selling costs",
			l.Name, remaining, l.ResolvedSellPrice, l.SellCostsNet))
	} else {
		pay = remaining - refund
		notes = append(notes, fmt.Sprintf("paying off asset %s for %.2f", l.Name, remaining))
	}
	for k := range ls.payments {
		if k > m {
			delete(ls.payments, k)
		}
	}
	for k := range ls.remainAfter {
		if k >= m {
			delete(ls.remainAfter, k)
		}
	}
	ls.payments[m] = pay
	ls.remainAfter[m] = 0
	if ls.lastGen < m {
		ls.lastGen = m
	}
	ls.ended = false // reset so endLoan records cleanly
	ls.endLoan(m, !l.SellProperty, simEnd)

	// Fund the cash shortfall from flagged investments (§3.5 funding).
	shortfall := math.Max(0, pay-projectedLiquid)
	proceeds := 0.0
	for _, iv := range invs {
		if round2(shortfall) <= 0 {
			break
		}
		if !iv.inv.FundLoanPayoffs {
			continue
		}
		net, note := iv.withdrawNet(shortfall)
		if net <= 0 {
			continue
		}
		proceeds += net
		shortfall -= net
		notes = append(notes, note)
	}
	return true, notes, proceeds - pay, proceeds
}
