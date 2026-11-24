import { describe, expect, it } from 'vitest';
import { analyzeClaims } from './analysis';
import { createClaim } from './parser';
import { SAMPLE_SPEC, sampleDocument } from './sample';
import { checkSpecSupport } from './spec';

const claim = (n: number, text: string) => createClaim(n, text);

describe('specification support', () => {
  it('flags terms the description never uses and only those', () => {
    const doc = sampleDocument();
    const report = checkSpecSupport(doc.claims, SAMPLE_SPEC);
    const missing = report.terms.filter((t) => !t.supported).map((t) => t.term);
    expect(missing).toEqual(['baseline value', 'memory']);
    expect(report.supportedCount).toBe(report.terms.length - 2);
  });

  it('matches plurals and trims trailing participles', () => {
    const claims = [claim(1, 'A device comprising a sensor and a signal indicative of heat.')];
    const report = checkSpecSupport(claims, 'A device with sensors can emit a signal.');
    expect(report.terms.every((t) => t.supported)).toBe(true);
  });

  it('strips "plurality of" so the noun is what gets checked', () => {
    const claims = [claim(1, 'A device comprising a plurality of sensors.')];
    expect(checkSpecSupport(claims, 'Several sensors are used.').terms.map((t) => t.term)).toContain('plurality of sensors');
    expect(checkSpecSupport(claims, 'Several sensors are used.').terms.find((t) => t.term.startsWith('plurality'))?.supported).toBe(true);
  });

  it('records every claim that uses a term and flags nothing without a description', () => {
    const claims = [claim(1, 'A kettle comprising a lid.'), claim(2, 'The kettle of claim 1 comprising a lid.')];
    const empty = checkSpecSupport(claims, '   ');
    expect(empty.hasSpec).toBe(false);
    expect(empty.terms.every((t) => t.supported)).toBe(true);
    expect(analyzeClaims(claims, '').issues.some((i) => i.code === 'spec-unsupported')).toBe(false);
    const filled = checkSpecSupport(claims, 'A kettle.');
    expect(filled.terms.find((t) => t.term === 'lid')?.claimNumbers).toEqual([1, 2]);
  });

  it('reports unsupported terms as issues with a range inside the claim', () => {
    const claims = [claim(1, 'A kettle comprising a lid.')];
    const issue = analyzeClaims(claims, 'A kettle.').issues.find((i) => i.code === 'spec-unsupported');
    expect(issue?.range && claims[0].text.slice(...issue.range)).toBe('lid');
  });

  it('flags unnumbered and duplicate-free numbering', () => {
    const issues = analyzeClaims([claim(0, 'A kettle.'), claim(0, 'A pot.')]).issues;
    expect(issues.filter((i) => i.code === 'numbering-missing')).toHaveLength(2);
    expect(issues.some((i) => i.code === 'numbering-duplicate')).toBe(false);
  });
});
