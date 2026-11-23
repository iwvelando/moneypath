import { describe, expect, it } from 'vitest';
import { loadWasmEngine } from '../engine/wasmEngine';
import { toConfigYaml } from './serialize';
import { starterConfig } from './starter';

describe('the starter plan', () => {
  it('lists the car as an asset, with the car loan secured on it', () => {
    const { common } = starterConfig('2026-01');
    expect(common.assets.map((asset) => asset.name)).toEqual(['Car']);
    expect(common.loans.find((loan) => loan.name === 'Car loan')?.asset).toBe('Car');
  });

  it('has no problems, and reports the car’s value and equity', async () => {
    const engine = await loadWasmEngine();
    const yaml = toConfigYaml(starterConfig('2026-01'));
    expect(engine.validate(yaml, { now: '2026-01' })).toEqual([]);
    const results = await engine.forecast(yaml, { now: '2026-01' });
    const first = results.rows[0]!.values[0]!;
    expect(first.assets).toBe(22000);
    expect(first.equity).toBeCloseTo(22000 - first.liabilities!, 6);
  });
});
