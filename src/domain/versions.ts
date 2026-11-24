import type { ClaimDocument } from './types';

export interface ChangeStats {
  added: number;
  removed: number;
  changed: number;
  specChanged: boolean;
  titleChanged: boolean;
}

export interface DraftSummary {
  id: string;
  title: string;
  updatedAt: string;
  claimCount: number;
}

export interface Draft extends ClaimDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface VersionSummary {
  id: string;
  draftId: string;
  createdAt: string;
  label: string;
  /** True when the app created the version (for example when a suggestion was accepted). */
  auto: boolean;
  claimCount: number;
  /** Change relative to the previous version of the same draft. */
  change: ChangeStats;
}

export interface Version extends VersionSummary {
  snapshot: ClaimDocument;
}

/** Compares two documents by claim id: which claims were added, removed or edited. */
export function diffDocuments(before: ClaimDocument | null, after: ClaimDocument): ChangeStats {
  if (!before) {
    return { added: after.claims.length, removed: 0, changed: 0, specChanged: false, titleChanged: false };
  }
  const old = new Map(before.claims.map((c) => [c.id, c]));
  const next = new Set(after.claims.map((c) => c.id));
  let added = 0;
  let changed = 0;
  for (const claim of after.claims) {
    const prior = old.get(claim.id);
    if (!prior) added += 1;
    else if (prior.text !== claim.text || prior.number !== claim.number) changed += 1;
  }
  let removed = 0;
  for (const id of old.keys()) if (!next.has(id)) removed += 1;
  return {
    added,
    removed,
    changed,
    specChanged: before.spec !== after.spec,
    titleChanged: before.title !== after.title,
  };
}

export function describeChange(change: ChangeStats): string {
  const parts: string[] = [];
  if (change.added) parts.push(`${change.added} added`);
  if (change.changed) parts.push(`${change.changed} edited`);
  if (change.removed) parts.push(`${change.removed} removed`);
  if (change.specChanged) parts.push('description edited');
  if (change.titleChanged) parts.push('title changed');
  return parts.length ? parts.join(', ') : 'no changes';
}
