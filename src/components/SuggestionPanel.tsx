import { applySuggestionText, type Suggestion, type SuggestionKind } from '../domain/suggestions';
import { diffWords } from '../domain/diff';
import type { Claim } from '../domain/types';

const KIND_LABEL: Record<SuggestionKind, string> = {
  antecedent: 'Antecedent basis',
  wording: 'Wording',
  style: 'Style',
};

interface Props {
  suggestions: Suggestion[];
  claims: Claim[];
  dismissedCount: number;
  onAccept: (suggestion: Suggestion) => void;
  onReject: (suggestion: Suggestion) => void;
  onRestore: () => void;
  llmEnabled: boolean;
  llmStatus: 'idle' | 'loading' | 'error';
  onAskLlm: () => void;
}

export function SuggestionPanel({
  suggestions,
  claims,
  dismissedCount,
  onAccept,
  onReject,
  onRestore,
  llmEnabled,
  llmStatus,
  onAskLlm,
}: Props) {
  const textOf = (claimId: string) => claims.find((claim) => claim.id === claimId)?.text ?? '';

  return (
    <div className="suggestions">
      <p className="muted">
        Rule-based fixes run offline and refresh as you edit. Accept or reject each change on its own.
      </p>
      {llmEnabled && (
        <button type="button" onClick={onAskLlm} disabled={llmStatus === 'loading'}>
          {llmStatus === 'loading' ? 'Asking the LLM…' : 'Ask LLM for more suggestions'}
        </button>
      )}

      {suggestions.length === 0 ? (
        <p className="muted">No open suggestions.</p>
      ) : (
        <ul className="suggestion-list">
          {suggestions.map((suggestion) => {
            const before = textOf(suggestion.claimId);
            const result = applySuggestionText(before, suggestion);
            const stale = result === null;
            const parts = diffWords(before, result ?? before);
            return (
              <li key={suggestion.id} className="suggestion">
                <div className="suggestion-head">
                  <span className="badge">{KIND_LABEL[suggestion.kind]}</span>
                  <span className="muted">Claim {suggestion.claimNumber}</span>
                </div>
                <p>{suggestion.message}</p>
                <p className="diff" role="group" aria-label="Proposed change">
                  {parts.map((part, index) => {
                    if (part.type === 'added') return <ins key={index}>{part.text}</ins>;
                    if (part.type === 'removed') return <del key={index}>{part.text}</del>;
                    return <span key={index}>{part.text}</span>;
                  })}
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={stale}
                    onClick={() => onAccept(suggestion)}
                    aria-label={`Accept: ${suggestion.message}`}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => onReject(suggestion)}
                    aria-label={`Reject: ${suggestion.message}`}
                  >
                    Reject
                  </button>
                  {stale && <span className="muted">Out of date</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dismissedCount > 0 && (
        <button type="button" className="ghost" onClick={onRestore}>
          Show {dismissedCount} dismissed
        </button>
      )}
    </div>
  );
}
