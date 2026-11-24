import { REFERENCE_PATTERN } from './parser';
import type { Claim } from './types';

/**
 * Renumbers claims 1..n in document order and rewrites "claim N" references to match.
 * Each old number maps to the first claim that carried it.
 */
export function renumberClaims(claims: Claim[]): Claim[] {
  const mapping = new Map<number, number>();
  claims.forEach((claim, index) => {
    if (!mapping.has(claim.number)) mapping.set(claim.number, index + 1);
  });
  return claims.map((claim, index) => ({
    ...claim,
    number: index + 1,
    text: remapReferences(claim.text, mapping),
  }));
}

export function remapReferences(text: string, mapping: Map<number, number>): string {
  return text.replace(REFERENCE_PATTERN, (whole) =>
    whole.replace(/\d+/g, (digits) => String(mapping.get(Number(digits)) ?? digits)),
  );
}
