import { EditorCard, EditorFields, useEditorCards, type EditorCardState } from './EditorCard';
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
import { MonthField, NumberField, SelectField, TextField } from '../fields';
import { IconCalendar } from '../icons';

/* ------------------------------------------------------------------ */

interface OptimizeFormProps {
  event: EventModel;
  optimize: OptimizeModel;
  simulation: SimulationModel;
  onChange: (optimize: OptimizeModel) => void;
  onRemove: () => void;
}

/** The on-demand `optimize` sub-form (spec/03 §Optimizer block). */
function OptimizeForm({ event, optimize, simulation, onChange, onRemove }: OptimizeFormProps) {
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
          help={HELP.optimizeField}
          value={optimize.field}
          options={OPTIMIZE_FIELDS.map((field) => ({ value: field, label: OPTIMIZE_FIELD_LABEL[field] }))}
          onChange={(field) => onChange(retargetOptimize(optimize, field, event, simulation))}
        />
        {dateBounds ? (
          <>
            <MonthField
              label="Earliest month"
              help={HELP.optimizeMinDate}
              value={optimize.minDate}
              required
              onChange={(minDate) => patch({ minDate })}
            />
            <MonthField
              label="Latest month"
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
              help={HELP.optimizeMin}
              value={optimize.min}
              step={optimize.field === 'frequency' ? 1 : 50}
              onChange={(min) => patch({ min })}
            />
            <NumberField
              label="Upper bound"
              help={HELP.optimizeMax}
              value={optimize.max}
              step={optimize.field === 'frequency' ? 1 : 50}
              onChange={(max) => patch({ max })}
            />
          </>
        )}
        <NumberField
          label="Tolerance"
          help={HELP.optimizeTolerance}
          value={optimize.tolerance}
          step={optimize.field === 'amount' ? 0.01 : 1}
          onChange={(tolerance) => patch({ tolerance })}
        />
        <NumberField
          label="Max iterations"
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

/** An extra per-row action, e.g. "Move to common" on scenario events. */
export interface EventMoveAction {
  label: string;
  onMove: (index: number) => void;
}

interface EventRowProps extends EditorCardState {
  event: EventModel;
  index: number;
  kind: EventKind;
  simulation: SimulationModel;
  allowOptimize: boolean;
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
  const usePercentage = kind === 'withdrawal' && withdrawalStyle === 'percentage';

  return (
    <EditorCard
      id={`event-${event.id}`}
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
      <EditorFields title={`${EVENT_KIND_LABEL[kind]} details`}>
        <div class="field-grid">
          <TextField
            label="Name"
            help={HELP.eventName}
            value={event.name}
            onInput={(name) => patch({ name })}
          />
          {usePercentage ? (
            <NumberField
              label="Percentage"
              help={HELP.eventPercentageWithdrawal}
              value={event.percentage}
              step={0.5}
              suffix="%"
              onChange={(percentage) => patch({ percentage })}
            />
          ) : (
            <NumberField
              label="Amount"
              help={eventAmountHelp(kind)}
              value={event.amount}
              step={kind === 'cashflow' ? 50 : 25}
              onChange={(amount) => patch({ amount })}
            />
          )}
        </div>
      </EditorFields>
      <EditorFields title="Schedule">
        <div class="field-grid">
          <NumberField
            label="Frequency"
            help={HELP.eventFrequency}
            value={event.frequency}
            step={1}
            placeholder="1"
            suffix="months"
            onChange={(frequency) => patch({ frequency })}
          />
          <MonthField
            label="Start month"
            help={HELP.eventStartDate}
            value={event.startDate}
            placeholder="Simulation start"
            onChange={(startDate) => patch({ startDate })}
          />
          <MonthField
            label="End month"
            help={HELP.eventEndDate}
            value={event.endDate}
            placeholder="Simulation end"
            onChange={(endDate) => patch({ endDate })}
          />
        </div>
      </EditorFields>

      {event.optimize && kind === 'cashflow' ? (
        <OptimizeForm
          event={event}
          optimize={event.optimize}
          simulation={simulation}
          onChange={(optimize) => patch({ optimize })}
          onRemove={() => patch({ optimize: null })}
        />
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
  withdrawalStyle?: WithdrawalStyle;
  moveAction?: EventMoveAction;
  onChange: (events: EventModel[]) => void;
}

export function EventList({
  title,
  description,
  kind,
  events,
  simulation,
  allowOptimize = false,
  withdrawalStyle = 'amount',
  moveAction,
  onChange,
}: EventListProps) {
  const cards = useEditorCards(events);
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
          {events.map((event, index) => (
            <EventRow
              key={event.id}
              {...cards.cardProps(event.id)}
              event={event}
              index={index}
              kind={kind}
              simulation={simulation}
              allowOptimize={allowOptimize}
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
          ))}
        </ul>
      )}
    </div>
  );
}
