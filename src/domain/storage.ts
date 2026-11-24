import type { ClaimDocument } from './types';

export const STORAGE_KEY = 'claim-editor:document:v1';
export const DRAFT_ID_KEY = 'claim-editor:draft-id:v1';
export const THEME_KEY = 'claim-editor:theme:v1';

function isClaimDocument(value: unknown): value is Omit<ClaimDocument, 'spec'> & { spec?: string } {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<ClaimDocument>;
  return (
    typeof doc.title === 'string' &&
    (doc.spec === undefined || typeof doc.spec === 'string') &&
    Array.isArray(doc.claims) &&
    doc.claims.every(
      (claim) =>
        !!claim && typeof claim.id === 'string' && typeof claim.number === 'number' && typeof claim.text === 'string',
    )
  );
}

/** Returns the locally cached draft, or null when there is none or storage is unavailable. */
export function loadDocument(): ClaimDocument | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isClaimDocument(parsed) ? { ...parsed, spec: parsed.spec ?? '' } : null;
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

export function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
