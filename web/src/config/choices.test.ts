import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  addChoice,
  addOption,
  applyEdit,
  changedFields,
  describeOption,
  effectiveEntry,
  linkTargets,
  optionUsers,
  removeChoice,
  removeOption,
  resetField,
  targetCandidates,
} from './choices';
import { fromConfigDocument, refreshIds, toConfigDocument } from './serialize';
import { cloneScenario, emptyEvent, emptyScenario, type ConfigModel } from './types';

// vitest runs from web/.
const examplePath = resolve(process.cwd(), '../examples/choices.yaml');
const exampleDocument = (): Record<string, unknown> =>
  parseYaml(readFileSync(examplePath, 'utf8')) as Record<string, unknown>;
const example = (): ConfigModel => fromConfigDocument(exampleDocument());

function plain(): ConfigModel {
  return fromConfigDocument({
    version: 2,
    simulation: { endDate: '2030-01', startingCash: 100 },
    common: { events: [{ name: 'Salary', amount: 5000 }] },
    scenarios: [{ name: 'a' }, { name: 'b', active: false }],
  });
}

const choice = (config: ConfigModel, name: string) => config.choices.find((c) => c.name === name)!;
const option = (config: ConfigModel, choiceName: string, name: string) =>
  choice(config, choiceName).options.find((o) => o.name === name)!;
const scenarios = (doc: Record<string, unknown>) => doc['scenarios'] as Record<string, unknown>[];

describe('choices in the config document', () => {
  it('reads and writes the worked example without losing anything', () => {
    const doc = exampleDocument();
    const out = toConfigDocument(example());
    expect(out['choices']).toEqual(doc['choices']);
    expect(scenarios(out).map((s) => s['select'])).toEqual(scenarios(doc).map((s) => s['select']));
    expect(out['common']).toEqual(doc['common']);
  });

  it('survives a refresh of the client-only ids', () => {
    const doc = toConfigDocument(example());
    expect(toConfigDocument(refreshIds(example()))).toEqual(doc);
  });

  it('writes neither key for a plan without choices', () => {
    const doc = toConfigDocument(plain());
    expect(doc).not.toHaveProperty('choices');
    expect(scenarios(doc)[0]).not.toHaveProperty('select');
  });

  it('writes select in the order the choices are listed', () => {
    const config = example();
    config.choices.reverse();
    const select = scenarios(toConfigDocument(config))[0]!['select'] as Record<string, string>;
    expect(Object.keys(select)).toEqual(['Job', 'Housing']);
  });

  it('follows a renamed choice, option and baseline entry', () => {
    const config = example();
    choice(config, 'Housing').name = 'Home';
    option(config, 'Home', 'Sell and rent').name = 'Sell';
    config.common.loans[0]!.name = 'House loan';
    const doc = toConfigDocument(linkTargets(config));
    expect(scenarios(doc)[1]!['select']).toEqual({ Home: 'Sell', Job: 'Stay' });
    const sell = (doc['choices'] as { options: Record<string, unknown>[] }[])[0]!.options[1]!;
    expect((sell['change'] as { loans: { name: string }[] }).loans[0]!.name).toBe('House loan');
  });

  it('writes a field that was emptied as taken away', () => {
    const config = example();
    const sell = option(config, 'Housing', 'Sell and rent');
    sell.change.loans[0]!.set = { escrow: null, earlyPayoffDate: '', sellProperty: false, extraPrincipalPayments: [] };
    const doc = toConfigDocument(config);
    const written = (doc['choices'] as { options: Record<string, unknown>[] }[])[0]!.options[1]!;
    expect((written['change'] as { loans: { set: unknown }[] }).loans[0]!.set).toEqual({
      escrow: null,
      earlyPayoffDate: null,
      sellProperty: false,
      extraPrincipalPayments: [],
    });
  });

  it('reads a field set to null as changed to empty', () => {
    const doc = exampleDocument();
    const choices = doc['choices'] as { options: { change?: { loans: { set: Record<string, unknown> }[] } }[] }[];
    choices[0]!.options[1]!.change!.loans[0]!.set = { escrow: null };
    const config = fromConfigDocument(doc);
    expect(option(config, 'Housing', 'Sell and rent').change.loans[0]!.set).toEqual({ escrow: null });
  });

  it('keeps a target the baseline does not have, by the name as written', () => {
    const doc = exampleDocument();
    const choices = doc['choices'] as { options: { remove?: { events: string[] } }[] }[];
    choices[1]!.options[1]!.remove!.events = ['Salery', 'Gym'];
    const config = fromConfigDocument(doc);
    const removals = option(config, 'Job', 'Go freelance').remove.events;
    expect(removals.map((r) => [r.targetName, r.targetId !== ''])).toEqual([
      ['Salery', false],
      ['Gym', true],
    ]);
    const written = (toConfigDocument(config)['choices'] as { options: { remove?: unknown }[] }[])[1]!.options[1]!;
    expect(written.remove).toEqual({ events: ['Salery', 'Gym'] });
  });

  it('leaves a scenario unset for a choice it does not pick, and does not repair it', () => {
    const doc = exampleDocument();
    scenarios(doc)[0]!['select'] = { Housing: 'Keep the house', Job: 'Retire' };
    const config = fromConfigDocument(doc);
    expect(config.scenarios[0]!.select[choice(config, 'Job').id]).toBeUndefined();
    expect(scenarios(toConfigDocument(config))[0]!['select']).toEqual({ Housing: 'Keep the house' });
  });
});

