import { useEffect, useRef, useState } from 'preact/hooks';
import { OPTIMIZE_FIELD_LABEL } from '../config/optimize';
import type { OptimizerRef } from '../config/optimizers';

interface OptimizerControlProps {
  refs: OptimizerRef[];
  /** Whether a run lets the optimizer adjust the events below. */
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  running: boolean;
  onJump: (ref: OptimizerRef) => void;
}

/**
 * Everything about the optimizer in one cluster: the switch that turns it on,
 * how many events it can act on, and a list that jumps to any of them.
 *
 * The switch and the list are separate controls sharing one visible label —
 * nesting a checkbox inside a button would be neither valid nor operable, so
 * the switch carries its own accessible name and they are only grouped
 * visually.
 */
export function OptimizerControl({
  refs,
  enabled,
  onEnabledChange,
  running,
  onJump,
}: OptimizerControlProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  // Removing the last optimizer while the list is open would strand an
  // empty panel under a disabled button.
  const empty = refs.length === 0;
  useEffect(() => {
    if (empty) setOpen(false);
  }, [empty]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div class="optctl" ref={root}>
      <label class="optctl__switch">
        <input
          type="checkbox"
          checked={enabled}
          disabled={running}
          aria-label="Run the optimizer"
          title="Let a run adjust the events listed here"
          onChange={(event) => onEnabledChange((event.currentTarget as HTMLInputElement).checked)}
        />
      </label>

      <button
        type="button"
        class="btn optctl__list"
        disabled={empty}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls="optctl-panel"
        title={
          empty
            ? 'No event is set up for the optimizer to adjust.'
            : 'List the events the optimizer can adjust.'
        }
        onClick={() => setOpen((current) => !current)}
      >
        {/* Kept terse: the pinned bar competes for width with the section links. */}
        Optimizer ({refs.length})
      </button>

      {open ? (
        <div
          class="optctl__panel"
          id="optctl-panel"
          role="group"
          aria-label="Events the optimizer can adjust"
        >
          {enabled ? null : (
            <p class="optctl__note">
              The optimizer is switched off, so a run uses these events exactly as you entered
              them.
            </p>
          )}
          <ul class="optctl__listing">
            {refs.map((ref) => (
              <li key={ref.eventId}>
                <button
                  type="button"
                  class="optctl__entry"
                  onClick={() => {
                    setOpen(false);
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
        </div>
      ) : null}
    </div>
  );
}
