import { useId } from 'preact/hooks';
import { EditorCard, EditorFields, useEditorCards, type EditorCardState } from './EditorCard';
import { guardrailSummary } from './summaries';
import { HELP, type Help } from '../../config/help';
import {
  cloneGuardrail,
  emptyGuardrail,
  type ConfigModel,
  type GuardrailModel,
  type InvestmentModel,
  type LoanModel,
} from '../../config/types';
import { formatMoney } from '../../util/format';
import { HelpTip } from '../HelpTip';
import { MonthField, NumberField, SelectField, TextField } from '../fields';
import { GrowthField } from '../GrowthField';
import { At, Notes, PathProblems, noteOf, usePath, useProblemsAt } from '../problems';

const KINDS = [
  { value: 'cashFloor', label: 'Cash floor' },
  { value: 'debtFree', label: 'Debt-free' },
  { value: 'lasts', label: 'Investments last' },
] as const;

/** The loan and investment names written anywhere in a plan, each once, in the plan's order. */
export interface EntryNames {
  loans: string[];
  investments: string[];
}

/**
 * Every loan and investment name in the plan: the baseline's, those an option
 * adds and each scenario's own, active or not. These are the names a guardrail
 * can list; the engine says when a listed one is not among them.
 */
export function entryNames(config: ConfigModel): EntryNames {
  const sections: { loans: LoanModel[]; investments: InvestmentModel[] }[] = [
    config.common,
    ...config.choices.flatMap((choice) => choice.options),
    ...config.scenarios,
  ];
  const unique = (names: string[]) => [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))];
  return {
    loans: unique(sections.flatMap((section) => section.loans.map((loan) => loan.name))),
    investments: unique(sections.flatMap((section) => section.investments.map((investment) => investment.name))),
  };
}

/**
 * The plan's guardrail names, each once and in the plan's order: the
 * guardrails an optimizer target can be held to.
 */
export function guardrailNames(config: ConfigModel): string[] {
  return [...new Set(config.guardrails.map((guardrail) => guardrail.name.trim()).filter((name) => name !== ''))];
}

/**
 * Something a loaded plan gave a guardrail whose kind does not use it. It
 * stays on screen with the engine's warning until the reader takes it away.
 */
function Unused({ field, label, help, text, onRemove }: { field: string; label: string; help: Help; text: string; onRemove: () => void }) {
  const path = usePath(field);
  const helpId = `${useId()}-help`;
  const notes = useProblemsAt(path).map(noteOf);
  return (
    <div class="field field--wide" data-path={path}>
      <div class="field__label">
        <span>{label}</span>
        <HelpTip id={helpId} label={label} help={help} />
      </div>
      <p class="field__static">{text}</p>
      <Notes notes={notes} />
      <p>
        <button type="button" class="btn btn--quiet btn--small" onClick={onRemove}>
          Take away
        </button>
      </p>
    </div>
  );
}

function UnusedNames({ field, label, names, onRemove }: { field: string; label: string; names: string[]; onRemove: () => void }) {
  return (
    <Unused
      field={field}
      label={label}
      help={HELP.guardrailUnusedNames}
      text={names.length > 0 ? names.join(', ') : 'None listed'}
      onRemove={onRemove}
    />
  );
}

interface NameChecklistProps {
  field: 'loans' | 'investments';
  label: string;
  help: Help;
  /** Said under the boxes; the rule itself is the engine's. */
  hint: string;
  /** What the guardrail lists, as written; null when it lists nothing. */
  listed: string[] | null;
  /** The names of that kind in the plan. */
  available: string[];
  /** Said when the plan has no entry of that kind yet. */
  none: string;
  /** Optional action to remove an explicitly empty list. */
  clearEmptyLabel?: string;
  onChange: (listed: string[] | null) => void;
}

/**
 * A box for every name of one kind in the plan, ticked when the guardrail
 * lists it. A listed name the plan does not have keeps its ticked box, with
 * the engine's problem at its place in the list, until it is unticked.
 */
