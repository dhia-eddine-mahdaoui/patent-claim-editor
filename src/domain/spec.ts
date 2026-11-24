import { PLURAL_HEADS, normalizeTerm, scanClaim } from './antecedent';
import type { Claim, SupportReport, SupportTerm } from './types';

/**
 * Specification-support check (heuristic).
 *
 * Every noun phrase a claim introduces with "a" / "an" should be described in the
 * specification. Terms are compared on normalised words, so "sensors" in the description
 * supports "a sensor" in a claim. A term is supported when its full word sequence occurs
 * in the description, or when the sequence minus trailing participial words
 * ("signal indicative" -> "signal") does.
 */

const WORD = /[A-Za-z0-9][A-Za-z0-9'-]*/g;

function words(text: string): string[] {
  return Array.from(text.matchAll(WORD), (m) => normalizeTerm(m[0]));
}

function trimTrailingModifiers(parts: string[]): string[] {
  const out = [...parts];
  while (out.length > 1 && /(ive|ed|ing)$/.test(out[out.length - 1])) out.pop();
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length - 1;
  }
}

export function checkSpecSupport(claims: Claim[], spec: string): SupportReport {
  const hasSpec = spec.trim().length > 0;
  const haystack = ` ${words(spec).join(' ')} `;
  const byKey = new Map<string, SupportTerm>();

  for (const claim of claims) {
    for (const event of scanClaim(claim.text)) {
      if (event.kind !== 'intro') continue;
      let parts = event.words;
      while (parts.length > 1 && PLURAL_HEADS.has(parts[0])) parts = parts.slice(1);
      if (parts.length === 0) continue;
      const key = parts.join(' ');
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.claimNumbers.includes(claim.number)) existing.claimNumbers.push(claim.number);
        continue;
      }
      const start = event.start + event.article.length;
      const raw = claim.text.slice(start, event.end).trim();
      const rawStart = claim.text.indexOf(raw, start);
      const candidates = [parts, trimTrailingModifiers(parts)];
      const occurrences = Math.max(
        ...candidates.map((c) => countOccurrences(haystack, ` ${c.join(' ')} `)),
      );
      byKey.set(key, {
        term: raw,
        claimId: claim.id,
        claimNumbers: [claim.number],
        range: [rawStart, rawStart + raw.length],
        supported: hasSpec ? occurrences > 0 : true,
        occurrences,
      });
    }
  }

  const terms = [...byKey.values()];
  return { terms, supportedCount: terms.filter((t) => t.supported).length, hasSpec };
}
