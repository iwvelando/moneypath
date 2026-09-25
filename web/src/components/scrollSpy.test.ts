import { describe, expect, it } from 'vitest';
import { sectionAt } from './scrollSpy';

describe('sectionAt', () => {
  it('picks the last section whose top has reached the reading line', () => {
    expect(sectionAt([-900, -200, 60, 700], 90, false)).toBe(2);
  });

  it('counts a section sitting exactly on the line as reached', () => {
    expect(sectionAt([-400, 90, 600], 90, false)).toBe(1);
  });

  it('falls back to the first section above the first top', () => {
    expect(sectionAt([200, 900], 90, false)).toBe(0);
  });

  it('picks the last section at the bottom of the page, which may never reach the line', () => {
    // A short final section cannot scroll up to the line; being at the
    // bottom is the only way to say the reader is on it.
    expect(sectionAt([-900, -200, 300, 500], 90, true)).toBe(3);
  });

  it('is empty-safe', () => {
    expect(sectionAt([], 90, false)).toBe(-1);
  });
});
