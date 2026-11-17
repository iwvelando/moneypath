import { useContext } from 'preact/hooks';
import { EditorCard, EditorFields, useEditorCards, type EditorCardState } from './EditorCard';
import { CardScope } from './scope';
import { eventSummary } from './summaries';
import { EVENT_KIND_LABEL, HELP, eventAmountHelp } from '../../config/help';
import {
  OPTIMIZE_FIELDS,
  OPTIMIZE_FIELD_LABEL,
  defaultOptimize,
  retargetOptimize,
} from '../../config/optimize';
import {
  cloneEvent,
  emptyEvent,
  type EventKind,
  type EventModel,
  type OptimizeField,
  type OptimizeModel,
  type SimulationModel,
} from '../../config/types';
import { ChangedLabels, MonthField, NumberField, SelectField, TextField } from '../fields';
import { At } from '../problems';
import { IconCalendar } from '../icons';

/* ------------------------------------------------------------------ */

interface OptimizeFormProps {
  event: EventModel;
  optimize: OptimizeModel;
  simulation: SimulationModel;
  /** The plan's guardrail names, which a target can be held to. */
  guardrailNames: readonly string[];
  onChange: (optimize: OptimizeModel) => void;
  onRemove: () => void;
}

/**
 * The choices of what a value is held to: the emergency fund, then each
 * guardrail. A name the plan no longer has stays listed while it is chosen,
 * so it stays on screen with the engine's error under it.
 */
function heldToOptions(guardrailNames: readonly string[], current: string) {
  const names = current !== '' && !guardrailNames.includes(current) ? [...guardrailNames, current] : guardrailNames;
  return [{ value: '', label: 'Emergency fund' }, ...names.map((name) => ({ value: name, label: name }))];
}

