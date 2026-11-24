import type { SupportReport } from '../domain/types';
import { Icon } from './Icon';

interface Props {
  report: SupportReport;
  onGoTo: (claimId: string, range: [number, number]) => void;
  onFocusSpec: () => void;
}

export function SupportPanel({ report, onGoTo, onFocusSpec }: Props) {
  if (!report.hasSpec) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <Icon name="file" size={20} />
        </span>
        <p className="empty-title">No description yet</p>
        <p className="muted">Write or paste the description. Every term a claim introduces is then checked against it.</p>
        <button type="button" className="btn btn-sm" onClick={onFocusSpec}>
          Go to description
        </button>
      </div>
    );
  }
  const total = report.terms.length;
  const missing = total - report.supportedCount;
  const percent = total === 0 ? 100 : Math.round((100 * report.supportedCount) / total);
  const sorted = [...report.terms].sort((a, b) => Number(a.supported) - Number(b.supported));

  return (
    <div>
      <div className="coverage">
        <div className="coverage-head">
          <strong>
            {report.supportedCount} of {total}
          </strong>{' '}
          claim terms are described
          <span className="coverage-pct">{percent}%</span>
        </div>
        <div className="progress" role="img" aria-label={`${percent} percent of claim terms are described in the specification`}>
          <span className={missing ? 'warn' : 'ok'} style={{ width: `${percent}%` }} />
        </div>
      </div>
      <ul className="term-list" aria-label="Claim terms">
        {sorted.map((term) => (
          <li key={term.term}>
            <button
              type="button"
              className={`term-row ${term.supported ? 'ok' : 'missing'}`}
              onClick={() => onGoTo(term.claimId, term.range)}
            >
              <span className="term-icon">
                <Icon name={term.supported ? 'check' : 'alert'} size={14} />
              </span>
              <span className="term-body">
                <span className="term-name">{term.term}</span>
                <span className="muted">
                  claim {term.claimNumbers.join(', ')}
                  {term.supported
                    ? ` · found ${term.occurrences}×`
                    : ' · not found in the description'}
                </span>
              </span>
              <span className="sr-only">{term.supported ? 'Described' : 'Unsupported'}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted fine">
        Terms are matched by word, ignoring plurals. A synonym in the description still counts as unsupported.
      </p>
    </div>
  );
}