describe('editing choices', () => {
  it('adds a choice whose one option every scenario selects', () => {
    const config = addChoice(plain());
    expect(config.choices).toHaveLength(1);
    const added = config.choices[0]!;
    expect(added.name).toBe('Choice 1');
    expect(added.options.map((o) => o.name)).toEqual(['Option 1']);
    for (const scenario of config.scenarios) {
      expect(scenario.select[added.id]).toBe(added.options[0]!.id);
    }
    expect(addChoice(config).choices[1]!.name).toBe('Choice 2');
  });

  it('removes a choice and the selections for it', () => {
    const config = example();
    const housing = choice(config, 'Housing');
    const next = removeChoice(config, housing.id);
    expect(next.choices.map((c) => c.name)).toEqual(['Job']);
    expect(next.scenarios.every((s) => !(housing.id in s.select))).toBe(true);
  });

  it('adds an option that no scenario selects', () => {
    const config = example();
    const housing = choice(config, 'Housing');
    const next = addOption(config, housing.id);
    expect(choice(next, 'Housing').options.map((o) => o.name)).toEqual([
      'Keep the house',
      'Sell and rent',
      'Option 3',
    ]);
    expect(optionUsers(next, housing.id, choice(next, 'Housing').options[2]!.id)).toEqual([]);
  });

  it('names the scenarios that use an option', () => {
    const config = example();
    const users = optionUsers(config, choice(config, 'Housing').id, option(config, 'Housing', 'Sell and rent').id);
    expect(users.map((s) => s.name)).toEqual(['sell', 'sell and freelance']);
  });

  it('refuses to remove an option a scenario selects, or the last one', () => {
    const config = example();
    const housing = choice(config, 'Housing');
    expect(removeOption(config, housing.id, housing.options[1]!.id)).toBe(config);

    const withSpare = addOption(config, housing.id);
    const spare = choice(withSpare, 'Housing').options[2]!;
    expect(choice(removeOption(withSpare, housing.id, spare.id), 'Housing').options).toHaveLength(2);

    const single = addChoice(plain());
    const only = single.choices[0]!;
    const unselected: ConfigModel = { ...single, scenarios: single.scenarios.map((s) => ({ ...s, select: {} })) };
    expect(removeOption(unselected, only.id, only.options[0]!.id)).toBe(unselected);
  });

  it('gives a new scenario the first option of each choice, and a copy its selections', () => {
    const config = example();
    const fresh = emptyScenario('new', config.choices);
    expect(fresh.select).toEqual({
      [choice(config, 'Housing').id]: option(config, 'Housing', 'Keep the house').id,
      [choice(config, 'Job').id]: option(config, 'Job', 'Stay').id,
    });
    expect(cloneScenario(config.scenarios[2]!).select).toEqual(config.scenarios[2]!.select);
  });
});

