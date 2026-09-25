import { HELP } from '../../config/help';
import { cloneLoan, emptyLoan, type LoanModel, type SimulationModel } from '../../config/types';
import { CheckField, MonthField, NumberField, TextField } from '../fields';
import { IconPercent } from '../icons';
import { EventList } from './EventList';

interface LoanCardProps {
  loan: LoanModel;
  index: number;
  simulation: SimulationModel;
  onChange: (loan: LoanModel) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function LoanCard({ loan, index, simulation, onChange, onRemove, onDuplicate }: LoanCardProps) {
  const patch = (changes: Partial<LoanModel>) => onChange({ ...loan, ...changes });
  const title = loan.name.trim() || `Loan ${index + 1}`;

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
        <TextField label="Name" help={HELP.loanName} value={loan.name} required onInput={(name) => patch({ name })} />
        <NumberField
          label="Principal"
          help={HELP.loanPrincipal}
          value={loan.principal}
          step={1000}
          onChange={(principal) => patch({ principal })}
        />
        <NumberField
          label="Down payment"
          help={HELP.loanDownPayment}
          value={loan.downPayment}
          step={500}
          placeholder="0"
          onChange={(downPayment) => patch({ downPayment })}
        />
        <NumberField
          label="Interest rate"
          help={HELP.loanInterestRate}
          value={loan.interestRate}
          step={0.05}
          suffix="% / yr"
          onChange={(interestRate) => patch({ interestRate })}
        />
        <NumberField
          label="Term"
          help={HELP.loanTerm}
          value={loan.term}
          step={12}
          suffix="months"
          onChange={(term) => patch({ term })}
        />
        <MonthField
          label="First payment"
          help={HELP.loanStartDate}
          value={loan.startDate}
          required
          onChange={(startDate) => patch({ startDate })}
        />
        <NumberField
          label="Escrow"
          help={HELP.loanEscrow}
          value={loan.escrow}
          step={25}
          placeholder="0"
          suffix="/ mo"
          onChange={(escrow) => patch({ escrow })}
        />
        <NumberField
          label="Mortgage insurance"
          help={HELP.loanMortgageInsurance}
          value={loan.mortgageInsurance}
          step={5}
          placeholder="0"
          suffix="/ mo"
          onChange={(mortgageInsurance) => patch({ mortgageInsurance })}
        />
        <NumberField
          label="MI cutoff"
          help={HELP.loanMortgageInsuranceCutoff}
          value={loan.mortgageInsuranceCutoff}
          step={1}
          suffix="%"
          onChange={(mortgageInsuranceCutoff) => patch({ mortgageInsuranceCutoff })}
        />
        <NumberField
          label="Early payoff threshold"
          help={HELP.loanEarlyPayoffThreshold}
          value={loan.earlyPayoffThreshold}
          step={500}
          onChange={(earlyPayoffThreshold) => patch({ earlyPayoffThreshold })}
        />
        <MonthField
          label="Early payoff month"
          help={HELP.loanEarlyPayoffDate}
          value={loan.earlyPayoffDate}
          onChange={(earlyPayoffDate) => patch({ earlyPayoffDate })}
        />
      </div>

      <CheckField
        label="Sell the property at payoff"
        help={HELP.loanSellProperty}
        checked={loan.sellProperty}
        onChange={(sellProperty) => patch({ sellProperty })}
      />

      {loan.sellProperty ? (
        <div class="field-grid">
          <NumberField
            label="Sale price"
            help={HELP.loanSellPrice}
            value={loan.sellPrice}
            step={1000}
            onChange={(sellPrice) => patch({ sellPrice })}
          />
          <NumberField
            label="Net selling costs"
            help={HELP.loanSellCostsNet}
            value={loan.sellCostsNet}
            step={500}
            onChange={(sellCostsNet) => patch({ sellCostsNet })}
          />
        </div>
      ) : null}

      <EventList
        title="Extra principal payments"
        description={HELP.loanExtraPrincipalPayments}
        kind="extraPrincipalPayment"
        events={loan.extraPrincipalPayments}
        simulation={simulation}
        onChange={(extraPrincipalPayments) => patch({ extraPrincipalPayments })}
      />
    </li>
  );
}

interface LoanListProps {
  loans: LoanModel[];
  simulation: SimulationModel;
  onChange: (loans: LoanModel[]) => void;
}

export function LoanList({ loans, simulation, onChange }: LoanListProps) {
  return (
    <div class="list-block">
      <div class="list-block__head">
        <h4>
          <span class="list-block__icon" aria-hidden="true">
            <IconPercent />
          </span>
          Loans
        </h4>
        {/* Prepend so the new card appears next to this button without scrolling. */}
        <button type="button" class="btn" onClick={() => onChange([emptyLoan(), ...loans])}>
          Add loan
        </button>
      </div>
      {loans.length === 0 ? (
        <p class="empty">None yet.</p>
      ) : (
        <ul class="row-list">
          {loans.map((loan, index) => (
            <LoanCard
              key={loan.id}
              loan={loan}
              index={index}
              simulation={simulation}
              onChange={(next) => onChange(loans.map((existing, i) => (i === index ? next : existing)))}
              onRemove={() => onChange(loans.filter((_, i) => i !== index))}
              onDuplicate={() =>
                onChange([...loans.slice(0, index + 1), cloneLoan(loan), ...loans.slice(index + 1)])
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
