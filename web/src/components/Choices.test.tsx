import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { fromConfigDocument, toConfigDocument } from '../config/serialize';
import type { ChoiceModel, ConfigModel, OptionModel } from '../config/types';
import { Workspace } from './Workspace';

// vitest runs from web/.
const example = (): ConfigModel =>
  fromConfigDocument(parseYaml(readFileSync(resolve(process.cwd(), '../examples/choices.yaml'), 'utf8')));

const plain = (): ConfigModel =>
  fromConfigDocument({
    version: 2,
    simulation: { endDate: '2030-01', startingCash: 100 },
    common: { events: [{ name: 'Salary', amount: 5000 }] },
    scenarios: [{ name: 'a' }, { name: 'b' }],
  });

let container: HTMLDivElement;
let latest: ConfigModel;

function Harness({ initial }: { initial: ConfigModel }) {
  const [config, setConfig] = useState(initial);
  latest = config;
  return (
    <Workspace
      config={config}
      optimizerEnabled={false}
      onOptimizerEnabledChange={() => {}}
      running={false}
      canRun
      runError={null}
      onRun={() => {}}
      onChange={(next) => {
        latest = next;
        setConfig(next);
      }}
    />
  );
}

async function mount(config: ConfigModel): Promise<void> {
  await act(async () => {
    render(<Harness initial={config} />, container);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const choice = (name: string): ChoiceModel => latest.choices.find((c) => c.name === name)!;
const option = (choiceName: string, name: string): OptionModel =>
  choice(choiceName).options.find((o) => o.name === name)!;
const el = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`no element #${id}`);
  return found;
};
const optionCard = (choiceName: string, name: string) => el(`option-${option(choiceName, name).id}`);
const scenarioSection = (index: number) => el(`section-scenario-${latest.scenarios[index]!.id}`);

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

async function click(root: ParentNode, label: string): Promise<void> {
  await act(async () => {
    button(root, label).click();
  });
}

/** The control a visible label names, within `root`. */
function control<T extends HTMLElement>(root: ParentNode, label: string): T {
  const found = Array.from(root.querySelectorAll('label')).find((l) => l.textContent?.trim() === label);
  if (!found) throw new Error(`no field labelled "${label}"`);
  return document.getElementById(found.htmlFor) as T;
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pick(select: HTMLSelectElement, label: string): Promise<void> {
  const found = Array.from(select.options).find((o) => o.textContent?.trim() === label);
  if (!found) throw new Error(`no option "${label}"`);
  await act(async () => {
    select.value = found.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const selections = (index: number) =>
  (toConfigDocument(latest)['scenarios'] as Record<string, unknown>[])[index]!['select'];

describe('sections and navigation', () => {
  it('lists the baseline, each choice and each scenario', async () => {
    await mount(example());
    await click(container, 'Jump to section');
    const links = Array.from(container.querySelectorAll('.sectionnav__link')).map((l) => l.textContent);
    expect(links).toEqual([
      'Simulation',
      'Baseline',
      'Choices',
      'Housing',
      'Job',
      'Scenarios',
      'as we are',
      'sell',
      'sell and freelance',
    ]);
    expect(el('section-common').querySelector('h3')?.textContent).toBe('Baseline');
  });

  it('jumps to a choice', async () => {
    await mount(example());
    await click(container, 'Jump to section');
    await click(container.querySelector('.sectionnav__panel')!, 'Job');
    expect(document.activeElement).toBe(el(`section-choice-${choice('Job').id}`));
  });

  it('gives every card and field its own id', async () => {
    await mount(example());
    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });
});

describe('a plan without choices', () => {
  it('has an empty Choices section and no selections', async () => {
    await mount(plain());
    expect(el('section-choices').textContent).toContain('No choices yet');
    expect(scenarioSection(0).textContent).not.toContain('Selections');
  });

  it('adds a choice that every scenario selects, leaving the plan as it was', async () => {
    await mount(plain());
    await click(el('section-choices'), 'Add choice');
    expect(latest.choices.map((c) => c.name)).toEqual(['Choice 1']);
    expect(selections(0)).toEqual({ 'Choice 1': 'Option 1' });
    expect(selections(1)).toEqual({ 'Choice 1': 'Option 1' });
    expect(control<HTMLSelectElement>(scenarioSection(1), 'Choice 1').value).toBe(latest.choices[0]!.options[0]!.id);
  });
});

describe('choices and options', () => {
  it('says what each option does and which scenarios use it, before it is opened', async () => {
    await mount(example());
    const sell = optionCard('Housing', 'Sell and rent');
    expect(sell.querySelector('.editor-card__toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(sell.querySelector('.editor-card__summary')?.textContent).toBe('Adds 1 event · Changes Mortgage');
    expect(sell.querySelector('.editor-card__detail')?.textContent).toBe('Used by: sell, sell and freelance');
    expect(optionCard('Housing', 'Keep the house').querySelector('.editor-card__summary')?.textContent)
      .toBe('Changes nothing');
  });

  it('renames a choice and an option without losing the selections', async () => {
    await mount(example());
    const section = el(`section-choice-${choice('Housing').id}`);
    await type(control<HTMLInputElement>(section, 'Choice name'), 'Home');
    await type(control<HTMLInputElement>(optionCard('Home', 'Sell and rent'), 'Option name'), 'Sell');
    expect(selections(1)).toEqual({ Home: 'Sell', Job: 'Stay' });
  });

  it('adds an option nobody uses, which can be removed again', async () => {
    await mount(example());
    const section = el(`section-choice-${choice('Job').id}`);
    await click(section, 'Add option');
    const added = optionCard('Job', 'Option 3');
    expect(added.querySelector('.editor-card__detail')?.textContent).toBe('No scenario picks this yet');
    await click(added, 'Remove Option 3');
    expect(choice('Job').options.map((o) => o.name)).toEqual(['Stay', 'Go freelance']);
  });

  it('does not let an option a scenario uses be removed', async () => {
    await mount(example());
    const stay = optionCard('Job', 'Stay');
    expect(button(stay, 'Remove Stay').disabled).toBe(true);
    expect(stay.textContent).toContain('pick another option there before removing this one');
  });

  it('removes a choice and its selections', async () => {
    await mount(example());
    await click(el(`section-choice-${choice('Housing').id}`), 'Remove choice');
    expect(latest.choices.map((c) => c.name)).toEqual(['Job']);
    expect(selections(1)).toEqual({ Job: 'Stay' });
  });

  it('offers no optimizer on an event an option adds', async () => {
    await mount(example());
    expect(optionCard('Housing', 'Sell and rent').textContent).not.toContain('Add optimizer');
    expect(scenarioSection(2).textContent).toContain('Add optimizer');
  });
});

describe('picking options in a scenario', () => {
  it('shows one dropdown per choice, in choice order, holding the pick', async () => {
    await mount(example());
    const group = scenarioSection(1).querySelector('.selections')!;
    expect(Array.from(group.querySelectorAll('label')).map((l) => l.textContent)).toEqual(['Housing', 'Job']);
    expect(control<HTMLSelectElement>(group, 'Housing').selectedOptions[0]?.textContent).toBe('Sell and rent');
  });

  it('makes a new path by flipping one option', async () => {
    await mount(example());
    await click(el('section-scenarios'), 'Add scenario');
    const added = latest.scenarios.length - 1;
    expect(selections(added)).toEqual({ Housing: 'Keep the house', Job: 'Stay' });
    await pick(control<HTMLSelectElement>(scenarioSection(added), 'Job'), 'Go freelance');
    expect(selections(added)).toEqual({ Housing: 'Keep the house', Job: 'Go freelance' });
    expect(latest.scenarios[added]).toMatchObject({ events: [], loans: [], investments: [] });
  });

  it('leaves a missing pick unset and says so', async () => {
    const config = example();
    config.scenarios[0]!.select = {};
    await mount(config);
    const select = control<HTMLSelectElement>(scenarioSection(0), 'Housing');
    expect(select.value).toBe('');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(selections(0)).toBeUndefined();
  });
});

describe('changing a baseline entry', () => {
  const changeCard = () => el(`change-${option('Housing', 'Sell and rent').change.loans[0]!.id}`);
  const loanSet = () => option('Housing', 'Sell and rent').change.loans[0]!.set;

  it('lists each changed field beside the baseline value', async () => {
    await mount(example());
    const rows = Array.from(changeCard().querySelectorAll('.changed-list li')).map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual([
      'Early payoff month 2027-06 Baseline: Not set Reset',
      'Sell the property at payoff Yes Baseline: No Reset',
      'Sale price $310,000.00 Baseline: Not set Reset',
      'Net selling costs $21,000.00 Baseline: Not set Reset',
    ]);
  });

  it('shows the entry as it is on this path, without its name to edit', async () => {
    await mount(example());
    const card = changeCard();
    expect(control<HTMLInputElement>(card, 'Principal').value).toBe('240000');
    expect(control<HTMLInputElement>(card, 'Early payoff month').value).toBe('2027-06');
    expect(Array.from(card.querySelectorAll('label')).map((l) => l.textContent)).not.toContain('Name');
    expect(card.querySelectorAll('.field.is-changed').length).toBe(4);
  });

  it('makes an edited field part of the change, and an emptied one taken away', async () => {
    await mount(example());
    await type(control<HTMLInputElement>(changeCard(), 'Interest rate'), '3.5');
    await type(control<HTMLInputElement>(changeCard(), 'Escrow'), '');
    expect(loanSet()).toMatchObject({ interestRate: 3.5, escrow: null, earlyPayoffDate: '2027-06' });
    expect(latest.common.loans[0]).toMatchObject({ interestRate: 4, escrow: 450 });
  });

  it('hands a field back to the baseline on Reset', async () => {
    await mount(example());
    await click(changeCard(), 'Reset Early payoff month');
    expect(loanSet()).not.toHaveProperty('earlyPayoffDate');
    expect(control<HTMLInputElement>(changeCard(), 'Early payoff month').value).toBe('');
  });

  it('follows the baseline in every field it has not changed', async () => {
    await mount(example());
    const baseline = el(`loan-${latest.common.loans[0]!.id}`);
    await type(control<HTMLInputElement>(baseline, 'Interest rate'), '4.25');
    expect(control<HTMLInputElement>(changeCard(), 'Interest rate').value).toBe('4.25');
  });

  it('keeps a change whose entry the baseline lost, and flags it', async () => {
    await mount(example());
    await click(el(`loan-${latest.common.loans[0]!.id}`), 'Remove Mortgage');
    const card = changeCard();
    expect(card.querySelector('.editor-card__notice')).not.toBeNull();
    expect(card.textContent).toContain('The baseline has no loan named Mortgage');
    const written = (toConfigDocument(latest)['choices'] as { options: { change?: { loans: { name: string }[] } }[] }[])[0]!
      .options[1]!;
    expect(written.change!.loans[0]!.name).toBe('Mortgage');
    await click(card, 'Stop changing Mortgage');
    expect(option('Housing', 'Sell and rent').change.loans).toEqual([]);
  });
});

describe('choosing a baseline entry to change or remove', () => {
  const picker = (choiceName: string, name: string) =>
    control<HTMLInputElement>(optionCard(choiceName, name), 'Baseline entry');
  const listed = (input: HTMLInputElement) =>
    Array.from(input.closest('.combobox')!.querySelectorAll<HTMLElement>('[role="option"]'));

  async function search(input: HTMLInputElement, letters: string): Promise<void> {
    await act(async () => {
      input.focus();
    });
    await type(input, letters);
  }

  /** Find an entry by a few letters of its name and pick it. */
  async function choose(input: HTMLInputElement, letters: string): Promise<void> {
    await search(input, letters);
    await act(async () => {
      listed(input)[0]!.click();
    });
  }

  it('lists every entry, with the reason beside those this option may not target', async () => {
    await mount(example());
    const input = picker('Housing', 'Keep the house');
    await search(input, '');
    const reason = 'The choice Job already changes or removes it.';
    expect(
      listed(input).map((o) => [
        o.querySelector('.combobox__name')?.textContent,
        o.querySelector('.combobox__detail')?.textContent,
        o.querySelector('.combobox__reason')?.textContent ?? null,
        o.getAttribute('aria-disabled') === 'true',
      ]),
    ).toEqual([
      ['Salary', 'Event', reason, true],
      ['Living costs', 'Event', null, false],
      ['Gym', 'Event', reason, true],
      ['Mortgage', 'Loan', null, false],
      ['Brokerage', 'Investment', reason, true],
    ]);
  });

  it('finds an entry by a few letters of its name', async () => {
    await mount(example());
    const input = picker('Housing', 'Keep the house');
    await search(input, 'ort');
    expect(listed(input).map((o) => o.querySelector('.combobox__name')?.textContent)).toEqual(['Mortgage']);
  });

  it('does not pick an entry another choice already uses', async () => {
    await mount(example());
    const card = optionCard('Housing', 'Keep the house');
    await choose(picker('Housing', 'Keep the house'), 'salary');
    expect(button(card, 'Change it').disabled).toBe(true);
    expect(button(card, 'Remove it').disabled).toBe(true);
  });

  it('removes a baseline entry on this path', async () => {
    await mount(example());
    const card = optionCard('Housing', 'Sell and rent');
    expect(button(card, 'Remove it').disabled).toBe(true);
    await choose(picker('Housing', 'Sell and rent'), 'liv');
    await click(card, 'Remove it');
    expect(option('Housing', 'Sell and rent').remove.events.map((r) => r.targetName)).toEqual(['Living costs']);
    expect(card.textContent).toContain('Removes Living costs');
    // The box is empty again, ready for the next entry.
    expect(picker('Housing', 'Sell and rent').value).toBe('');
    await click(card, 'Keep Living costs');
    expect(option('Housing', 'Sell and rent').remove.events).toEqual([]);
  });

  it('starts a change with nothing changed yet', async () => {
    await mount(example());
    const card = optionCard('Housing', 'Keep the house');
    await choose(picker('Housing', 'Keep the house'), 'living');
    await click(card, 'Change it');
    const change = option('Housing', 'Keep the house').change.events[0]!;
    expect(change).toMatchObject({ targetName: 'Living costs', set: {} });
    await type(control<HTMLInputElement>(el(`change-${change.id}`), 'Amount'), '-2800');
    expect(option('Housing', 'Keep the house').change.events[0]!.set).toEqual({ amount: -2800 });
  });
});
