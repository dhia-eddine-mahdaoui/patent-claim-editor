import { useEffect, useMemo, useReducer, useState } from 'react';
import { ClaimEditor } from './components/ClaimEditor';
import { DependencyTree } from './components/DependencyTree';
import { SuggestionPanel } from './components/SuggestionPanel';
import { analyzeClaims } from './domain/analysis';
import { downloadText, toJsonExport, toPlainText } from './domain/exporter';
import { commit, createHistory, redo, undo, type History } from './domain/history';
import { createClaim } from './domain/parser';
import { renumberClaims } from './domain/renumber';
import { sampleDocument } from './domain/sample';
import { loadDocument, saveDocument } from './domain/storage';
import {
  applySuggestionText,
  createLlmProvider,
  suggestRuleBased,
  type Suggestion,
} from './domain/suggestions';
import { buildDependencyTree } from './domain/tree';
import type { Claim, ClaimDocument } from './domain/types';

const LLM_ENDPOINT = import.meta.env.VITE_LLM_ENDPOINT as string | undefined;
const LLM_MODEL = (import.meta.env.VITE_LLM_MODEL as string | undefined) ?? 'default';

type Action =
  | { type: 'edit'; transform: (doc: ClaimDocument) => ClaimDocument; key?: string }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(state: History<ClaimDocument>, action: Action): History<ClaimDocument> {
  switch (action.type) {
    case 'edit':
      return commit(state, action.transform(state.present), action.key ?? null);
    case 'undo':
      return undo(state);
    case 'redo':
      return redo(state);
  }
}

function focusClaim(claimId: string) {
  document.querySelector<HTMLTextAreaElement>(`#claim-${claimId} textarea`)?.focus();
}

function replaceClaimText(claims: Claim[], claimId: string, text: string): Claim[] {
  return claims.map((claim) => (claim.id === claimId ? { ...claim, text } : claim));
}

