import { describe, expect, it } from 'vitest';
import { planUpload } from './upload';

const V2 = `version: 2
simulation:
  endDate: 2090-01
  startingCash: 100
scenarios:
  - name: current path
`;

const V1 = `startDate: 2025-06
common:
  startingValue: 30000
  deathDate: 2090-01
scenarios:
  - name: current path
    active: true
`;

describe('upload plan', () => {
  it('loads a v2 config directly', () => {
    const plan = planUpload(V2);
    expect(plan.action).toBe('load');
    if (plan.action === 'load') {
      expect((plan.document as Record<string, unknown>)['version']).toBe(2);
    }
  });

  it('routes a version-less config to migration', () => {
    const plan = planUpload(V1);
    expect(plan.action).toBe('migrate');
    if (plan.action === 'migrate') expect(plan.reason).toMatch(/version/);
  });

  it('routes a config carrying common.deathDate to migration even when versioned', () => {
    const plan = planUpload('version: 2\ncommon:\n  deathDate: 2090-01\n');
    expect(plan.action).toBe('migrate');
    if (plan.action === 'migrate') expect(plan.reason).toMatch(/deathDate/);
  });

  it('rejects an unparseable file', () => {
    const plan = planUpload('version: 2\n  bad: [unclosed\n');
    expect(plan.action).toBe('error');
  });

  it('rejects an empty file', () => {
    expect(planUpload('   \n').action).toBe('error');
  });

  it('rejects a YAML document that is not a mapping', () => {
    expect(planUpload('- a\n- b\n').action).toBe('error');
    expect(planUpload('just a string\n').action).toBe('error');
  });

  it('rejects an unsupported future version', () => {
    const plan = planUpload('version: 3\nscenarios: []\n');
    expect(plan.action).toBe('error');
    if (plan.action === 'error') expect(plan.message).toMatch(/version 2/);
  });
});
