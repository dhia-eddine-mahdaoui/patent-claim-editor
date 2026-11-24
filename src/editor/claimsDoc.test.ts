import { describe, expect, it } from 'vitest';
import { claimToLine, parseLine, sameClaims } from './claimsDoc';

describe('claim lines', () => {
  it('splits the typed number from the body', () => {
    expect(parseLine('12. The device of claim 1.')).toEqual({ number: 12, text: 'The device of claim 1.', prefixLength: 4 });
    expect(parseLine('3) Text')).toMatchObject({ number: 3, text: 'Text' });
  });

  it('treats a line without a number as number 0', () => {
    expect(parseLine('No number here')).toEqual({ number: 0, text: 'No number here', prefixLength: 0 });
  });

  it('round-trips through claimToLine', () => {
    const claim = { id: 'a', number: 4, text: 'A thing.' };
    expect(parseLine(claimToLine(claim))).toMatchObject({ number: 4, text: 'A thing.' });
    expect(sameClaims([claim], [{ ...claim }])).toBe(true);
    expect(sameClaims([claim], [{ ...claim, text: 'x' }])).toBe(false);
  });
});