export default function App() {
  const [history, dispatch] = useReducer(reducer, null, () =>
    createHistory(loadDocument() ?? sampleDocument()),
  );
  const doc = history.present;

  const analysis = useMemo(() => analyzeClaims(doc.claims), [doc.claims]);
  const tree = useMemo(() => buildDependencyTree(doc.claims), [doc.claims]);
  const ruleSuggestions = useMemo(() => suggestRuleBased(doc.claims, analysis), [doc.claims, analysis]);

  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [llmSuggestions, setLlmSuggestions] = useState<Suggestion[]>([]);
  const [llmStatus, setLlmStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [status, setStatus] = useState('');
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  useEffect(() => {
    saveDocument(doc);
  }, [doc]);

  useEffect(() => {
    if (pendingFocus) {
      focusClaim(pendingFocus);
      setPendingFocus(null);
    }
  }, [pendingFocus]);

  // Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) redoes document changes, even inside the editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        dispatch({ type: 'undo' });
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const edit = (transform: (d: ClaimDocument) => ClaimDocument, key?: string) =>
    dispatch({ type: 'edit', transform, key });

  const suggestions = [...ruleSuggestions, ...llmSuggestions].filter((s) => !dismissed.has(s.id));
  const errorCount = analysis.issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = analysis.issues.length - errorCount;

  const addClaim = () => {
    const number = Math.max(0, ...doc.claims.map((claim) => claim.number)) + 1;
    const claim = createClaim(number, '');
    edit((d) => ({ ...d, claims: [...d.claims, claim] }));
    setPendingFocus(claim.id);
  };

  const acceptSuggestion = (suggestion: Suggestion) => {
    const claim = doc.claims.find((c) => c.id === suggestion.claimId);
    const next = claim ? applySuggestionText(claim.text, suggestion) : null;
    if (!claim || next === null) {
      setStatus(`That suggestion for claim ${suggestion.claimNumber} is out of date.`);
      return;
    }
    edit((d) => ({ ...d, claims: replaceClaimText(d.claims, claim.id, next) }));
    setLlmSuggestions((previous) => previous.filter((s) => s.id !== suggestion.id));
    setStatus(`Accepted a change to claim ${suggestion.claimNumber}. Undo is available.`);
  };

  const rejectSuggestion = (suggestion: Suggestion) => {
    setDismissed((previous) => new Set(previous).add(suggestion.id));
    setStatus(`Dismissed a suggestion for claim ${suggestion.claimNumber}.`);
  };

  const askLlm = async () => {
    if (!LLM_ENDPOINT) return;
    setLlmStatus('loading');
    try {
      const provider = createLlmProvider({ endpoint: LLM_ENDPOINT, model: LLM_MODEL });
      const result = await provider.suggest(doc.claims, analysis);
      setLlmSuggestions(result);
      setLlmStatus('idle');
      setStatus(`The LLM returned ${result.length} suggestion(s).`);
    } catch {
      setLlmStatus('error');
      setStatus('The LLM request failed. Rule-based suggestions are still available.');
    }
  };

  const restoreSample = () => {
    if (!window.confirm('Replace the current draft with the sample patent? You can undo this.')) return;
    edit(() => sampleDocument());
    setStatus('Sample restored.');
  };

  return (
    <div className="app">
      <a className="skip-link" href="#claims">
        Skip to claims
      </a>
      <header className="topbar">
        <div className="title-block">
          <h1>Patent claim editor</h1>
          <input
            className="title-input"
            value={doc.title}
            aria-label="Document title"
            onChange={(event) => edit((d) => ({ ...d, title: event.target.value }), 'title')}
          />
        </div>
        <div className="toolbar" role="toolbar" aria-label="Document actions">
          <button
            type="button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={history.past.length === 0}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={history.future.length === 0}
            title="Redo (Ctrl+Shift+Z)"
          >
            Redo
          </button>
          <button type="button" className="primary" onClick={addClaim}>
            Add claim
          </button>
          <button type="button" onClick={() => edit((d) => ({ ...d, claims: renumberClaims(d.claims) }))}>
            Renumber
          </button>
          <button type="button" onClick={() => downloadText('claims.txt', toPlainText(doc.claims), 'text/plain')}>
            Export .txt
          </button>
          <button type="button" onClick={() => downloadText('claims.json', toJsonExport(doc), 'application/json')}>
            Export .json
          </button>
          <button type="button" className="ghost" onClick={restoreSample}>
            Restore sample
          </button>
        </div>
      </header>

      <p className="summary" role="status" aria-live="polite">
        {analysis.issues.length === 0
          ? 'No issues found.'
          : `${errorCount} error(s), ${warningCount} warning(s).`}
        {status ? ` ${status}` : ''}
      </p>

      <main id="claims" className="layout">
        <section className="panel" aria-labelledby="claims-heading">
          <h2 id="claims-heading">Claims</h2>
          <ClaimEditor
            claims={doc.claims}
            issuesByClaim={analysis.issuesByClaim}
            onText={(id, text) => edit((d) => ({ ...d, claims: replaceClaimText(d.claims, id, text) }), `text:${id}`)}
            onNumber={(id, value) =>
              edit((d) => ({ ...d, claims: d.claims.map((c) => (c.id === id ? { ...c, number: value } : c)) }), `number:${id}`)
            }
            onDelete={(id) => edit((d) => ({ ...d, claims: d.claims.filter((c) => c.id !== id) }))}
            onRenumber={() => edit((d) => ({ ...d, claims: renumberClaims(d.claims) }))}
          />
        </section>

        <div className="sidebar">
          <section className="panel" aria-labelledby="tree-heading">
            <h2 id="tree-heading">Dependency tree</h2>
            <DependencyTree roots={tree} onSelect={focusClaim} />
          </section>
          <section className="panel" aria-labelledby="ai-heading">
            <h2 id="ai-heading">AI suggestions</h2>
            <SuggestionPanel
              suggestions={suggestions}
              claims={doc.claims}
              dismissedCount={dismissed.size}
              onAccept={acceptSuggestion}
              onReject={rejectSuggestion}
              onRestore={() => setDismissed(new Set())}
              llmEnabled={Boolean(LLM_ENDPOINT)}
              llmStatus={llmStatus}
              onAskLlm={askLlm}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
