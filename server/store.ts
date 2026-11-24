import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ClaimDocument } from '../src/domain/types';
import {
  diffDocuments,
  type Draft,
  type DraftSummary,
  type Version,
  type VersionSummary,
} from '../src/domain/versions';

interface Data {
  drafts: Record<string, Draft>;
  versions: Record<string, Version[]>;
}

const MAX_VERSIONS = 200;

/**
 * Drafts and their version history in one JSON file. Writes go to a temp file that is renamed
 * into place, so a crash cannot leave a half-written file. Passing `file: null` keeps everything in memory.
 */
export class DraftStore {
  private data: Data = { drafts: {}, versions: {} };

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Data;
        if (parsed && typeof parsed === 'object' && parsed.drafts && parsed.versions) this.data = parsed;
      } catch {
        // A corrupt file is replaced on the next write; the broken copy stays alongside as .bak.
        try {
          renameSync(file, `${file}.bak`);
        } catch {
          // ignore
        }
      }
    }
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }

  listDrafts(): DraftSummary[] {
    return Object.values(this.data.drafts)
      .map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt, claimCount: d.claims.length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getDraft(id: string): Draft | undefined {
    return this.data.drafts[id];
  }

  createDraft(doc: ClaimDocument): Draft {
    const now = new Date().toISOString();
    const draft: Draft = { ...doc, id: randomUUID(), createdAt: now, updatedAt: now };
    this.data.drafts[draft.id] = draft;
    this.data.versions[draft.id] = [];
    this.addVersion(draft.id, 'Initial draft', true, doc);
    return draft;
  }

  updateDraft(id: string, doc: ClaimDocument): Draft | undefined {
    const existing = this.data.drafts[id];
    if (!existing) return undefined;
    const draft: Draft = { ...doc, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    this.data.drafts[id] = draft;
    this.persist();
    return draft;
  }

  deleteDraft(id: string): boolean {
    if (!this.data.drafts[id]) return false;
    delete this.data.drafts[id];
    delete this.data.versions[id];
    this.persist();
    return true;
  }

  listVersions(draftId: string): VersionSummary[] | undefined {
    const versions = this.data.versions[draftId];
    if (!versions) return undefined;
    return versions.map(toSummary).reverse();
  }

  getVersion(draftId: string, versionId: string): Version | undefined {
    return this.data.versions[draftId]?.find((v) => v.id === versionId);
  }

  addVersion(draftId: string, label: string, auto: boolean, snapshot: ClaimDocument): Version | undefined {
    const list = this.data.versions[draftId];
    if (!list) return undefined;
    const previous = list[list.length - 1]?.snapshot ?? null;
    const version: Version = {
      id: randomUUID(),
      draftId,
      createdAt: new Date().toISOString(),
      label,
      auto,
      claimCount: snapshot.claims.length,
      change: diffDocuments(previous, snapshot),
      snapshot: structuredClone(snapshot),
    };
    list.push(version);
    if (list.length > MAX_VERSIONS) list.splice(0, list.length - MAX_VERSIONS);
    this.persist();
    return version;
  }
}

function toSummary(version: Version): VersionSummary {
  const { snapshot: _snapshot, ...summary } = version;
  void _snapshot;
  return summary;
}
