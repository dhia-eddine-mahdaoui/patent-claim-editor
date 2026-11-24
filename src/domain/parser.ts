import type { Claim, ClaimReference } from './types';

/** Matches "claim 1", "claims 2 and 3", "claim 4, 5 or 6". Global so it can be reused with matchAll/replace. */
export const REFERENCE_PATTERN = /\bclaims?\s+(\d+(?:\s*(?:,|\bor\b|\band\b|\bto\b|-)\s*\d+)*)/gi;

export function parseReferences(text: string): ClaimReference[] {
  const references: ClaimReference[] = [];
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    for (const digits of match[1].match(/\d+/g) ?? []) {
      references.push({ number: Number(digits), start, end });
    }
  }
  return references;
}

export interface ParsedClaimLine {
  number: number;
  text: string;
}

const NUMBERED_LINE = /^\s*(\d+)\s*[.)]\s*(.*)$/;

/**
 * Parses pasted claim text. Lines that start with "N." or "N)" begin a new claim;
 * other non-empty lines are treated as continuations of the previous claim.
 */
export function parseClaimBlock(source: string): ParsedClaimLine[] {
  const claims: ParsedClaimLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const numbered = NUMBERED_LINE.exec(line);
    if (numbered) {
      claims.push({ number: Number(numbered[1]), text: numbered[2].trim() });
    } else if (claims.length > 0) {
      const previous = claims[claims.length - 1];
      previous.text = previous.text ? `${previous.text} ${line}` : line;
    } else {
      claims.push({ number: claims.length + 1, text: line });
    }
  }
  return claims;
}

let sequence = 0;

export function createClaim(number: number, text: string): Claim {
  sequence += 1;
  const random = Math.random().toString(36).slice(2, 7);
  return {
    id: `c${Date.now().toString(36)}${sequence.toString(36)}${random}`,
    number,
    text,
  };
}

/** Maps each claim number to the first claim that carries it. */
export function firstClaimByNumber(claims: Claim[]): Map<number, Claim> {
  const byNumber = new Map<number, Claim>();
  for (const claim of claims) {
    if (!byNumber.has(claim.number)) byNumber.set(claim.number, claim);
  }
  return byNumber;
}