/** The on-demand `optimize` sub-form (spec/03 §Optimizer block). */
function OptimizeForm({ event, optimize, simulation, guardrailNames, onChange, onRemove }: OptimizeFormProps) {
  const patch = (changes: Partial<OptimizeModel>) => onChange({ ...optimize, ...changes });
  const dateBounds = optimize.field === 'startDate' || optimize.field === 'endDate';

  return (
    <div class="optimize" role="group" aria-label={`Optimizer settings for ${event.name || 'this event'}`}>
      <div class="optimize__head">
        <h5>Optimizer</h5>
        <button type="button" class="btn btn--quiet" onClick={onRemove}>
          Remove optimizer
        </button>
      </div>
      <div class="field-grid">
        <SelectField<OptimizeField>
          label="Field to adjust"
          field="field"
          help={HELP.optimizeField}
          value={optimize.field}
          options={OPTIMIZE_FIELDS.map((field) => ({ value: field, label: OPTIMIZE_FIELD_LABEL[field] }))}
          onChange={(field) => onChange(retargetOptimize(optimize, field, event, simulation))}
        />
        <SelectField<string>
          label="Held to"
          field="guardrail"
          help={HELP.optimizeGuardrail}
          value={optimize.guardrail}
          options={heldToOptions(guardrailNames, optimize.guardrail)}
          onChange={(guardrail) => patch({ guardrail })}
        />
        {dateBounds ? (
          <>
            <MonthField
              label="Earliest month"
              field="minDate"
              help={HELP.optimizeMinDate}
              value={optimize.minDate}
              required
              onChange={(minDate) => patch({ minDate })}
            />
            <MonthField
              label="Latest month"
              field="maxDate"
              help={HELP.optimizeMaxDate}
              value={optimize.maxDate}
              required
              onChange={(maxDate) => patch({ maxDate })}
            />
          </>
        ) : (
          <>
            <NumberField
              label="Lower bound"
              field="min"
              help={HELP.optimizeMin}
              value={optimize.min}
              step={optimize.field === 'frequency' ? 1 : 50}
              signed={optimize.field === 'amount'}
              onChange={(min) => patch({ min })}
            />
            <NumberField
              label="Upper bound"
              field="max"
              help={HELP.optimizeMax}
              value={optimize.max}
              step={optimize.field === 'frequency' ? 1 : 50}
              signed={optimize.field === 'amount'}
              onChange={(max) => patch({ max })}
            />
          </>
        )}
        <NumberField
          label="Tolerance"
          field="tolerance"
          help={HELP.optimizeTolerance}
          value={optimize.tolerance}
          step={optimize.field === 'amount' ? 0.01 : 1}
          onChange={(tolerance) => patch({ tolerance })}
        />
        <NumberField
          label="Max iterations"
          field="maxIterations"
          help={HELP.optimizeMaxIterations}
          value={optimize.maxIterations}
          step={5}
          onChange={(maxIterations) => patch({ maxIterations })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export type WithdrawalStyle = 'amount' | 'percentage';

/** The key of each kind of event list in the config document. */
const LIST_KEY: Record<EventKind, string> = {
  cashflow: 'events',
  extraPrincipalPayment: 'extraPrincipalPayments',
  contribution: 'contributions',
  withdrawal: 'withdrawals',
};

/** The rows of a list are their own entries: what marks the list does not mark their fields. */
const NO_LABELS: ReadonlySet<string> = new Set();

/** An extra per-row action, e.g. "Move to baseline" on scenario events. */
export interface EventMoveAction {
  label: string;
  onMove: (index: number) => void;
}

interface EventFieldsProps {
  event: EventModel;
  kind: EventKind;
  withdrawalStyle?: WithdrawalStyle;
  /** Off where the name is not this form's to edit: an option's change to a baseline event. */
  showName?: boolean;
  onChange: (event: EventModel) => void;
}

/** An event's own fields, without its optimizer. */
export function EventFields({
  event,
  kind,
  withdrawalStyle = 'amount',
  showName = true,
  onChange,
}: EventFieldsProps) {
  const patch = (changes: Partial<EventModel>) => onChange({ ...event, ...changes });
  const usePercentage = kind === 'withdrawal' && withdrawalStyle === 'percentage';
  return (
    <>
      <EditorFields title={`${EVENT_KIND_LABEL[kind]} details`}>
        <div class="field-grid">
          {showName ? (
            <TextField
              label="Name"
              field="name"
              help={HELP.eventName}
              value={event.name}
              onInput={(name) => patch({ name })}
            />
          ) : null}
          {usePercentage ? (
            <NumberField
              label="Percentage"
              field="percentage"
              help={HELP.eventPercentageWithdrawal}
              value={event.percentage}
              step={0.5}
              suffix="%"
              onChange={(percentage) => patch({ percentage })}
            />
          ) : (
            <NumberField
              label="Amount"
              field="amount"
              help={eventAmountHelp(kind)}
              value={event.amount}
              step={kind === 'cashflow' ? 50 : 25}
              signed
              onChange={(amount) => patch({ amount })}
            />
          )}
        </div>
      </EditorFields>
      <EditorFields title="Schedule">
        <div class="field-grid">
          <NumberField
            label="Frequency"
            field="frequency"
            help={HELP.eventFrequency}
            value={event.frequency}
            step={1}
            placeholder="1"
            suffix="months"
            onChange={(frequency) => patch({ frequency })}
          />
          <MonthField
            label="Start month"
            field="startDate"
            help={HELP.eventStartDate}
            value={event.startDate}
            placeholder="Simulation start"
            onChange={(startDate) => patch({ startDate })}
          />
          <MonthField
            label="End month"
            field="endDate"
            help={HELP.eventEndDate}
            value={event.endDate}
            placeholder="Simulation end"
            onChange={(endDate) => patch({ endDate })}
          />
        </div>
      </EditorFields>
    </>
  );
}

interface EventRowProps extends EditorCardState {
  event: EventModel;
  index: number;
  kind: EventKind;
  simulation: SimulationModel;
  allowOptimize: boolean;
  guardrailNames: readonly string[];
  withdrawalStyle: WithdrawalStyle;
  moveAction?: EventMoveAction;
  onChange: (event: EventModel) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

function EventRow({
  event,
  index,
  kind,
  simulation,
  allowOptimize,
  guardrailNames,
  withdrawalStyle,
  moveAction,
  onChange,
  onRemove,
  onDuplicate,
  open,
  autoFocus,
  onOpenChange,
}: EventRowProps) {
  const patch = (changes: Partial<EventModel>) => onChange({ ...event, ...changes });
  const title = event.name.trim() || `${EVENT_KIND_LABEL[kind]} ${index + 1}`;
  const scope = useContext(CardScope);

  return (
    <EditorCard
      id={`${scope}event-${event.id}`}
      title={title}
      summary={eventSummary(event, kind, simulation)}
      open={open}
      autoFocus={autoFocus}
      onOpenChange={onOpenChange}
      badge={event.optimize ? `Optimizer: ${OPTIMIZE_FIELD_LABEL[event.optimize.field]}` : undefined}
      actions={
        <>
          {allowOptimize && kind === 'cashflow' && event.optimize === null ? (
            <button
              type="button"
              class="btn btn--quiet"
              onClick={() => patch({ optimize: defaultOptimize('amount', event, simulation) })}
            >
              Add optimizer
            </button>
          ) : null}
          {moveAction ? (
            <button
              type="button"
              class="btn btn--quiet"
              aria-label={`${moveAction.label} — ${title}`}
              onClick={() => moveAction.onMove(index)}
            >
              {moveAction.label}
            </button>
          ) : null}
          <button
            type="button"
            class="btn btn--quiet"
            aria-label={`Duplicate ${title}`}
            onClick={onDuplicate}
          >
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
      <EventFields
        event={event}
        kind={kind}
        withdrawalStyle={withdrawalStyle}
        onChange={onChange}
      />

      {event.optimize && kind === 'cashflow' ? (
        <At sub="optimize">
          <OptimizeForm
            event={event}
            optimize={event.optimize}
            simulation={simulation}
            guardrailNames={guardrailNames}
            onChange={(optimize) => patch({ optimize })}
            onRemove={() => patch({ optimize: null })}
          />
        </At>
      ) : null}
    </EditorCard>
  );
}

/* ------------------------------------------------------------------ */

interface EventListProps {
  title: string;
  description?: string;
  kind: EventKind;
  events: EventModel[];
  simulation: SimulationModel;
  /** Optimize blocks are legal on scenario events only (spec/03). */
  allowOptimize?: boolean;
  /** The plan's guardrail names, for an optimizer to be held to. */
  guardrailNames?: readonly string[];
  withdrawalStyle?: WithdrawalStyle;
  moveAction?: EventMoveAction;
  onChange: (events: EventModel[]) => void;
}

const NO_GUARDRAILS: readonly string[] = [];

export function EventList({
  title,
  description,
  kind,
  events,
  simulation,
  allowOptimize = false,
  guardrailNames = NO_GUARDRAILS,
  withdrawalStyle = 'amount',
  moveAction,
  onChange,
}: EventListProps) {
  const cards = useEditorCards(events);
  // Marked when this list is one an option replaces on a baseline entry.
  const changed = useContext(ChangedLabels).has(title);
  const replace = (index: number, event: EventModel) =>
    onChange(events.map((existing, i) => (i === index ? event : existing)));

  return (
    <div class="list-block">
      <div class="list-block__head">
        <h4>
          <span class="list-block__icon" aria-hidden="true">
            <IconCalendar />
          </span>
          {title}
          {changed ? <span class="field__changed">Changed</span> : null}
        </h4>
        {/* Prepend so the new row appears next to this button without scrolling. */}
        <div class="list-block__actions">
          {cards.toggleAll}
          <button type="button" class="btn" onClick={() => {
            const added = emptyEvent();
            cards.openNew(added.id);
            onChange([added, ...events]);
          }}>
            Add {EVENT_KIND_LABEL[kind].toLowerCase()}
          </button>
        </div>
      </div>
      {description ? <p class="list-block__hint">{description}</p> : null}
      {events.length === 0 ? (
        <p class="empty">None yet.</p>
      ) : (
        <ul class="row-list">
          <ChangedLabels.Provider value={NO_LABELS}>
            {events.map((event, index) => (
              <At key={event.id} sub={`${LIST_KEY[kind]}.${index}`}>
                <EventRow
                  {...cards.cardProps(event.id)}
                  event={event}
                  index={index}
                  kind={kind}
                  simulation={simulation}
                  allowOptimize={allowOptimize}
                  guardrailNames={guardrailNames}
                  withdrawalStyle={withdrawalStyle}
                  moveAction={moveAction}
                  onChange={(next) => replace(index, next)}
                  onRemove={() => onChange(events.filter((_, i) => i !== index))}
                  onDuplicate={() => {
                    const duplicate = cloneEvent(event);
                    cards.openNew(duplicate.id);
                    onChange([...events.slice(0, index + 1), duplicate, ...events.slice(index + 1)]);
                  }}
                />
              </At>
            ))}
          </ChangedLabels.Provider>
        </ul>
      )}
    </div>
  );
}
