import { describe, expect, it } from 'vitest';
import { buildDependencyTree, type TreeNode } from './tree';
import { createClaim } from './parser';
import { sampleDocument } from './sample';

function shape(nodes: TreeNode[]): unknown {
  return nodes.map((node) => ({ n: node.claim.number, children: shape(node.children) }));
}

describe('buildDependencyTree', () => {
  it('nests dependent claims under the claim they refer to', () => {
    const roots = buildDependencyTree(sampleDocument().claims);
    expect(shape(roots)).toEqual([
      { n: 1, children: [{ n: 2, children: [{ n: 4, children: [] }] }, { n: 3, children: [] }] },
      {
        n: 5,
        children: [
          { n: 6, children: [] },
          { n: 7, children: [{ n: 8, children: [] }] },
        ],
      },
    ]);
  });

  it('keeps a dependent claim with only broken references at the top, marked unresolved', () => {
    const claims = [createClaim(1, 'A device.'), createClaim(2, 'The device of claim 7.')];
    const roots = buildDependencyTree(claims);
    expect(roots.map((r) => r.claim.number)).toEqual([1, 2]);
    expect(roots[1].unresolved).toBe(true);
    expect(roots[0].unresolved).toBe(false);
  });

  it('does not loop when claims refer to each other', () => {
    const claims = [createClaim(1, 'The device of claim 2.'), createClaim(2, 'The device of claim 1.')];
    const roots = buildDependencyTree(claims);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.flatMap((r) => r.children).length).toBeLessThanOrEqual(1);
  });
});
