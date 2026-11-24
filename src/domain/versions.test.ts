import { describe, expect, it } from 'vitest';
import { sampleDocument } from './sample';
import { describeChange, diffDocuments } from './versions';

describe('version change stats', () => {
  it('counts added, removed and edited claims by id', () => {
    const before = sampleDocument();
    const after = {
      ...before,
      claims: [{ ...before.claims[0], text: 'Changed.' }, ...before.claims.slice(2), { id: 'new', number: 9, text: 'New.' }],
    };
    expect(diffDocuments(before, after)).toEqual({ added: 1, removed: 1, changed: 1, specChanged: false, titleChanged: false });
    expect(describeChange(diffDocuments(before, after))).toBe('1 added, 1 edited, 1 removed');
  });

  it('describes an unchanged document', () => {
    const doc = sampleDocument();
    expect(describeChange(diffDocuments(doc, doc))).toBe('no changes');
  });
});
