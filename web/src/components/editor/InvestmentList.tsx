import { useContext } from 'preact/hooks';
import { EditorCard, EditorFields, useEditorCards, type EditorCardState } from './EditorCard';
import { CardScope } from './scope';
import { investmentSummary } from './summaries';
import { HELP } from '../../config/help';
import {
  cloneInvestment,
  emptyInvestment,
  type EventModel,
  type InvestmentModel,
  type SimulationModel,
} from '../../config/types';
import { CheckField, NumberField, TextField } from '../fields';
import { At, PathProblems } from '../problems';
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

interface InvestmentFieldsProps {
  investment: InvestmentModel;
  simulation: SimulationModel;
  /** Off where the name is not this form's to edit: an option's change to a baseline account. */
  showName?: boolean;
  onChange: (investment: InvestmentModel) => void;
}

/** An account's fields, contributions and withdrawals. */
export function InvestmentFields({ investment, simulation, showName = true, onChange }: InvestmentFieldsProps) {
  const patch = (changes: Partial<InvestmentModel>) => onChange({ ...investment, ...changes });
  const style = withdrawalStyleOf(investment);
  const scope = useContext(CardScope);
  return (
    <>
      <EditorFields title="Account">
        <div class="field-grid">
          {showName ? (
            <TextField field="name"
              label="Name"
              help={HELP.investmentName}
              value={investment.name}
              required
              onInput={(name) => patch({ name })}
            />
          ) : null}
          <NumberField field="startingValue"
            label="Starting value"
            help={HELP.investmentStartingValue}
            value={investment.startingValue}
            step={1000}
            placeholder="0"
            onChange={(startingValue) => patch({ startingValue })}
          />
          <NumberField field="annualReturnRate"
            label="Annual return"
            help={HELP.investmentAnnualReturnRate}
            value={investment.annualReturnRate}
            signed
            step={0.1}
            placeholder="0"
            suffix="% / yr"
            onChange={(annualReturnRate) => patch({ annualReturnRate })}
          />
        </div>
      </EditorFields>
      <EditorFields title="Taxes and cash flow">
        <div class="field-grid">
          <NumberField field="taxRate"
            label="Growth tax rate"
            help={HELP.investmentTaxRate}
            value={investment.taxRate}
            step={1}
            placeholder="0"
            suffix="%"
            onChange={(taxRate) => patch({ taxRate })}
          />
          <NumberField field="withdrawalTaxRate"
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
          <CheckField field="contributionsFromCash"
            label="Contributions come out of simulated cash"
            help={HELP.investmentContributionsFromCash}
            checked={investment.contributionsFromCash}
            onChange={(contributionsFromCash) => patch({ contributionsFromCash })}
          />
          <CheckField field="fundLoanPayoffs"
            label="Can fund loan payoffs"
            help={HELP.investmentFundLoanPayoffs}
            checked={investment.fundLoanPayoffs}
            onChange={(fundLoanPayoffs) => patch({ fundLoanPayoffs })}
          />
        </div>
      </EditorFields>

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
                name={`${scope}withdrawal-style-${investment.id}`}
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
          <PathProblems field="withdrawals" />
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
    </>
  );
}

interface InvestmentCardProps extends EditorCardState {
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
  open,
  autoFocus,
  onOpenChange,
}: InvestmentCardProps) {
  const title = investment.name.trim() || `Investment ${index + 1}`;
  const scope = useContext(CardScope);

  return (
    <EditorCard
      id={`${scope}investment-${investment.id}`}
      title={title}
      summary={investmentSummary(investment)}
      open={open}
      autoFocus={autoFocus}
      onOpenChange={onOpenChange}
      actions={
        <>
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
        </>
      }
    >
      <InvestmentFields investment={investment} simulation={simulation} onChange={onChange} />
    </EditorCard>
  );
}

interface InvestmentListProps {
  investments: InvestmentModel[];
  simulation: SimulationModel;
  onChange: (investments: InvestmentModel[]) => void;
}

export function InvestmentList({ investments, simulation, onChange }: InvestmentListProps) {
  const cards = useEditorCards(investments);
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
        <div class="list-block__actions">
          {cards.toggleAll}
          <button type="button" class="btn" onClick={() => {
            const added = emptyInvestment();
            cards.openNew(added.id);
            onChange([added, ...investments]);
          }}>
            Add investment
          </button>
        </div>
      </div>
      {investments.length === 0 ? (
        <p class="empty">None yet.</p>
      ) : (
        <ul class="row-list">
          {investments.map((investment, index) => (
            <At key={investment.id} sub={`investments.${index}`}>
            <InvestmentCard
              {...cards.cardProps(investment.id)}
              investment={investment}
              index={index}
              simulation={simulation}
              onChange={(next) =>
                onChange(investments.map((existing, i) => (i === index ? next : existing)))
              }
              onRemove={() => onChange(investments.filter((_, i) => i !== index))}
              onDuplicate={() => {
                const duplicate = cloneInvestment(investment);
                cards.openNew(duplicate.id);
                onChange([...investments.slice(0, index + 1), duplicate, ...investments.slice(index + 1)]);
              }}
            />
            </At>
          ))}
        </ul>
      )}
    </div>
  );
}
