import { describe, expect, it } from 'vitest';
import {
  BRIEF_WORDS,
  HELP,
  MORE_WORDS,
  eventAmountHelp,
  helpText,
  isTiered,
  tiered,
  withMore,
  type Help,
} from './help';

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

describe('a help in two tiers', () => {
  it('keeps a plain help as it is', () => {
    expect(isTiered('One line.')).toBe(false);
    expect(helpText('One line.')).toBe('One line.');
  });

  it('reads both tiers in order', () => {
    const help = tiered('What it does.', 'Every limit it has.');
    expect(isTiered(help)).toBe(true);
    expect(helpText(help)).toBe('What it does. Every limit it has.');
  });

  it('adds to the more, keeping the brief first', () => {
    expect(withMore('What it does.', 'One more limit.')).toEqual(tiered('What it does.', 'One more limit.'));
    expect(withMore(tiered('What it does.', 'A limit.'), 'Another.')).toEqual(tiered('What it does.', 'A limit. Another.'));
  });
});

// AGENTS.md, "User-facing text": a help opens on one short line, and anything
// further waits behind Show more.
describe('every help', () => {
  const entries = Object.entries(HELP) as [string, Help][];

  it.each(entries)('%s opens on a short line', (_, help) => {
    const brief = isTiered(help) ? help.brief : help;
    expect(words(brief), brief).toBeLessThanOrEqual(BRIEF_WORDS);
  });

  it.each(entries.filter(([, help]) => isTiered(help)))('%s keeps its more to a short paragraph', (_, help) => {
    if (!isTiered(help)) throw new Error('not tiered');
    expect(words(help.more), help.more).toBeLessThanOrEqual(MORE_WORDS);
    expect(help.more.trim()).not.toBe('');
  });

  it.each(entries)('%s has no stray spacing between or around its sentences', (_, help) => {
    const text = helpText(help);
    expect(text).toBe(text.trim());
    expect(text).not.toMatch(/\s{2,}/);
  });

  it('answers an event amount with the help for its kind', () => {
    expect(eventAmountHelp('cashflow')).toBe(HELP.eventAmountCashflow);
    expect(eventAmountHelp('contribution')).toBe(HELP.eventAmountContribution);
    expect(eventAmountHelp('withdrawal')).toBe(HELP.eventAmountWithdrawal);
    expect(eventAmountHelp('extraPrincipalPayment')).toBe(HELP.eventAmountExtraPrincipal);
  });
});
