import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { CHOICES_EXAMPLE, openApp, problems, runForecast, uploadChoices } from './helpers';

async function text(download: Promise<Download>): Promise<string> {
  return readFileSync(await (await download).path(), 'utf8');
}

async function downloadCsv(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  return text(download);
}

async function downloadConfig(page: Page): Promise<Record<string, unknown>> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Config' }).click();
  return parse(await text(download)) as Record<string, unknown>;
}

test('an uploaded plan with choices forecasts as the CLI does and keeps its choices', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadChoices(page);
  await runForecast(page);

  // The same file through the command line, built from this checkout.
  const cli = execFileSync(
    'go',
    ['run', './cmd/moneypath', 'forecast', '--config', 'examples/choices.yaml', '--output-format', 'csv'],
    { cwd: '..', encoding: 'utf8' },
  );
  expect(await downloadCsv(page)).toBe(cli);

  const written = await downloadConfig(page);
  const source = parse(readFileSync(CHOICES_EXAMPLE, 'utf8')) as Record<string, unknown>;
  expect(written['choices']).toEqual(source['choices']);
  const selections = (doc: Record<string, unknown>) =>
    (doc['scenarios'] as { name: string; select?: unknown }[]).map((s) => [s.name, s.select]);
  expect(selections(written)).toEqual(selections(source));
  expect(found).toEqual([]);
});

