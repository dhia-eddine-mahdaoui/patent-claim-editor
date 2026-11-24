import type { Node as PMNode } from '@tiptap/pm/model';
import type { Claim } from '../domain/types';
import { createClaim } from '../domain/parser';

/** A claim paragraph starts with "N." or "N)"; the prefix is part of the editable text. */
export const PREFIX = /^\s*(\d+)\s*[.)]\s?/;

export interface ClaimPosition {
  claim: Claim;
  /** Position of the paragraph node in the editor document. */
  pos: number;
  /** Length of the typed "N. " prefix, so claim text offsets can be mapped to editor positions. */
  prefixLength: number;
}

export function claimToLine(claim: Pick<Claim, 'number' | 'text'>): string {
  return claim.number === 0 ? claim.text : `${claim.number}. ${claim.text}`;
}

export function parseLine(line: string): { number: number; text: string; prefixLength: number } {
  const match = PREFIX.exec(line);
  if (!match) return { number: 0, text: line, prefixLength: 0 };
  return { number: Number(match[1]), text: line.slice(match[0].length), prefixLength: match[0].length };
}

/** Builds the editor JSON for a list of claims. */
export function claimsToJson(claims: Claim[]) {
  return {
    type: 'doc',
    content: claims.length
      ? claims.map((claim) => {
          const line = claimToLine(claim);
          return {
            type: 'paragraph',
            attrs: { id: claim.id },
            content: line ? [{ type: 'text', text: line }] : undefined,
          };
        })
      : [{ type: 'paragraph' }],
  };
}

/**
 * Reads claims back out of the editor, reusing earlier objects so unchanged claims keep their
 * identity. An empty editor (one blank paragraph) means there are no claims.
 */
export function docToClaims(doc: PMNode, previous: Claim[] = []): ClaimPosition[] {
  const byId = new Map(previous.map((claim) => [claim.id, claim]));
  const out: ClaimPosition[] = [];
  const seen = new Set<string>();
  if (doc.childCount === 1 && doc.child(0).content.size === 0) return out;
  doc.forEach((node, offset) => {
    const { number, text, prefixLength } = parseLine(node.textContent);
    let id = (node.attrs.id as string | null) ?? '';
    if (!id || seen.has(id)) id = createClaim(number, text).id;
    seen.add(id);
    const prior = byId.get(id);
    const claim = prior && prior.number === number && prior.text === text ? prior : { id, number, text };
    out.push({ claim, pos: offset, prefixLength });
  });
  return out;
}

export function sameClaims(a: Claim[], b: Claim[]): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id && c.number === b[i].number && c.text === b[i].text);
}
