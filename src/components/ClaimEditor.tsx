import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Claim, Issue } from '../domain/types';

interface EditorProps {
  claims: Claim[];
  issuesByClaim: Record<string, Issue[]>;
  onText: (id: string, text: string) => void;
  onNumber: (id: string, value: number) => void;
  onDelete: (id: string) => void;
  onRenumber: () => void;
}

export function ClaimEditor({ claims, issuesByClaim, onText, onNumber, onDelete, onRenumber }: EditorProps) {
  if (claims.length === 0) {
    return <p className="muted">No claims yet. Use "Add claim" to start.</p>;
  }
  return (
    <ul className="claim-list" aria-label="Claims">
      {claims.map((claim) => (
        <ClaimRow
          key={claim.id}
          claim={claim}
          issues={issuesByClaim[claim.id] ?? []}
          onText={onText}
          onNumber={onNumber}
          onDelete={onDelete}
          onRenumber={onRenumber}
        />
      ))}
    </ul>
  );
}

interface RowProps {
  claim: Claim;
  issues: Issue[];
  onText: (id: string, text: string) => void;
  onNumber: (id: string, value: number) => void;
  onDelete: (id: string) => void;
  onRenumber: () => void;
}

function ClaimRow({ claim, issues, onText, onNumber, onDelete, onRenumber }: RowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea so the highlight layer underneath always lines up with it.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [claim.text]);

  const ranges: HighlightRange[] = issues.flatMap((issue) =>
    issue.range ? [{ start: issue.range[0], end: issue.range[1], severity: issue.severity }] : [],
  );
  const hasError = issues.some((issue) => issue.severity === 'error');
  const issuesId = `issues-${claim.id}`;

  return (
    <li id={`claim-${claim.id}`} className="claim-row">
      <div className="claim-head">
        <label className="number-field">
          <span>No.</span>
          <input
            type="number"
            min={1}
            step={1}
            value={claim.number}
            aria-label={`Claim ${claim.number} number`}
            onChange={(event) => onNumber(claim.id, Math.max(1, Math.floor(Number(event.target.value)) || 1))}
          />
        </label>
        <button type="button" className="ghost" onClick={() => onDelete(claim.id)} aria-label={`Delete claim ${claim.number}`}>
          Delete
        </button>
      </div>
      <div className="editor-wrap">
        <Mirror text={claim.text} ranges={ranges} />
        <textarea
          ref={textareaRef}
          className="editor-field"
          rows={3}
          value={claim.text}
          spellCheck
          aria-label={`Claim ${claim.number} text`}
          aria-invalid={hasError}
          aria-describedby={issues.length > 0 ? issuesId : undefined}
          onChange={(event) => onText(claim.id, event.target.value)}
        />
      </div>
      {issues.length > 0 && (
        <ul id={issuesId} className="issues" aria-label={`Issues for claim ${claim.number}`}>
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`issue ${issue.severity}`}>
              <span className="badge">{issue.severity === 'error' ? 'Error' : 'Warning'}</span>
              <span className="issue-message">{issue.message}</span>
              {issue.fix === 'renumber' && (
                <button type="button" className="small" onClick={onRenumber}>
                  Fix: renumber claims
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

interface HighlightRange {
  start: number;
  end: number;
  severity: 'error' | 'warning';
}

/** Read-only layer drawn beneath the transparent textarea so issue ranges appear inline. */
function Mirror({ text, ranges }: { text: string; ranges: HighlightRange[] }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  [...ranges]
    .sort((a, b) => a.start - b.start)
    .forEach((range, index) => {
      if (range.start < cursor || range.end <= range.start) return;
      if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
      nodes.push(
        <mark key={index} className={`hl hl-${range.severity}`}>
          {text.slice(range.start, range.end)}
        </mark>,
      );
      cursor = range.end;
    });
  nodes.push(text.slice(cursor));
  return (
    <div className="mirror editor-field" aria-hidden="true">
      {nodes}
      {' '}
    </div>
  );
}