function NameChecklist({ field, label, help, hint, listed, available, none, clearEmptyLabel, onChange }: NameChecklistProps) {
  const path = usePath(field);
  const base = useId();
  const labelId = `${base}-label`;
  const helpId = `${base}-help`;
  const messageId = `${base}-msg`;
  const notes = useProblemsAt(path).map(noteOf);
  const names = [...available, ...(listed ?? []).filter((name, i, all) => !available.includes(name) && all.indexOf(name) === i)];
  const toggle = (name: string, ticked: boolean) => {
    const next = ticked ? [...(listed ?? []), name] : (listed ?? []).filter((existing) => existing !== name);
    onChange(next.length > 0 ? next : null);
  };
  return (
    <fieldset
      class="field field--wide name-checklist"
      data-path={path}
      aria-labelledby={labelId}
      aria-describedby={notes.length > 0 ? messageId : undefined}
    >
      <legend class="field__label">
        <span id={labelId}>{label}</span>
        <HelpTip id={helpId} label={label} help={help} />
      </legend>
      {names.length === 0 ? (
        <p class="field__static">{none}</p>
      ) : (
        <ul class="check-grid name-checklist__list">
          {names.map((name, n) => {
            const id = `${base}-${n}`;
            const places = (listed ?? []).flatMap((existing, j) => (existing === name ? [j] : []));
            return (
              <li key={name}>
                <div class="check-row">
                  <input id={id} type="checkbox" checked={places.length > 0} onChange={(event) => toggle(name, (event.currentTarget as HTMLInputElement).checked)} />
                  <label for={id}>{name}</label>
                </div>
                {places.map((j) => (
                  <PathProblems key={j} field={`${field}.${j}`} />
                ))}
              </li>
            );
          })}
        </ul>
      )}
      <p class="field__message">{hint}</p>
      <Notes id={messageId} notes={notes} />
      {clearEmptyLabel && listed?.length === 0 ? (
        <p>
          <button type="button" class="btn btn--quiet btn--small" onClick={() => onChange(null)}>
            {clearEmptyLabel}
          </button>
        </p>
      ) : null}
    </fieldset>
  );
}

