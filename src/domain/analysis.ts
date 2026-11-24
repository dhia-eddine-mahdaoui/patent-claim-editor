import { checkAntecedentBasis } from './antecedent';
import { firstClaimByNumber, parseReferences } from './parser';
import { checkSpecSupport } from './spec';
import type { Analysis, Claim, Issue } from './types';

/** Runs every live check over the document and groups the issues by claim. */
export function analyzeClaims(claims: Claim[], spec = ''): Analysis {
  const issues: Issue[] = [];
  const counts = new Map<number, number>();
  for (const claim of claims) counts.set(claim.number, (counts.get(claim.number) ?? 0) + 1);
  const firstByNumber = firstClaimByNumber(claims);

  let highest = 0;
  for (const claim of claims) {
    if (claim.number === 0) {
      issues.push({
        code: 'numbering-missing',
        severity: 'error',
        claimId: claim.id,
        message: 'This claim has no number. Start it with "N." or renumber the claims.',
        fix: 'renumber',
      });
    }
    const count = counts.get(claim.number) ?? 0;
    if (claim.number !== 0 && count > 1) {
      issues.push({
        code: 'numbering-duplicate',
        severity: 'error',
        claimId: claim.id,
        message: `Claim number ${claim.number} is used ${count} times.`,
        fix: 'renumber',
      });
    }
    if (claim.number > highest + 1) {
      issues.push({
        code: 'numbering-gap',
        severity: 'warning',
        claimId: claim.id,
        message: `Numbering jumps from ${highest} to ${claim.number}.`,
        fix: 'renumber',
      });
    }
    highest = Math.max(highest, claim.number);

    for (const ref of parseReferences(claim.text)) {
      const range: [number, number] = [ref.start, ref.end];
      if (!firstByNumber.has(ref.number)) {
        issues.push({
          code: 'reference-missing',
          severity: 'error',
          claimId: claim.id,
          range,
          message: `Refers to claim ${ref.number}, which does not exist.`,
        });
      } else if (ref.number >= claim.number) {
        issues.push({
          code: 'reference-forward',
          severity: 'error',
          claimId: claim.id,
          range,
          message: `Refers to claim ${ref.number}, which is not an earlier claim.`,
        });
      }
    }
  }

  issues.push(...checkAntecedentBasis(claims));

  const support = checkSpecSupport(claims, spec);
  if (support.hasSpec) {
    for (const term of support.terms) {
      if (term.supported) continue;
      issues.push({
        code: 'spec-unsupported',
        severity: 'warning',
        claimId: term.claimId,
        range: term.range,
        message: `"${term.term}" is not described in the specification.`,
      });
    }
  }

  const issuesByClaim: Record<string, Issue[]> = {};
  for (const issue of issues) {
    (issuesByClaim[issue.claimId] ??= []).push(issue);
  }
  return { issues, issuesByClaim, support };
}
