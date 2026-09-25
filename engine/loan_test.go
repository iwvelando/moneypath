package engine

import (
	"math"
	"testing"

	"github.com/iwvelando/moneypath/config"
)

func month(t *testing.T, s string) config.Month {
	t.Helper()
	m, err := config.ParseMonth(s)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func validLoan(t *testing.T, l *config.Loan, simStart, simEnd string) *config.Loan {
	t.Helper()
	var warns []string
	s, e := month(t, simStart), month(t, simEnd)
	if err := validateLoanForTest(l, s, e, &warns); err != nil {
		t.Fatalf("loan setup: %v", err)
	}
	return l
}

// validateLoanForTest resolves the fields the schedule builder needs,
// mirroring config.Validate for a standalone loan.
func validateLoanForTest(l *config.Loan, start, end config.Month, warns *[]string) error {
	s, err := config.ParseMonth(l.StartDate)
	if err != nil {
		return err
	}
	l.ResolvedStart = s
	l.ResolvedEarlyPayoffDate = -1
	if l.EarlyPayoffDate != "" {
		d, err := config.ParseMonth(l.EarlyPayoffDate)
		if err != nil {
			return err
		}
		l.ResolvedEarlyPayoffDate = d
	}
	l.ResolvedSellPrice = l.Principal
	if l.SellPrice != nil {
		l.ResolvedSellPrice = *l.SellPrice
	}
	for _, ev := range l.ExtraPrincipalPayments {
		ev.ResolvedFrequency = 1
		if ev.Frequency != nil {
			ev.ResolvedFrequency = *ev.Frequency
		}
		ev.ResolvedStart = start
		if ev.StartDate != "" {
			if ev.ResolvedStart, err = config.ParseMonth(ev.StartDate); err != nil {
				return err
			}
		}
		ev.ResolvedEnd = end
		if ev.EndDate != "" {
			if ev.ResolvedEnd, err = config.ParseMonth(ev.EndDate); err != nil {
				return err
			}
		}
	}
	return nil
}

// Spec chapter 04 §3.1: M = F·r/(1−(1+r)^−term); zero-rate M = F/term.
func TestAmortizationPayment(t *testing.T) {
	l := validLoan(t, &config.Loan{
		Name: "L", Principal: 120000, DownPayment: 20000,
		InterestRate: 6, Term: 360, StartDate: "2025-01",
	}, "2025-01", "2060-01")
	ls := buildLoanSchedule(l, month(t, "2060-01"))

	// Standard formula: 100000 at 0.5%/month over 360 payments.
	wantM := 100000 * 0.005 / (1 - math.Pow(1.005, -360))
	first := ls.payments[month(t, "2025-01")] - l.DownPayment
	if math.Abs(first-wantM) > 1e-9 {
		t.Errorf("first payment (net of down payment): got %.6f, want %.6f", first, wantM)
	}
	// The loan amortizes to exactly zero at maturity.
	if got := ls.remainingAsOf(month(t, "2054-12")); round2(got) != 0 {
		t.Errorf("remaining at maturity: %.6f, want 0", got)
	}
	if !ls.ended || ls.endMonth != month(t, "2054-12") {
		t.Errorf("loan should end at 2054-12, got ended=%v end=%s", ls.ended, ls.endMonth)
	}
}

// Spec chapter 04 §3.1/§3.2: zero-interest loans split F evenly and end at
// term with an exact final payment.
func TestZeroInterestLoan(t *testing.T) {
	l := validLoan(t, &config.Loan{
		Name: "Z", Principal: 1200, InterestRate: 0, Term: 12, StartDate: "2025-01",
	}, "2025-01", "2026-12")
	ls := buildLoanSchedule(l, month(t, "2026-12"))
	for m := month(t, "2025-01"); m <= month(t, "2025-12"); m++ {
		if p := ls.payments[m]; math.Abs(p-100) > 1e-9 {
			t.Errorf("payment at %s = %.4f, want 100.00", m, p)
		}
	}
	if _, ok := ls.payments[month(t, "2026-01")]; ok {
		t.Error("no payments after maturity")
	}
}

// Spec chapter 04 §3.2: a one-month term ends the loan at its first payment.
func TestOneMonthTerm(t *testing.T) {
	l := validLoan(t, &config.Loan{
		Name: "One", Principal: 500, InterestRate: 0, Term: 1, StartDate: "2025-03",
	}, "2025-01", "2025-12")
	ls := buildLoanSchedule(l, month(t, "2025-12"))
	if p := ls.payments[month(t, "2025-03")]; math.Abs(p-500) > 1e-9 {
		t.Errorf("single payment = %.4f, want 500", p)
	}
	if len(ls.payments) != 1 {
		t.Errorf("want exactly one payment, got %d", len(ls.payments))
	}
}

// Spec chapter 04 §3.2 invariant + §3.3: extra principal overshoot cannot
// drive the balance negative or generate phantom payments (appendix
// deviation 2).
func TestExtraPrincipalOvershootEndsCleanly(t *testing.T) {
	amt := 10000.0
	l := validLoan(t, &config.Loan{
		Name: "E", Principal: 5000, InterestRate: 12, Term: 48, StartDate: "2025-01",
		ExtraPrincipalPayments: []*config.Event{
			{Amount: &amt, StartDate: "2025-03", EndDate: "2025-03"},
		},
	}, "2025-01", "2030-12")
	ls := buildLoanSchedule(l, month(t, "2030-12"))
	if !ls.ended || ls.endMonth != month(t, "2025-03") {
		t.Fatalf("loan should end at 2025-03, got ended=%v end=%s", ls.ended, ls.endMonth)
	}
	// Final payment charges exactly what is owed: interest + remaining
	// balance, not a full M + overshoot.
	rem := ls.remainingAsOf(month(t, "2025-02"))
	interest := rem * 0.01
	want := interest + rem
	if got := ls.payments[month(t, "2025-03")]; math.Abs(got-want) > 1e-9 {
		t.Errorf("final payment = %.6f, want %.6f (exactly what is owed)", got, want)
	}
	for m := month(t, "2025-04"); m <= month(t, "2030-12"); m++ {
		if _, ok := ls.payments[m]; ok {
			t.Errorf("phantom payment at %s after payoff", m)
		}
	}
}

// Spec chapter 04 §3.4: MI charges while remaining/principal > cutoff, on
// the pre-payment balance, with the original principal as denominator.
func TestMortgageInsuranceWindow(t *testing.T) {
	l := validLoan(t, &config.Loan{
		Name: "M", Principal: 1000, InterestRate: 0, Term: 10, StartDate: "2025-01",
		MortgageInsurance: 7, MortgageInsuranceCutoff: 50,
	}, "2025-01", "2026-12")
	ls := buildLoanSchedule(l, month(t, "2026-12"))
	// remaining before month k (1-based) is 1000 − (k−1)*100; MI while
	// ratio > 0.50 → months 1..5 (before-month balances 1000..600).
	for i := 0; i < 10; i++ {
		m := month(t, "2025-01") + config.Month(i)
		want := 100.0
		if i < 5 {
			want += 7
		}
		if p := ls.payments[m]; math.Abs(p-want) > 1e-9 {
			t.Errorf("payment %s = %.2f, want %.2f", m, p, want)
		}
	}
}

// Spec chapter 04 §3.6: every kept-property calendar year costs exactly
// 12·escrow — the ending year refunds the accrual and bills 12·escrow each
// December from the end month inclusive.
func TestEscrowSettlementKept(t *testing.T) {
	l := validLoan(t, &config.Loan{
		Name: "K", Principal: 600, InterestRate: 0, Term: 6, StartDate: "2025-01",
		Escrow: 50,
	}, "2025-01", "2027-12")
	simEnd := month(t, "2027-12")
	ls := buildLoanSchedule(l, simEnd)
	// Months 1..5: 100 principal + 50 escrow. Month 6 (June): 100 + 50
	// − 300 refund (Jan–Jun accrual) = −150.
	if p := ls.payments[month(t, "2025-06")]; math.Abs(p-(-150)) > 1e-9 {
		t.Errorf("final payment = %.2f, want -150.00 (escrow refund)", p)
	}
	// Every December from the end month on bills 12·escrow.
	for _, d := range []string{"2025-12", "2026-12", "2027-12"} {
		if p := ls.payments[month(t, d)]; math.Abs(p-600) > 1e-9 {
			t.Errorf("December %s = %.2f, want 600.00", d, p)
		}
	}
	// Year cost invariant: 2025 total = 5*150 + (−150) + 600 = 1200… minus
	// the principal part (500) leaves 700? No: the invariant is escrow cost
	// per year = 600. Escrow paid Jan–May = 250, June refund −300 plus the
	// June payment's own 50 nets to −300+50; December +600 → 250+50−300+600 = 600. ✓
	total2025 := 0.0
	for m := month(t, "2025-01"); m <= month(t, "2025-12"); m++ {
		total2025 += ls.payments[m]
	}
	if math.Abs(total2025-(600+600)) > 1e-9 { // 600 principal + 600 escrow
		t.Errorf("2025 total billed = %.2f, want 1200.00", total2025)
	}
}

// Spec chapter 04 §3.5 (by date, with sale): payment = remaining − sellPrice
// + sellCostsNet − refund; nothing continues after a sale.
func TestEarlyPayoffDateSell(t *testing.T) {
	sell := 900.0
	l := validLoan(t, &config.Loan{
		Name: "S", Principal: 1200, InterestRate: 0, Term: 12, StartDate: "2025-01",
		Escrow: 10, EarlyPayoffDate: "2025-04", SellProperty: true,
		SellPrice: &sell, SellCostsNet: 25,
	}, "2025-01", "2026-12")
	ls := buildLoanSchedule(l, month(t, "2026-12"))
	// Remaining after 2025-03: 1200 − 300 = 900. Refund = Jan–Mar escrow = 30.
	// Payment = 900 − 900 + 25 − 30 = −5 (net cash in).
	if p := ls.payments[month(t, "2025-04")]; math.Abs(p-(-5)) > 1e-9 {
		t.Errorf("sale payoff payment = %.2f, want -5.00", p)
	}
	for m := month(t, "2025-05"); m <= month(t, "2026-12"); m++ {
		if _, ok := ls.payments[m]; ok {
			t.Errorf("payment at %s after sale", m)
		}
	}
}
