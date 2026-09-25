/**
 * The built-in starter config: a small, sensible plan that exercises an event,
 * a loan and an investment without overwhelming a first-time reader. Used on
 * first load and by "Reset Config".
 */

import { currentMonth, addMonths } from './month';
import { fromConfigDocument, refreshIds } from './serialize';
import type { ConfigModel } from './types';

export function starterConfig(now: string = currentMonth()): ConfigModel {
  const start = now;
  const end = addMonths(now, 12 * 30) ?? '2055-01';
  const carLoanStart = addMonths(now, -18) ?? start;
  const contributionStart = addMonths(now, 1) ?? start;

  return refreshIds(
    fromConfigDocument({
      version: 2,
      simulation: {
        startDate: start,
        endDate: end,
        startingCash: 25000,
      },
      recommendations: { emergencyFundMonths: 6 },
      common: {
        events: [
          { name: 'Take-home pay', amount: 5200 },
          { name: 'Living expenses', amount: -3400 },
          { name: 'Annual insurance premium', amount: -1200, frequency: 12 },
        ],
        loans: [
          {
            name: 'Car loan',
            principal: 28000,
            downPayment: 4000,
            interestRate: 5.4,
            term: 60,
            startDate: carLoanStart,
          },
        ],
        investments: [
          {
            name: 'Brokerage',
            startingValue: 40000,
            annualReturnRate: 6.5,
            taxRate: 15,
            withdrawalTaxRate: 15,
            contributionsFromCash: true,
            contributions: [{ amount: 600, startDate: contributionStart }],
          },
        ],
      },
      scenarios: [
        {
          name: 'current path',
          active: true,
        },
        {
          name: 'save more aggressively',
          active: true,
          investments: [
            {
              name: 'Extra savings',
              startingValue: 0,
              annualReturnRate: 5,
              contributionsFromCash: true,
              contributions: [{ amount: 400, startDate: contributionStart }],
            },
          ],
        },
      ],
    }),
  );
}
