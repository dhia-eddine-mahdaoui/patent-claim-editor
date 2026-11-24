import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { createClaim } from '../domain/parser';
import type { Suggestion } from '../domain/suggestions';
import type { Issue } from '../domain/types';
import { PREFIX, parseLine } from './claimsDoc';

export interface DecorationData {
  issues: Issue[];
  suggestions: Suggestion[];
  activeSuggestionId: string | null;
}

const EMPTY: DecorationData = { issues: [], suggestions: [], activeSuggestionId: null };

interface PluginState {
  marks: DecorationSet;
  issues: Issue[];
}

export const decorationKey = new PluginKey<PluginState>('claimDecorations');

function issueClass(issue: Issue): string {
  if (issue.code === 'spec-unsupported') return 'hl hl-spec';
  return `hl hl-${issue.severity}`;
}

interface ClaimInfo {
  pos: number;
  node: PMNode;
  prefixLength: number;
}

function indexClaims(doc: PMNode): Map<string, ClaimInfo> {
  const map = new Map<string, ClaimInfo>();
  doc.forEach((node, pos) => {
    const id = node.attrs.id as string | null;
    if (id) map.set(id, { pos, node, prefixLength: PREFIX.exec(node.textContent)?.[0].length ?? 0 });
  });
  return map;
}

function ghost(text: string, className: string, title: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  el.title = title;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/** Inline decorations for issues and suggestion marks, positioned from claim-relative offsets. */
function buildMarks(doc: PMNode, data: DecorationData): DecorationSet {
  const claims = indexClaims(doc);
  const decorations: Decoration[] = [];
  const place = (claimId: string, start: number, end: number): [number, number] | null => {
    const info = claims.get(claimId);
    if (!info) return null;
    const base = info.pos + 1 + info.prefixLength;
    const limit = info.pos + 1 + info.node.content.size;
    const from = Math.min(base + start, limit);
    const to = Math.min(base + end, limit);
    return [from, to];
  };

  for (const issue of data.issues) {
    if (!issue.range) continue;
    const at = place(issue.claimId, issue.range[0], issue.range[1]);
    if (!at || at[1] <= at[0]) continue;
    decorations.push(Decoration.inline(at[0], at[1], { class: issueClass(issue), title: issue.message }));
  }

  for (const suggestion of data.suggestions) {
    const active = suggestion.id === data.activeSuggestionId;
    const at = place(suggestion.claimId, suggestion.index, suggestion.index + suggestion.from.length);
    if (!at) continue;
    const label = `Suggestion: ${suggestion.message}`;
    if (suggestion.from.length > 0) {
      decorations.push(
        Decoration.inline(at[0], at[1], {
          class: active ? 'sug sug-active' : 'sug',
          'data-sug': suggestion.id,
          title: label,
        }),
      );
    }
    if (active && suggestion.to) {
      decorations.push(
        Decoration.widget(at[1], () => ghost(suggestion.to, 'sug-ins', 'Alt+Enter accepts, Alt+Backspace rejects'), {
          side: 1,
          key: `ins-${suggestion.id}`,
        }),
      );
    } else if (!active && suggestion.from.length === 0) {
      decorations.push(
        Decoration.widget(at[0], () => ghost('+', 'sug-caret', label), { side: 1, key: `caret-${suggestion.id}` }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/** Structure-level decorations (claim classes, number prefix, placeholder). Cheap enough to rebuild on every change. */
function buildStructure(doc: PMNode, issues: Issue[]): Decoration[] {
  const severity = new Map<string, 'error' | 'warning'>();
  for (const issue of issues) {
    if (severity.get(issue.claimId) !== 'error') severity.set(issue.claimId, issue.severity);
  }
  const out: Decoration[] = [];
  const empty = doc.childCount === 1 && doc.child(0).content.size === 0;
  doc.forEach((node, pos) => {
    const id = node.attrs.id as string | null;
    const level = id ? severity.get(id) : undefined;
    const attrs: Record<string, string> = { class: `claim${level ? ` has-${level}` : ''}` };
    if (empty) {
      attrs.class += ' is-empty';
      attrs['data-placeholder'] = 'Type "1." and the first claim to begin. Enter starts the next numbered claim.';
    }
    out.push(Decoration.node(pos, pos + node.nodeSize, attrs));
    const prefix = PREFIX.exec(node.textContent)?.[0].length ?? 0;
    if (prefix > 0) out.push(Decoration.inline(pos + 1, pos + 1 + prefix, { class: 'claim-no' }));
  });
  return out;
}

export interface ClaimsKitOptions {
  onSuggestionClick?: (id: string) => void;
}

/**
 * Turns plain paragraphs into numbered claims: unique ids, Enter starts the next number,
 * and issues and suggestions are drawn as decorations from data pushed in through a transaction meta.
 */
export const ClaimsKit = Extension.create<ClaimsKitOptions>({
  name: 'claimsKit',

  addOptions() {
    return { onSuggestionClick: undefined };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        const { number } = parseLine($from.parent.textContent);
        return editor
          .chain()
          .splitBlock()
          .insertContent(`${number + 1}. `)
          .scrollIntoView()
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    const { onSuggestionClick } = this.options;
    let structure: { doc: PMNode; issues: Issue[]; set: DecorationSet } | null = null;

    return [
      new Plugin({
        key: new PluginKey('claimIds'),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const seen = new Set<string>();
          let tr = state.tr;
          let changed = false;
          state.doc.forEach((node, pos) => {
            const id = node.attrs.id as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return;
            }
            const fresh = createClaim(0, '').id;
            seen.add(fresh);
            tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
            changed = true;
          });
          return changed ? tr : null;
        },
      }),
      new Plugin<PluginState>({
        key: decorationKey,
        state: {
          init: () => ({ marks: DecorationSet.empty, issues: [] }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(decorationKey) as DecorationData | undefined;
            if (meta) return { marks: buildMarks(newState.doc, meta), issues: meta.issues };
            if (tr.docChanged) return { ...value, marks: value.marks.map(tr.mapping, tr.doc) };
            return value;
          },
        },
        props: {
          decorations(state) {
            const doc = state.doc;
            const current = decorationKey.getState(state);
            const marks = current?.marks ?? DecorationSet.empty;
            const issues = current?.issues ?? [];
            if (!structure || structure.doc !== doc || structure.issues !== issues) {
              structure = { doc, issues, set: DecorationSet.create(doc, buildStructure(doc, issues)) };
            }
            return structure.set.add(doc, marks.find());
          },
          handleDOMEvents: {
            click(_view, event) {
              const target = event.target as HTMLElement | null;
              const id = target?.closest<HTMLElement>('[data-sug]')?.dataset.sug;
              if (id) onSuggestionClick?.(id);
              return false;
            },
          },
        },
      }),
    ];
  },
});

export { EMPTY as EMPTY_DECORATION_DATA };
