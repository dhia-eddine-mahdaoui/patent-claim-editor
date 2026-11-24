export interface Claim {
  /** Stable identifier used for React keys, DOM anchors and editor decorations. */
  id: string;
  /** The claim number as the user typed it. May be duplicated or out of sequence. 0 means "no number typed". */
  number: number;
  /** The claim body without its leading "N." prefix. */
  text: string;
}

export interface ClaimDocument {
  title: string;
  claims: Claim[];
  /** Plain-text description (specification). Claim terms are checked against it. */
  spec: string;
}

/** A "claim N" style reference found inside claim text. Offsets cover the whole phrase. */
export interface ClaimReference {
  number: number;
  start: number;
  end: number;
}

export type IssueCode =
  | 'reference-missing'
  | 'reference-forward'
  | 'numbering-duplicate'
  | 'numbering-gap'
  | 'numbering-missing'
  | 'antecedent'
  | 'spec-unsupported';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  claimId: string;
  message: string;
  /** Character range inside the claim text to highlight. */
  range?: [number, number];
  /** A one-click fix that the UI can offer for this issue. */
  fix?: 'renumber';
}

/** One claim term and whether the description uses it. */
export interface SupportTerm {
  /** The term as first written in the claims, without its article. */
  term: string;
  claimId: string;
  claimNumbers: number[];
  /** Range of the term inside the first claim that introduces it. */
  range: [number, number];
  supported: boolean;
  /** How many times the (normalised) term occurs in the description. */
  occurrences: number;
}

export interface SupportReport {
  terms: SupportTerm[];
  supportedCount: number;
  /** False when the description is empty, in which case nothing is flagged. */
  hasSpec: boolean;
}

export interface Analysis {
  issues: Issue[];
  issuesByClaim: Record<string, Issue[]>;
  support: SupportReport;
}
