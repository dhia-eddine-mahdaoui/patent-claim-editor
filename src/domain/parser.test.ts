import { describe, expect, it } from 'vitest';
import { createClaim, parseClaimBlock, parseReferences } from './parser';

describe('parseReferences', () => {
  it('finds a single dependency reference', () => {
    const refs = parseReferences('The apparatus of claim 1, wherein the sensor is hot.');
    expect(refs.map((r) => r.number)).toEqual([1]);
  });

  it('finds several numbers in one phrase', () => {
    expect(parseReferences('The method according to claims 2 and 3.').map((r) => r.number)).toEqual([2, 3]);
    expect(parseReferences('The kit of claim 4, 5 or 6.').map((r) => r.number)).toEqual([4, 5, 6]);
  });

  it('reports offsets that cover the reference phrase', () => {
    const text = 'The device of claim 12, wherein';
    const [ref] = parseReferences(text);
    expect(text.slice(ref.start, ref.end)).toBe('claim 12');
  });

  it('ignores words that merely start with claim', () => {
    expect(parseReferences('as claimed in the claimed invention')).toEqual([]);
  });
});

describe('parseClaimBlock', () => {
  it('splits numbered lines and joins continuation lines', () => {
    const parsed = parseClaimBlock('1. A device\ncomprising a housing.\n\n2) The device of claim 1.');
    expect(parsed).toEqual([
      { number: 1, text: 'A device comprising a housing.' },
      { number: 2, text: 'The device of claim 1.' },
    ]);
  });

  it('numbers unnumbered text as a single claim when there are no numbers', () => {
    expect(parseClaimBlock('A device.')).toEqual([{ number: 1, text: 'A device.' }]);
    expect(parseClaimBlock('A device.\nA method.')).toEqual([{ number: 1, text: 'A device. A method.' }]);
  });
});

describe('createClaim', () => {
  it('gives every claim a distinct id', () => {
    const ids = new Set(Array.from({ length: 50 }, (_, i) => createClaim(i + 1, '').id));
    expect(ids.size).toBe(50);
  });
});
