import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { ApiError, api } from './api';
import { DependencyTree } from './components/DependencyTree';
import { HistoryPanel } from './components/HistoryPanel';
import { Icon } from './components/Icon';
import { IssuesPanel } from './components/IssuesPanel';
import { ShortcutsDialog, MOD } from './components/ShortcutsDialog';
import { SuggestionPanel } from './components/SuggestionPanel';
import { SupportPanel } from './components/SupportPanel';
import { analyzeClaims } from './domain/analysis';
import { downloadText, toJsonExport, toPlainText } from './domain/exporter';
import { commit, createHistory, redo, undo, type History } from './domain/history';
import { renumberClaims } from './domain/renumber';
import { sampleDocument } from './domain/sample';
import { DRAFT_ID_KEY, THEME_KEY, loadDocument, readSetting, saveDocument, writeSetting } from './domain/storage';
import { applySuggestionText, type Suggestion } from './domain/suggestions';
import { buildDependencyTree } from './domain/tree';
import type { Claim, ClaimDocument, Issue } from './domain/types';
import type { DraftSummary, Version, VersionSummary } from './domain/versions';
import { ClaimsEditor, type ClaimsEditorHandle } from './editor/ClaimsEditor';
import { useSuggestionStream } from './hooks/useSuggestionStream';

interface Initial {
  doc: ClaimDocument;
  draftId: string | null;
}

const toDoc = ({ title, claims, spec }: ClaimDocument): ClaimDocument => ({ title, claims, spec });

