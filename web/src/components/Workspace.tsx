import type { ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { addChoice, linkTargets, removeChoice } from '../config/choices';
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
  type ChoiceModel,
  type CommonModel,
  type ConfigModel,
  type ScenarioModel,
  type SimulationModel,
} from '../config/types';
import { findOptimizers, type OptimizerRef } from '../config/optimizers';
import { CheckField, MonthField, NumberField, SelectField, TextField } from './fields';
import { IconBranch, IconChoice, IconLayers, IconShield, IconSliders } from './icons';
import { OptimizerControl } from './OptimizerControl';
import { At, PathProblems, Problems } from './problems';
import { problemText, type Problem } from '../engine/types';
import { EventList } from './editor/EventList';
import { GuardrailList } from './editor/GuardrailList';
import { InvestmentList } from './editor/InvestmentList';
import { LoanList } from './editor/LoanList';
import { OptionList } from './editor/OptionList';
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
  /**
   * A run was asked for while the plan still has errors. The pinned bar then
   * counts them and leads to the first; each one is under its own field.
   */
  blocked?: boolean;
  /** A run that failed for a reason no field accounts for. A run starts in the bar, so it is said here. */
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
  blocked = false,
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

  const problems = useContext(Problems);
  const errors = useMemo(() => problems.all.filter((problem) => problem.level === 'error'), [problems]);
  // An error with no field of its own on the page is spelled out in the bar,
  // so it is never counted without being shown.
  const [unplaced, setUnplaced] = useState<readonly Problem[]>([]);
  useLayoutEffect(() => {
    if (!blocked) return;
    const placed = new Set(
      Array.from(workspaceRef.current?.querySelectorAll('[data-path]') ?? [], (element) =>
        element.getAttribute('data-path'),
      ),
    );
    const next = errors.filter((problem) => !placed.has(problem.path));
    setUnplaced((current) =>
      current.length === next.length && current.every((problem, index) => problem === next[index]) ? current : next,
    );
  }, [blocked, errors]);

  /** Opens whatever holds the first error on the page and goes to its field. */
  const showFirstError = () => {
    const paths = new Set(errors.map((problem) => problem.path));
    const target = Array.from(workspaceRef.current?.querySelectorAll<HTMLElement>('[data-path]') ?? []).find(
      (element) => paths.has(element.dataset['path'] ?? ''),
    );
    if (!target) return;
    for (
      let card = target.closest('.editor-card');
      card;
      card = card.parentElement?.closest('.editor-card') ?? null
    ) {
      card.dispatchEvent(new Event('editor:reveal'));
    }
    // Once the cards have opened.
    window.setTimeout(() => {
      const gently = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView?.({ behavior: gently ? 'smooth' : 'auto', block: 'center' });
      (target.querySelector<HTMLElement>('input, select') ?? target).focus({ preventScroll: true });
    }, 0);
  };

  const [openPanel, setOpenPanel] = useState<'sections' | 'optimizer' | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const sections: SectionRef[] = useMemo(
    () => [
      { id: 'section-simulation', label: 'Simulation' },
      { id: 'section-guardrails', label: 'Guardrails' },
      { id: 'section-common', label: 'Baseline' },
      {
        id: 'section-choices',
        label: 'Choices',
        children: config.choices.map((choice, index) => ({
          id: `section-choice-${choice.id}`,
          label: choice.name.trim() || `Choice ${index + 1}`,
        })),
      },
      {
        id: 'section-scenarios',
        label: 'Scenarios',
        children: config.scenarios.map((scenario, index) => ({
          id: `section-scenario-${scenario.id}`,
          label: scenario.name.trim() || `Scenario ${index + 1}`,
        })),
      },
    ],
    [config.choices, config.scenarios],
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

  /** "Move to baseline" on a scenario event: immediate unless replicates exist. */
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
  // An option names the baseline entries it changes or removes, so they are
  // brought in step whenever the baseline moves.
  const patchCommon = (changes: Partial<CommonModel>) =>
    onChange(linkTargets({ ...config, common: { ...config.common, ...changes } }));
  const patchChoice = (id: string, changes: Partial<ChoiceModel>) =>
    onChange({
      ...config,
      choices: config.choices.map((choice) => (choice.id === id ? { ...choice, ...changes } : choice)),
    });
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
        {blocked && errors.length > 0 ? (
          <div class="workbar__error" role="alert">
            <p>
              <strong>
                {errors.length === 1
                  ? 'One thing in your plan needs fixing before the forecast can run.'
                  : `${errors.length} things in your plan need fixing before the forecast can run.`}
              </strong>{' '}
              {errors.length > unplaced.length ? (
                <button type="button" class="btn btn--small" onClick={showFirstError}>
                  {errors.length === 1 ? 'Show it' : 'Show the first'}
                </button>
              ) : null}
            </p>
            {unplaced.length > 0 ? (
              <ul>
                {unplaced.map((problem) => (
                  <li key={`${problem.path} ${problem.message}`}>{problemText(problem)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : runError ? (
          <p class="workbar__error" role="alert">
            <strong>The forecast could not be run.</strong> {runError}
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
            Move {moveDialog.eventTitle} to the baseline? Other scenarios also contain an event
            with this name:{' '}
            {moveDialog.replicates
              .map((replicate) => replicate.scenarioName.trim() || 'unnamed scenario')
              .join(', ')}
            . Baseline events apply to every scenario, so those copies would count twice.
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
        description="The window the forecast covers, the cash you start with, and what that cash earns."
        highlighted={highlightId === 'section-simulation'}
        icon={<IconSliders />}
      >
        <div class="field-grid">
          <At path="simulation">
          <MonthField
            field="startDate"
            label="Start month"
            help={HELP.startDate}
            value={config.simulation.startDate}
            onChange={(startDate) => patchSimulation({ startDate })}
          />
          <MonthField
            field="endDate"
            label="End month"
            help={HELP.endDate}
            value={config.simulation.endDate}
            required
            onChange={(endDate) => patchSimulation({ endDate })}
          />
          <NumberField
            field="startingCash"
            label="Starting cash"
            help={HELP.startingCash}
            value={config.simulation.startingCash}
            step={500}
            signed
            onChange={(startingCash) => patchSimulation({ startingCash })}
          />
          <NumberField
            field="cashInterestRate"
            label="Cash interest rate"
            help={HELP.cashInterestRate}
            value={config.simulation.cashInterestRate}
            step={0.25}
            placeholder="0"
            suffix="% / yr"
            onChange={(cashInterestRate) => patchSimulation({ cashInterestRate })}
          />
          </At>
          <At path="recommendations">
          <NumberField
            field="emergencyFundMonths"
            label="Emergency fund months"
            help={HELP.emergencyFundMonths}
            value={config.simulation.emergencyFundMonths}
            step={1}
            placeholder="6"
            suffix="months"
            onChange={(emergencyFundMonths) => patchSimulation({ emergencyFundMonths })}
          />
          </At>
        </div>
      </Section>

      <Section
        id="section-guardrails"
        title="Guardrails"
        description="Conditions every scenario is checked against, month by month, such as keeping a cash cushion. A guardrail never stops a forecast: the results say whether each one holds on each path, when it first breaks, and when it comes closest."
        highlighted={highlightId === 'section-guardrails'}
        icon={<IconShield />}
      >
        <GuardrailList
          guardrails={config.guardrails}
          onChange={(guardrails) => onChange({ ...config, guardrails })}
        />
      </Section>

      <Section
        id="section-common"
        title="Baseline"
        description="Events, loans and investments that hold on every path, unless an option a scenario picks changes or removes them."
        highlighted={highlightId === 'section-common'}
        icon={<IconLayers />}
      >
        <At path="common">
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
        </At>
      </Section>

      <Section
        id="section-choices"
        title="Choices"
        description="The decisions this plan faces. Each choice has options, the ways it can go, and every scenario picks one option per choice."
        highlighted={highlightId === 'section-choices'}
        icon={<IconChoice />}
        actions={
          <button
            type="button"
            class="btn"
            onClick={() => {
              const next = addChoice(config);
              onChange(next);
              const added = next.choices.at(-1);
              if (added) window.setTimeout(() => jump(`section-choice-${added.id}`), 0);
            }}
          >
            Add choice
          </button>
        }
      >
        {config.choices.length === 0 ? (
          <p class="empty">
            No choices yet. Add one to describe a decision once and let each scenario pick how it goes,
            in place of copying entries between scenarios.
          </p>
        ) : (
          <ul class="scenario-index">
            {config.choices.map((choice, index) => (
              <li key={choice.id}>
                <button type="button" class="chip" onClick={() => jump(`section-choice-${choice.id}`)}>
                  {choice.name.trim() || `Choice ${index + 1}`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {config.choices.map((choice, index) => {
        const id = `section-choice-${choice.id}`;
        return (
          <Section
            key={choice.id}
            id={id}
            title={choice.name.trim() || `Choice ${index + 1}`}
            highlighted={highlightId === id}
            icon={<IconChoice />}
            actions={
              <div class="row-card__actions">
                <button
                  type="button"
                  class="btn btn--quiet btn--danger"
                  onClick={() => onChange(removeChoice(config, choice.id))}
                >
                  Remove choice
                </button>
              </div>
            }
          >
            <At path={`choices.${index}`}>
            <div class="field-grid">
              <TextField
                field="name"
                label="Choice name"
                help={HELP.choiceName}
                value={choice.name}
                required
                wide
                onInput={(name) => patchChoice(choice.id, { name })}
              />
            </div>
            <OptionList config={config} choice={choice} onChange={onChange} />
            </At>
          </Section>
        );
      })}

      <Section
        id="section-scenarios"
        title="Scenarios"
        description="Alternative futures to compare. Each scenario is the baseline, the options it picks, and whatever belongs to it alone."
        highlighted={highlightId === 'section-scenarios'}
        icon={<IconBranch />}
        actions={
          <button
            type="button"
            class="btn"
            onClick={() => {
              const scenario = emptyScenario(`scenario ${config.scenarios.length + 1}`, config.choices);
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
            <At path={`scenarios.${index}`}>
            <div class="field-grid">
              <TextField
                field="name"
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
            {config.choices.length > 0 ? (
              <fieldset class="editor-fields selections">
                <legend>Selections</legend>
                <div class="field-grid">
                  {config.choices.map((choice, choiceIndex) => {
                    const picked = scenario.select[choice.id];
                    return (
                      <SelectField<string>
                        key={choice.id}
                        field={`select.${choiceIndex}`}
                        label={choice.name.trim() || `Choice ${choiceIndex + 1}`}
                        help={HELP.selection}
                        value={choice.options.some((option) => option.id === picked) ? picked! : ''}
                        placeholder="Pick an option"
                        missingMessage="Pick an option for this choice."
                        options={choice.options.map((option, optionIndex) => ({
                          value: option.id,
                          label: option.name.trim() || `Option ${optionIndex + 1}`,
                        }))}
                        onChange={(optionId) =>
                          patch({ select: { ...scenario.select, [choice.id]: optionId } })
                        }
                      />
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
            <EventList
              title="Events"
              description="Events on this path alone. They may carry an optimizer directive."
              kind="cashflow"
              events={scenario.events}
              simulation={config.simulation}
              allowOptimize
              moveAction={{
                label: 'Move to baseline',
                onMove: (eventIndex) => requestMoveToCommon(scenario.id, eventIndex),
              }}
              onChange={(events) => patch({ events })}
            />
            <LoanList
              loans={scenario.loans}
              simulation={config.simulation}
              onChange={(loans) => patch({ loans })}
            />
            <PathProblems field="investments" />
            <InvestmentList
              investments={scenario.investments}
              simulation={config.simulation}
              onChange={(investments) => patch({ investments })}
            />
            </At>
          </Section>
        );
      })}
    </div>
  );
}
