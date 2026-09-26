import { WorkbarDisclosure } from './WorkbarDisclosure';
import { OPTIMIZE_FIELD_LABEL } from '../config/optimize';
import type { OptimizerRef } from '../config/optimizers';

interface OptimizerControlProps {
  refs: OptimizerRef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether a run lets the optimizer adjust the events below. */
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  running: boolean;
  onJump: (ref: OptimizerRef) => void;
}

export function OptimizerControl({
  refs,
  open,
  onOpenChange,
  enabled,
  onEnabledChange,
  running,
  onJump,
}: OptimizerControlProps) {
  const label = enabled ? 'Optimizer: On' : 'Optimizer: Off';

  return (
    <WorkbarDisclosure
      id="optctl-panel"
      className="optctl"
      triggerClass="optctl__list"
      label={label}
      panelLabel="Optimizer settings and events"
      open={open}
      onOpenChange={onOpenChange}
    >
      <label class="optctl__switch">
        <input
          type="checkbox"
          checked={enabled}
          disabled={running}
          onChange={(event) => onEnabledChange(event.currentTarget.checked)}
        />
        Run the optimizer
      </label>
      <p class="optctl__note">
        {enabled
          ? 'A forecast can adjust the events below. Your plan only changes when you apply an adjustment.'
          : 'The optimizer is switched off, so a run uses these events exactly as you entered them.'}
      </p>
      {refs.length === 0 ? (
        <p class="optctl__empty">
          No events are set up for the optimizer yet. In a scenario event, select Add optimizer,
          then choose the field it can adjust and set its bounds.
        </p>
      ) : (
        <ul class="optctl__listing">
          {refs.map((ref) => (
            <li key={ref.eventId}>
              <button
                type="button"
                class="optctl__entry"
                onClick={() => {
                  onOpenChange(false);
                  onJump(ref);
                }}
              >
                <span class="optctl__event">{ref.eventLabel}</span>
                <span class="optctl__where">
                  {ref.scenarioLabel}
                  {ref.scenarioActive ? '' : ' — inactive, so it will not run'}
                </span>
                <span class="optctl__field">Adjusting: {OPTIMIZE_FIELD_LABEL[ref.field]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WorkbarDisclosure>
  );
}
