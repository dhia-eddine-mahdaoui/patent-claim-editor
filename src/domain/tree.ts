import { firstClaimByNumber, parseReferences } from './parser';
import type { Claim } from './types';

export interface TreeNode {
  claim: Claim;
  children: TreeNode[];
  /** True when the claim refers to other claims but none of them is a valid earlier parent. */
  unresolved: boolean;
}

/**
 * Builds the dependency forest. A dependent claim hangs under the first claim it
 * validly refers to (an earlier claim that exists). Independent claims and claims
 * with only broken references are roots.
 */
export function buildDependencyTree(claims: Claim[]): TreeNode[] {
  const byNumber = firstClaimByNumber(claims);
  const nodes = new Map<string, TreeNode>();
  for (const claim of claims) {
    nodes.set(claim.id, { claim, children: [], unresolved: false });
  }

  const roots: TreeNode[] = [];
  for (const claim of claims) {
    const node = nodes.get(claim.id);
    if (!node) continue;
    const refs = parseReferences(claim.text);
    let parent: TreeNode | undefined;
    for (const ref of refs) {
      const target = byNumber.get(ref.number);
      if (target && target.number < claim.number) {
        parent = nodes.get(target.id);
        break;
      }
    }
    if (parent) {
      parent.children.push(node);
    } else {
      node.unresolved = refs.length > 0;
      roots.push(node);
    }
  }
  return roots;
}
