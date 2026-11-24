import type { ClaimDocument } from './types';

export const STORAGE_KEY = 'claim-editor:document:v1';

function isClaimDocument(value: unknown): value is ClaimDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<ClaimDocument>;
  return (
    typeof doc.title === 'string' &&
    Array.isArray(doc.claims) &&
    doc.claims.every(
      (claim) =>
        !!claim && typeof claim.id === 'string' && typeof claim.number === 'number' && typeof claim.text === 'string',
    )
  );
}

/** Returns the saved draft, or null when there is none or storage is unavailable. */
export function loadDocument(): ClaimDocument | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isClaimDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDocument(doc: ClaimDocument): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage may be full or blocked; the editor keeps working in memory.
  }
}
