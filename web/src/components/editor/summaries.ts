import type { AssetModel, EventKind, EventModel, GuardrailModel, InvestmentModel, LoanModel, SimulationModel } from '../../config/types';
import { monthIsError } from '../../config/month';
import { formatMoney } from '../../util/format';
import { growthLabel } from '../../config/choices';
import type { GrowthModel } from '../../config/types';

/** " · With inflation" or " · 4% a year" for an amount that grows; nothing for one that stays the same. */
function grows(growth: GrowthModel): string {
  return growth.mode === 'fixed' ? '' : ` · ${growthLabel(growth)}`;
}

export interface EditorSummary {
  primary: string;
  detail: string;
  attention: boolean;
}

// Match the existing inline field checks; full config validation remains in the engine.
function eventHasFieldErrors(event: EventModel): boolean {
  const optimize = event.optimize;
  const dateBounds = optimize?.field === 'startDate' || optimize?.field === 'endDate';
  return monthIsError(event.startDate) || monthIsError(event.endDate) || Boolean(dateBounds && optimize &&
    (monthIsError(optimize.minDate, { required: true }) || monthIsError(optimize.maxDate, { required: true })));
}

/** Display entered values and documented defaults; never calculate forecast values here. */
export function eventSummary(event: EventModel, kind: EventKind, simulation: SimulationModel): EditorSummary {
  const amount = kind === 'withdrawal' && event.percentage !== null
    ? `${event.percentage}% of balance`
    : event.amount === null ? 'Amount not set' : formatMoney(event.amount);
  const start = event.startDate || simulation.startDate;
  const end = event.endDate || simulation.endDate;
  const once = start !== '' && start === end;
  const cadence = once ? 'Once' : (event.frequency ?? 1) === 1 ? 'Monthly' : `Every ${event.frequency} months`;
  return {
    attention: eventHasFieldErrors(event),
    primary: `${amount} · ${cadence}${grows(event.growth)}`,
    detail: once ? start : `${start || 'Simulation start'} through ${end || 'simulation end'}`,
  };
}

export function loanSummary(loan: LoanModel): EditorSummary {
  const extras = [
    loan.escrow !== null && loan.escrow !== 0
      ? loan.escrowGrowth.mode === 'fixed' ? 'Escrow' : `Escrow ${growthLabel(loan.escrowGrowth).toLowerCase()}`
      : '',
    loan.mortgageInsurance !== null && loan.mortgageInsurance !== 0 ? 'Mortgage insurance' : '',
    loan.earlyPayoffDate || loan.earlyPayoffThreshold !== null ? 'Early payoff' : '',
    loan.asset.trim() ? `Secured on ${loan.asset.trim()}` : '',
    loan.sellProperty ? 'Property sale' : '',
    loan.extraPrincipalPayments.length ? `${loan.extraPrincipalPayments.length} extra payment${loan.extraPrincipalPayments.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return {
    attention: !loan.name.trim() || monthIsError(loan.startDate, { required: true }) ||
      monthIsError(loan.earlyPayoffDate) || loan.extraPrincipalPayments.some(eventHasFieldErrors),
    primary: [loan.principal === null ? 'Principal not set' : `${formatMoney(loan.principal)} principal`,
      loan.interestRate === null ? 'Rate not set' : `${loan.interestRate}% annual interest`,
      loan.term === null ? 'Term not set' : `${loan.term} months`].join(' · '),
    detail: [loan.startDate ? `First payment ${loan.startDate}` : 'First payment not set', ...extras].join(' · '),
  };
}

export function investmentSummary(investment: InvestmentModel): EditorSummary {
  const details = [
    `${investment.contributions.length} contribution${investment.contributions.length === 1 ? '' : 's'}`,
    `${investment.withdrawals.length} withdrawal${investment.withdrawals.length === 1 ? '' : 's'}`,
    investment.contributionsFromCash ? 'Contributions from cash' : 'Contributions from outside the plan',
    (investment.taxRate ?? 0) !== 0 || (investment.withdrawalTaxRate ?? 0) !== 0 ? 'Tax settings' : '',
    investment.fundLoanPayoffs ? 'Can fund loan payoffs' : '',
  ].filter(Boolean);
  return {
    attention: !investment.name.trim() || [...investment.contributions, ...investment.withdrawals].some(eventHasFieldErrors),
    primary: `${formatMoney(investment.startingValue ?? 0)} starting value · ${investment.annualReturnRate ?? 0}% annual return`,
    detail: details.join(' · '),
  };
}

/** The value as entered, how it changes, and when it is bought and sold. */
export function assetSummary(asset: AssetModel): EditorSummary {
  const sale = asset.sellDate
    ? `Sold ${asset.sellDate}${asset.sellCosts ? ` · ${asset.sellCosts}% selling costs` : ''}`
    : 'Kept';
  return {
    attention: !asset.name.trim() || monthIsError(asset.startDate) || monthIsError(asset.sellDate),
    primary: `${asset.value === null ? 'Value not set' : formatMoney(asset.value)}${grows(asset.appreciation)}`,
    detail: [asset.startDate ? `Bought ${asset.startDate}` : 'Owned from the start', sale].join(' · '),
  };
}

/** What the guardrail checks and over which months, as entered. */
export function guardrailSummary(guardrail: GuardrailModel): EditorSummary {
  const listed = (names: string[] | null) => (names ?? []).join(', ');
  let primary: string;
  switch (guardrail.kind) {
    case 'cashFloor':
      primary = guardrail.amount === null ? 'Cash floor not set' : `Cash never below ${formatMoney(guardrail.amount)}${grows(guardrail.growth)}`;
      break;
    case 'debtFree':
      primary = `Nothing owed on ${guardrail.loans === null ? 'any loan' : listed(guardrail.loans)}`;
      break;
    case 'lasts':
      primary = !guardrail.investments?.length
        ? 'Investments not picked'
        : guardrail.amount === null
          ? `${listed(guardrail.investments)} never emptied`
          : `${listed(guardrail.investments)} never below ${formatMoney(guardrail.amount)}${grows(guardrail.growth)}`;
      break;
    default:
      primary = guardrail.kind.trim() || 'Kind not set';
  }
  const { startDate: start, endDate: end } = guardrail;
  const detail =
    guardrail.kind === 'debtFree' && !start
      ? 'Debt-free month not set'
      : start && end
        ? `${start} through ${end}`
        : start
          ? `From ${start}`
          : end
            ? `Through ${end}`
            : 'Every month of the plan';
  return {
    attention: !guardrail.name.trim() || monthIsError(guardrail.startDate) || monthIsError(guardrail.endDate),
    primary,
    detail,
  };
}