/** Loads the draft named in the URL or last used, falling back to a local copy when the API is down. */
async function bootstrap(): Promise<Initial> {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('draft');
    for (const id of [fromUrl, readSetting(DRAFT_ID_KEY)]) {
      if (!id) continue;
      try {
        const draft = await api.getDraft(id);
        writeSetting(DRAFT_ID_KEY, draft.id);
        return { doc: toDoc(draft), draftId: draft.id };
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
    const [latest] = await api.listDrafts();
    const draft = latest ? await api.getDraft(latest.id) : await api.createDraft();
    writeSetting(DRAFT_ID_KEY, draft.id);
    return { doc: toDoc(draft), draftId: draft.id };
  } catch {
    return { doc: loadDocument() ?? sampleDocument(), draftId: null };
  }
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    const saved = readSetting(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);
  const effective = theme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const toggle = () => {
    const next = effective === 'dark' ? 'light' : 'dark';
    setTheme(next);
    writeSetting(THEME_KEY, next);
  };
  return { effective, toggle };
}

export default function App() {
  const [initial, setInitial] = useState<Initial | null>(null);
  const theme = useTheme();

  useEffect(() => {
    let cancelled = false;
    void bootstrap().then((result) => {
      if (!cancelled) setInitial(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!initial) {
    return (
      <div className="boot" role="status">
        <span className="spinner" aria-hidden="true" /> Loading draft…
      </div>
    );
  }
  return <Workspace initial={initial} theme={theme} />;
}

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

type Tab = 'issues' | 'suggestions' | 'support' | 'history';
type SaveState = 'saved' | 'saving' | 'offline';

function Workspace({ initial, theme }: { initial: Initial; theme: { effective: 'light' | 'dark'; toggle: () => void } }) {
  const { draftId } = initial;
  const [history, dispatch] = useReducer(reducer, initial.doc, createHistory);
  const doc = history.present;
  const docRef = useRef(doc);
  docRef.current = doc;

  const [online, setOnline] = useState(draftId !== null);
  const [save, setSave] = useState<SaveState>(draftId ? 'saved' : 'offline');
  const [tab, setTab] = useState<Tab>('issues');
  const [toast, setToast] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [preview, setPreview] = useState<Version | null>(null);

  const editorRef = useRef<ClaimsEditorHandle>(null);
  const specRef = useRef<HTMLTextAreaElement>(null);

  const analysis = useMemo(() => analyzeClaims(doc.claims, doc.spec), [doc.claims, doc.spec]);
  const deferredAnalysis = useDeferredValue(analysis);
  const tree = useMemo(() => buildDependencyTree(doc.claims), [doc.claims]);
  const deferredTree = useDeferredValue(tree);

  const { items, stream, rerun, setItems } = useSuggestionStream(doc.claims, online);

  const order = useMemo(() => new Map(doc.claims.map((c, i) => [c.id, i])), [doc.claims]);
  const visible = useMemo(
    () =>
      items
        .filter((s) => !dismissed.has(s.id))
        .sort((a, b) => (order.get(a.claimId) ?? 0) - (order.get(b.claimId) ?? 0) || a.index - b.index),
    [items, dismissed, order],
  );
  const claimTextById = useMemo(() => new Map(doc.claims.map((c) => [c.id, c.text])), [doc.claims]);
  const fresh = useMemo(
    () => visible.filter((s) => applySuggestionText(claimTextById.get(s.claimId) ?? '', s) !== null),
    [visible, claimTextById],
  );
  const activeSuggestion = tab === 'suggestions' ? (visible.find((s) => s.id === activeId) ?? fresh[0] ?? null) : null;

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const edit = useCallback(
    (transform: (d: ClaimDocument) => ClaimDocument, key?: string) => dispatch({ type: 'edit', transform, key }),
    [],
  );

  // Local cache plus debounced autosave to the API.
  const firstDoc = useRef(doc);
  useEffect(() => {
    saveDocument(doc);
    if (doc === firstDoc.current) return;
    if (!draftId) return;
    setSave('saving');
    const timer = setTimeout(() => {
      api.saveDraft(draftId, doc).then(
        () => {
          setSave('saved');
          setOnline(true);
        },
        () => {
          setSave('offline');
          setOnline(false);
        },
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [doc, draftId]);

  const refreshVersions = useCallback(async () => {
    if (!draftId || !online) return;
    try {
      setVersions(await api.listVersions(draftId));
    } catch {
      setVersions([]);
    }
  }, [draftId, online]);
  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  const saveVersion = useCallback(
    async (label: string, auto = false, snapshot: ClaimDocument = docRef.current) => {
      if (!draftId || !online) {
        notify('Versions need the server. Your draft is still saved in this browser.');
        return;
      }
      try {
        await api.saveVersion(draftId, snapshot, label, auto);
        setSave('saved');
        await refreshVersions();
        if (!auto) notify(`Saved version "${label}".`);
      } catch {
        notify('Could not save the version. The server did not respond.');
      }
    },
    [draftId, online, notify, refreshVersions],
  );

  const previewVersion = async (versionId: string) => {
    if (!draftId) return;
    try {
      setPreview(await api.getVersion(draftId, versionId));
    } catch {
      notify('Could not load that version.');
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (!draftId) return;
    try {
      await api.saveDraft(draftId, docRef.current);
      const restored = await api.restoreVersion(draftId, versionId);
      edit(() => toDoc(restored));
      setPreview(null);
      await refreshVersions();
      notify('Version restored. Your previous text was saved as a version, and Undo works too.');
    } catch {
      notify('Could not restore that version.');
    }
  };

  // Issue and suggestion navigation.
  const goToIssue = useCallback((issue: Issue) => editorRef.current?.focusClaim(issue.claimId, issue.range), []);
  const issueCursor = useRef(-1);
  const stepIssue = (direction: 1 | -1) => {
    const list = analysis.issues;
    if (list.length === 0) return notify('No issues to jump to.');
    issueCursor.current = (issueCursor.current + direction + list.length) % list.length;
    goToIssue(list[issueCursor.current]);
  };

  const activate = (suggestion: Suggestion) => {
    setActiveId(suggestion.id);
    editorRef.current?.reveal(suggestion.claimId, suggestion.index);
  };
  const stepSuggestion = (direction: 1 | -1) => {
    setTab('suggestions');
    if (fresh.length === 0) return;
    const at = fresh.findIndex((s) => s.id === (activeSuggestion?.id ?? activeId));
    const next = fresh[(at + direction + fresh.length) % fresh.length];
    activate(next);
  };

  const accept = (suggestion: Suggestion) => {
    const claim = doc.claims.find((c) => c.id === suggestion.claimId);
    const next = claim ? applySuggestionText(claim.text, suggestion) : null;
    if (!claim || next === null) {
      notify(`That suggestion for claim ${suggestion.claimNumber} is out of date.`);
      return;
    }
    const claims = doc.claims.map((c) => (c.id === claim.id ? { ...c, text: next } : c));
    const nextDoc = { ...doc, claims };
    edit(() => nextDoc);
    setItems((previous) => previous.filter((s) => s.id !== suggestion.id));
    const following = fresh[fresh.findIndex((s) => s.id === suggestion.id) + 1] ?? fresh[0];
    setActiveId(following && following.id !== suggestion.id ? following.id : null);
    notify(`Accepted a change to claim ${suggestion.claimNumber}. Undo is available.`);
    void saveVersion(`Accepted: ${suggestion.message}`, true, nextDoc);
  };

  const reject = (suggestion: Suggestion) => {
    setDismissed((previous) => new Set(previous).add(suggestion.id));
    const following = fresh.find((s) => s.id !== suggestion.id && (order.get(s.claimId) ?? 0) >= (order.get(suggestion.claimId) ?? 0));
    setActiveId(following?.id ?? null);
    notify(`Dismissed a suggestion for claim ${suggestion.claimNumber}.`);
  };

  const renumber = () => {
    edit((d) => ({ ...d, claims: renumberClaims(d.claims) }));
    notify('Claims renumbered and references updated.');
  };

  const restoreSample = () => {
    if (!window.confirm('Replace the current draft with the sample patent? You can undo this.')) return;
    edit(() => sampleDocument());
    notify('Sample restored.');
  };

  // Keyboard shortcuts. The handler reads the latest closures through a ref.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') {
      event.preventDefault();
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
    } else if (mod && key === 'y') {
      event.preventDefault();
      dispatch({ type: 'redo' });
    } else if (mod && key === 's') {
      event.preventDefault();
      void saveVersion('Saved version');
    } else if (mod && key === '/') {
      event.preventDefault();
      setShowHelp((v) => !v);
    } else if (event.key === 'F8') {
      event.preventDefault();
      stepIssue(event.shiftKey ? -1 : 1);
    } else if (event.altKey && event.code === 'BracketRight') {
      event.preventDefault();
      stepSuggestion(1);
    } else if (event.altKey && event.code === 'BracketLeft') {
      event.preventDefault();
      stepSuggestion(-1);
    } else if (event.altKey && event.key === 'Enter' && activeSuggestion) {
      event.preventDefault();
      accept(activeSuggestion);
    } else if (event.altKey && event.key === 'Backspace' && activeSuggestion) {
      event.preventDefault();
      reject(activeSuggestion);
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const onClaimsChange = useCallback(
    (claims: Claim[], editedId: string | null) =>
      edit((d) => ({ ...d, claims }), `text:${editedId ?? ''}`),
    [edit],
  );
  const onSuggestionClick = useCallback((id: string) => {
    setTab('suggestions');
    setActiveId(id);
  }, []);

  const errors = analysis.issues.filter((i) => i.severity === 'error').length;
  const warnings = analysis.issues.length - errors;
  const unsupported = deferredAnalysis.support.terms.filter((t) => !t.supported).length;
  const wordCount = doc.spec.trim() ? doc.spec.trim().split(/\s+/).length : 0;

  const tabs: Array<{ id: Tab; label: string; count?: number; tone?: 'error' | 'warning' | 'info' }> = [
    { id: 'issues', label: 'Issues', count: deferredAnalysis.issues.length, tone: errors ? 'error' : 'warning' },
    { id: 'suggestions', label: 'Suggestions', count: visible.length, tone: 'info' },
    { id: 'support', label: 'Support', count: deferredAnalysis.support.hasSpec ? unsupported : undefined, tone: 'warning' },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="app">
      <a className="skip-link" href="#claims">
        Skip to claims
      </a>

      <header className="topbar">
        <div className="brand" aria-hidden="true">
          <span className="brand-mark">§</span>
        </div>
        <div className="title-block">
          <h1 className="sr-only">Patent claim editor</h1>
          <input
            className="title-input"
            value={doc.title}
            aria-label="Document title"
            placeholder="Untitled draft"
            onChange={(event) => edit((d) => ({ ...d, title: event.target.value }), 'title')}
          />
          <span className={`save-state ${save}`} role="status">
            <span className="dot" aria-hidden="true" />
            {save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : 'Local only'}
          </span>
        </div>
        <div className="toolbar" role="toolbar" aria-label="Document actions">
          <button type="button" className="btn btn-icon" onClick={() => dispatch({ type: 'undo' })} disabled={history.past.length === 0} title={`Undo (${MOD}+Z)`}>
            <Icon name="undo" />
            <span className="btn-text">Undo</span>
          </button>
          <button type="button" className="btn btn-icon" onClick={() => dispatch({ type: 'redo' })} disabled={history.future.length === 0} title={`Redo (${MOD}+Shift+Z)`}>
            <Icon name="redo" />
            <span className="btn-text">Redo</span>
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button type="button" className="btn btn-icon" onClick={() => void saveVersion('Saved version')} title={`Save a version (${MOD}+S)`}>
            <Icon name="save" />
            <span className="btn-text">Save version</span>
          </button>
          <Menu label="Export" icon="download">
            <button type="button" onClick={() => downloadText('claims.txt', toPlainText(doc.claims), 'text/plain')}>
              Plain text (.txt)
            </button>
            <button type="button" onClick={() => downloadText('claims.json', toJsonExport(doc), 'application/json')}>
              JSON (.json)
            </button>
          </Menu>
          <DraftsMenu draftId={draftId} online={online} onRestoreSample={restoreSample} />
          <span className="toolbar-sep" aria-hidden="true" />
          <button type="button" className="btn btn-icon" onClick={theme.toggle} aria-label={theme.effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title="Toggle theme">
            <Icon name={theme.effective === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="btn btn-icon" onClick={() => setShowHelp(true)} aria-label="Keyboard shortcuts" title={`Keyboard shortcuts (${MOD}+/)`}>
            <Icon name="help" />
          </button>
        </div>
      </header>

      {!online && (
        <div className="banner" role="note">
          <Icon name="wifiOff" />
          <span>
            Server not reachable. You are working offline: edits stay in this browser, suggestions run locally, and version history is paused.
          </span>
        </div>
      )}

      <main id="claims" className="workspace">
        <section className="pane pane-claims" aria-labelledby="claims-heading">
          <div className="pane-head">
            <h2 id="claims-heading">Claims</h2>
            <div className="chips" role="status" aria-live="polite">
              {errors === 0 && warnings === 0 ? (
                <span className="chip chip-ok">
                  <Icon name="check" size={13} /> No issues
                </span>
              ) : (
                <>
                  {errors > 0 && <span className="chip chip-error">{errors} {errors === 1 ? 'error' : 'errors'}</span>}
                  {warnings > 0 && <span className="chip chip-warning">{warnings} {warnings === 1 ? 'warning' : 'warnings'}</span>}
                </>
              )}
            </div>
            <div className="pane-actions">
              <button type="button" className="btn btn-sm" onClick={renumber}>
                <Icon name="renumber" size={14} /> Renumber
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => editorRef.current?.addClaim()}>
                <Icon name="plus" size={14} /> Add claim
              </button>
            </div>
          </div>
          <div className="pane-body">
            <ClaimsEditor
              ref={editorRef}
              claims={doc.claims}
              issues={analysis.issues}
              suggestions={fresh}
              activeSuggestionId={activeSuggestion?.id ?? null}
              onClaimsChange={onClaimsChange}
              onSuggestionClick={onSuggestionClick}
            />
          </div>
        </section>

        <section className="pane pane-spec" aria-labelledby="spec-heading">
          <div className="pane-head">
            <h2 id="spec-heading">Description</h2>
            <span className="muted pane-meta">{wordCount} words</span>
          </div>
          <div className="pane-body">
            <textarea
              ref={specRef}
              className="spec-field"
              value={doc.spec}
              aria-label="Description"
              placeholder="Paste or write the description here. Terms introduced in the claims are checked against it."
              onChange={(event) => edit((d) => ({ ...d, spec: event.target.value }), 'spec')}
            />
          </div>
        </section>

        <aside className="side" aria-label="Analysis">
          <section className="pane tree-pane" aria-labelledby="tree-heading">
            <div className="pane-head">
              <h2 id="tree-heading">Dependency tree</h2>
              <span className="muted pane-meta">{doc.claims.length} claims</span>
            </div>
            <div className="pane-body scroll">
              <DependencyTree roots={deferredTree} onSelect={(id) => editorRef.current?.focusClaim(id)} />
            </div>
          </section>

          <section className="pane tabs-pane" aria-label="Review">
            <div className="tablist" role="tablist" aria-label="Review panels">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  className={`tab${tab === t.id ? ' selected' : ''}`}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(event) => {
                    const at = tabs.findIndex((x) => x.id === t.id);
                    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                    if (!move) return;
                    const next = tabs[(at + move + tabs.length) % tabs.length];
                    setTab(next.id);
                    document.getElementById(`tab-${next.id}`)?.focus();
                  }}
                >
                  {t.label}
                  {t.count !== undefined && t.count > 0 && <span className={`count count-${t.tone}`}>{t.count}</span>}
                </button>
              ))}
            </div>
            <div className="pane-body scroll" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
              {tab === 'issues' && (
                <IssuesPanel claims={doc.claims} issues={deferredAnalysis.issues} onGoTo={goToIssue} onRenumber={renumber} />
              )}
              {tab === 'suggestions' && (
                <SuggestionPanel
                  suggestions={visible}
                  claims={doc.claims}
                  activeId={activeSuggestion?.id ?? null}
                  dismissedCount={dismissed.size}
                  stream={stream}
                  onActivate={activate}
                  onAccept={accept}
                  onReject={reject}
                  onRestore={() => setDismissed(new Set())}
                  onRerun={rerun}
                />
              )}
              {tab === 'support' && (
                <SupportPanel
                  report={deferredAnalysis.support}
                  onGoTo={(claimId, range) => editorRef.current?.focusClaim(claimId, range)}
                  onFocusSpec={() => specRef.current?.focus()}
                />
              )}
              {tab === 'history' && (
                <HistoryPanel
                  online={online && draftId !== null}
                  versions={versions}
                  current={doc}
                  preview={preview}
                  onSave={(label) => void saveVersion(label)}
                  onPreview={(id) => void previewVersion(id)}
                  onClosePreview={() => setPreview(null)}
                  onRestore={(id) => void restoreVersion(id)}
                />
              )}
            </div>
          </section>
        </aside>
      </main>

      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function Menu({
  label,
  icon,
  onOpen,
  children,
}: {
  label: string;
  icon: 'download' | 'folder';
  onOpen?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(event.target as Node)) el.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      const el = ref.current;
      if (event.key !== 'Escape' || !el?.open) return;
      el.open = false;
      el.querySelector('summary')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <details
      className="menu"
      ref={ref}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary className="btn btn-icon">
        <Icon name={icon} />
        <span className="btn-text">{label}</span>
        <Icon name="chevronDown" size={13} />
      </summary>
      <div
        className="menu-list"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button') && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}

function DraftsMenu({ draftId, online, onRestoreSample }: { draftId: string | null; online: boolean; onRestoreSample: () => void }) {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const load = () => {
    if (!online) return;
    api.listDrafts().then(setDrafts, () => setDrafts([]));
  };
  const open = (id: string) => {
    writeSetting(DRAFT_ID_KEY, id);
    window.location.search = `?draft=${id}`;
  };
  const create = async () => {
    try {
      const draft = await api.createDraft({ title: 'Untitled draft', claims: [], spec: '' });
      open(draft.id);
    } catch {
      /* the banner already explains that the server is down */
    }
  };
  return (
    <>
      <Menu label="Drafts" icon="folder" onOpen={load}>
        {online ? (
          <>
            {drafts === null && <span className="menu-note">Loading…</span>}
            {drafts?.map((d) => (
              <button key={d.id} type="button" onClick={() => open(d.id)} aria-current={d.id === draftId ? 'true' : undefined}>
                <span className="menu-title">{d.title || 'Untitled draft'}</span>
                <span className="muted">{d.claimCount} claims</span>
              </button>
            ))}
            <hr />
            <button type="button" onClick={() => void create()}>
              New blank draft
            </button>
          </>
        ) : (
          <span className="menu-note">Drafts are stored by the server.</span>
        )}
        <button type="button" onClick={onRestoreSample}>
          Restore sample text
        </button>
      </Menu>
    </>
  );
}
