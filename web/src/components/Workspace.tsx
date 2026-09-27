import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { HELP } from '../config/help';
import {
  findReplicates,
  moveEventToCommon,
  moveEventToScenarios,
  type ReplicateRef,
} from '../config/move';
import {
  cloneScenario,
  emptyScenario,
  type CommonModel,
  type ConfigModel,
  type ScenarioModel,
  type SimulationModel,
} from '../config/types';
import { findOptimizers, type OptimizerRef } from '../config/optimizers';
import { CheckField, MonthField, NumberField, TextField } from './fields';
import { IconBranch, IconLayers, IconSliders } from './icons';
import { OptimizerControl } from './OptimizerControl';
import { EventList } from './editor/EventList';
import { InvestmentList } from './editor/InvestmentList';
import { LoanList } from './editor/LoanList';
import { SectionNav, type SectionRef } from './SectionNav';

interface SectionProps {
  id: string;
  title: string;
  description?: string;
  highlighted: boolean;
  icon?: ComponentChildren;
  actions?: ComponentChildren;
  children: ComponentChildren;
}

function Section({ id, title, description, highlighted, icon, actions, children }: SectionProps) {
  return (
    <section
      id={id}
      class={highlighted ? 'section is-highlighted' : 'section'}
      aria-labelledby={`${id}-heading`}
      tabIndex={-1}
    >
      <div class="section__intro">
        <div class="section__head">
          <h3 id={`${id}-heading`}>
            {icon ? <span class="section__icon">{icon}</span> : null}
            {title}
          </h3>
        </div>
        {description ? <p class="section__description">{description}</p> : null}
        {actions ? <div class="section__actions">{actions}</div> : null}
      </div>
      <div class="section__body">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Pending "move event" interaction. `toCommon` appears only when same-named
 * events exist in other scenarios (otherwise the move happens immediately);
 * `toScenario` always asks, since the user must pick target scenarios.
 */
type MoveDialogState =
  | {
      kind: 'toCommon';
      scenarioId: string;
      eventId: string;
      eventTitle: string;
      replicates: ReplicateRef[];
    }
  | { kind: 'toScenario'; eventId: string; eventTitle: string; selected: string[] };

interface WorkspaceProps {
  config: ConfigModel;
  onChange: (config: ConfigModel) => void;
  optimizerEnabled: boolean;
  onOptimizerEnabledChange: (value: boolean) => void;
  running: boolean;
  canRun: boolean;
  /** Shown in the pinned bar: a run starts here, so its failure belongs here. */
  runError: string | null;
  onRun: () => void;
}

export function Workspace({
  config,
  onChange,
  optimizerEnabled,
  onOptimizerEnabledChange,
  running,
  canRun,
  runError,
  onRun,
}: WorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const workbarRef = useRef<HTMLDivElement | null>(null);

  // Wrapping controls, zoom, and run errors can all change the bar's height.
  // Share the measured height with sticky introductions and scroll targets.
  useLayoutEffect(() => {
    const bar = workbarRef.current;
    const workspace = workspaceRef.current;
    if (!bar || !workspace) return;
    const measure = () => {
      const height = bar.getBoundingClientRect().height;
      // The workspace remains mounted while the Results tab hides it.
      if (height > 0) workspace.style.setProperty('--workbar-height', `${height}px`);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const [openPanel, setOpenPanel] = useState<'sections' | 'optimizer' | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const sections: SectionRef[] = useMemo(
    () => [
      { id: 'section-simulation', label: 'Simulation' },
      { id: 'section-common', label: 'Common settings' },
      {
        id: 'section-scenarios',
        label: 'Scenarios',
        children: config.scenarios.map((scenario, index) => ({
          id: `section-scenario-${scenario.id}`,
          label: scenario.name.trim() || `Scenario ${index + 1}`,
        })),
      },
    ],
    [config.scenarios],
  );

  const reveal = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    // A targeted editor entry may be collapsed; open it before moving there.
    target.dispatchEvent(new Event('editor:reveal'));
    const gently = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // jsdom has no scrollIntoView; the focus below is what the tests observe.
    target.scrollIntoView?.({ behavior: gently ? 'smooth' : 'auto', block: 'start' });
    target.focus({ preventScroll: true });
  }, []);

  const jump = useCallback(
    (id: string) => {
      reveal(id);
      setHighlightId(id);
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlightId(null), 1600);
    },
    [reveal],
  );

  const optimizers = useMemo(() => findOptimizers(config), [config]);

  const jumpToOptimizer = useCallback(
    (ref: OptimizerRef) => {
      reveal(`event-${ref.eventId}`);
    },
    [reveal],
  );

  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    },
    [],
  );

  const [moveDialog, setMoveDialog] = useState<MoveDialogState | null>(null);
  const moveDialogRef = useRef<HTMLDivElement | null>(null);

  // The dialog renders at the top of the workspace while the triggering
  // button may sit far down the page — bring it on screen when it opens.
  const moveDialogOpen = moveDialog !== null;
  useEffect(() => {
    if (moveDialogOpen && moveDialogRef.current) {
      moveDialogRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      moveDialogRef.current.focus({ preventScroll: true });
    }
  }, [moveDialogOpen]);

  const eventTitle = (name: string) => name.trim() || 'this event';

  /** "Move to common" on a scenario event: immediate unless replicates exist. */
  const requestMoveToCommon = (scenarioId: string, index: number) => {
    const scenario = config.scenarios.find((s) => s.id === scenarioId);
    const event = scenario?.events[index];
    if (!event) return;
    const replicates = findReplicates(config, scenarioId, event.id);
    if (replicates.length === 0) {
      onChange(moveEventToCommon(config, scenarioId, event.id, []));
    } else {
      setMoveDialog({
        kind: 'toCommon',
        scenarioId,
        eventId: event.id,
        eventTitle: eventTitle(event.name),
        replicates,
      });
    }
  };

  /** "Move to scenario…" on a common event: always opens the picker. */
  const requestMoveToScenario = (index: number) => {
    const event = config.common.events[index];
    if (!event) return;
    setMoveDialog({
      kind: 'toScenario',
      eventId: event.id,
      eventTitle: eventTitle(event.name),
      selected: [],
    });
  };

  const finishMoveToCommon = (removeReplicates: ReplicateRef[]) => {
    if (moveDialog?.kind !== 'toCommon') return;
    onChange(moveEventToCommon(config, moveDialog.scenarioId, moveDialog.eventId, removeReplicates));
    setMoveDialog(null);
  };

  const finishMoveToScenario = (mode: 'move' | 'copy') => {
    if (moveDialog?.kind !== 'toScenario') return;
    onChange(moveEventToScenarios(config, moveDialog.eventId, moveDialog.selected, mode));
    setMoveDialog(null);
  };

  const patchSimulation = (changes: Partial<SimulationModel>) =>
    onChange({ ...config, simulation: { ...config.simulation, ...changes } });
  const patchCommon = (changes: Partial<CommonModel>) =>
    onChange({ ...config, common: { ...config.common, ...changes } });
  const patchScenario = (index: number, next: ScenarioModel) =>
    onChange({
      ...config,
      scenarios: config.scenarios.map((scenario, i) => (i === index ? next : scenario)),
    });

  return (
    <div class="workspace" ref={workspaceRef}>
      <div class="workbar" ref={workbarRef}>
        <SectionNav
          sections={sections}
          open={openPanel === 'sections'}
          onOpenChange={(open) => setOpenPanel(open ? 'sections' : null)}
          onJump={jump}
        />
        <div class="workbar__actions">
          <OptimizerControl
            refs={optimizers}
            open={openPanel === 'optimizer'}
            onOpenChange={(open) => setOpenPanel(open ? 'optimizer' : null)}
            enabled={optimizerEnabled}
            onEnabledChange={onOptimizerEnabledChange}
            running={running}
            onJump={jumpToOptimizer}
          />
          <button
            type="button"
            class="btn btn--primary"
            disabled={running || !canRun}
            title="Run the forecast — Ctrl+Enter, or Cmd+Enter on a Mac"
            onClick={() => {
              setOpenPanel(null);
              onRun();
            }}
          >
            {running ? 'Running…' : 'Run Forecast'}
          </button>
        </div>
        {runError ? (
          <p class="workbar__error" role="alert">
            <strong>The engine could not run this config.</strong> {runError}
          </p>
        ) : null}
      </div>

      {moveDialog?.kind === 'toCommon' ? (
        <div
          class="confirm"
          role="dialog"
          aria-labelledby="move-common-title"
          tabIndex={-1}
          ref={moveDialogRef}
        >
          <p id="move-common-title">
            Move {moveDialog.eventTitle} to common settings? Other scenarios also contain an event
            with this name:{' '}
            {moveDialog.replicates
              .map((replicate) => replicate.scenarioName.trim() || 'unnamed scenario')
              .join(', ')}
            . Common events apply to every scenario, so those copies would count twice.
          </p>
          <div class="confirm__actions">
            <button type="button" class="btn" onClick={() => finishMoveToCommon(moveDialog.replicates)}>
              Move and remove duplicates
            </button>
            <button type="button" class="btn btn--quiet" onClick={() => finishMoveToCommon([])}>
              Move and keep duplicates
            </button>
            <button type="button" class="btn btn--quiet" onClick={() => setMoveDialog(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {moveDialog?.kind === 'toScenario' ? (
        <div
          class="confirm"
          role="dialog"
          aria-labelledby="move-scenario-title"
          tabIndex={-1}
          ref={moveDialogRef}
        >
          <p id="move-scenario-title">
            Move or copy {moveDialog.eventTitle} into which scenarios?
          </p>
          <div class="confirm__choices">
            {config.scenarios.map((scenario, index) => (
              <label key={scenario.id} class="check-row">
                <input
                  type="checkbox"
                  checked={moveDialog.selected.includes(scenario.id)}
                  onChange={(event) => {
                    const checked = (event.currentTarget as HTMLInputElement).checked;
                    setMoveDialog({
                      ...moveDialog,
                      selected: checked
                        ? [...moveDialog.selected, scenario.id]
                        : moveDialog.selected.filter((id) => id !== scenario.id),
                    });
                  }}
                />
                {scenario.name.trim() || `Scenario ${index + 1}`}
              </label>
            ))}
            <button
              type="button"
              class="btn btn--quiet"
              onClick={() =>
                setMoveDialog({ ...moveDialog, selected: config.scenarios.map((s) => s.id) })
              }
            >
              Select all
            </button>
          </div>
          <div class="confirm__actions">
            <button
              type="button"
              class="btn"
              disabled={moveDialog.selected.length === 0}
              onClick={() => finishMoveToScenario('move')}
            >
              Move to selected
            </button>
            <button
              type="button"
              class="btn"
              disabled={moveDialog.selected.length === 0}
              onClick={() => finishMoveToScenario('copy')}
            >
              Copy to selected
            </button>
            <button type="button" class="btn btn--quiet" onClick={() => setMoveDialog(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <Section
        id="section-simulation"
        title="Simulation"
        description="The window the forecast covers and the cash you start with."
        highlighted={highlightId === 'section-simulation'}
        icon={<IconSliders />}
      >
        <div class="field-grid">
          <MonthField
            label="Start month"
            help={HELP.startDate}
            value={config.simulation.startDate}
            onChange={(startDate) => patchSimulation({ startDate })}
          />
          <MonthField
            label="End month"
            help={HELP.endDate}
            value={config.simulation.endDate}
            required
            onChange={(endDate) => patchSimulation({ endDate })}
          />
          <NumberField
            label="Starting cash"
            help={HELP.startingCash}
            value={config.simulation.startingCash}
            step={500}
            onChange={(startingCash) => patchSimulation({ startingCash })}
          />
          <NumberField
            label="Emergency fund months"
            help={HELP.emergencyFundMonths}
            value={config.simulation.emergencyFundMonths}
            step={1}
            placeholder="6"
            suffix="months"
            onChange={(emergencyFundMonths) => patchSimulation({ emergencyFundMonths })}
          />
        </div>
      </Section>

      <Section
        id="section-common"
        title="Common settings"
        description="Events, loans and investments shared by every scenario."
        highlighted={highlightId === 'section-common'}
        icon={<IconLayers />}
      >
        <EventList
          title="Events"
          description="Positive amounts are income, negative amounts are spending."
          kind="cashflow"
          events={config.common.events}
          simulation={config.simulation}
          moveAction={{ label: 'Move to scenario…', onMove: requestMoveToScenario }}
          onChange={(events) => patchCommon({ events })}
        />
        <LoanList
          loans={config.common.loans}
          simulation={config.simulation}
          onChange={(loans) => patchCommon({ loans })}
        />
        <InvestmentList
          investments={config.common.investments}
          simulation={config.simulation}
          onChange={(investments) => patchCommon({ investments })}
        />
      </Section>

      <Section
        id="section-scenarios"
        title="Scenarios"
        description="Alternative futures to compare. Each scenario adds to the common settings above."
        highlighted={highlightId === 'section-scenarios'}
        icon={<IconBranch />}
        actions={
          <button
            type="button"
            class="btn"
            onClick={() => {
              const scenario = emptyScenario(`scenario ${config.scenarios.length + 1}`);
              onChange({ ...config, scenarios: [...config.scenarios, scenario] });
              window.setTimeout(() => jump(`section-scenario-${scenario.id}`), 0);
            }}
          >
            Add scenario
          </button>
        }
      >
        <ul class="scenario-index">
          {config.scenarios.map((scenario, index) => (
            <li key={scenario.id}>
              <button
                type="button"
                class="chip"
                onClick={() => jump(`section-scenario-${scenario.id}`)}
              >
                {scenario.name.trim() || `Scenario ${index + 1}`}
                {scenario.active ? '' : ' (inactive)'}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {config.scenarios.map((scenario, index) => {
        const id = `section-scenario-${scenario.id}`;
        const patch = (changes: Partial<ScenarioModel>) =>
          patchScenario(index, { ...scenario, ...changes });
        return (
          <Section
            key={scenario.id}
            id={id}
            title={scenario.name.trim() || `Scenario ${index + 1}`}
            highlighted={highlightId === id}
            icon={<IconBranch />}
            actions={
              <div class="row-card__actions">
                <button
                  type="button"
                  class="btn btn--quiet"
                  onClick={() =>
                    onChange({
                      ...config,
                      scenarios: [
                        ...config.scenarios.slice(0, index + 1),
                        cloneScenario(scenario),
                        ...config.scenarios.slice(index + 1),
                      ],
                    })
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  class="btn btn--quiet btn--danger"
                  disabled={config.scenarios.length <= 1}
                  onClick={() =>
                    onChange({
                      ...config,
                      scenarios: config.scenarios.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            }
          >
            <div class="field-grid">
              <TextField
                label="Scenario name"
                help={HELP.scenarioName}
                value={scenario.name}
                required
                wide
                onInput={(name) => patch({ name })}
              />
            </div>
            <CheckField
              label="Active"
              help={HELP.scenarioActive}
              checked={scenario.active}
              onChange={(active) => patch({ active })}
            />
            <EventList
              title="Events"
              description="Scenario events may carry an optimizer directive."
              kind="cashflow"
              events={scenario.events}
              simulation={config.simulation}
              allowOptimize
              moveAction={{
                label: 'Move to common',
                onMove: (eventIndex) => requestMoveToCommon(scenario.id, eventIndex),
              }}
              onChange={(events) => patch({ events })}
            />
            <LoanList
              loans={scenario.loans}
              simulation={config.simulation}
              onChange={(loans) => patch({ loans })}
            />
            <InvestmentList
              investments={scenario.investments}
              simulation={config.simulation}
              onChange={(investments) => patch({ investments })}
            />
          </Section>
        );
      })}
    </div>
  );
}