describe('which baseline entries an option may target', () => {
  it('offers only entries no other choice, and not this option, already targets', () => {
    const config = example();
    const housing = choice(config, 'Housing');
    const keep = option(config, 'Housing', 'Keep the house');
    const sell = option(config, 'Housing', 'Sell and rent');
    const state = (optionId: string) =>
      Object.fromEntries(
        targetCandidates(config, housing.id, optionId).map((c) => [`${c.kind}:${c.name}`, c.unavailable]),
      );

    expect(state(keep.id)).toEqual({
      'events:Salary': 'The choice Job already changes or removes it.',
      'events:Living costs': null,
      'events:Gym': 'The choice Job already changes or removes it.',
      // Another option of the same choice may target it too.
      'loans:Mortgage': null,
      'investments:Brokerage': 'The choice Job already changes or removes it.',
    });
    expect(state(sell.id)['loans:Mortgage']).toBe('This option already changes or removes it.');
  });

  it('does not offer an event without a name, or a name the baseline uses twice', () => {
    const config = addChoice(plain());
    config.common.events.push(emptyEvent(), { ...emptyEvent(), name: 'Salary' });
    const added = config.choices[0]!;
    const candidates = targetCandidates(config, added.id, added.options[0]!.id);
    expect(candidates.map((c) => c.unavailable)).toEqual([
      'The baseline has more than one event with this name.',
      'Give it a name in the baseline first.',
      'The baseline has more than one event with this name.',
    ]);
  });

  it('relinks a target by name once the baseline has it', () => {
    const doc = exampleDocument();
    const choices = doc['choices'] as { options: { remove?: { events: string[] } }[] }[];
    choices[1]!.options[1]!.remove!.events = ['Gymnasium'];
    const config = fromConfigDocument(doc);
    config.common.events[2]!.name = 'Gymnasium';
    const linked = linkTargets(config);
    expect(option(linked, 'Job', 'Go freelance').remove.events[0]!.targetId).toBe(config.common.events[2]!.id);
  });

  it('keeps a target whose baseline entry was deleted, under its last name', () => {
    const config = example();
    config.common.loans[0]!.name = 'House loan';
    const renamed = linkTargets(config);
    const deleted = linkTargets({ ...renamed, common: { ...renamed.common, loans: [] } });
    const change = option(deleted, 'Housing', 'Sell and rent').change.loans[0]!;
    expect(change.targetName).toBe('House loan');
    expect(targetCandidates(deleted, choice(deleted, 'Housing').id, '').length).toBe(4);
  });
});

describe('an entry as an option changes it', () => {
  it('lays the changed fields over the baseline entry', () => {
    const config = example();
    const mortgage = config.common.loans[0]!;
    const change = option(config, 'Housing', 'Sell and rent').change.loans[0]!;
    const effective = effectiveEntry(mortgage, change.set);
    expect(effective).toMatchObject({
      id: mortgage.id,
      name: 'Mortgage',
      principal: 240000,
      earlyPayoffDate: '2027-06',
      sellProperty: true,
      sellPrice: 310000,
    });
  });

  it('turns an edit into changed fields, never the name', () => {
    const config = example();
    const mortgage = config.common.loans[0]!;
    const set = applyEdit('loans', mortgage, {}, { ...mortgage, name: 'Other', interestRate: 3.5, escrow: null });
    expect(set).toEqual({ interestRate: 3.5, escrow: null });
    // A later edit keeps what was changed before, even when it matches the baseline again.
    const again = applyEdit('loans', mortgage, set, { ...effectiveEntry(mortgage, set), interestRate: 4 });
    expect(again).toEqual({ interestRate: 4, escrow: null });
    expect(resetField(again, 'interestRate')).toEqual({ escrow: null });
  });

  it('describes each changed field beside the baseline value', () => {
    const config = example();
    const mortgage = config.common.loans[0]!;
    const brokerage = config.common.investments[0]!;
    expect(
      changedFields('loans', mortgage, { earlyPayoffDate: '2027-06', sellProperty: true, sellPrice: 310000, escrow: null }),
    ).toEqual([
      { key: 'escrow', label: 'Escrow', value: 'Not set', baseline: '$450.00' },
      { key: 'earlyPayoffDate', label: 'Early payoff month', value: '2027-06', baseline: 'Not set' },
      { key: 'sellProperty', label: 'Sell the property at payoff', value: 'Yes', baseline: 'No' },
      { key: 'sellPrice', label: 'Sale price', value: '$310,000.00', baseline: 'Not set' },
    ]);
    expect(
      changedFields('investments', brokerage, { contributions: [], annualReturnRate: 5 }),
    ).toEqual([
      { key: 'annualReturnRate', label: 'Annual return', value: '5%', baseline: '6%' },
      { key: 'contributions', label: 'Contributions', value: 'None', baseline: '1 entry' },
    ]);
  });

  it('summarises what an option does and who uses it', () => {
    const config = example();
    const housing = choice(config, 'Housing');
    expect(describeOption(config, housing.id, option(config, 'Housing', 'Keep the house'))).toEqual({
      primary: 'Changes nothing',
      detail: 'Used by: as we are',
      attention: false,
    });
    const job = choice(config, 'Job');
    config.scenarios[2]!.active = false;
    expect(describeOption(config, job.id, option(config, 'Job', 'Go freelance'))).toEqual({
      primary: 'Adds 2 events · Changes Brokerage · Removes Salary, Gym',
      detail: 'Used by: sell and freelance (inactive)',
      attention: false,
    });
    const spare = addOption(config, job.id);
    const added = choice(spare, 'Job').options[2]!;
    expect(describeOption(spare, job.id, added).detail).toBe('No scenario picks this yet');
  });

  it('flags an option whose target the baseline does not have', () => {
    const config = example();
    const job = choice(config, 'Job');
    const gone = linkTargets({ ...config, common: { ...config.common, investments: [] } });
    expect(describeOption(gone, job.id, option(gone, 'Job', 'Go freelance')).attention).toBe(true);
  });
});
