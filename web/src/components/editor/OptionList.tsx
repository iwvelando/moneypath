import { useId, useMemo, useState } from 'preact/hooks';
import {
  ENTRY_KINDS,
  SET_FIELDS,
  addOption,
  applyEdit,
  canRemoveOption,
  changedFields,
  describeOption,
  effectiveEntry,
  newTarget,
  optionUsers,
  removeOption,
  resetField,
  targetCandidates,
  targetEntry,
  usedBy,
  type TargetCandidate,
} from '../../config/choices';
import { HELP } from '../../config/help';
import type {
  ChoiceModel,
  ConfigModel,
  EntryKind,
  EventModel,
  InvestmentModel,
  AssetModel,
  LoanModel,
  OptionModel,
  SimulationModel,
  TargetRef,
} from '../../config/types';
import { Combobox } from '../Combobox';
import { ChangedLabels, TextField } from '../fields';
import { IconChoice, IconLayers } from '../icons';
import { At, PathProblems } from '../problems';
import { EditorCard, useEditorCards, type EditorCardState } from './EditorCard';
import { EventFields, EventList } from './EventList';
import { InvestmentFields, InvestmentList } from './InvestmentList';
import { AssetFields, AssetList } from './AssetList';
import { LoanFields, LoanList } from './LoanList';
import { CardScope } from './scope';

const KIND_NOUN: Record<EntryKind, string> = { events: 'event', loans: 'loan', investments: 'investment', assets: 'asset' };
const KIND_LABEL: Record<EntryKind, string> = { events: 'Event', loans: 'Loan', investments: 'Investment', assets: 'Asset' };

interface Named {
  id: string;
  name: string;
}

type AnyChange = TargetRef & { set: object };

/* ------------------------------------------------------------------ */
/* one baseline entry, as an option changes it                          */
/* ------------------------------------------------------------------ */

interface ChangeCardProps extends EditorCardState {
  kind: EntryKind;
  change: AnyChange;
  /** The baseline entry, or null when the baseline no longer has it. */
  entry: Named | null;
  simulation: SimulationModel;
  onChange: (set: object) => void;
  onRemove: () => void;
}

