import type { Claim, Issue } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  claims: Claim[];
  issues: Issue[];
  onGoTo: (issue: Issue) => void;
  onRenumber: () => void;
}

const LABEL: Record<Issue['code'], string> = {
  'reference-missing': 'Reference',
  'reference-forward': 'Reference',
  'numbering-duplicate': 'Numbering',
  'numbering-gap': 'Numbering',
  'numbering-missing': 'Numbering',
  antecedent: 'Antecedent',
  'spec-unsupported': 'Support',
};

export function IssuesPanel({ claims, issues, onGoTo, onRenumber }: Props) {
  if (issues.length === 0) {
    return (
      <div className="empty">
        <span className="empty-icon ok">
          <Icon name="check" size={20} />
        </span>
        <p className="empty-title">No issues found</p>
        <p className="muted">References, numbering, antecedent basis and description support all check out.</p>
      </div>
    );
  }
  const numberOf = new Map(claims.map((c) => [c.id, c.number]));
  const hasRenumber = issues.some((issue) => issue.fix === 'renumber');
  return (
    <div>
      {hasRenumber && (
        <button type="button" className="btn btn-block" onClick={onRenumber}>
          <Icon name="renumber" /> Fix numbering: renumber claims
        </button>
      )}
      <ul className="issue-list" aria-label="Issues">
        {issues.map((issue, index) => (
          <li key={`${issue.claimId}-${issue.code}-${index}`}>
            <button type="button" className={`issue-row ${issue.code === 'spec-unsupported' ? 'spec' : issue.severity}`} onClick={() => onGoTo(issue)}>
              <span className="issue-icon">
                <Icon name={issue.severity === 'error' ? 'alert' : 'info'} size={15} />
              </span>
              <span className="issue-body">
                <span className="issue-meta">
                  <span className="issue-claim">Claim {numberOf.get(issue.claimId) || '?'}</span>
                  <span className="issue-kind">{LABEL[issue.code]}</span>
                  <span className="sr-only">{issue.severity === 'error' ? 'Error' : 'Warning'}</span>
                </span>
                <span className="issue-text">{issue.message}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
