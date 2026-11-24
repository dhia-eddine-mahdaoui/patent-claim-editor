import { applySuggestionText, type Suggestion, type SuggestionKind } from '../domain/suggestions';
import type { Claim } from '../domain/types';
import { Icon } from './Icon';

const KIND_LABEL: Record<SuggestionKind, string> = {
  antecedent: 'Antecedent basis',
  wording: 'Wording',
  style: 'Style',
};

export interface StreamState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  done: number;
  total: number;
  engine: 'server' | 'local';
  ms: number | null;
}

interface Props {
  suggestions: Suggestion[];
  claims: Claim[];
  activeId: string | null;
  dismissedCount: number;
  stream: StreamState;
  onActivate: (suggestion: Suggestion) => void;
  onAccept: (suggestion: Suggestion) => void;
  onReject: (suggestion: Suggestion) => void;
  onRestore: () => void;
  onRerun: () => void;
}

const CONTEXT = 42;

/** A short before/after excerpt around the edit. */
function Excerpt({ text, suggestion }: { text: string; suggestion: Suggestion }) {
  const { index, from, to } = suggestion;
  const start = Math.max(0, index - CONTEXT);
  const end = Math.min(text.length, index + from.length + CONTEXT);
  return (
    <span className="diff" aria-label="Proposed change">
      {start > 0 && '…'}
      {text.slice(start, index)}
      {from && <del>{from}</del>}
      {to && <ins>{to}</ins>}
      {text.slice(index + from.length, end)}
      {end < text.length && '…'}
    </span>
  );
}

export function SuggestionPanel({
  suggestions,
  claims,
  activeId,
  dismissedCount,
  stream,
  onActivate,
  onAccept,
  onReject,
  onRestore,
  onRerun,
}: Props) {
  const textOf = (claimId: string) => claims.find((claim) => claim.id === claimId)?.text ?? '';
  const streaming = stream.status === 'streaming';

  return (
    <div className="suggestions">
      <div className="stream-bar">
        <span className="stream-status" aria-live="polite">
          {streaming ? (
            <>
              <span className="spinner" aria-hidden="true" /> Reviewing claim {Math.min(stream.done, stream.total)} of {stream.total}
            </>
          ) : stream.status === 'error' ? (
            'Suggestion engine failed'
          ) : (
            <>
              {suggestions.length} open
              <span className="muted">
                {' '}
                · {stream.engine === 'server' ? 'streamed from the server' : 'local rules (offline)'}
                {stream.ms !== null && stream.engine === 'server' ? `, ${stream.ms} ms` : ''}
              </span>
            </>
          )}
        </span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onRerun} disabled={streaming}>
          Re-run
        </button>
      </div>
      {streaming && (
        <div className="progress" role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={stream.total} aria-valuenow={stream.done}>
          <span style={{ width: `${stream.total ? (100 * stream.done) / stream.total : 0}%` }} />
        </div>
      )}

      {suggestions.length === 0 && !streaming ? (
        <div className="empty">
          <span className="empty-icon ok">
            <Icon name="sparkle" size={20} />
          </span>
          <p className="empty-title">No open suggestions</p>
          <p className="muted">New ones appear here as you edit.</p>
        </div>
      ) : (
        <ul className="suggestion-list">
          {suggestions.map((suggestion) => {
            const before = textOf(suggestion.claimId);
            const stale = applySuggestionText(before, suggestion) === null;
            const active = suggestion.id === activeId;
            return (
              <li key={suggestion.id} className={`suggestion${active ? ' active' : ''}${stale ? ' stale' : ''}`} aria-current={active ? 'true' : undefined}>
                <button type="button" className="suggestion-main" onClick={() => onActivate(suggestion)} aria-label={`Show in editor: ${suggestion.message}`}>
                  <span className="suggestion-head">
                    <span className={`tag tag-${suggestion.kind}`}>{KIND_LABEL[suggestion.kind]}</span>
                    <span className="muted">Claim {suggestion.claimNumber}</span>
                  </span>
                  <span className="suggestion-message">{suggestion.message}</span>
                  {stale ? <span className="muted">Out of date. Edit in progress, refreshing.</span> : <Excerpt text={before} suggestion={suggestion} />}
                </button>
                <div className="actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={stale} onClick={() => onAccept(suggestion)} aria-label={`Accept: ${suggestion.message}`}>
                    <Icon name="check" size={14} /> Accept
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => onReject(suggestion)} aria-label={`Reject: ${suggestion.message}`}>
                    <Icon name="x" size={14} /> Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dismissedCount > 0 && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={onRestore}>
          Show {dismissedCount} dismissed
        </button>
      )}
    </div>
  );
}