interface GuardrailCardProps extends EditorCardState {
  guardrail: GuardrailModel;
  names: EntryNames;
  index: number;
  onChange: (guardrail: GuardrailModel) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function GuardrailCard({ guardrail, names, index, onChange, onRemove, onDuplicate, open, autoFocus, onOpenChange }: GuardrailCardProps) {
  const title = guardrail.name.trim() || `Guardrail ${index + 1}`;
  const patch = (changes: Partial<GuardrailModel>) => onChange({ ...guardrail, ...changes });
  const known = KINDS.some((kind) => kind.value === guardrail.kind);
  // A kind the editor cannot offer is shown as written, for the engine's error to explain.
  const kinds =
    known || guardrail.kind === ''
      ? KINDS
      : [...KINDS, { value: guardrail.kind, label: guardrail.kind, disabled: true }];
  return (
    <EditorCard
      id={`guardrail-${guardrail.id}`}
      title={title}
      summary={guardrailSummary(guardrail)}
      open={open}
      autoFocus={autoFocus}
      onOpenChange={onOpenChange}
      actions={
        <>
          <button type="button" class="btn btn--quiet" aria-label={`Duplicate ${title}`} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" class="btn btn--quiet btn--danger" aria-label={`Remove ${title}`} onClick={onRemove}>
            Remove
          </button>
        </>
      }
    >
      <EditorFields title="What it checks">
        <div class="field-grid">
          <TextField field="name" label="Name" help={HELP.guardrailName} value={guardrail.name} required onInput={(name) => patch({ name })} />
          <SelectField<string>
            field="kind"
            label="Kind"
            help={HELP.guardrailKind}
            value={guardrail.kind}
            placeholder={guardrail.kind === '' ? 'Pick a kind' : undefined}
            options={kinds}
            onChange={(kind) => patch({ kind })}
          />
          {guardrail.kind === 'cashFloor' ? (
            <NumberField
              field="amount"
              label="Floor"
              help={HELP.guardrailAmount}
              value={guardrail.amount}
              step={500}
              signed
              onChange={(amount) => patch({ amount })}
            />
          ) : null}
          {guardrail.kind === 'lasts' ? (
            <NumberField
              field="amount"
              label="Never below"
              help={HELP.guardrailLastsAmount}
              value={guardrail.amount}
              step={500}
              placeholder="Never emptied"
              onChange={(amount) => patch({ amount })}
            />
          ) : null}
          {/* A debt-free has no floor to grow; a growth the plan gives one stays for its warning. */}
          {guardrail.kind !== 'debtFree' || guardrail.growth.mode !== 'fixed' ? (
            <GrowthField
              label="Growth"
              help={HELP.guardrailGrowth}
              field="growth"
              value={guardrail.growth}
              onChange={(growth) => patch({ growth })}
            />
          ) : null}
        </div>
        {guardrail.kind === 'debtFree' ? (
          <NameChecklist
            field="loans"
            label="Loans"
            help={HELP.guardrailLoans}
            hint="Leave every box unticked to check every loan."
            listed={guardrail.loans}
            available={names.loans}
            none="The plan has no loans yet, so every loan a scenario takes out later is checked."
            clearEmptyLabel="Use every loan"
            onChange={(loans) => patch({ loans })}
          />
        ) : null}
        {guardrail.kind === 'lasts' ? (
          <NameChecklist
            field="investments"
            label="Investments"
            help={HELP.guardrailInvestments}
            hint="Tick at least one. Their balances are added together."
            listed={guardrail.investments}
            available={names.investments}
            none="The plan has no investments yet. Add one to the baseline, an option or a scenario first."
            onChange={(investments) => patch({ investments })}
          />
        ) : null}
        {guardrail.kind === 'debtFree' && guardrail.amount !== null ? (
          <Unused
            field="amount"
            label="Amount"
            help={HELP.guardrailUnusedAmount}
            text={formatMoney(guardrail.amount)}
            onRemove={() => patch({ amount: null })}
          />
        ) : null}
        {guardrail.kind !== 'lasts' && guardrail.investments !== null ? (
          <UnusedNames field="investments" label="Investments" names={guardrail.investments} onRemove={() => patch({ investments: null })} />
        ) : null}
        {guardrail.kind !== 'debtFree' && guardrail.loans !== null ? (
          <UnusedNames field="loans" label="Loans" names={guardrail.loans} onRemove={() => patch({ loans: null })} />
        ) : null}
      </EditorFields>
      <EditorFields title="Months checked">
        <div class="field-grid">
          {guardrail.kind === 'debtFree' ? (
            <MonthField
              field="startDate"
              label="Debt-free from"
              help={HELP.guardrailDeadline}
              value={guardrail.startDate}
              required
              onChange={(startDate) => patch({ startDate })}
            />
          ) : (
            <MonthField
              field="startDate"
              label="Start month"
              help={HELP.guardrailStartDate}
              value={guardrail.startDate}
              placeholder="Simulation start"
              onChange={(startDate) => patch({ startDate })}
            />
          )}
          <MonthField
            field="endDate"
            label="End month"
            help={HELP.guardrailEndDate}
            value={guardrail.endDate}
            placeholder="Simulation end"
            onChange={(endDate) => patch({ endDate })}
          />
        </div>
      </EditorFields>
    </EditorCard>
  );
}

interface GuardrailListProps {
  guardrails: GuardrailModel[];
  /** The loan and investment names in the plan, for the guardrails that list them. */
  names: EntryNames;
  onChange: (guardrails: GuardrailModel[]) => void;
}

/** The plan's guardrails, each at `guardrails.<i>` in the config document. */
export function GuardrailList({ guardrails, names, onChange }: GuardrailListProps) {
  const cards = useEditorCards(guardrails);
  return (
    <div class="list-block">
      <div class="list-block__head">
        <h4>Guardrails</h4>
        <div class="list-block__actions">
          {cards.toggleAll}
          <button
            type="button"
            class="btn"
            onClick={() => {
              const added = emptyGuardrail();
              cards.openNew(added.id);
              onChange([...guardrails, added]);
            }}
          >
            Add guardrail
          </button>
        </div>
      </div>
      {guardrails.length === 0 ? (
        <p class="empty">
          No guardrails yet. Add one to check every scenario against a condition you care about, such as never
          letting cash fall below a cushion, owing nothing by a certain month, or savings that last.
        </p>
      ) : (
        <ul class="row-list">
          {guardrails.map((guardrail, index) => (
            <At key={guardrail.id} path={`guardrails.${index}`}>
              <GuardrailCard
                {...cards.cardProps(guardrail.id)}
                guardrail={guardrail}
                names={names}
                index={index}
                onChange={(next) => onChange(guardrails.map((existing, i) => (i === index ? next : existing)))}
                onRemove={() => onChange(guardrails.filter((_, i) => i !== index))}
                onDuplicate={() => {
                  const duplicate = cloneGuardrail(guardrail);
                  cards.openNew(duplicate.id);
                  onChange([...guardrails.slice(0, index + 1), duplicate, ...guardrails.slice(index + 1)]);
                }}
              />
            </At>
          ))}
        </ul>
      )}
    </div>
  );
}