function ChangeCard({ kind, change, entry, simulation, onChange, onRemove, open, autoFocus, onOpenChange }: ChangeCardProps) {
  const name = entry?.name.trim() || change.targetName || `an unnamed ${KIND_NOUN[kind]}`;
  const changed = entry ? changedFields(kind, entry, change.set) : [];
  const labels = useMemo(
    () => new Set(SET_FIELDS[kind].filter((field) => field.key in change.set).map((field) => field.label)),
    [kind, change.set],
  );
  const edit = (next: object) => {
    if (entry) onChange(applyEdit(kind, entry, change.set, next));
  };
  const effective = entry ? effectiveEntry<object>(entry, change.set) : null;

  return (
    <EditorCard
      id={`change-${change.id}`}
      title={`Changes ${name}`}
      summary={{
        primary: changed.length ? changed.map((field) => field.label).join(', ') : 'Nothing changed yet',
        detail: 'Everything else follows the baseline',
        attention: entry === null,
      }}
      open={open}
      autoFocus={autoFocus}
      onOpenChange={onOpenChange}
      ownNote={entry === null}
      actions={
        <button type="button" class="btn btn--quiet btn--danger" aria-label={`Stop changing ${name}`} onClick={onRemove}>
          Stop changing
        </button>
      }
    >
      {effective === null ? (
        <p class="target-note is-error">
          The baseline has no {KIND_NOUN[kind]} named {name}. Add it back to the baseline under that name, or
          stop changing it here.
        </p>
      ) : (
        <>
          <p class="list-block__hint">
            This is {name} as it is on the paths that pick this option. Edit a field to change it there, or
            empty it to take it away. Everything you leave alone follows the baseline.
          </p>
          {changed.length > 0 ? (
            <div class="changed">
              <h6>Changed on these paths</h6>
              <ul class="changed-list">
                {changed.map((field) => (
                  <li key={field.key}>
                    <span class="changed-list__label">{field.label}</span>{' '}
                    <span class="changed-list__value">{field.value}</span>{' '}
                    <span class="changed-list__baseline">Baseline: {field.baseline}</span>{' '}
                    <button
                      type="button"
                      class="btn btn--quiet"
                      aria-label={`Reset ${field.label}`}
                      onClick={() => onChange(resetField(change.set, field.key))}
                    >
                      Reset
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <CardScope.Provider value={`${change.id}-`}>
            <At sub="set">
            <ChangedLabels.Provider value={labels}>
              {kind === 'events' ? (
                <EventFields event={effective as EventModel} kind="cashflow" showName={false} onChange={edit} />
              ) : kind === 'loans' ? (
                <LoanFields loan={effective as LoanModel} simulation={simulation} showName={false} onChange={edit} />
              ) : kind === 'assets' ? (
                <AssetFields asset={effective as AssetModel} showName={false} onChange={edit} />
              ) : (
                <InvestmentFields
                  investment={effective as InvestmentModel}
                  simulation={simulation}
                  showName={false}
                  onChange={edit}
                />
              )}
            </ChangedLabels.Provider>
            </At>
          </CardScope.Provider>
        </>
      )}
    </EditorCard>
  );
}

/* ------------------------------------------------------------------ */
/* the baseline entries an option changes or removes                    */
/* ------------------------------------------------------------------ */

interface BaselineEffectsProps {
  config: ConfigModel;
  choice: ChoiceModel;
  option: OptionModel;
  onChange: (option: OptionModel) => void;
}

function BaselineEffects({ config, choice, option, onChange }: BaselineEffectsProps) {
  const [picked, setPicked] = useState('');
  const hintId = useId();
  const changes = ENTRY_KINDS.flatMap((kind) =>
    (option.change[kind] as AnyChange[]).map((change) => ({ kind, change })),
  );
  const removals = ENTRY_KINDS.flatMap((kind) => option.remove[kind].map((ref) => ({ kind, ref })));
  const cards = useEditorCards(changes.map(({ change }) => change));

  const candidates = targetCandidates(config, choice.id, option.id);
  const key = (candidate: TargetCandidate) => `${candidate.kind}:${candidate.id}`;
  const current = candidates.find((candidate) => key(candidate) === picked && candidate.unavailable === null);
  const entryOf = (candidate: TargetCandidate): Named =>
    (config.common[candidate.kind] as Named[]).find((entry) => entry.id === candidate.id)!;

  const setChanges = (kind: EntryKind, next: AnyChange[]) =>
    onChange({ ...option, change: { ...option.change, [kind]: next } });
  const setRemovals = (kind: EntryKind, next: TargetRef[]) =>
    onChange({ ...option, remove: { ...option.remove, [kind]: next } });

  const startChange = () => {
    if (!current) return;
    const added: AnyChange = { ...newTarget(entryOf(current)), set: {} };
    cards.openNew(added.id);
    setChanges(current.kind, [...(option.change[current.kind] as AnyChange[]), added]);
    setPicked('');
  };
  const startRemoval = () => {
    if (!current) return;
    setRemovals(current.kind, [...option.remove[current.kind], newTarget(entryOf(current))]);
    setPicked('');
  };

  return (
    <div class="list-block">
      <div class="list-block__head">
        <h4>
          <span class="list-block__icon" aria-hidden="true">
            <IconLayers />
          </span>
          Baseline entries changed or removed
        </h4>
        <div class="list-block__actions">{cards.toggleAll}</div>
      </div>
      <p class="list-block__hint">
        On the paths that pick this option, a baseline entry can have some of its fields changed, or be left
        out altogether.
      </p>

      {candidates.length === 0 ? (
        <p class="empty">The baseline has no entries yet.</p>
      ) : (
        <div class="target-picker">
          <Combobox
            label="Baseline entry"
            help={HELP.baselineTarget}
            placeholder="Type to search the baseline"
            emptyMessage="No baseline entry has a name like that."
            value={current ? picked : ''}
            options={candidates.map((candidate) => ({
              value: key(candidate),
              label: candidate.name,
              detail: KIND_LABEL[candidate.kind],
              unavailable: candidate.unavailable,
            }))}
            onChange={setPicked}
          />
          <div class="target-picker__actions" aria-describedby={hintId}>
            <button type="button" class="btn" disabled={!current} onClick={startChange}>
              Change it
            </button>
            <button type="button" class="btn" disabled={!current} onClick={startRemoval}>
              Remove it
            </button>
          </div>
          <p class="list-block__hint" id={hintId}>
            {candidates.some((candidate) => candidate.unavailable === null)
              ? 'Type part of a name to find an entry, then say whether this option changes it or removes it.'
              : 'No baseline entry is free for this option to change or remove.'}
          </p>
        </div>
      )}

      {changes.length + removals.length > 0 ? (
        <ul class="row-list">
          {changes.map(({ kind, change }) => (
            <At key={change.id} sub={`change.${kind}.${(option.change[kind] as AnyChange[]).indexOf(change)}`}>
            <ChangeCard
              {...cards.cardProps(change.id)}
              kind={kind}
              change={change}
              entry={targetEntry<Named>(config.common[kind], change)}
              simulation={config.simulation}
              onChange={(set) =>
                setChanges(
                  kind,
                  (option.change[kind] as AnyChange[]).map((existing) =>
                    existing.id === change.id ? { ...existing, set } : existing,
                  ),
                )
              }
              onRemove={() =>
                setChanges(
                  kind,
                  (option.change[kind] as AnyChange[]).filter((existing) => existing.id !== change.id),
                )
              }
            />
            </At>
          ))}
          {removals.map(({ kind, ref }) => {
            const entry = targetEntry<Named>(config.common[kind], ref);
            const name = entry?.name.trim() || ref.targetName || `an unnamed ${KIND_NOUN[kind]}`;
            return (
              <li key={ref.id} class="row-card target-row" id={`removal-${ref.id}`}>
                <p>
                  Removes <strong>{name}</strong>
                  <span class="target-row__kind"> ({KIND_NOUN[kind]})</span> on the paths that pick this option.
                  {entry ? null : (
                    <span class="target-note is-error">
                      {' '}
                      The baseline has no {KIND_NOUN[kind]} named {name}. Add it back to the baseline under that
                      name, or keep it here.
                    </span>
                  )}
                </p>
                <At sub={`remove.${kind}.${option.remove[kind].indexOf(ref)}`}>
                  <PathProblems quiet={entry === undefined || entry === null} />
                </At>
                <button
                  type="button"
                  class="btn btn--quiet"
                  aria-label={`Keep ${name}`}
                  onClick={() =>
                    setRemovals(
                      kind,
                      option.remove[kind].filter((existing) => existing.id !== ref.id),
                    )
                  }
                >
                  Keep it
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* options                                                              */
/* ------------------------------------------------------------------ */

interface OptionCardProps extends EditorCardState {
  config: ConfigModel;
  choice: ChoiceModel;
  option: OptionModel;
  index: number;
  onChange: (option: OptionModel) => void;
  onRemove: () => void;
}

function OptionCard({ config, choice, option, index, onChange, onRemove, open, autoFocus, onOpenChange }: OptionCardProps) {
  const patch = (changes: Partial<OptionModel>) => onChange({ ...option, ...changes });
  const title = option.name.trim() || `Option ${index + 1}`;
  const removable = canRemoveOption(config, choice.id, option.id);
  const reasonId = useId();
  const reason = removable
    ? null
    : optionUsers(config, choice.id, option.id).length > 0
      ? 'A scenario uses this option; pick another option there before removing this one.'
      : 'A choice keeps at least one option.';

  return (
    <EditorCard
      id={`option-${option.id}`}
      title={title}
      summary={describeOption(config, choice.id, option)}
      open={open}
      autoFocus={autoFocus}
      onOpenChange={onOpenChange}
      actions={
        <>
          {reason ? (
            <span class="option__reason" id={reasonId}>
              {reason}
            </span>
          ) : null}
          <button
            type="button"
            class="btn btn--quiet btn--danger"
            aria-label={`Remove ${title}`}
            aria-describedby={reason ? reasonId : undefined}
            disabled={!removable}
            onClick={onRemove}
          >
            Remove
          </button>
        </>
      }
    >
      <div class="field-grid">
        <TextField
          field="name"
          label="Option name"
          help={HELP.optionName}
          value={option.name}
          required
          wide
          onInput={(name) => patch({ name })}
        />
      </div>
      <p class="option__usage">
        {usedBy(config, choice.id, option.id)}. An edit here reaches every scenario that picks this option.
      </p>

      <EventList
        title="Events"
        description="What this option adds on the paths that pick it. Positive amounts are income, negative amounts are spending."
        kind="cashflow"
        events={option.events}
        simulation={config.simulation}
        onChange={(events) => patch({ events })}
      />
      <LoanList loans={option.loans} simulation={config.simulation} onChange={(loans) => patch({ loans })} />
      <InvestmentList
        investments={option.investments}
        simulation={config.simulation}
        onChange={(investments) => patch({ investments })}
      />
      <AssetList assets={option.assets} onChange={(assets) => patch({ assets })} />
      <BaselineEffects config={config} choice={choice} option={option} onChange={onChange} />
    </EditorCard>
  );
}

interface OptionListProps {
  config: ConfigModel;
  choice: ChoiceModel;
  onChange: (config: ConfigModel) => void;
}

export function OptionList({ config, choice, onChange }: OptionListProps) {
  const cards = useEditorCards(choice.options);
  const replace = (next: OptionModel) =>
    onChange({
      ...config,
      choices: config.choices.map((existing) =>
        existing.id === choice.id
          ? { ...existing, options: existing.options.map((option) => (option.id === next.id ? next : option)) }
          : existing,
      ),
    });

  return (
    <div class="list-block">
      <div class="list-block__head">
        <h4>
          <span class="list-block__icon" aria-hidden="true">
            <IconChoice />
          </span>
          Options
        </h4>
        <div class="list-block__actions">
          {cards.toggleAll}
          <button
            type="button"
            class="btn"
            onClick={() => {
              const next = addOption(config, choice.id);
              const added = next.choices.find((existing) => existing.id === choice.id)?.options.at(-1);
              if (added) cards.openNew(added.id);
              onChange(next);
            }}
          >
            Add option
          </button>
        </div>
      </div>
      <p class="list-block__hint">The ways this decision can go. Each scenario picks one.</p>
      <ul class="row-list">
        {choice.options.map((option, index) => (
          <At key={option.id} sub={`options.${index}`}>
          <OptionCard
            {...cards.cardProps(option.id)}
            config={config}
            choice={choice}
            option={option}
            index={index}
            onChange={replace}
            onRemove={() => onChange(removeOption(config, choice.id, option.id))}
          />
          </At>
        ))}
      </ul>
    </div>
  );
}