test('a new path is one flipped option, and an option is edited once for every scenario that picks it', async ({ page }) => {
  await openApp(page);
  await uploadChoices(page);

  // The fourth path the example leaves out: keep the house, go freelance.
  await page.locator('#section-scenarios').getByRole('button', { name: 'Add scenario' }).click();
  const added = page.locator('section', { has: page.getByRole('heading', { name: 'scenario 4', exact: true }) });
  await expect(added.getByRole('combobox', { name: 'Housing' })).toHaveValue(/.+/);
  await added.getByRole('combobox', { name: 'Job' }).selectOption({ label: 'Go freelance' });
  await runForecast(page);
  const before = await downloadCsv(page);
  expect(before.split('\n')[0]).toContain('"liquid (scenario 4)"');

  const config = await downloadConfig(page);
  const scenario = (config['scenarios'] as Record<string, unknown>[])[3]!;
  expect(scenario['select']).toEqual({ Housing: 'Keep the house', Job: 'Go freelance' });
  expect(Object.keys(scenario).sort()).toEqual(['active', 'name', 'select']);

  // Freelance income is written once, in the option. Raising it moves both
  // scenarios that pick the option and neither of the two that do not.
  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  const job = page.locator('section', { has: page.getByRole('heading', { name: 'Job', exact: true }) });
  await job.getByRole('button', { name: 'Edit Go freelance', exact: true }).click();
  await job.getByRole('button', { name: 'Edit Freelance income', exact: true }).click();
  await job.locator('.editor-card.is-open .editor-card.is-open').getByRole('textbox', { name: 'Amount', exact: true }).fill('7000');
  await runForecast(page);
  const after = await downloadCsv(page);

  const column = (csv: string, name: string): string[] => {
    const rows = csv.trim().split('\n').map((line) => line.split('","'));
    const index = rows[0]!.findIndex((cell) => cell.replace(/"/g, '') === name);
    return rows.map((row) => row[index]!);
  };
  for (const name of ['as we are', 'sell']) {
    expect(column(after, `liquid (${name})`), name).toEqual(column(before, `liquid (${name})`));
  }
  for (const name of ['sell and freelance', 'scenario 4']) {
    expect(column(after, `liquid (${name})`), name).not.toEqual(column(before, `liquid (${name})`));
  }
});

test('one flipped choice reads as the CLI reports it, and is kept as a scenario only when asked', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadChoices(page);
  await runForecast(page);
  const before = await downloadCsv(page);

  await page.getByRole('tab', { name: /^sell(?! and)/ }).click();
  const flip = page.locator('.flip');
  await flip.getByRole('combobox', { name: 'Choice' }).selectOption({ label: 'Job' });
  await flip.getByRole('combobox', { name: 'Instead of Stay' }).selectOption({ label: 'Go freelance' });
  await expect(flip.locator('.chart__svg')).toBeVisible();

  // The same flip through the command line, built from this checkout.
  const cli = execFileSync(
    'go',
    ['run', './cmd/moneypath', 'forecast', '--config', 'examples/choices.yaml',
      '--compare', 'sell', '--flip', 'Job', '--to', 'Go freelance'],
    { cwd: '..', encoding: 'utf8' },
  ).split('\n');
  const months = (line: string): string[] =>
    [...line.matchAll(/(\d{4}-\d{2}) \((.+?) moves ahead\)/g)].map((m) => `${m[1]}: ${m[2]} moves ahead`);
  const shown = async (label: string): Promise<string[]> =>
    (await flip.locator('.difference__breakeven > div', { hasText: `${label} break-even` }).locator('li').allTextContents())
      .map((item) => item.trim());
  const cash = months(cli.find((line) => line.startsWith('Cash break-even'))!);
  const total = months(cli.find((line) => line.startsWith('Total break-even'))!);
  expect(cash.length).toBeGreaterThan(0);
  expect(await shown('Liquid')).toEqual(cash);
  expect(await shown('Total')).toEqual(total);

  // Reading the flip left the plan and its results alone.
  await expect(page.getByRole('tab', { name: 'Results' })).not.toHaveClass(/is-outdated/);
  expect(await downloadCsv(page)).toBe(before);

  await flip.getByRole('button', { name: 'Keep as a scenario' }).click();
  await expect(flip.getByRole('button', { name: 'Kept as a scenario' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveClass(/is-outdated/);
  const config = await downloadConfig(page);
  const scenarios = config['scenarios'] as { name: string; select?: unknown }[];
  expect(scenarios.map((s) => s.name)).toEqual(['as we are', 'sell', 'sell (Job: Go freelance)', 'sell and freelance']);
  expect(scenarios[2]!.select).toEqual({ Housing: 'Sell and rent', Job: 'Go freelance' });
  expect(found).toEqual([]);
});

test('an earlier flip stays readable but needs a fresh forecast before it can be kept', async ({ page }) => {
  const found = problems(page);
  await openApp(page);
  await uploadChoices(page);
  await runForecast(page);

  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  await page.getByRole('textbox', { name: 'Starting cash', exact: true }).fill('12345');
  await page.getByRole('tab', { name: 'Results', exact: true }).click();
  const flip = page.locator('.flip');
  const chooseFreelance = async () => {
    await flip.getByRole('combobox', { name: 'Choice' }).selectOption({ label: 'Job' });
    await flip.getByRole('combobox', { name: 'Instead of Stay' }).selectOption({ label: 'Go freelance' });
    await expect(flip.locator('.chart__svg')).toBeVisible();
  };
  await chooseFreelance();
  await flip.getByRole('button', { name: 'Keep as a scenario' }).click();
  await expect(flip.locator('.flip__keep [role="alert"]')).toBeInViewport();
  await expect(flip.locator('.flip__keep [role="alert"]')).toContainText(
    'Your plan has changed. Run the forecast again before keeping this path.',
  );
  const before = await downloadConfig(page);
  expect(before['scenarios']).toHaveLength(3);
  expect(before['simulation']).toMatchObject({ startingCash: 12345 });

  await page.getByRole('tab', { name: 'Planning Workspace' }).click();
  await runForecast(page);
  await chooseFreelance();
  await flip.getByRole('button', { name: 'Keep as a scenario' }).click();
  await expect(flip.getByRole('button', { name: 'Kept as a scenario' })).toBeFocused();
  expect((await downloadConfig(page))['scenarios']).toHaveLength(4);
  expect(found).toEqual([]);
});
