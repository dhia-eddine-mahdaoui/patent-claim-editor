import { firstClaimByNumber, parseReferences } from './parser';
import type { Claim, Issue } from './types';

/**
 * Antecedent-basis checker (rule-based, heuristic).
 *
 * A definite reference ("the sensor", "said sensor") needs an earlier introduction
 * ("a sensor", "an apparatus") either earlier in the same claim or in a claim it
 * depends on (directly or transitively). Matching is on normalised words, and a
 * reference is accepted if any of its words was introduced, which keeps false
 * positives low at the cost of missing some real errors.
 */

const MAX_PHRASE_WORDS = 4;

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'said', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'for',
  'and', 'or', 'that', 'which', 'wherein', 'whereby', 'comprising', 'comprises', 'comprise',
  'including', 'includes', 'having', 'has', 'have', 'is', 'are', 'be', 'being', 'was', 'were',
  'configured', 'adapted', 'operable', 'coupled', 'connected', 'between', 'as', 'such', 'when',
  'where', 'claim', 'claims', 'further', 'each', 'according', 'so', 'it', 'its', 'into', 'over',
  'under', 'than', 'via', 'while', 'if', 'then', 'thereby',
]);

/** Words after which "of" continues the phrase, e.g. "a plurality of sensors". */
const PLURAL_HEADS = new Set(['plurality', 'set', 'number', 'pair', 'group', 'array', 'series']);

/** References whose first word is one of these are not patent terms of art. */
const IGNORED_TERMS = new Set([
  'same', 'other', 'preceding', 'foregoing', 'above', 'below', 'following', 'claimed',
  'respective', 'corresponding', 'present', 'invention',
]);

interface Token {
  lower: string;
  start: number;
  end: number;
  isWord: boolean;
}

const TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9'-]*|[^\sA-Za-z0-9]/g;

function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(TOKEN_PATTERN), (match) => {
    const value = match[0];
    const start = match.index ?? 0;
    return {
      lower: value.toLowerCase(),
      start,
      end: start + value.length,
      isWord: /^[A-Za-z0-9]/.test(value),
    };
  });
}

/** Light singular normalisation so "sensors" and "sensor" match. Applied to both sides. */
export function normalizeTerm(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function collectPhrase(tokens: Token[], from: number): Token[] {
  const words: Token[] = [];
  let i = from;
  while (i < tokens.length && words.length < MAX_PHRASE_WORDS) {
    const token = tokens[i];
    if (!token.isWord) break;
    if (STOP_WORDS.has(token.lower)) {
      const previous = words[words.length - 1];
      if (token.lower === 'of' && previous && PLURAL_HEADS.has(previous.lower)) {
        i += 1;
        continue;
      }
      break;
    }
    words.push(token);
    i += 1;
  }
  return words;
}

export interface ScanEvent {
  kind: 'intro' | 'ref';
  /** The determiner as written in lower case: "a", "an", "the" or "said". */
  article: string;
  /** The original text from the determiner to the last word of the phrase. */
  phrase: string;
  /** Normalised content words of the phrase. */
  words: string[];
  start: number;
  end: number;
}

/** Finds indefinite introductions ("a sensor") and definite references ("the sensor") in order. */
export function scanClaim(text: string): ScanEvent[] {
  const tokens = tokenize(text);
  const events: ScanEvent[] = [];
  tokens.forEach((token, index) => {
    if (!token.isWord) return;
    const isIntro = token.lower === 'a' || token.lower === 'an';
    const isRef = token.lower === 'the' || token.lower === 'said';
    if (!isIntro && !isRef) return;
    const words = collectPhrase(tokens, index + 1);
    const last = words[words.length - 1];
    if (!last || !/^[a-z]/.test(last.lower)) return;
    events.push({
      kind: isIntro ? 'intro' : 'ref',
      article: token.lower,
      phrase: text.slice(token.start, last.end),
      words: words.filter((w) => /^[a-z]/.test(w.lower)).map((w) => normalizeTerm(w.lower)),
      start: token.start,
      end: last.end,
    });
  });
  return events;
}

/** Claims that a claim depends on, directly or transitively, through valid earlier references. */
function ancestorsOf(claim: Claim, byNumber: Map<number, Claim>): Claim[] {
  const found: Claim[] = [];
  const seen = new Set<string>();
  const visit = (current: Claim) => {
    for (const ref of parseReferences(current.text)) {
      const parent = byNumber.get(ref.number);
      // Only strictly earlier claims count; this also guarantees termination.
      if (!parent || parent.number >= current.number || seen.has(parent.id)) continue;
      seen.add(parent.id);
      found.push(parent);
      visit(parent);
    }
  };
  visit(claim);
  return found;
}

function checkClaim(claim: Claim, inherited: Set<string>): Issue[] {
  const introduced = new Set(inherited);
  const reported = new Set<string>();
  const issues: Issue[] = [];
  for (const event of scanClaim(claim.text)) {
    if (event.kind === 'intro') {
      for (const word of event.words) introduced.add(word);
      continue;
    }
    const [first] = event.words;
    if (!first || IGNORED_TERMS.has(first)) continue;
    if (event.words.some((word) => introduced.has(word))) continue;
    const key = event.words.join(' ');
    if (reported.has(key)) continue;
    reported.add(key);
    const noun = event.phrase.slice(event.article.length).trim();
    issues.push({
      code: 'antecedent',
      severity: 'warning',
      claimId: claim.id,
      range: [event.start, event.end],
      message: `"${event.phrase}" has no antecedent basis. Introduce it first as "a ${noun}".`,
    });
  }
  return issues;
}

export function checkAntecedentBasis(claims: Claim[]): Issue[] {
  const byNumber = firstClaimByNumber(claims);
  return claims.flatMap((claim) => {
    const inherited = new Set<string>();
    for (const ancestor of ancestorsOf(claim, byNumber)) {
      for (const event of scanClaim(ancestor.text)) {
        if (event.kind === 'intro') {
          for (const word of event.words) inherited.add(word);
        }
      }
    }
    return checkClaim(claim, inherited);
  });
}
