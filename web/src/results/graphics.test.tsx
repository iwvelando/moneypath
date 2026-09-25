import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EmergencyFundGauge } from './Gauge';
import { Sparkline } from './Sparkline';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe('EmergencyFundGauge', () => {
  it('renders a labeled image with the funded share and a filled arc', () => {
    render(<EmergencyFundGauge fundedMonths={3} targetMonths={6} />, host);
    const svg = host.querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toContain('3.0 months');
    expect(svg?.getAttribute('aria-label')).toContain('50 percent');
    expect(host.querySelector('.gauge__fill--warn')).not.toBeNull();
    expect(host.textContent).toContain('50%');
  });

  it('caps the arc but reports the true percentage beyond the target', () => {
    render(<EmergencyFundGauge fundedMonths={9} targetMonths={6} />, host);
    expect(host.querySelector('.gauge__fill--ok')).not.toBeNull();
    expect(host.textContent).toContain('150%');
  });

  it('renders nothing without a positive target', () => {
    render(<EmergencyFundGauge fundedMonths={3} targetMonths={0} />, host);
    expect(host.querySelector('svg')).toBeNull();
  });

  it('shows an empty track with no fill at zero coverage', () => {
    render(<EmergencyFundGauge fundedMonths={0} targetMonths={6} />, host);
    expect(host.querySelector('.gauge__track')).not.toBeNull();
    expect(host.querySelector('.gauge__fill')).toBeNull();
  });
});

describe('Sparkline', () => {
  it('renders a decorative polyline for a real series', () => {
    render(<Sparkline series={[1, 2, 3]} />, host);
    const svg = host.querySelector('svg.sparkline');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('polyline')?.getAttribute('points')).toBeTruthy();
  });

  it('renders nothing when there is not enough data for a line', () => {
    render(<Sparkline series={[null, 4]} />, host);
    expect(host.querySelector('svg')).toBeNull();
  });
});
