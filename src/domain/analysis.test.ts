import { describe, expect, it } from 'vitest';
import { analyzeClaims } from './analysis';
import { checkAntecedentBasis } from './antecedent';
import { renumberClaims } from './renumber';
import { createClaim } from './parser';
import { sampleDocument } from './sample';
import type { Claim } from './types';

function claims(...pairs: Array<[number, string]>): Claim[] {
  return pairs.map(([number, text]) => createClaim(number, text));
}

describe('antecedent basis', () => {
  it('accepts a definite reference introduced in an ancestor claim', () => {
    const doc = claims(
      [1, 'A device comprising a sensor.'],
      [2, 'The device of claim 1, wherein the sensor is hot.'],
    );
    expect(checkAntecedentBasis(doc)).toEqual([]);
  });

  it('flags "the sensor" when no claim in the chain introduces it', () => {
    const doc = claims(
      [1, 'A device comprising a housing.'],
      [2, 'The device of claim 1, wherein the sensor is hot.'],
    );
    const issues = checkAntecedentBasis(doc);
    expect(issues).toHaveLength(1);
    expect(issues[0].claimId).toBe(doc[1].id);
    expect(issues[0].message).toContain('"the sensor"');
    const [start, end] = issues[0].range ?? [0, 0];
    expect(doc[1].text.slice(start, end)).toBe('the sensor');
  });

  it('flags a reference that appears before its introduction in the same claim', () => {
    const doc = claims([1, 'A device wherein the sensor is hot, and a sensor is cold.']);
    expect(checkAntecedentBasis(doc).map((i) => i.message)).toHaveLength(1);
  });

  it('does not look at sibling claims when resolving antecedents', () => {
    const doc = claims(
      [1, 'A device comprising a sensor.'],
      [2, 'A method comprising reading the sensor.'],
    );
    // Claim 2 is independent, so claim 1 does not count as an ancestor.
    expect(checkAntecedentBasis(doc).map((i) => i.claimId)).toEqual([doc[1].id]);
  });

  it('flags the sample issues that were planted on purpose', () => {
    const doc = sampleDocument().claims;
    const flagged = checkAntecedentBasis(doc).map((issue) => doc.find((c) => c.id === issue.claimId)?.number);
    expect(flagged).toEqual([3, 5, 6]);
  });
});

describe('numbering and references', () => {
  it('reports duplicated claim numbers as errors with a renumber fix', () => {
    const { issues } = analyzeClaims(claims([1, 'A device.'], [2, 'A method.'], [2, 'A kit.']));
    const duplicates = issues.filter((i) => i.code === 'numbering-duplicate');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((i) => i.severity === 'error' && i.fix === 'renumber')).toBe(true);
  });

  it('reports a gap in numbering at the claim after the gap', () => {
    const doc = claims([1, 'A device.'], [3, 'A method.']);
    const gaps = analyzeClaims(doc).issues.filter((i) => i.code === 'numbering-gap');
    expect(gaps.map((i) => i.claimId)).toEqual([doc[1].id]);
  });

  it('reports a reference to a claim that does not exist', () => {
    const { issues } = analyzeClaims(claims([1, 'A device.'], [2, 'The device of claim 9.']));
    expect(issues.map((i) => i.code)).toContain('reference-missing');
    // With no valid parent, "the device" is also unsupported, which is a correct second signal.
    expect(issues.map((i) => i.code)).toContain('antecedent');
  });

  it('reports a reference to a later claim as forward', () => {
    const { issues } = analyzeClaims(claims([1, 'The device of claim 2.'], [2, 'A device.']));
    expect(issues.map((i) => i.code)).toContain('reference-forward');
  });

  it('renumbers claims and rewrites references so the checks pass', () => {
    const before = claims(
      [2, 'A device comprising a sensor.'],
      [4, 'The device of claim 2, wherein the sensor is hot.'],
      [5, 'The device of claim 4.'],
    );
    expect(analyzeClaims(before).issues.length).toBeGreaterThan(0);

    const after = renumberClaims(before);
    expect(after.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(after[1].text).toBe('The device of claim 1, wherein the sensor is hot.');
    expect(after[2].text).toBe('The device of claim 2.');
    expect(analyzeClaims(after).issues).toEqual([]);
  });
});
