import { HELP } from '../../config/help';
import {
  cloneInvestment,
  emptyInvestment,
  type EventModel,
  type InvestmentModel,
  type SimulationModel,
} from '../../config/types';
import { CheckField, NumberField, TextField } from '../fields';
import { IconGrowth } from '../icons';
import { EventList, type WithdrawalStyle } from './EventList';

/**
 * Spec/03 forbids mixing amount-style and percentage-style withdrawals within
 * one investment, so the style is chosen once per investment and switching
 * converts every row, rather than letting the user build an invalid config row
 * by row.
 */
export function withdrawalStyleOf(investment: InvestmentModel): WithdrawalStyle {
  return investment.withdrawals.some((w) => w.percentage !== null) ? 'percentage' : 'amount';
}

function convertWithdrawals(withdrawals: EventModel[], style: WithdrawalStyle): EventModel[] {
  return withdrawals.map((withdrawal) =>
    style === 'percentage'
      ? { ...withdrawal, percentage: withdrawal.percentage ?? 4 }
      : { ...withdrawal, percentage: null, amount: withdrawal.amount ?? 0 },
  );
}

interface InvestmentCardProps {
  investment: InvestmentModel;
  index: number;
  simulation: SimulationModel;
  onChange: (investment: InvestmentModel) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function InvestmentCard({
  investment,
  index,
  simulation,
  onChange,
  onRemove,
  onDuplicate,
}: InvestmentCardProps) {
  const patch = (changes: Partial<InvestmentModel>) => onChange({ ...investment, ...changes });
  const title = investment.name.trim() || `Investment ${index + 1}`;
  const style = withdrawalStyleOf(investment);

  return (
    <li class="row-card">
      <div class="row-card__head">
        <h5 class="row-card__title">{title}</h5>
        <div class="row-card__actions">
          <button type="button" class="btn btn--quiet" aria-label={`Duplicate ${title}`} onClick={onDuplicate}>
            Duplicate
          </button>
          <button
            type="button"
            class="btn btn--quiet btn--danger"
            aria-label={`Remove ${title}`}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>

      <div class="field-grid">
        <TextField
          label="Name"
          help={HELP.investmentName}
          value={investment.name}
          required
          onInput={(name) => patch({ name })}
        />
        <NumberField
          label="Starting value"
          help={HELP.investmentStartingValue}
          value={investment.startingValue}
          step={1000}
          placeholder="0"
          onChange={(startingValue) => patch({ startingValue })}
        />
        <NumberField
          label="Annual return"
          help={HELP.investmentAnnualReturnRate}
          value={investment.annualReturnRate}
          step={0.1}
          placeholder="0"
          suffix="% / yr"
          onChange={(annualReturnRate) => patch({ annualReturnRate })}
        />
        <NumberField
          label="Growth tax rate"
          help={HELP.investmentTaxRate}
          value={investment.taxRate}
          step={1}
          placeholder="0"
          suffix="%"
          onChange={(taxRate) => patch({ taxRate })}
        />
        <NumberField
          label="Withdrawal tax rate"
          help={HELP.investmentWithdrawalTaxRate}
          value={investment.withdrawalTaxRate}
          step={1}
          placeholder="0"
          suffix="%"
          onChange={(withdrawalTaxRate) => patch({ withdrawalTaxRate })}
        />
      </div>

      <div class="check-grid">
        <CheckField
          label="Contributions come out of simulated cash"
          help={HELP.investmentContributionsFromCash}
          checked={investment.contributionsFromCash}
          onChange={(contributionsFromCash) => patch({ contributionsFromCash })}
        />
        <CheckField
          label="Can fund loan payoffs"
          help={HELP.investmentFundLoanPayoffs}
          checked={investment.fundLoanPayoffs}
          onChange={(fundLoanPayoffs) => patch({ fundLoanPayoffs })}
        />
      </div>

      <EventList
        title="Contributions"
        kind="contribution"
        events={investment.contributions}
        simulation={simulation}
        onChange={(contributions) => patch({ contributions })}
      />

      <div class="list-block">
        <fieldset class="style-picker">
          <legend>Withdrawal style</legend>
          {(['amount', 'percentage'] as const).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={`withdrawal-style-${investment.id}`}
                checked={style === option}
                onChange={() => patch({ withdrawals: convertWithdrawals(investment.withdrawals, option) })}
              />
              {option === 'amount' ? 'Fixed amount' : 'Percentage of balance'}
            </label>
          ))}
          <p class="list-block__hint">
            One style per investment — an account&rsquo;s withdrawals must either all be fixed
            amounts or all be percentages, never a mix. Switching converts every row.
          </p>
        </fieldset>
      </div>

      <EventList
        title="Withdrawals"
        kind="withdrawal"
        events={investment.withdrawals}
        simulation={simulation}
        withdrawalStyle={style}
        onChange={(withdrawals) => patch({ withdrawals: convertWithdrawals(withdrawals, style) })}
      />
    </li>
  );
}

interface InvestmentListProps {
  investments: InvestmentModel[];
  simulation: SimulationModel;
  onChange: (investments: InvestmentModel[]) => void;
}

export function InvestmentList({ investments, simulation, onChange }: InvestmentListProps) {
  return (
    <div class="list-block">
      <div class="list-block__head">
        <h4>
          <span class="list-block__icon" aria-hidden="true">
            <IconGrowth />
          </span>
          Investments
        </h4>
        {/* Prepend so the new card appears next to this button without scrolling. */}
        <button type="button" class="btn" onClick={() => onChange([emptyInvestment(), ...investments])}>
          Add investment
        </button>
      </div>
      {investments.length === 0 ? (
        <p class="empty">None yet.</p>
      ) : (
        <ul class="row-list">
          {investments.map((investment, index) => (
            <InvestmentCard
              key={investment.id}
              investment={investment}
              index={index}
              simulation={simulation}
              onChange={(next) =>
                onChange(investments.map((existing, i) => (i === index ? next : existing)))
              }
              onRemove={() => onChange(investments.filter((_, i) => i !== index))}
              onDuplicate={() =>
                onChange([
                  ...investments.slice(0, index + 1),
                  cloneInvestment(investment),
                  ...investments.slice(index + 1),
                ])
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
