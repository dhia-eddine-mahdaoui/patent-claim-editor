import { useState } from 'react';
import { diffWords } from '../domain/diff';
import type { ClaimDocument } from '../domain/types';
import { describeChange, type Version, type VersionSummary } from '../domain/versions';
import { Icon } from './Icon';

interface Props {
  online: boolean;
  versions: VersionSummary[] | null;
  current: ClaimDocument;
  preview: Version | null;
  onSave: (label: string) => void;
  onPreview: (versionId: string) => void;
  onClosePreview: () => void;
  onRestore: (versionId: string) => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function HistoryPanel({ online, versions, current, preview, onSave, onPreview, onClosePreview, onRestore }: Props) {
  const [label, setLabel] = useState('');

  if (!online) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="wifiOff" size={20} />
        </span>
        <p className="empty-title">History needs the server</p>
        <p className="muted">Versions are stored by the API. Start it with npm start and reload.</p>
      </div>
    );
  }

  if (preview) return <Preview version={preview} current={current} onClose={onClosePreview} onRestore={onRestore} />;

  return (
    <div>
      <form
        className="save-row"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(label.trim() || 'Saved version');
          setLabel('');
        }}
      >
        <input
          className="input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Version label (optional)"
          aria-label="Version label"
          maxLength={120}
        />
        <button type="submit" className="btn btn-primary">
          <Icon name="save" /> Save
        </button>
      </form>

      {versions === null ? (
        <p className="muted">Loading versions…</p>
      ) : versions.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No versions yet</p>
          <p className="muted">Save a version to keep a restorable snapshot.</p>
        </div>
      ) : (
        <ol className="version-list" aria-label="Versions">
          {versions.map((version) => (
            <li key={version.id}>
              <button type="button" className="version-row" onClick={() => onPreview(version.id)}>
                <span className={`version-dot${version.auto ? ' auto' : ''}`} aria-hidden="true" />
                <span className="version-body">
                  <span className="version-label">{version.label}</span>
                  <span className="muted">
                    {formatTime(version.createdAt)} · {version.claimCount} claims · {describeChange(version.change)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Preview({
  version,
  current,
  onClose,
  onRestore,
}: {
  version: Version;
  current: ClaimDocument;
  onClose: () => void;
  onRestore: (id: string) => void;
}) {
  const before = new Map(version.snapshot.claims.map((c) => [c.id, c]));
  const now = new Map(current.claims.map((c) => [c.id, c]));
  const rows: Array<{ key: string; number: number; kind: 'changed' | 'added' | 'removed'; parts?: ReturnType<typeof diffWords>; text?: string }> = [];
  for (const claim of current.claims) {
    const old = before.get(claim.id);
    if (!old) rows.push({ key: claim.id, number: claim.number, kind: 'added', text: claim.text });
    else if (old.text !== claim.text) rows.push({ key: claim.id, number: claim.number, kind: 'changed', parts: diffWords(old.text, claim.text) });
  }
  for (const claim of version.snapshot.claims) {
    if (!now.has(claim.id)) rows.push({ key: claim.id, number: claim.number, kind: 'removed', text: claim.text });
  }
  const specChanged = version.snapshot.spec !== current.spec;

  return (
    <div>
      <div className="preview-head">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
          Back
        </button>
        <strong className="preview-title">{version.label}</strong>
      </div>
      <p className="muted">{formatTime(version.createdAt)}. Differences between this version and what you have now:</p>
      {rows.length === 0 && !specChanged ? (
        <p className="muted">The claims and description match this version.</p>
      ) : (
        <ul className="change-list">
          {rows.map((row) => (
            <li key={row.key} className={`change change-${row.kind}`}>
              <span className="change-head">
                Claim {row.number || '?'} <span className="tag">{row.kind === 'changed' ? 'edited since' : row.kind === 'added' ? 'added since' : 'removed since'}</span>
              </span>
              <span className="diff">
                {row.parts
                  ? row.parts.map((part, i) =>
                      part.type === 'added' ? <ins key={i}>{part.text}</ins> : part.type === 'removed' ? <del key={i}>{part.text}</del> : <span key={i}>{part.text}</span>,
                    )
                  : row.text}
              </span>
            </li>
          ))}
          {specChanged && (
            <li className="change change-changed">
              <span className="change-head">Description</span>
              <span className="muted">The description text differs.</span>
            </li>
          )}
        </ul>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={() => onRestore(version.id)}>
        <Icon name="history" /> Restore this version
      </button>
      <p className="muted fine">Your current text is saved as a version first, and the restore can be undone.</p>
    </div>
  );
}
