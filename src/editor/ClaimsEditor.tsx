import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import type { Suggestion } from '../domain/suggestions';
import type { Claim, Issue } from '../domain/types';
import { claimsToJson, docToClaims, sameClaims } from './claimsDoc';
import { ClaimsKit, decorationKey } from './claimsKit';

export interface ClaimsEditorHandle {
  /** Moves the caret to a claim (optionally selecting a range of its text) and scrolls it into view. */
  focusClaim: (claimId: string, range?: [number, number]) => void;
  /** Scrolls a claim range into view without moving the caret. */
  reveal: (claimId: string, offset: number) => void;
  /** Id of the claim the caret is in, if any. */
  currentClaimId: () => string | null;
  focus: () => void;
  /** Appends the next numbered claim and puts the caret in it. */
  addClaim: () => void;
}

interface Props {
  claims: Claim[];
  issues: Issue[];
  suggestions: Suggestion[];
  activeSuggestionId: string | null;
  onClaimsChange: (claims: Claim[], editedClaimId: string | null) => void;
  onSuggestionClick: (id: string) => void;
}

const IdParagraph = Paragraph.extend({
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-claim-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-claim-id': attrs.id as string } : {}),
      },
    };
  },
});

function locate(editor: Editor, claimId: string) {
  let found: { pos: number; prefix: number; size: number } | null = null;
  editor.state.doc.forEach((node, pos) => {
    if (found || node.attrs.id !== claimId) return;
    const prefix = /^\s*\d+\s*[.)]\s?/.exec(node.textContent)?.[0].length ?? 0;
    found = { pos, prefix, size: node.content.size };
  });
  return found as { pos: number; prefix: number; size: number } | null;
}

export const ClaimsEditor = forwardRef<ClaimsEditorHandle, Props>(function ClaimsEditor(
  { claims, issues, suggestions, activeSuggestionId, onClaimsChange, onSuggestionClick },
  ref,
) {
  const claimsRef = useRef(claims);
  claimsRef.current = claims;
  const changeRef = useRef(onClaimsChange);
  changeRef.current = onClaimsChange;
  const clickRef = useRef(onSuggestionClick);
  clickRef.current = onSuggestionClick;

  const initial = useMemo(() => claimsToJson(claims), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions: [
      Document,
      IdParagraph,
      Text,
      ClaimsKit.configure({ onSuggestionClick: (id) => clickRef.current(id) }),
    ],
    content: initial,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Claims',
        'aria-describedby': 'claims-hint',
        spellcheck: 'true',
        class: 'claims-prose',
      },
    },
    onUpdate({ editor: ed }) {
      const next = docToClaims(ed.state.doc, claimsRef.current).map((c) => c.claim);
      if (sameClaims(next, claimsRef.current)) return;
      const id = (ed.state.selection.$from.parent.attrs.id as string | null) ?? null;
      changeRef.current(next, id);
    },
  });

  // Push external changes (undo, accepted suggestions, renumber, restored versions) into the editor.
  useEffect(() => {
    if (!editor) return;
    const current = docToClaims(editor.state.doc, claims).map((c) => c.claim);
    if (sameClaims(current, claims)) return;
    const { from } = editor.state.selection;
    const hadFocus = editor.isFocused;
    editor.commands.setContent(claimsToJson(claims), false);
    if (hadFocus) editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size - 1));
  }, [claims, editor]);

  // Push issues and suggestion marks in as decorations.
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(decorationKey, { issues, suggestions, activeSuggestionId }).setMeta('addToHistory', false),
    );
  }, [editor, issues, suggestions, activeSuggestionId]);

  useImperativeHandle(
    ref,
    () => ({
      focusClaim(claimId, range) {
        if (!editor) return;
        const at = locate(editor, claimId);
        if (!at) return;
        const base = at.pos + 1 + at.prefix;
        const limit = at.pos + 1 + at.size;
        const chain = editor.chain().focus();
        if (range) chain.setTextSelection({ from: Math.min(base + range[0], limit), to: Math.min(base + range[1], limit) });
        else chain.setTextSelection(limit);
        chain.scrollIntoView().run();
      },
      reveal(claimId, offset) {
        if (!editor) return;
        const at = locate(editor, claimId);
        if (!at) return;
        const pos = Math.min(at.pos + 1 + at.prefix + offset, at.pos + 1 + at.size);
        const { node } = editor.view.domAtPos(pos);
        const el = node instanceof HTMLElement ? node : node.parentElement;
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      },
      currentClaimId() {
        return editor ? ((editor.state.selection.$from.parent.attrs.id as string | null) ?? null) : null;
      },
      focus() {
        editor?.commands.focus();
      },
      addClaim() {
        if (!editor) return;
        const highest = Math.max(0, ...claimsRef.current.map((c) => c.number));
        const chain = editor.chain().focus('end');
        if (claimsRef.current.length > 0) chain.splitBlock();
        chain.insertContent(`${highest + 1}. `).scrollIntoView().run();
      },
    }),
    [editor],
  );

  return (
    <div className="editor-shell">
      <EditorContent editor={editor} />
      <p id="claims-hint" className="sr-only">
        Each paragraph is one claim and starts with its number. Press Enter to start the next numbered claim.
      </p>
    </div>
  );
});
