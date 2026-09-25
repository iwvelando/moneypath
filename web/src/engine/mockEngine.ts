/**
 * A development stand-in for the Go engine.
 *
 * It exists so the UI can be built and exercised before/without the compiled
 * wasm module. It deliberately does NOT implement spec/04 — the numbers are a
 * synthetic deterministic curve, not a forecast — because the frontend must
 * never contain finance math. It is used only when wasm instantiation fails in
 * a dev build, or when `?mockEngine` is present; a production build surfaces a
 * visible error instead of silently substituting it.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { addMonths, currentMonth, isMonth } from '../config/month';
import { formatMoney } from '../util/format';
import {
  EngineError,
  type Engine,
  type ForecastOptions,
  type ForecastResults,
  type MigrateResult,
  type ResultRow,
  type ScenarioMetrics,
} from './types';

const MOCK_VERSION = 'dev (mock engine)';
const ROW_COUNT = 40;

interface MockScenario {
  name: string;
  active: boolean;
  seed: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function seedOf(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 1000;
}

function readScenarios(doc: unknown): MockScenario[] {
  const scenarios: MockScenario[] = [];
  if (isObject(doc) && Array.isArray(doc['scenarios'])) {
    for (const entry of doc['scenarios']) {
      if (!isObject(entry)) continue;
      const name = typeof entry['name'] === 'string' ? entry['name'] : '';
      if (name.trim() === '') {
        throw new EngineError('scenario at index 0 has no name');
      }
      scenarios.push({
        name,
        active: entry['active'] === undefined ? true : entry['active'] === true,
        seed: seedOf(name),
      });
    }
  }
  if (scenarios.length === 0) throw new EngineError('config has no scenarios');
  const active = scenarios.filter((s) => s.active);
  if (active.length === 0) throw new EngineError('no active scenarios to forecast');
  return active;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function renderCsv(scenarios: string[], rows: ResultRow[]): string {
  const header = ['date'];
  for (const name of scenarios) {
    header.push(`liquid (${name})`, `total (${name})`, `notes (${name})`);
  }
  const lines = [header.map(csvEscape).join(',')];
  for (const row of rows) {
    const cells = [row.date];
    scenarios.forEach((_, index) => {
      const value = row.values[index];
      cells.push(
        value?.liquid === undefined || value?.liquid === null ? '' : value.liquid.toFixed(2),
        value?.total === undefined || value?.total === null ? '' : value.total.toFixed(2),
        (value?.notes ?? []).join(','),
      );
    });
    lines.push(cells.map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function buildRows(scenarios: MockScenario[], startMonth: string): ResultRow[] {
  const rows: ResultRow[] = [];
  for (let i = 0; i < ROW_COUNT; i += 1) {
    const date = addMonths(startMonth, i) ?? startMonth;
    const values = scenarios.map((scenario) => {
      const wobble = Math.sin((i + scenario.seed / 97) / 3.2) * 5200;
      const drift = 1800 * i - (scenario.seed % 7) * 260 * Math.max(0, i - 12);
      const liquid = 24000 + drift + wobble - (i > 16 && i < 27 ? 34000 : 0);
      const invested = 40000 * Math.pow(1.0054, i) + (scenario.seed % 5) * 900;
      const notes: string[] = [];
      if (i % 12 === 6) {
        notes.push(`common Brokerage: contribution (reduces cash balance) +600.00, growth +${(180 + i).toFixed(2)}`);
      }
      if (i === 18) notes.push('paying off asset Car loan for 12480.55');
      if (i === 24) notes.push(`scenario ${scenario.name}: withdrawal -2000.00 (basis -1400.00, growth -600.00)`);
      return {
        liquid: Math.round(liquid * 100) / 100,
        total: Math.round((liquid + invested) * 100) / 100,
        notes,
      };
    });
    rows.push({ date, values });
  }
  return rows;
}

function buildMetrics(scenarios: MockScenario[], rows: ResultRow[], optimize: boolean): ScenarioMetrics[] {
  return scenarios.map((scenario, index) => {
    const averageMonthlyExpenses = 3900 + (scenario.seed % 11) * 45;
    const targetMonths = 6;
    const targetAmount = averageMonthlyExpenses * targetMonths;
    const initialLiquid = rows[0]?.values[index]?.liquid ?? 0;
    const fundedMonths = averageMonthlyExpenses === 0 ? 0 : initialLiquid / averageMonthlyExpenses;
    const metrics: ScenarioMetrics = {
      emergencyFund: {
        targetMonths,
        averageMonthlyExpenses,
        targetAmount,
        initialLiquid,
        fundedMonths,
        shortfall: Math.max(0, targetAmount - initialLiquid),
        surplus: Math.max(0, initialLiquid - targetAmount),
      },
      optimizations: [],
    };
    if (optimize && index === 0) {
      metrics.optimizations = [
        {
          targetName: 'Transition income',
          field: 'amount',
          original: 2000,
          value: 2680.5,
          originalDisplay: formatMoney(2000),
          valueDisplay: formatMoney(2680.5),
          floor: targetAmount,
          minimumCash: targetAmount + 412.19,
          headroom: 412.19,
          iterations: 11,
          converged: true,
          notes: [],
        },
        {
          targetName: 'Home purchase',
          field: 'startDate',
          // Month index for 2027-03: 2027·12 + 3 − 1.
          original: 2027 * 12 + 2,
          value: 2027 * 12 + 2,
          originalDisplay: '2027-03',
          valueDisplay: '2027-03',
          floor: targetAmount,
          minimumCash: targetAmount - 8100,
          headroom: -8100,
          iterations: 6,
          converged: false,
          notes: [
            `unable to satisfy minimum cash ${formatMoney(targetAmount)} within bounds 2026-09 to 2028-03`,
          ],
        },
      ];
    }
    return metrics;
  });
}

class MockEngine implements Engine {
  readonly kind = 'mock' as const;

  version(): string {
    return MOCK_VERSION;
  }

  async forecast(configYaml: string, options: ForecastOptions): Promise<ForecastResults> {
    await new Promise((resolve) => setTimeout(resolve, 140));
    let doc: unknown;
    try {
      doc = parseYaml(configYaml);
    } catch (error) {
      throw new EngineError(`config is not valid YAML: ${(error as Error).message}`);
    }
    if (!isObject(doc)) throw new EngineError('config is empty');
    if (doc['version'] !== 2) {
      throw new EngineError('config version must be the integer 2');
    }
    const simulation = isObject(doc['simulation']) ? doc['simulation'] : {};
    const endDate = typeof simulation['endDate'] === 'string' ? simulation['endDate'] : '';
    if (endDate === '') throw new EngineError('simulation.endDate is required');
    if (!isMonth(endDate)) throw new EngineError(`simulation.endDate: ${endDate} is not a YYYY-MM month`);
    const rawStart = typeof simulation['startDate'] === 'string' ? simulation['startDate'] : '';
    if (rawStart !== '' && !isMonth(rawStart)) {
      throw new EngineError(`simulation.startDate: ${rawStart} is not a YYYY-MM month`);
    }
    const startMonth = rawStart || options.now || currentMonth();

    const scenarios = readScenarios(doc);
    const rows = buildRows(scenarios, startMonth);
    const names = scenarios.map((s) => s.name);

    const warnings: string[] = ['mock engine: these numbers are synthetic, not a real forecast'];
    if (simulation['startingCash'] === undefined) {
      warnings.push("simulation.startingCash is absent; treating it as 0.00");
    }

    return {
      version: MOCK_VERSION,
      scenarios: names,
      rows,
      csv: renderCsv(names, rows),
      metrics: buildMetrics(scenarios, rows, options.optimize === true),
      warnings,
      configYaml: stringifyYaml(doc, { lineWidth: 0 }),
    };
  }

  async migrate(legacyYaml: string): Promise<MigrateResult> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    let doc: unknown;
    try {
      doc = parseYaml(legacyYaml);
    } catch (error) {
      throw new EngineError(`legacy config is not valid YAML: ${(error as Error).message}`);
    }
    if (!isObject(doc)) throw new EngineError('legacy config is empty');
    if (doc['version'] === 2) throw new EngineError('config already declares version: 2');
    const common = isObject(doc['common']) ? doc['common'] : {};
    if (common['deathDate'] === undefined) {
      throw new EngineError("legacy config has no common.deathDate; nothing to migrate");
    }

    const notices: string[] = [];
    if (doc['logging'] !== undefined) {
      notices.push("dropped 'logging' block: logging is configured via CLI flags in v2");
    }
    if (doc['output'] !== undefined) {
      notices.push("dropped 'output' block: output format is configured via CLI flags in v2");
    }

    const scenarios = Array.isArray(doc['scenarios']) ? doc['scenarios'] : [];
    const migrated = {
      version: 2,
      simulation: {
        ...(typeof doc['startDate'] === 'string' ? { startDate: doc['startDate'] } : {}),
        endDate: common['deathDate'],
        startingCash: common['startingValue'] ?? 0,
      },
      ...(doc['recommendations'] !== undefined ? { recommendations: doc['recommendations'] } : {}),
      common: {
        ...(common['events'] !== undefined ? { events: common['events'] } : {}),
        ...(common['loans'] !== undefined ? { loans: common['loans'] } : {}),
        ...(common['investments'] !== undefined ? { investments: common['investments'] } : {}),
      },
      scenarios: scenarios.map((scenario) => {
        if (!isObject(scenario)) return scenario;
        const active = scenario['active'];
        if (active === undefined) {
          notices.push(
            `scenario '${String(scenario['name'] ?? '')}': 'active' was absent (v1 default was inactive); emitting active: false`,
          );
        }
        return { ...scenario, active: active === undefined ? false : active };
      }),
    };

    notices.push(
      'some migrated features behave differently in v2 — review the forecast against your expectations',
    );

    return { configYaml: stringifyYaml(migrated, { lineWidth: 0 }), notices };
  }
}

export function createMockEngine(): Engine {
  return new MockEngine();
}
