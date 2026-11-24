export interface Claim {
  /** Stable identifier used for React keys and DOM anchors. */
  id: string;
  /** The claim number as the user typed it. May be duplicated or out of sequence. */
  number: number;
  text: string;
}

export interface ClaimDocument {
  title: string;
  claims: Claim[];
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
  | 'antecedent';

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

export interface Analysis {
  issues: Issue[];
  issuesByClaim: Record<string, Issue[]>;
}
