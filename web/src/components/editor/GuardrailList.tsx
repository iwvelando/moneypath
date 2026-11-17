import { useId } from 'preact/hooks';
import { EditorCard, EditorFields, useEditorCards, type EditorCardState } from './EditorCard';
import { guardrailSummary } from './summaries';
import { HELP } from '../../config/help';
import { cloneGuardrail, emptyGuardrail, type GuardrailModel } from '../../config/types';
import { HelpTip } from '../HelpTip';
import { MonthField, NumberField, SelectField, TextField } from '../fields';
import { At, Notes, noteOf, usePath, useProblemsAt } from '../problems';

const KINDS = [{ value: 'cashFloor', label: 'Cash floor' }] as const;

/**
 * Names a loaded plan gave a guardrail whose kind does not use them. They stay
 * on screen with the engine's warning until the reader takes them away.
 */
function UnusedNames({ field, label, names, onRemove }: { field: string; label: string; names: string[]; onRemove: () => void }) {
  const path = usePath(field);
  const helpId = `${useId()}-help`;
  const notes = useProblemsAt(path).map(noteOf);
  return (
    <div class="field field--wide" data-path={path}>
      <div class="field__label">
        <span>{label}</span>
        <HelpTip id={helpId} label={label} text={HELP.guardrailUnusedNames} />
      </div>
      <p class="field__static">{names.length > 0 ? names.join(', ') : 'None listed'}</p>
      <Notes notes={notes} />
      <p>
        <button type="button" class="btn btn--quiet btn--small" onClick={onRemove}>
          Take away
        </button>
      </p>
    </div>
  );
}

interface GuardrailCardProps extends EditorCardState {
  guardrail: GuardrailModel;
  index: number;
  onChange: (guardrail: GuardrailModel) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function GuardrailCard({ guardrail, index, onChange, onRemove, onDuplicate, open, autoFocus, onOpenChange }: GuardrailCardProps) {
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
        </div>
        {guardrail.investments !== null ? (
          <UnusedNames field="investments" label="Investments" names={guardrail.investments} onRemove={() => patch({ investments: null })} />
        ) : null}
        {guardrail.loans !== null ? (
          <UnusedNames field="loans" label="Loans" names={guardrail.loans} onRemove={() => patch({ loans: null })} />
        ) : null}
      </EditorFields>
      <EditorFields title="Months checked">
        <div class="field-grid">
          <MonthField
            field="startDate"
            label="Start month"
            help={HELP.guardrailStartDate}
            value={guardrail.startDate}
            placeholder="Simulation start"
            onChange={(startDate) => patch({ startDate })}
          />
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
  onChange: (guardrails: GuardrailModel[]) => void;
}

/** The plan's guardrails, each at `guardrails.<i>` in the config document. */
export function GuardrailList({ guardrails, onChange }: GuardrailListProps) {
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
          letting cash fall below a cushion.
        </p>
      ) : (
        <ul class="row-list">
          {guardrails.map((guardrail, index) => (
            <At key={guardrail.id} path={`guardrails.${index}`}>
              <GuardrailCard
                {...cards.cardProps(guardrail.id)}
                guardrail={guardrail}
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
